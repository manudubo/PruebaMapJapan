# Análisis del repositorio — bugs, mejoras y brechas de seguridad

> Generado por Claude (modelo **Fable 5**) vía Claude Code — 2026-07-22.
> Alcance: `backend/` (Hono + Cloudflare Workers + Drizzle/Neon), `frontend/` (Vite + Keycloak JS), `terraform/keycloak`, CI (`.github/workflows`). No incluye `.planning/` ni `node_modules/`.
> Complementa (no reemplaza) a `codex-review.md`.

---

## Resumen ejecutivo

La base de código está en buen estado general: la verificación JWT contra Keycloak es correcta (firma RS256, `exp`/`nbf`/`iss`/`aud`, refresh de JWKS ante rotación de claves), la autorización por recurso está bien encadenada (trip → destination → day → activity con chequeo de ownership en cada nivel), el hash de OTP usa HMAC con comparación de tiempo constante, y los secretos (`.dev.vars`, tfstate, tfvars) están correctamente fuera de git.

Los problemas más serios encontrados:

| # | Severidad | Hallazgo |
|---|-----------|----------|
| S-01 | **Alta** | OTP generado con `Math.random()` (no criptográfico) |
| S-02 | **Alta** | XSS en widgets de noticias: HTML de fuentes externas inyectado sin escapar |
| S-03 | **Alta** | Contenido de terceros vía proxies CORS no confiables (allorigins/corsproxy) directo al DOM |
| S-04 | Media | Invalidación de caché JWKS forzable por atacante → amplificación de carga contra Keycloak |
| S-06 | Media | Race condition (TOCTOU) en el límite de 5 intentos de OTP |
| S-07 | Media | Fallback de email a Mailpit "fail-open" si falta `RESEND_API_KEY` en producción |
| B-01 | Media | Promesa que nunca resuelve en el cliente API ante 401 |

---

## 1. Brechas de seguridad

### S-01 (Alta) — OTP generado con `Math.random()`
`backend/src/routes/auth.ts:123`

```ts
const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
```

`Math.random()` (xorshift128+ en V8) no es un CSPRNG y su estado interno es recuperable a partir de salidas observadas. Para un código de seguridad debe usarse el generador criptográfico:

```ts
const buf = new Uint32Array(1);
crypto.getRandomValues(buf);
const code = String(buf[0]! % 1_000_000).padStart(6, '0');
```

(Para eliminar el sesgo módulo, rechazar valores ≥ 4_294_000_000 y regenerar; con 6 dígitos el sesgo es ínfimo pero el fix es una línea.)

### S-02 (Alta) — XSS en widgets de noticias/eventos
`frontend/src/modules/widgets.ts:191-202` (`renderList`)

`item.title`, `item.link`, `item.source` y `item.pubDate` provienen del RSS parseado y se interpolan **sin escapar** en un template que termina en `container.innerHTML`:

```ts
return `<li ...><a href="${item.link}" ...><span class="widget-link-title">${title}</span>...`;
```

- Un `link` como `javascript:...` o un valor con `"` permite romper el atributo `href`.
- Un `title`/`source` con `<img onerror=...>` ejecuta script.

Estos datos **no vienen de Google directamente** — ver S-03.

**Fix:** escapar todo valor interpolado (helper `escapeHtml`) y validar que `link` empiece con `https://` antes de usarlo como `href`. Idealmente construir los nodos con `createElement`/`textContent` como ya hace `dashboard.ts` (que está bien hecho en ese aspecto).

### S-03 (Alta) — Proxies CORS de terceros como fuente de HTML
`frontend/src/modules/widgets.ts:166-170`

```ts
? `https://api.allorigins.win/get?url=...`
: `https://corsproxy.io/?...`
```

Todo el contenido del widget pasa por `api.allorigins.win` o `corsproxy.io`, servicios gratuitos sin garantía alguna. Cualquiera de ellos (o quien los comprometa) puede devolver XML arbitrario que, combinado con S-02, es ejecución de script en tu origen. Además filtran a esos terceros qué ciudades consulta el usuario.

**Opciones:** proxyear el RSS a través del propio Worker (misma infraestructura, dominio confiable, permite cachear y sanear en el servidor), o eliminar el widget de noticias.

### S-04 (Media) — Invalidación de caché JWKS forzable
`backend/src/auth/keycloak.ts:237-251`

Ante una firma inválida, el código hace `jwksCache = null` y refetchea JWKS para cubrir rotación de claves. Pero eso significa que **cualquier request con un `kid` válido y firma basura invalida la caché global del isolate**. Un atacante puede enviar tokens malformados en loop y convertir cada request legítimo posterior en un fetch a Keycloak (latencia + carga sobre el IdP).

**Fix:** guardar un timestamp del último refresh forzado y aplicar un cooldown (p. ej. no refetchear más de una vez por minuto por rotación sospechada).

### S-05 (Baja) — Mensajes de error de JWT filtrados al cliente
`backend/src/middleware/auth.ts:33-34`

El `catch` devuelve `err.message` textual. `verifyJwt` incluye en sus mensajes el **issuer esperado** (URL interna de Keycloak + realm) y el audience recibido. Es reconocimiento gratuito para un atacante. Devolver un genérico `invalid_token` y loggear el detalle en servidor.

### S-06 (Media) — TOCTOU en límite de intentos de OTP
`backend/src/routes/auth.ts:157-170`

El check `otp.attempts >= 5` y el `incrementOtpAttempts` no son atómicos. N requests paralelos leen el mismo `attempts` y todos pasan el check, permitiendo superar el límite de 5. Con 10 minutos de ventana y 1M de combinaciones el riesgo práctico es bajo, pero el fix es simple: incrementar de forma atómica y decidir sobre el valor retornado:

```sql
UPDATE email_otp_codes SET attempts = attempts + 1
WHERE id = $1 AND attempts < 5 RETURNING attempts;
-- 0 filas → max attempts alcanzado
```

### S-07 (Media) — Fallback de email "fail-open" a Mailpit
`backend/src/routes/auth.ts:63-83`

El branch se decide por **presencia de `RESEND_API_KEY`**: si en producción el secret falta (typo al configurarlo, rotación fallida), el código intenta postear el OTP a `http://localhost:8025` silenciosamente en lugar de fallar de forma explícita. Gatear el fallback con una variable explícita (`ENVIRONMENT=development`) y fallar con error claro si falta la key en prod.

### S-08 (Baja) — Enumeración de recursos por IDs secuenciales + 403
- IDs `serial` (autoincrementales) en todas las tablas → los IDs de trips ajenos son adivinables.
- `resolveDestination` (`backend/src/routes/trips.ts:68`) devuelve **403** cuando el trip existe pero es de otro usuario, y 404 cuando no existe → confirma existencia de recursos ajenos.

Devolver 404 en ambos casos elimina la señal. (El acceso en sí está bien protegido; esto es solo information disclosure.)

### S-09 (Baja) — Headers de seguridad incompletos
- `backend/src/middleware/security.ts`: falta `X-Content-Type-Options: nosniff` y `Permissions-Policy`.
- Frontend en GitHub Pages: **sin CSP**. GitHub Pages no permite headers custom, pero puede añadirse `<meta http-equiv="Content-Security-Policy" ...>` en los HTML — con S-02/S-03 presentes, una CSP sería la segunda línea de defensa que hoy no existe.

### S-10 (Baja) — Respuesta pública expone metadatos internos
`backend/src/db/queries/trips.ts:143-163` (`getTripBySlug`)

La respuesta del endpoint público incluye la fila completa del trip: `user_id` interno, `id` numérico y `public_slug`. Además incluye el **hotel completo** (nombre, fechas, coordenadas) de cada destino. Lo del hotel es probablemente decisión de producto (compartir itinerario completo), pero conviene: (a) proyectar columnas y omitir `user_id`/`id` internos, (b) confirmar conscientemente que compartir hoteles y fechas es lo deseado — es información sensible de ubicación en fechas concretas.

### S-11 (Baja) — Passwords default de usuarios de test commiteadas
`terraform/keycloak/variables.tf`

Seis usuarios E2E tienen passwords con `default` en texto plano en el repo. Para el realm local está bien; el riesgo es aplicar este terraform contra un Keycloak expuesto. Mitigación barata: eliminar los defaults (forzar `-var-file=local.tfvars`, ya gitignoreado) o al menos comentar explícitamente que este módulo es solo para `localhost:8080`.

### S-12 (Baja) — CORS permite localhost en producción
`backend/src/middleware/cors.ts:12-16` — `http://localhost:3000` y `:5173` están siempre permitidos. Un sitio malicioso corriendo en el localhost de la víctima puede llamar a la API de prod con las cookies... (no aplica: auth es Bearer, no cookies — impacto casi nulo, pero es higiene separar los orígenes por entorno).

---

## 2. Bugs

### B-01 (Media) — Promesa colgada para siempre ante 401
`frontend/src/api/client.ts:88-96`

```ts
return new Promise<never>(() => { /* intentionally never resolves */ });
```

Todo caller de `request()` que reciba un 401 queda colgado eternamente: spinners que no terminan, `finally` que nunca corre (nótese que `handleCreateTrip` en `dashboard.ts` rehabilita el botón en un `finally` — con 401 ese botón queda deshabilitado para siempre si el redirect no ocurre). El redirect via `setTimeout` además puede ser cancelado por navegación. Mejor: lanzar un `ApiError(401, 'unauthorized')` y centralizar el toast+redirect en un handler, con un flag para deduplicar el toast.

### B-02 (Media) — Race en auto-provisioning de usuario
`backend/src/middleware/user.ts:24-31`

Primer login: dos requests paralelos (el dashboard dispara varios fetch a la vez) ven `getUserByKeycloakId → null` y ambos llaman `createUser`. El índice único `users_keycloak_id_idx` hace que el segundo falle → 500 intermitente en el primer uso. Fix: `INSERT ... ON CONFLICT (keycloak_id) DO NOTHING` + re-select.

### B-03 (Baja) — Contrato roto en `getHotel`
`frontend/src/api/client.ts:232-238` documenta "null if none", pero el backend responde 404 con `error: 'Hotel not found'` (`trips.ts:917-920`) → el cliente **lanza** `ApiError` en vez de devolver null. Cualquier caller que siga el JSDoc tiene un bug latente. Alinear: backend 200 con `data: null`, o cliente que capture el 404.

### B-04 (Baja) — Validación de `DATABASE_URL` inconsistente
Todas las rutas de `trips.ts`/`auth.ts` chequean `c.env.DATABASE_URL`, pero `public.ts:18` no — con la env ausente, `getDb(undefined)` lanza y cae al `onError` genérico. Funciona, pero es inconsistente (ver M-01: la solución correcta elimina las 20 copias del check).

### B-05 (Baja) — Query redundante en `getTripById`
`backend/src/db/queries/trips.ts:47-77` hace un `select` del trip y después un `findFirst` con el mismo `where`. La primera query es puro costo; `findFirst` ya devuelve `undefined` si no hay match.

### B-06 (Nit) — Regex de slug laxa
`backend/src/routes/public.ts:21` — `/^[0-9a-f-]{36}$/` acepta `------------------------------------`. Inofensivo (query parametrizada), pero un regex UUID real documenta mejor la intención.

### B-07 (Nit) — Cast a `any` innecesario
`backend/src/routes/trips.ts:132` — `dayResult as { dest: any; day: any }` pierde el tipado que el resto del archivo mantiene con cuidado; el narrowing de `'error' in result` debería bastar.

### B-08 (Nit) — Comentario engañoso sobre almacenamiento de tokens
`frontend/src/auth/keycloak.ts:32` dice "Tokens are stored in sessionStorage" — keycloak-js guarda los tokens **en memoria** (lo cual es mejor). El comentario describe algo que el código no hace.

### B-09 (Baja) — OTP quemado en max-attempts obliga a esperar la expiración
`backend/src/routes/auth.ts:157-160` marca el código como usado tras 5 intentos, pero `otp-request` seguirá devolviendo 429 `otp_pending` hasta que... no: `getLatestUnexpiredOtp` filtra por `used_at IS NULL`, así que marcado como usado sí permite pedir uno nuevo de inmediato. Revisado — **no es bug**, pero un atacante puede entonces ciclar: 5 intentos → auto-quemar → pedir código nuevo → 5 intentos más. El throttle real es el email (1 código por request). Considerar un límite por usuario/hora sobre `email_otp_codes.created_at`.

---

## 3. Mejoras

### M-01 — Middleware para `DATABASE_URL` y `getDb`
El bloque `if (!c.env.DATABASE_URL) return 500` aparece ~20 veces en `trips.ts` + `auth.ts`. Un middleware que valide y setee `c.set('db', getDb(...))` elimina todas las copias y arregla B-04 de paso.

### M-02 — Reducir round-trips en la cadena de ownership
`resolveActivity` ejecuta 4 SELECTs secuenciales (trip → dest → day → act). Un único query con JOINs (o el relational API con `where` anidado) baja la latencia de los endpoints más usados. En Workers + Neon cada round-trip es red real.

### M-03 — Estrategia unificada anti-XSS en el frontend
Hay dos estilos conviviendo: DOM seguro (`dashboard.ts`, `buildOtpModal` — `createElement`/`textContent`) y template-strings a `innerHTML` (`widgets.ts`, `SearchBar.ts`, `profile.ts`). Los datos de la API (nombres de trips/actividades editables por usuarios) terminarán tarde o temprano en un sink `innerHTML` — `SearchBar.renderResults` interpola `result.title`/`subtitle` sin escapar, hoy con datos estáticos, mañana con datos de la API. Definir un helper `el(tag, props, children)` o un `escapeHtml` obligatorio, y dejar `innerHTML` solo para SVGs constantes.

### M-04 — Timeout en el cliente API
`request()` no usa `AbortSignal.timeout()`. Un backend colgado deja la UI esperando indefinidamente.

### M-05 — Validaciones de dominio en Zod
- `UpdateTripSchema.partial()` acepta `{}` → UPDATE que solo toca `updated_at`. Añadir `.refine(obj => Object.keys(obj).length > 0)`.
- `start_date <= end_date` no se valida ni en trip ni en destination ni en hotel.
- `lat`/`lng` son `z.coerce.string()` sin rango — acepta `"999"` como latitud. Validar −90..90 / −180..180.
- `time` en activities es `string` libre — sin formato validado.

### M-06 — Rate limiting a nivel plataforma
No hay rate limiting global (solo el implícito de OTP). Cloudflare ofrece Rate Limiting Rules por ruta — barato de configurar para `/api/auth/*` y `/api/public/*` (este último es anónimo y golpea la DB).

### M-07 — CSP en el frontend
Vía `<meta http-equiv>` en los HTML (GitHub Pages no da headers). Con `script-src 'self'` + `connect-src` explícito, S-02/S-03 pasarían de "ejecución de script" a "no-op".

### M-08 — Higiene del monorepo
- `uat-passkeys.spec.ts` suelto en la raíz (fuera de `tests/`).
- `codex-review.md` (49KB) sin trackear en la raíz — mover a `docs/` o `.planning/` si se quiere conservar.
- 69 commits sin pushear a `origin/main` — riesgo de pérdida local y de divergencia larga.

### M-09 — Observabilidad
Los `catch {}` de las rutas descartan el error real (p. ej. `trips.ts:156-159`): todo termina en un genérico "Failed to fetch X" sin log. `console.error(err)` antes de responder haría los 500 de producción diagnosticables en `wrangler tail`.

---

## 4. Lo que está bien (para no tocarlo por accidente)

- **JWT**: verificación completa de firma RS256 + claims, con manejo de rotación de claves; solo acepta `alg: RS256` (inmune a `alg: none`).
- **OTP hashing**: HMAC-SHA256 con secret del servidor + comparación en tiempo constante correctamente implementada (hash solo del código submitido, XOR acumulador).
- **Autorización**: ownership verificado en cada nivel de anidamiento; queries siempre parametrizadas vía Drizzle (sin SQL injection aparente).
- **Secretos**: `.dev.vars`, `local.tfvars`, `tfstate` gitignoreados y verificado que no están trackeados; CI usa GitHub Secrets; `wrangler.toml` sin secretos inline.
- **Keycloak frontend**: PKCE S256, tokens en memoria, silent-check-sso con base path correcto para GitHub Pages.
- **Schema**: FKs con `onDelete: cascade` coherentes, `public_slug` UUID aleatorio e indexado único.

---

## 5. Priorización sugerida

1. **S-01** (una línea) y **S-05** (dos líneas) — fixes triviales, hacer ya.
2. **S-02 + S-03 + M-07** — el paquete XSS: escapar interpolaciones, validar `href`, CSP por meta tag. Es la brecha explotable más real del repo.
3. **B-01 + B-02** — los dos bugs que usuarios reales van a pisar (401 colgado, 500 intermitente en primer login).
4. **S-04, S-06, S-07** — hardening del flujo auth/OTP.
5. El resto según vaya tocándose cada archivo (regla de "dejar el código mejor de lo que estaba").

---

# Segunda pasada — cobertura ampliada

> Áreas revisadas en profundidad: rutas `users`/`health`, capa `db` (factory + queries), frontend `profile`/`AuthGuard`/`map`/`tripDetail`, tema FreeMarker de Keycloak, scripts, y los tres workflows de CI/CD. Numeración continúa desde la primera pasada.

## 6. Seguridad (adicional)

### S-13 (Media) — Posible XSS en la página de error de Keycloak
`keycloak/themes/japan-trip/login/error.ftl:7`

```ftl
<p class="instruction">${message.summary?no_esc}</p>
```

El `error.ftl` **estándar** de Keycloak sanea antes de deshabilitar el escape: `${kcSanitize(message.summary)?no_esc}`. Este tema dropeó el `kcSanitize`, dejando `?no_esc` a secas. `message.summary` puede contener parámetros derivados de la request en ciertos flujos de error → riesgo de inyección de HTML en la página de login. El `login.ftl` del mismo tema **sí** usa `kcSanitize` (línea 58), así que es una inconsistencia, no una decisión deliberada. **Fix:** `${kcSanitize(message.summary)?no_esc}`.

### S-14 (Media) — `GET /api/users/me` auto-provisiona sin validar `DATABASE_URL` y sin try/catch
`backend/src/routes/users.ts:42-55`

A diferencia de `trips.ts`/`auth.ts`, ninguna ruta de `users.ts` valida `c.env.DATABASE_URL` ni envuelve las llamadas a DB en try/catch. Con la env ausente o un fallo transitorio de Neon, el error se propaga al `onError` global (500 genérico). Además `getOrCreateUser` tiene la **misma race de B-02**: dos `GET /me` paralelos en el primer login → violación del índice único → 500. Como `AuthGuard` + el arranque de varias páginas disparan `getMe()` casi en paralelo, esta ruta es de hecho el punto más probable donde B-02 se manifiesta.

### S-15 (Baja) — Passkeys renderizadas con `innerHTML` sin escapar
`frontend/src/pages/profile.ts:86-107`

`c.userLabel` (etiqueta de la passkey, editable por el usuario al registrarla) se interpola directo en `innerHTML`:

```ts
const label = c.userLabel ?? 'Passkey';
return `<li ...><span class="passkey-name">${label}</span>...`;
```

El `userLabel` viene de la Account API de Keycloak, pero **su origen es input del propio usuario**. Un label como `<img onerror=...>` se ejecuta en la página de perfil (self-XSS, pero abre la puerta a otros vectores). Escapar `label` o construir con `textContent`.

### S-16 (Baja) — Endpoint de salud filtra el nombre del servicio
`backend/src/routes/health.ts` y `index.ts:19-24` exponen `service`, `version` y `message` sin auth. Menor, pero es fingerprinting gratuito; conviene un health mínimo (`{status:'ok'}`).

## 7. Bugs (adicional)

### B-10 (Media) — `getMapsUrl(activity.name)` genera URLs con datos sin validar
`frontend/src/modules/map.ts:53-59` — Aunque `createPopupContent` pasa el resultado por `DOMPurify.sanitize` (bien 👍), el `href` del popup del overview (`map.ts:394`) interpola `city.link` que viene de `ITINERARY` (datos estáticos, hoy seguro). El patrón es correcto **para datos estáticos**; el riesgo aparece si algún día estos popups se alimentan de datos de la API. Nota positiva: la sanitización con DOMPurify en `map.ts` y `tripDetail.ts` está bien aplicada — es el modelo a replicar en `widgets.ts`/`SearchBar.ts`/`profile.ts` (ver S-02, S-15, M-03).

### B-11 (Baja) — `createElement` helper reintroduce el sink `innerHTML`
`frontend/src/modules/utils.ts:45-53` — El helper "seguro" acepta un parámetro `html` que va directo a `el.innerHTML`. Cualquier caller que le pase datos dinámicos hereda el problema. Debería aceptar `textContent` por defecto y exponer `innerHTML` solo con nombre explícito.

### B-12 (Baja) — `upsertUser` existe pero nadie la usa; el login real no refresca email/name
`backend/src/db/queries/users.ts:92-105` define `upsertUser` (refresca email/name en cada login), pero el flujo real usa `getOrCreateUser`/`ensureUserProvisioned`, que **solo crean**. Si el usuario cambia su email o nombre en Keycloak, la copia en la DB queda desactualizada para siempre. O se usa `upsertUser`, o se borra (código muerto que confunde).

### B-13 (Baja) — `getUserInfo`/`getMe` divergen en la fuente de verdad
El frontend tiene dos caminos para los datos de usuario: `getUserInfo()` (decodifica el token localmente) y `getMe()` (va al backend). Pueden divergir (el token trae claims frescos, la DB puede estar desactualizada por B-12). Documentar cuál es autoritativo para cada caso.

## 8. CI/CD y operaciones

### O-01 (Media) — Los deploys no dependen del CI
`deploy-backend.yml` y `deploy-frontend.yml` se disparan en `push` a `main` por `paths`, **sin `needs`** sobre los jobs de `ci.yml` ni `workflow_run`. Resultado: un push a `main` que rompe typecheck o tests **igual despliega a producción** — CI y deploy corren en paralelo, no en secuencia. **Fix:** encadenar el deploy con `workflow_run` sobre CI exitoso, o mover typecheck+test como job previo dentro del propio workflow de deploy.

### O-02 (Media) — El deploy de backend no corre typecheck ni tests
`deploy-backend.yml` hace `npm ci` + `wrangler deploy` directo. No hay `tsc --noEmit` ni `vitest` antes de publicar el Worker. Combinado con O-01, un backend que no compila puede llegar a producción (Wrangler transpila pero no type-checkea).

### O-03 (Baja) — `wrangler deploy` sin versión fijada
`deploy-backend.yml:19` usa `npx wrangler deploy` — toma la última versión de wrangler publicada en npm en cada run. Un cambio mayor de wrangler puede romper el deploy sin que nada cambie en el repo. Fijar wrangler en `devDependencies` del backend y usar el binario local.

### O-04 (Baja) — `compatibility_date` del Worker congelada en 2024-01-01
`backend/wrangler.toml` — con `nodejs_compat` activo pero fecha de compatibilidad vieja, se pierden fixes de runtime. Revisar y avanzar la fecha con testing.

### O-05 (Nit) — `npm ci` duplicado en el job e2e
`ci.yml:56-58` corre `npm ci` en la raíz y otra vez en `tests/` — el segundo probablemente redundante según cómo estén configurados los workspaces; revisar para acelerar CI.

## 9. Notas de arquitectura / deuda

- **N-01** — `createDb` retorna `any` (`db/index.ts:16`) con eslint-disable. Se pierde todo el tipado de Drizzle aguas abajo; el `dest: any`/`day: any` de `trips.ts:132` (B-07) es consecuencia directa. Un tipo unión `NeonDb | PgDb` recuperaría el checking.
- **N-02** — El patrón dual-driver (node-postgres local / neon-http prod) se decide por substring `localhost` en la URL. Frágil: una URL de Neon que contenga `localhost` en un parámetro, o un túnel local a Neon, elige el driver equivocado. Preferir una env explícita (`DB_DRIVER`).
- **N-03** — `getToken()` en `frontend/src/auth/keycloak.ts` tiene lógica de refresh delicada (comentarios sobre `updateToken(30)` que tira si no hay refresh token tras silent-check-sso). Es un punto históricamente frágil; conviene un test de integración que cubra el camino "authenticated sin refresh token".
- **N-04** — Higiene de tests: `tests/global-setup.ts` acumula manejo de casos especiales por usuario (Case A/B de webauthn, `kcLoginSessionUser`, etc.). Está creciendo en complejidad; el comentario del diff sugiere que el flujo de required-actions de Keycloak es una fuente recurrente de flakiness. Vale la pena extraer un helper único de login que absorba ambos casos en vez de replicar la lógica por usuario.

---

---

# Tercera pasada — cierre y matiz clave sobre el riesgo XSS

Revisado el editor CRUD (`trip-edit/*`), la vista pública `tripDetail.ts` y `Navbar.ts`. Esto **matiza y refina** el riesgo XSS de la primera pasada:

### Conclusión refinada sobre XSS (importante)

El repo tiene **tres niveles de manejo de HTML**, y la protección está aplicada exactamente donde el dato cruza fronteras de confianza:

| Superficie | Dato renderizado | Cómo | Veredicto |
|---|---|---|---|
| `tripDetail.ts` (vista pública, trip de **otro** usuario) | `activity.name`, `notes`, `hotel.name` de la API | popups vía `DOMPurify.sanitize`; sidebar vía `textContent`/`setText` | ✅ **Protegido** |
| `map.ts` (overview + city) | datos de `ITINERARY` (estáticos) + popups | `DOMPurify.sanitize` | ✅ Protegido |
| `trip-edit/*` (editor CRUD) | datos propios del usuario | **cero `innerHTML`** — todo `createElement`/`textContent` | ✅ Protegido |
| `widgets.ts` (noticias/eventos) | HTML de RSS vía **proxies de terceros** | template string → `innerHTML` **sin sanear** | ❌ **Vulnerable (S-02/S-03)** |
| `profile.ts` (passkeys) | `userLabel` (input del usuario) | template string → `innerHTML` **sin escapar** | ⚠️ Self-XSS (S-15) |
| `SearchBar.ts` | `result.title`/`subtitle` (hoy estáticos) | template string → `innerHTML` | ⚠️ Latente (M-03) |

**El dato genuinamente cross-user (trips públicos compartidos) está bien defendido con DOMPurify.** La brecha explotable real (S-02+S-03) es el widget de noticias alimentado por proxies CORS no confiables — no toca datos de otros usuarios, pero sí ejecuta HTML de terceros en tu origen. Esto **refuerza** la priorización: el paquete widgets (S-02/S-03/M-07) sigue siendo lo primero a arreglar en el frontend, pero el modelo correcto a replicar (DOMPurify + `textContent`) **ya existe en el propio repo** en `tripDetail.ts` y `map.ts` — es cuestión de extenderlo, no de inventarlo.

`Navbar.ts:92` usa `innerHTML` con un template estático (sin datos externos) → seguro. `Navbar.ts:362` interpola solo un booleano de tema → seguro.

---

## Estado final de esta revisión

Cobertura alcanzada — **repositorio auditado de forma integral**:

- **Backend completo**: todas las rutas (trips, users, auth, public, health, index), middleware (auth, cors, security, user), queries (users, trips, otp + resto), factory DB, validación Zod, schema Drizzle.
- **Frontend**: auth (keycloak, AuthGuard), api client, map, widgets, profile, dashboard, tripDetail, editor CRUD (`trip-edit/*`), Navbar, utils.
- **Keycloak**: tema FreeMarker (login, error, otp, verify-email).
- **Infra**: terraform/keycloak, wrangler.toml, `.dev.vars`/gitignore.
- **CI/CD**: los tres workflows (ci, deploy-backend, deploy-frontend) + script `dev.js`.

Auditados superficialmente (sin hallazgos que agregar más allá del patrón ya documentado): módulos menores `search.ts`/`countdown.ts`/`toast.ts`/`theme.ts` y la suite E2E salvo `global-setup.ts`. El patrón de riesgo dominante quedó completamente caracterizado, así que cualquier revisión futura de esos archivos debe aplicar la tabla de arriba como checklist.

**Totales:** 16 hallazgos de seguridad (3 altas, 6 medias, 7 bajas), 13 bugs, 9 mejoras, 5 ítems de CI/CD-ops y 4 notas de arquitectura. Todos con referencia `archivo:línea`.

---

# Cuarta pasada — lógica del editor (trip-edit) y módulos

> Auditoría de comportamiento (no solo XSS) del CRUD del editor y módulos de soporte. Aquí aparece el bug funcional más concreto de todo el análisis.

## B-14 (Media, **bug funcional confirmado**) — El reordenamiento de actividades no se refleja en la UI
`frontend/src/pages/trip-edit/activities.ts:407-439` + `:472`

`handleReorder` hace una actualización optimista intercambiando **posiciones en el array** (`newActivities`), pero **no toca `order_index`**:

```ts
[newActivities[movedIndex], newActivities[swapIndex]] = [newActivities[swapIndex], newActivities[movedIndex]];
day.activities = newActivities;
renderActivitiesDisplay(container, day, tripId, destId); // ← re-render
```

Pero `renderActivitiesDisplay` **re-ordena por `order_index`** en cada render (línea 472):

```ts
const sorted = [...day.activities].sort((a, b) => a.order_index - b.order_index);
```

Como los `order_index` **no cambiaron** (solo la posición en el array), el sort deshace el swap y la UI vuelve a mostrar el orden original. El usuario hace clic en ▲/▼ y **nada cambia visualmente**. Peor: la llamada a `reorderActivities` **sí** persiste los nuevos `order_index` en la DB y **devuelve las filas actualizadas** (`returning()`), pero `handleReorder` **descarta el valor de retorno** (línea 429) y nunca refresca los `order_index` locales. Resultado: incluso tras un reorder exitoso, hasta un reload completo de la página es necesario para ver el nuevo orden.

**Fix:** aplicar los `order_index` devueltos por la API al estado local, o actualizar `order_index` en la actualización optimista antes de re-renderizar:

```ts
newActivities.forEach((a, i) => { a.order_index = i; });
day.activities = newActivities;
// ...y tras la API: day.activities = returnedActivities;
```

Este bug es serio porque el reordenamiento es una feature visible y la suite E2E podría no detectarlo si valida el estado de la DB en vez del DOM tras el clic. Merece un test de regresión a nivel UI.

## S-17 (Baja) — `SearchBar.highlightMatch` reintroduce HTML sin escapar
`frontend/src/components/SearchBar.ts:520-533` + `:472/491`

`highlightMatch` construye HTML concatenando substrings de `text` **sin escaparlos** y lo inserta vía `result.title` → `list.innerHTML`:

```ts
return text.substring(0, index) + '<mark ...>' + text.substring(...) + '</mark>' + text.substring(...);
```

Si `text` contiene `<`, se renderiza como HTML. Hoy la `SearchBar` opera sobre datos **estáticos** de `ITINERARY` (nombres de ciudades/actividades hardcodeados en `src/data/`), así que es **latente**, no explotable. Pero es exactamente el patrón que M-03 advierte: el día que el índice de búsqueda incluya datos de la API (nombres de trips/actividades editables), esto se vuelve XSS activo. Escapar cada substring antes de concatenar el `<mark>`.

## B-17 (Baja) — El header `User-Agent` en Nominatim es un no-op en el navegador
`frontend/src/modules/geocoder.ts:18-21`

```ts
headers: { 'User-Agent': 'PruebaMapJapan/1.0 (...)', 'Accept-Language': 'es,en' }
```

`User-Agent` es un **forbidden header** en la Fetch spec — los navegadores lo **ignoran silenciosamente** y envían su propio UA. El comentario del código ("stock fetch without it returns 403") describe comportamiento de un fetch server-side, no del navegador. Funciona hoy porque el navegador manda su propio UA, pero el header es código muerto y el contrato documentado es incorrecto. No es un bug de runtime, pero engaña al próximo que lea el archivo.

## S-18 (Baja) — Nominatim llamado directo desde el navegador
`frontend/src/modules/geocoder.ts:12-26`

Llamar a `nominatim.openstreetmap.org` directamente desde cada navegador cliente va contra la [Usage Policy de OSM](https://operations.osmfoundation.org/policies/nominatim/), que espera una app identificable con throttling centralizado, no llamadas distribuidas desde clientes. Para uso personal el riesgo es bajo (bloqueo de IP como mucho), pero si el proyecto escala conviene proxyear el geocoding por el Worker (igual que la recomendación de S-03 para el RSS).

## T-01 (Media, **gap de tests**) — La lógica de autorización más crítica no tiene tests
`backend/src/routes/trips.ts` (1017 líneas, sin `.test.ts`)

Hay tests para `auth`, `cors`, `public`, `keycloak` e `index`, pero **`trips.ts` no tiene ninguno**. Ese archivo contiene toda la cascada de autorización del sistema: `resolveDestination`/`resolveDay`/`resolveActivity`, los chequeos de ownership en cada nivel de anidamiento, y la distinción 403-vs-404. Es precisamente el código donde un bug tiene mayor impacto (acceso a recursos de otros usuarios) y donde una regresión es más fácil de introducir sin notarla. **Recomendación:** suite de tests que cubra, para cada nivel (dest/day/activity): (a) owner accede OK, (b) no-owner recibe 403/404, (c) recurso inexistente recibe 404, (d) recurso de otro trip/día recibe 404. Es el test de mayor ROI de seguridad del repo.

## B-15 (Baja) — `String(null)` literal en inputs de coordenadas al editar
`frontend/src/pages/trip-edit/activities.ts:202-203`

```ts
latInput.value = act ? String(act.lat) : '';
```

Si `act.lat` es `null` (actividad sin coordenadas), `String(null)` produce el string literal `'null'` en el input hidden. Es benigno hoy (`parseFloat('null')` → `NaN` → se filtra del payload en línea 315), pero es frágil: cualquier cambio en la lógica de parseo podría enviar `"null"` como coordenada. Usar `act.lat ?? ''`.

## B-16 (Baja) — `reorderActivities` backend no valida completitud del set
`backend/src/db/queries/activities.ts:102-132`

El JSDoc dice "`orderedIds` must contain every activity id that belongs to `dayId`", pero no se valida. Si el cliente envía un subconjunto, solo esas filas se reindexan (el `CASE ... ELSE order_index`) → índices duplicados/inconsistentes entre las incluidas y las omitidas. El `ReorderActivitiesSchema` (`z.array(z.number().int().positive())`) tampoco lo verifica. Bajo impacto (el cliente siempre manda la lista completa), pero un contrato no validado es deuda. Añadir un check de que `orderedIds` cubre exactamente el set de la día, o documentar que el reindexado parcial es intencional.

## Nota positiva — el editor CRUD está bien construido

`trip-edit/activities.ts` (y por extensión el resto del editor) usa **construcción DOM segura de punta a punta**: `createElement` + `textContent`/`setText`, `replaceChildren` para limpiar, patrón de clonado de botones para evitar listeners duplicados, actualizaciones optimistas con revert en error, y estados de loading en los botones. Es el código de más calidad del frontend. El único defecto real es B-14 (el sort que pisa el optimistic update), que es un descuido puntual, no un problema estructural. `toast.ts` también es DOM-safe (`textContent`).

---

# Totales consolidados (todas las pasadas)

| Categoría | Cantidad | Destacados |
|---|---|---|
| **Seguridad** | 18 | Altas: S-01 (OTP `Math.random`), S-02+S-03 (XSS widgets vía proxies). Medias: S-04, S-06, S-07, S-13 (error.ftl), S-14. |
| **Bugs** | 17 | B-14 (reorder no se refleja en UI — **el más concreto**), B-01 (promesa 401 colgada), B-02/S-14 (race primer login). |
| **Mejoras** | 9 | M-01 (middleware DB), M-03 (estrategia anti-XSS unificada), M-07 (CSP). |
| **CI/CD-Ops** | 5 | O-01 (deploy no depende de CI), O-02 (deploy sin typecheck/test). |
| **Arquitectura** | 4 | N-01 (`any` en factory DB), N-02 (dual-driver por substring). |
| **Gaps de test** | 1 | T-01 (`trips.ts` — toda la autorización — sin tests). |

## Los 5 hallazgos de mayor prioridad, en una línea cada uno

1. **S-01** — OTP con `Math.random()` → cambiar a `crypto.getRandomValues` (1 línea). *[seguridad alta, fix trivial]*
2. **S-02+S-03+M-07** — XSS en widgets vía proxies CORS de terceros → escapar + validar `href` + CSP. El patrón correcto (DOMPurify) ya existe en `tripDetail.ts`/`map.ts`. *[la brecha explotable real]*
3. **B-14** — El reordenamiento de actividades no se ve en la UI (el re-sort por `order_index` pisa el optimistic update). *[feature rota que el usuario nota]*
4. **O-01+O-02** — Los deploys a producción no dependen del CI ni corren typecheck. Código roto puede desplegarse. *[riesgo operacional]*
5. **T-01** — Toda la lógica de autorización (`trips.ts`) está sin tests unitarios. *[el gap de mayor ROI de seguridad]*

## Nota de método

Análisis realizado con el modelo **Fable 5** vía Claude Code, en cinco pasadas de lectura dirigida sobre el árbol real del repositorio (no sobre supuestos). Cada hallazgo incluye referencia `archivo:línea` verificable. Se corrigieron en el camino tres falsos positivos iniciales (OTP quemado tras 5 intentos, manejo de datos cross-user en `tripDetail`, y el patrón DOM del editor CRUD) para no dejar pistas engañosas. No se ejecutó código ni se corrieron los tests; los hallazgos son de lectura estática. Áreas no auditadas en profundidad: `search.ts`/`countdown.ts`/`theme.ts` (módulos de la itinerario estática, bajo riesgo) y la suite E2E completa (salvo `global-setup.ts`).

**Verificado (ya no es asunción):** los archivos restantes del editor — `days.ts`, `destinations.ts`, `hotels.ts`, `metadata.ts` — tienen **cero sinks `innerHTML`** (todos DOM-safe) y **no contienen lógica de reorder**, por lo que el bug B-14 está aislado a `activities.ts` (que es el único recurso reordenable). El editor CRUD queda confirmado como la parte más sólida del frontend, con B-14 como su único defecto real.

---

---

# Quinta pasada — infraestructura IdP, cadena de suministro (CDN/PWA), y config muerta

> Foco de esta pasada: lo que las cuatro anteriores tocaron de refilón o no tocaron — la definición Terraform del realm de Keycloak, el `realm-export.json`, el service worker (`sw.js`), la carga de dependencias por CDN en los HTML, `terraform/cloudflare`, `docker-compose`, y la config de entorno del backend. Aparece aquí S-19, uno de los dos hallazgos de mayor severidad del análisis completo (junto a S-01). Numeración continúa. *(Un hallazgo inicial de esta pasada, S-20, fue degradado tras re-verificación — ver la corrección en su entrada y la sección 14.)*

## 10. Seguridad de infraestructura / IdP

### S-19 (Alta) — Service account del Worker con `manage-users` sobre todo el realm, **sin que ningún código lo use**
`terraform/keycloak/main.tf:107-134` + `backend/src/types/index.ts:33-34` + `backend/src/dev.ts:22-23`

El cliente `japan-trip-worker` es CONFIDENTIAL con service account habilitado, y Terraform le asigna el rol **`manage-users`** del cliente `realm-management`:

```hcl
resource "keycloak_openid_client_service_account_role" "worker_manage_users" {
  service_account_user_id = keycloak_openid_client.japan_trip_worker.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = "manage-users"
}
```

`manage-users` en Keycloak es un permiso **amplísimo**: listar todos los usuarios del realm, leer/editar sus datos, resetear passwords, deshabilitar cuentas, borrar usuarios, gestionar credenciales. El secret de este cliente se despliega a producción (`terraform/cloudflare/main.tf:8-13`, `KC_ADMIN_CLIENT_SECRET`) e incluso se documenta el flujo para colocarlo en `.dev.vars` (SETUP.md:76).

**El problema:** grepeando todo `backend/src` (excluyendo tests), `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` **solo aparecen en la declaración del tipo `Env` y en el passthrough de `dev.ts`** — **ningún route, middleware o query los consume**. No hay ninguna llamada a `admin/realms`, `client_credentials`, `getAdminToken`, reset de password, ni gestión de usuarios en el código. Es decir: se aprovisiona, se le concede el permiso más peligroso del realm, y se despliega su secret a Cloudflare, **para una funcionalidad que no existe**.

Esto es una violación directa de mínimo privilegio y una superficie de ataque gratuita: si ese secret se filtra (logs, un `wrangler tail` mal compartido, un dump de env), el atacante obtiene **control total de todas las cuentas del realm** — a cambio de cero beneficio funcional. Las referencias `D-01`/`D-03`/`BACK-04` sugieren que era para una feature planificada (¿provisioning de usuarios server-side? ¿gestión de passkeys?) que nunca se implementó, o cuyo camino real terminó siendo el auto-provisioning vía JWT (`middleware/user.ts`) que no necesita admin API.

**Fix (elegir según la intención real):**
- Si la feature está muerta: eliminar el recurso `worker_manage_users`, el cliente `japan-trip-worker` si no se usa para nada más, y el secret de `terraform/cloudflare`. Quitar `KC_ADMIN_*` del tipo `Env` y de `dev.ts`.
- Si está planificada: no conceder `manage-users` (todo el realm) sino roles granulares mínimos (`view-users` si solo lee, o `manage-users` acotado por scope), y **no desplegar el secret hasta que exista el consumidor**.

Este es, junto a S-01, el hallazgo de mayor severidad del análisis: no es teórico (el permiso y el secret existen y están desplegados) y el radio de impacto es el realm completo.

### S-20 (Baja, **latente** — corregido: no es un vuln activo de prod) — `realm-export.json` contiene un redirect URI comodín peligroso, pero el archivo **nunca se importa**
`keycloak/realm-export.json:65-73` vs `terraform/keycloak/main.tf:66-82`

> **Corrección tras re-verificación:** la versión inicial de este hallazgo afirmaba que *"producción corre con los comodines"* porque el export se copia a `data/import/` en el `Dockerfile`. **Eso es falso** y lo corrijo aquí. Keycloak 26 (Quarkus) **solo** importa desde `data/import/` cuando el comando de arranque incluye `--import-realm`. Verificado: `railway.toml:6` usa `start --optimized --db=postgres` y `docker-compose.yml:35` usa `start-dev` — **ninguno pasa `--import-realm`**. Por lo tanto el `realm-export.json` **nunca se importa** (ni en prod ni en local); el realm vivo lo gobierna Terraform vía la Admin API, tal como declara la cabecera *"READ-ONLY REFERENCE — managed by terraform"* del propio archivo. El comodín **no está activo en ninguna instancia**.

Dicho esto, el hallazgo sobrevive como **footgun latente** (severidad Baja, no Media). El export define para `japan-trip-frontend`:

```json
"redirectUris": ["http://localhost:5173/*", "https://*.github.io/*"],
"post.logout.redirect.uris": "http://localhost:5173/*##https://*.github.io/*"
```

`https://*.github.io/*` es un comodín **extremadamente laxo**: autorizaría como destino de redirect del auth-code flow a **cualquier sitio de GitHub Pages de cualquier usuario** (`https://atacante.github.io/...`), habilitando robo de authorization codes. El `main.tf` de Terraform **sí** está endurecido (rutas explícitas bajo `https://manud.github.io/PruebaMapJapan/...`). El riesgo real es acotado: si algún día alguien **añade `--import-realm`** al arranque, o importa el export manualmente vía la consola de admin "para bootstrappear rápido", ese comodín entra en vigor y degrada silenciosamente la config endurecida de Terraform.

**Fix:** endurecer los redirect URIs del export para que igualen a Terraform (nada de `*.github.io`) aunque hoy sea vestigial — un archivo de referencia con un comodín peligroso es una trampa esperando a que alguien lo use. Idealmente, regenerar el export desde el estado real de Terraform, o eliminarlo si de verdad nadie lo importa.

### S-21 (Baja) — `sslRequired: "external"` permite HTTP en redes "internas"
`keycloak/realm-export.json:9` y `terraform/keycloak/main.tf:16`

`external` significa que Keycloak exige HTTPS solo para requests que considera "externas"; conexiones desde IPs privadas/loopback pueden ir por HTTP. En Railway detrás de un proxy, la detección de "externo" depende de `X-Forwarded-*` y de `frontendUrl`/`proxy-headers`; si están mal configurados, tokens y credenciales podrían viajar en claro en el tramo interno. Para producción lo robusto es `all`. Verificar la config de proxy de Railway; si no está el modo edge/reencrypt correcto, `external` es un riesgo silencioso.

### S-22 (Baja) — Passwords de test con defaults en `variables.tf` (confirma y amplía S-11)
`terraform/keycloak/variables.tf:16-71`

Ampliando S-11 de la primera pasada, ahora con el detalle completo: **seis** variables de password (`e2e_test_password`, `e2e_otp_password`, `testuser_password`, `new_user_test_password`, `trip_edit_test_user_password`, `e2e_session_password`) tienen `default` en texto plano y además esos mismos valores están **documentados en SETUP.md:113-114**. `testuser`/`Test1234!` cumple apenas la password policy. Riesgo real solo si este módulo se aplica contra un Keycloak accesible desde fuera de `localhost`. El `main.tf` no tiene ningún guard que impida `terraform apply` contra una `kc_url` remota. Mitigación: quitar los defaults (forzar `-var-file=local.tfvars`) o un `precondition` que aborte si `var.kc_url` no es localhost.

## 11. Cadena de suministro y PWA

### S-23 (Media) — Leaflet cargado desde `unpkg.com` **sin Subresource Integrity**, incluyendo la página pública cross-user
`frontend/tokyo.html:28,54` (y 8 páginas más: `nagoya`, `takayama`, `kyoto`, `osaka`, `naoshima`, `hakone`, `tokyo2`, y **`trip.html`**)

Las 9 páginas de mapa cargan Leaflet por CDN sin `integrity` ni `crossorigin`:

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

Sin SRI, un compromiso de unpkg (o un secuestro DNS/BGP del CDN) inyecta JS arbitrario que corre con plenos privilegios en el origen `manud.github.io`. Lo agravante: **`trip.html` es la vista pública de itinerarios compartidos** — la única superficie que renderiza datos de *otros* usuarios (la que las pasadas 1-3 identificaron como la frontera de confianza a proteger con DOMPurify). Esa misma página confía ciegamente en un `<script>` de tercero sin pinear. Toda la defensa XSS del lado del dato (DOMPurify en `tripDetail.ts`) se puentea trivialmente si el atacante controla el script de Leaflet.

**Fix:** añadir `integrity="sha384-..."` + `crossorigin="anonymous"` a ambos recursos (unpkg sirve los hashes), o mejor: instalar Leaflet como dependencia npm y dejar que Vite lo empaquete con el resto del bundle (mismo origen, hash de build, cero CDN). La segunda opción además hace funcionar el mapa offline en la PWA, cosa que hoy no ocurre (ver S-24). Refuerza la necesidad de M-07 (CSP): con `script-src 'self'` + hashes, este vector se cierra por completo.

### S-24 / B-18 (Media) — El service worker sirve HTML *cache-first* con nombre de caché fijo → los usuarios quedan clavados en versiones viejas
`frontend/public/sw.js:1,51-69`

Dos defectos combinados en el SW:

1. **`CACHE_NAME = 'japan-trip-v3'` es una constante hardcodeada.** El `activate` borra cachés cuyo nombre no sea el actual, pero como el nombre **no cambia entre deploys**, un nuevo build **no invalida** el precache. Sumado a que el `fetch` handler es **cache-first para navegaciones** (`caches.match` primero, red solo si falla), un usuario recurrente sigue viendo el `index.html`/páginas cacheadas de una versión anterior indefinidamente, hasta que alguien acuerde bumpear manualmente el string a `v4`. En una PWA desplegada por CI en cada push, esto es staleness garantizada: se despliega una corrección (incluyendo, irónicamente, cualquier fix de seguridad de este documento) y los usuarios no la reciben.

2. **Cache-first sobre HTML de app.** Cualquier página que pase el filtro `response.ok && response.type === 'basic'` se cachea, y las navegaciones se sirven desde caché. El `index.html` de Vite referencia JS con hash en el nombre; si el HTML cacheado es viejo, apunta a bundles hash-viejos (que también quedaron cacheados), congelando toda la app.

**Fix:** (a) derivar `CACHE_NAME` del hash/versión de build (inyectado por Vite en build-time) para que cada deploy genere un caché nuevo y el `activate` purgue el anterior; (b) para navegaciones/HTML usar **network-first** (o stale-while-revalidate), reservando cache-first solo para assets con hash inmutable en el nombre. Es un patrón estándar de Workbox; aquí está a mano.

### O-06 (Baja) — `EXTERNAL_ASSETS` en el SW es código muerto y engañoso
`frontend/public/sw.js:17-20`

El array `EXTERNAL_ASSETS` (Leaflet CSS/JS de unpkg) **no se referencia en ninguna parte** — no está en `PRECACHE_ASSETS`, no se le hace `addAll`, no aparece en el `fetch` handler. Sugiere que *se pretendía* precachear Leaflet (lo que arreglaría el mapa offline) pero quedó a medias. Hoy el mapa **no funciona sin red** pese a ser una "PWA offline". O se cachea Leaflet de verdad (y se resuelve S-23 empaquetándolo), o se borra el array muerto. También `NETWORK_ONLY_DOMAINS` lista `api.allorigins.win`/`corsproxy.io` (los proxies de S-03): el SW normaliza como "normal" que la app hable con esos terceros.

## 12. Config y consistencia (adicional)

### B-19 (Baja) — Nombre del output de Terraform no coincide con la doc
`terraform/keycloak/main.tf:146` define `output "worker_client_secret"`, pero `SETUP.md:73` instruye `terraform output -raw japan_trip_worker_secret`. El comando de la doc **falla** (`output not found`). Alinear el nombre en uno de los dos.

### N-05 (Baja) — Config del realm dispersa en dos mecanismos vivos + un archivo vestigial, con una contradicción concreta
Coexisten tres artefactos que describen la config del realm, pero **no son co-iguales** (corregido junto con S-20):
1. `terraform/keycloak/*.tf` — la **fuente de verdad viva** (aplica vía Admin API).
2. `keycloak/apply-local-settings.sh` — **también vivo**: parchea el realm vía REST API tras `docker compose up`, reseteando `browserFlow` a `"browser"`, lo que **contradice directamente** el `browser_flow = "browser-passkey"` de Terraform (`main.tf:29`). Cuál gana en local depende del orden de ejecución.
3. `keycloak/realm-export.json` — **vestigial**: nunca se importa (ver S-20, sin `--import-realm`), pese a estar marcado "read-only reference". Es documentación desactualizada que aparenta ser config.

El problema real es la contradicción `browser` vs `browser-passkey` entre (1) y (2), más un tercer archivo (3) que confunde por parecer autoritativo sin serlo. Consolidar: documentar taxativamente que Terraform gobierna, por qué el script lo pisa en local, y **eliminar o regenerar** el export para que deje de ser una fuente de verdad fantasma.

### N-06 (Nit) — `compatibility_date` y credenciales de infra local en claro (contexto, no acción)
`docker-compose.yml` usa `admin/admin` y `postgres/postgres` — correcto para local, pero conviene el mismo disclaimer explícito que S-22 pide para Terraform: este compose es **solo localhost**. Y `railway.toml` bootstrappea prod con la imagen que hornea el export comodín (ver S-20). No es un secreto filtrado (son defaults de dev), es higiene de "que nadie copie esto a un entorno accesible".

## 13. Capa de datos (schema / migraciones) — no auditada en pasadas previas

Revisadas las 4 migraciones SQL (`backend/src/db/migrations/*`) y `schema.ts` a nivel DDL. El diseño es sano en lo esencial (FKs con `ON DELETE CASCADE` coherentes en toda la jerarquía, `public_slug` UUID único e indexado, `users_keycloak_id_idx` único). Tres gaps concretos:

### P-01 (Baja, perf + housekeeping) — `email_otp_codes` sin índice y sin TTL
`backend/src/db/migrations/0003_add_email_otp_codes.sql` + `schema.ts:179-190`

La tabla `email_otp_codes` **solo tiene la PK** — no hay índice sobre `user_id` ni sobre `expires_at`. Toda validación de OTP filtra por `user_id` + `used_at IS NULL` + `expires_at > now()` (`getLatestUnexpiredOtp`), así que cada verificación es un **full table scan**. Peor: **nada purga las filas** usadas/expiradas — la tabla crece monótonamente por cada código emitido, y el scan se vuelve más caro con el tiempo. Añadir `CREATE INDEX ON email_otp_codes (user_id)` (o compuesto `(user_id, used_at, expires_at)`) y un job/cron de limpieza (`DELETE WHERE expires_at < now() - interval '1 day'`), o un `DELETE` oportunista en cada `otp-request`. Se conecta con B-09/S-06 (el throttle real del OTP vive en esta tabla).

### P-02 (Baja, integridad) — `users.email` no es único a nivel DB
`backend/src/db/schema.ts:25` + `migrations/0000_initial.sql`

`email` es `NOT NULL` pero **sin índice único** — solo `keycloak_id` es único. La unicidad de email la garantiza Keycloak upstream (`duplicateEmailsAllowed: false`), pero el DB acepta dos filas con el mismo email. Si alguna vez un usuario se re-provisiona con distinto `keycloak_id` (p. ej. realm recreado, migración de IdP), se generan cuentas huérfanas duplicadas por email sin que la DB lo impida. Añadir `UNIQUE (email)` (o al menos un índice) alinea la invariante del DB con la de Keycloak y acelera cualquier lookup por email.

### P-03 (Nit) — `lat`/`lng` como `NUMERIC(10,7)` sin `CHECK` de rango
`migrations/0000_initial.sql` (destinations/hotels/activities)

`NUMERIC(10,7)` admite hasta ±999.9999999, fuera del rango válido de lat (−90..90) / lng (−180..180). Combinado con M-05 (Zod tampoco valida rango en el frontend), coordenadas inválidas pueden persistirse. Un `CHECK (lat BETWEEN -90 AND 90)` en el DDL sería la última línea de defensa. Impacto: un pin de mapa fuera de rango, no seguridad.

## 14. Correcciones y actualizaciones a hallazgos de pasadas anteriores (re-verificación)

Re-leídos con el estado actual del árbol algunos archivos que evolucionaron desde las primeras pasadas. Un buen análisis se corrige a sí mismo:

- **S-09 (actualizar, no descartar):** `backend/src/middleware/security.ts` **mejoró** respecto a lo reportado en la primera pasada. Hoy sí emite `Content-Security-Policy: default-src 'none'`, `X-Frame-Options: DENY`, `Strict-Transport-Security` y `Referrer-Policy: no-referrer`. **Persiste el gap concreto:** siguen faltando `X-Content-Type-Options: nosniff` y `Permissions-Policy`. Es un fix de dos líneas. La parte de S-09 sobre el frontend (sin CSP en GitHub Pages) sigue vigente en su totalidad (ver M-07/S-23).
- **M-09 (confirmado, matizado):** el handler **global** `app.onError` **sí** loggea (`console.error('Unhandled error:', err)`, `index.ts:43`). Lo que M-09 señala sigue siendo cierto pero acotado a los `catch {}` **por-ruta**: p. ej. `trips.ts:156` hace `catch { return 500 'Failed to fetch trips' }` **descartando `err`** — esos errores no llegan al `onError` (se capturan antes) y por tanto **no se loggean**. El diagnóstico de un 500 en esas rutas sigue siendo a ciegas. Añadir `console.error` en cada `catch` de ruta, o dejar propagar al `onError` que ya loggea.
- **B-04/S-14 (confirmado):** la inconsistencia de validación de `DATABASE_URL` sigue presente; `users.ts` y `public.ts` no la chequean mientras `trips.ts`/`auth.ts` sí. M-01 (middleware `getDb`) sigue siendo la solución que unifica y elimina el problema de raíz.

**Nota positiva (E2E / tests):** la suite E2E (`tests/`) y `global-setup.ts` **no contienen secretos de producción hardcodeados** — todo va por env vars (`process.env.E2E_*`) con `.env.test.example` como plantilla. El único uso de credenciales literales es `admin/admin` contra `localhost:8080` en `uat-passkeys.spec.ts` (archivo suelto en la raíz, fuera del `rootDir` de Playwright → no corre en CI; ver M-08). Correcto para local. Refuerza que la higiene de secretos del repo (ya elogiada en la sección 4) se mantiene también en la capa de test.

## 15. Flujos de autenticación y protocol mappers (`flows.tf` / `mappers.tf`) — no leídos en pasadas previas

Estos dos archivos definen el corazón del comportamiento de login (ejecuciones del flow) y qué claims emite Keycloak. Ninguna pasada anterior los había abierto.

### KC-A (Media, diseño) — El subflow de passkey mezcla `REQUIRED` + un único `ALTERNATIVE`: seguro hoy, pero por semántica frágil de Keycloak, no por diseño explícito
`terraform/keycloak/flows.tf:32-45`

El subflow `passkey-forms` (ALTERNATIVE en el top-level) contiene:
- `auth-username-form` — **REQUIRED** (priority 10)
- `webauthn-authenticator-passwordless` — **ALTERNATIVE** (priority 20)

El propio código lleva un `SECURITY-NOTE` reconociendo el smell, y tras analizarlo **lo confirmo como preciso**: mezclar `REQUIRED` y un solo `ALTERNATIVE` en el mismo subflow es un anti-patrón conocido de Keycloak (la doc recomienda no combinar ambos en el mismo nivel). El riesgo teórico es que el subflow se satisfaga solo con el `REQUIRED` (username) si el `ALTERNATIVE` webauthn se "salta" para un usuario sin passkey — lo que sería un bypass de autenticación (login con solo username). En la práctica **no es un bypass**: (a) webauthn-passwordless tiene `userSetupAllowed`/required-action, así que un usuario sin passkey es empujado a registrar uno (el "Case B" que `global-setup.ts` maneja), no autenticado sin factor; (b) `password-forms` es un ALTERNATIVE top-level separado que siempre exige `auth-username-password-form` REQUIRED. La seguridad, sin embargo, **depende de la semántica exacta de evaluación de Keycloak** en vez de ser estructuralmente obvia — que es exactamente lo que el backlog de Phase 13 (citado en el comentario) propone corregir: un subflow de credencial REQUIRED con `webauthn|password` como ALTERNATIVEs dentro.

**Recomendación:** (1) ejecutar el restructure de Phase 13 (elimina la fragilidad de raíz); (2) **mientras tanto**, añadir un test E2E negativo explícito que verifique que un usuario sin passkey y sin password **no** puede autenticar solo con username — hoy la garantía descansa en semántica implícita, y un cambio de versión de Keycloak podría alterarla sin que ningún test lo detecte. Es el complemento natural de T-01 (gaps de test en la lógica de autorización): aquí el gap es en la lógica de *autenticación*.

### KC-B (Baja) — Atributos editables por el usuario (`avatar_url`, `preferences`) inyectados en el **access token**, y el backend confía en ellos
`terraform/keycloak/mappers.tf:31-63` + `backend/src/auth/keycloak.ts:276-282` + `middleware/user.ts:28-29`

Los seis protocol mappers ponen sus claims en **los tres** destinos: `add_to_id_token`, `add_to_access_token` **y** `add_to_userinfo`. Para `preferred_username`/`email`/`email_verified` es estándar. Pero `avatar_url` y `preferences` son **atributos de usuario editables** (custom attributes que el usuario puede modificar vía la Account API), y meterlos en el **access token** es no-estándar: el access token debería ser mínimo (viaja en cada header `Authorization` de cada request a la API). Dos consecuencias:

1. **Bloat controlable por el usuario.** `preferences` es un string arbitrario; un usuario puede inflar su propio access token (y, si es muy grande, romper límites de header en algún proxy). Menor, pero innecesario.
2. **El backend confía y persiste estos claims.** `parseKeycloakUser` (`keycloak.ts:281-282`) extrae `avatar_url`/`preferences` del token, y `middleware/user.ts:28-29` usa `email`/`name` del token para **crear** la fila del usuario. Como esos atributos son editables por el usuario, la DB termina reflejando datos que el usuario controla — aceptable para *su propio* registro (display name, avatar), pero conviene tenerlo consciente. Se conecta con **B-12** (el backend solo lee estos claims en el CREATE, nunca los refresca): el resultado es que estos mappers al access token están, en la práctica, **mayormente sin uso para su propósito de mantener sincronía** — otro caso (como S-19) de token/permiso sobre-provisto que el código lee una vez y nunca vuelve a mirar.

**Fix:** quitar `add_to_access_token = true` de `avatar_url` y `preferences` (dejarlos solo en id-token/userinfo, que es donde un cliente los consume para pintar la UI). El access token queda mínimo y el backend deja de recibir datos mutables por un canal que no necesita.

## Actualización de totales tras la quinta pasada

| Categoría | Antes | Ahora | Nuevos en esta pasada |
|---|---|---|---|
| **Seguridad** | 18 | 24 | S-19 (worker `manage-users` sin uso, **Alta**), S-20 (redirect comodín en export **vestigial**, Baja latente), S-21, S-22, S-23 (Leaflet sin SRI, Media), S-24 |
| **Bugs** | 17 | 19 | B-18 (SW cache-first stale), B-19 (output name mismatch) |
| **CI/CD-Ops** | 5 | 6 | O-06 (dead `EXTERNAL_ASSETS`) |
| **Arquitectura** | 4 | 6 | N-05 (3 fuentes de verdad del realm), N-06 |
| **Capa de datos** | 0 | 3 | P-01 (OTP sin índice/TTL), P-02 (email no único), P-03 (lat/lng sin CHECK) |
| **Auth flow / IdP claims** | 0 | 2 | KC-A (subflow REQUIRED+ALTERNATIVE frágil), KC-B (atributos editables en access token) |

### Los 3 hallazgos nuevos que suben al top de prioridad

1. **S-19 (Alta)** — El service account del Worker tiene `manage-users` sobre todo el realm y su secret está en producción, **sin ningún código que lo use**. Mínimo privilegio violado con impacto de realm completo. *Eliminar el rol/cliente/secret, o acotar y no desplegar hasta que exista el consumidor.*
2. **S-23 (Media)** — Leaflet por `unpkg` sin SRI en 9 páginas, incluida la vista pública `trip.html` (cross-user). Puentea toda la defensa DOMPurify. *Pinear con `integrity` o empaquetar vía Vite.*
3. **KC-A + N-05** — el tercer puesto lo ocupa el paquete de IdP/config: el subflow de passkey con `REQUIRED`+`ALTERNATIVE` mezclados (KC-A, seguro hoy pero frágil por semántica y sin test negativo) y la contradicción `browser` vs `browser-passkey` entre Terraform y `apply-local-settings.sh` (N-05). *Nota: S-20 (redirect comodín) fue degradado a Baja latente tras verificar que el export nunca se importa; ya no es top-priority.*

**Nota de método (quinta pasada):** todos los hallazgos verificados sobre el árbol real. S-19 confirmado con `rg 'KC_ADMIN' backend/src` excluyendo tests (solo aparece en `types/index.ts` y `dev.ts`, cero consumidores). S-23 confirmado enumerando las 9 páginas con `unpkg.com/leaflet` sin atributo `integrity`. La contradicción de N-05 (`browser` vs `browser-passkey`) verificada leyendo `apply-local-settings.sh` y `main.tf:29`. KC-A/KC-B verificados leyendo `flows.tf`/`mappers.tf` y cruzando con `auth/keycloak.ts:276-282` y `middleware/user.ts:28-29`. Sin ejecución de código.

**Corrección de rigor:** S-20 se publicó primero como "Media — producción corre con los comodines", asumiendo que el `Dockerfile` (`COPY … data/import/`) implicaba importación automática. Al re-verificar los comandos de arranque (`railway.toml`: `start --optimized`; `docker-compose.yml`: `start-dev` — **ninguno con `--import-realm`**) se comprobó que Keycloak 26 nunca importa ese archivo. S-20 fue degradado a **Baja latente** y N-05 reencuadrado (el export es vestigial, no una fuente de verdad viva). Se documenta el error y su corrección en vez de borrarlo, por trazabilidad — es la misma disciplina que llevó a marcar los tres falsos positivos de las pasadas 1-3. Zonas que ahora sí quedan cubiertas y antes no: `flows.tf`, `mappers.tf`, migraciones SQL/DDL, `sw.js`, `terraform/cloudflare`, `realm-export.json`, y los módulos `theme.ts`/`countdown.ts`/`modules/search.ts` (confirmados DOM-safe).

---

---

# Sexta pasada — lógica de negocio, paridad con la demo, y evaluación de passkeys/SPIs

> **Encuadre (a pedido):** el objetivo de producto declarado (`.planning/PROJECT.md`) es *"un usuario puede construir un itinerario completo end-to-end desde la UI — destinos, hoteles, días, actividades — y verlo visualizado en un mapa"*, con **paridad con la demo de Japón**. Esta pasada no busca XSS/infra (ya cubierto) sino **si el CRUD real permite reproducir la demo**, si las validaciones de dominio existen, y si algún objetivo (passkeys simples, personalización total) **requiere un SPI custom de Keycloak** — que la planificación marca explícitamente como *Out of Scope*. El hallazgo central: **hay una brecha estructural entre lo que la demo expresa y lo que un usuario puede construir**. La ruta de datos es `editor UI → Zod schema → DB → API → tripAdapter → vista`, y **se pierde información en casi cada salto**.

## 16. Paridad con la demo — lo que un usuario NO puede reproducir

La demo (`frontend/src/data/itinerary.ts`, tipo `Activity`/`Day`/`CityData`) usa un vocabulario visual rico: actividades **opcionales/alternativas** (`optional: string` como etiqueta "A"/"B"), **marcadores genéricos** de zona (`isGeneric` — Ginza, Shibuya como áreas, no pines exactos), **días con opciones** (`hasOptions`), colores por día, y enlaces "abrir en Google Maps". Comparando con la ruta CRUD real, **buena parte de ese vocabulario es inalcanzable** para un viaje construido por un usuario.

> **Nota de encuadre importante:** `.planning/PROJECT.md` lista *"New user feature parity with demo: full trip creation flow (map/days/activities/hotel/search)"* como requisito **✓ validado (Phase 14, v3.0)**. Por lo tanto BL-01..BL-05 **no** son "la demo es intencionalmente más rica" — son **contradicciones de un requisito que el proyecto ya marca como cumplido**. La paridad se validó probablemente a nivel de *flujo* (se puede crear un viaje con destinos/días/actividades/hotel) pero **no a nivel de fidelidad de campos** (opcionales, genéricos, maps_url, hora, zoom). Vale la pena revisar el criterio de aceptación de Phase 14 a la luz de esto.

### BL-01 (Media, paridad) — Las actividades "opcionales/alternativas" no se pueden crear desde la UI, y `optional_label` es un campo fantasma
`frontend/src/pages/trip-edit/activities.ts` (form) + `backend/src/validation/schemas.ts:56-65` + `frontend/src/modules/tripAdapter.ts:36`

Triple fallo encadenado:
1. **El formulario de actividad no tiene control de "opcional".** Los campos que arma el editor son solo: `name`, `time`, `notes`, `lat`/`lng` (vía geocoder). No hay checkbox `is_optional`. → un usuario **no puede marcar una actividad como alternativa** desde la UI.
2. **`optional_label` no existe en la DB ni en el backend.** El tipo `ApiActivity` (`types/index.ts`) declara `optional_label?: string`, pero **no hay columna `optional_label`** (migraciones + `schema.ts`), el `CreateActivitySchema` no la acepta, y `rg optional_label backend/` no encuentra nada. Es un campo fantasma: el tipo promete algo que la API nunca devuelve.
3. **El adapter degrada todo a "A".** `apiActivityToActivity` hace `optional: activity.is_optional ? (activity.optional_label ?? 'A') : undefined` (`tripAdapter.ts:36`). Como `optional_label` es siempre `undefined`, **toda** actividad opcional se etiqueta `'A'`. La demo puede tener "A"/"B"/"1"/"2"; un usuario, ni siquiera eso (no puede marcarlas opcionales en primer lugar).

**Fix:** decidir si "actividades opcionales/alternativas" es una feature de producto. Si sí: añadir columna `optional_label`, exponerla en `CreateActivitySchema` y en el formulario (checkbox opcional + input de etiqueta). Si no: eliminar `optional_label` del tipo y la lógica de degradación del adapter (código muerto que confunde).

### BL-02 (Media, paridad) — Los marcadores "genéricos" (`is_generic`) no se pueden crear: ausentes del schema **y** de la UI
`backend/src/validation/schemas.ts:56-65` + `frontend/src/pages/trip-edit/activities.ts`

`is_generic` existe en la DB (`activities.is_generic`), en el tipo (`ApiActivity.is_generic`), y la demo lo usa para diferenciar **áreas/barrios** (Ginza, Shibuya, Harajuku — marcadas visualmente distinto de un pin exacto). Pero **`CreateActivitySchema`/`UpdateActivitySchema` NO incluyen `is_generic`** — el backend descarta silenciosamente cualquier intento de setearlo. Y el formulario tampoco lo expone. Resultado: **todo lo que un usuario cree es un pin concreto**; la distinción área-vs-lugar de la demo es irreproducible. El campo queda solo poblado por `seed.ts` (import de la demo). Fix: añadir `is_generic: z.boolean().optional()` al schema y un toggle en el form, o aceptar que es exclusivo de la demo y documentarlo.

### BL-03 (Media, bug de negocio) — El link "abrir en Google Maps" funciona **solo para la demo**, nunca para viajes de usuario
`frontend/src/pages/tripDetail.ts:194,202,339,394` + `frontend/src/data/maps.ts:90` + `tripAdapter.ts:31-39`

`tripDetail.ts` (la vista pública/detalle de un viaje) resuelve el enlace de mapa con **`getMapsUrl(activity.name)`** — una **tabla hardcodeada** (`MAPS_URLS` en `data/maps.ts`) que solo contiene los ~60 lugares del itinerario de Japón. Para una actividad de usuario ("Torre Eiffel", "Café de la esquina"), `getMapsUrl` devuelve `null` → **no hay enlace de mapa**. Mientras tanto:
- La DB **sí** tiene `activities.maps_url`, el `CreateActivitySchema` **sí** lo acepta (`schemas.ts:62`)...
- ...pero el **formulario no lo expone** (no hay input `maps_url`), y...
- ...el **adapter lo descarta** (`apiActivityToActivity` no mapea `maps_url` al tipo `Activity` de la demo, que no tiene ese campo), y...
- ...la vista **usa `getMapsUrl(name)` en vez del `maps_url` almacenado**.

Es decir: `maps_url` es un campo que se puede setear solo por API cruda, **no por UI, no se renderiza, y aunque se renderizara el código no lo mira**. El "abrir en Google Maps" es funcionalidad exclusiva de la demo seedeada. **Fix:** en `tripDetail`/`buildPopup`, preferir `activity.maps_url` (propagándolo por el adapter) y usar `getMapsUrl(name)` solo como fallback para la demo. Exponer `maps_url` en el editor (o autogenerarlo desde lat/lng: `https://maps.google.com/?q=LAT,LNG`).

### BL-04 (Baja, paridad) — La hora de actividad (`time`) es editable y se guarda, pero **desaparece** en la vista compartida
`frontend/src/pages/trip-edit/activities.ts:80-83` (input) + `tripAdapter.ts:31-39` (no la mapea)

El editor tiene un `<input type="time">` para `time`, el backend lo persiste (`activities.time`), pero **el adapter no lo mapea** al tipo `Activity` de la demo (que carece de `time`), así que ni `tripDetail` ni los popups del mapa lo muestran. Un usuario setea "19:00", lo ve en el editor, comparte el viaje, y la hora **no aparece** en la vista de solo-lectura. Inconsistencia editor-vs-vista. Fix: añadir `time` al tipo `Activity` y renderizarlo en `buildLegendItem`/`buildPopup`.

### BL-05 (Baja, paridad) — El zoom por destino no se puede ajustar; todos los mapas de usuario abren en zoom 12
`frontend/src/pages/trip-edit/destinations.ts` (form: solo city/country/fechas) + `schema.ts:29` (acepta `zoom_level`) + `schema` DB default 12

`zoom_level` se acepta en `CreateDestinationSchema` y tiene default 12, pero el editor de destinos no lo expone. La demo afina el zoom por ciudad (Tokyo 12, ciudades chicas más). Todo destino de usuario abre en 12. Menor, pero es parte de "completamente personalizable". Fix: input de zoom (o botón "usar el zoom actual del mapa").

## 17. Validaciones de dominio — el "con sus validaciones" que falta

El usuario pidió explícitamente viajes *"completamente personalizables y con sus validaciones"*. La capa Zod valida **forma** (tipos, longitudes, hex de color, formato de fecha, URL) pero **casi nada de coherencia de dominio**. Para un planificador de viajes, la coherencia temporal es la validación de negocio central, y no existe.

### BL-06 (Media) — Cero validación de orden de fechas en ningún nivel
`backend/src/validation/schemas.ts` (todos los schemas)

Ninguna entidad valida que la fecha de inicio sea ≤ la de fin:
- **Trip**: `start_date`/`end_date` sin `refine` → un viaje puede empezar después de terminar.
- **Destination**: idem `start_date`/`end_date`.
- **Hotel**: `check_in_date`/`check_out_date` → check-out antes de check-in aceptado (¡y esto afecta el cálculo de noches si algún día se agrega!).

Fix: `.refine(d => !d.start_date || !d.end_date || d.start_date <= d.end_date, { message: 'end must be ≥ start', path: ['end_date'] })` en cada schema. Como las fechas son ISO `YYYY-MM-DD`, la comparación de strings funciona directamente.

### BL-07 (Media, coherencia estructural) — No hay coherencia de fechas entre niveles: el cronograma puede ser internamente imposible
`backend/src/routes/trips.ts` (creación de days/destinations) — sin validación cruzada

Nada garantiza que:
- La `date` de un **día** caiga dentro del rango de su **destino** (`destination.start_date`..`end_date`).
- El rango de un **destino** caiga dentro del rango del **trip**.
- Los destinos no se **solapen** en fechas (estás en dos ciudades el mismo día).

Un usuario puede crear un trip "22–28 feb", un destino "Tokyo 1–5 marzo", y un día "2030-01-01" dentro de él. La demo es coherente porque está curada a mano; un viaje de usuario no tiene red que lo impida, y el mapa/cronograma resultante es visualmente incoherente (días fuera de rango, orden temporal roto). **Este es el gap de lógica de negocio más importante para el objetivo "planificar viajes"**: un planificador que no valida coherencia temporal produce itinerarios imposibles. Fix: validar en el endpoint de creación/edición de día que `date ∈ [dest.start, dest.end]`; de destino que `[start,end] ⊆ [trip.start, trip.end]` y sin solape con otros destinos del mismo trip. Requiere leer el padre en el handler (ya se hace para authz — reusar esa query).

### BL-08 (Media) — `lat`/`lng` sin rango (confirma M-05/P-03 en la capa de entrada)
`schemas.ts:27-28,58-59` — `z.coerce.string().nullable().optional()` acepta `"999"`, `"abc"→` (coerce de número a string), etc. Sin `-90..90`/`-180..180`. Un pin fuera de rango rompe el `setView`/marker de Leaflet (o lo ubica en medio del océano). Validar rango numérico antes de coercionar a string, y añadir el `CHECK` de P-03 como defensa en profundidad. **Además**: `z.coerce.string()` sobre lat/lng es un modelado dudoso — coordenadas son números; guardarlas como string invita a `"null"`/`"NaN"` (ver B-15). Considerar `z.number().min(-90).max(90)`.

### BL-09 (Baja) — PATCH vacío aceptado (confirma M-05)
`UpdateTripSchema = CreateTripSchema.partial()` (y todos los `.partial()`) aceptan `{}` → UPDATE que solo toca `updated_at`, o peor, un PATCH sin efecto que responde 200 engañando al cliente. Añadir `.refine(o => Object.keys(o).length > 0, 'at least one field required')`.

## 18. Bugs de negocio nuevos surgidos en esta pasada

### BL-10 (Baja, i18n) — Strings en español en la vista tras el "internationalization to English" (Phase 5)
`frontend/src/modules/tripAdapter.ts:162-163`

```ts
if (start) return `Desde ${fmt(start)}`;
return `Hasta ${fmt(end!)}`;
```

`buildDateRange` emite **"Desde"/"Hasta"** (español) para rangos con solo un extremo, mientras el resto de la app se internacionalizó a inglés en Phase 5 (marcado ✓ validado en PROJECT.md). Estos strings llegan a la UI (el `dates` de cada destino). Bug de i18n residual. Fix: "From"/"Until".

### BL-11 (Media, bug de fecha) — `new Date('YYYY-MM-DD')` desfasa un día según el timezone del visitante
`frontend/src/modules/tripAdapter.ts:156-159`

```ts
const fmt = (iso: string): string => {
  const d = new Date(iso);  // 'YYYY-MM-DD' se parsea como UTC medianoche
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};
```

`new Date('2026-02-22')` se interpreta como **UTC 00:00**, y `toLocaleDateString` lo renderiza en el timezone **local del visitante**. En cualquier zona con offset negativo (todo América: UTC-3 a UTC-8), medianoche UTC del 22 es la **noche del 21 local** → se muestra **"Feb 21"**. Para una app cuyo producto es *mostrar fechas de viaje*, mostrar el día equivocado según quién mira es un bug real y difícil de notar en desarrollo (si el dev está en UTC+). El mismo patrón acecha en cualquier `new Date(isoDateOnly)` del frontend. **Fix:** parsear como fecha local (`new Date(y, m-1, d)` tras split, o formatear los componentes sin construir un `Date` con semántica UTC), o usar una lib de fechas date-only. Verificar todos los `new Date(` sobre strings date-only del repo.

> **Reproducido (séptima pasada, ejecutado):** corriendo el patrón exacto de `buildDateRange` con distintos timezones:
> ```
> UTC                             2026-02-22 -> Feb 22, 2026
> America/Argentina/Buenos_Aires  2026-02-22 -> Feb 21, 2026   ← un día antes
> America/Los_Angeles             2026-02-22 -> Feb 21, 2026   ← un día antes
> ```
> Ya no es inferencia estática: un usuario en Argentina (o cualquier offset negativo) ve **todas** las fechas de viaje corridas un día. Bug confirmado.

## 19. Evaluación: passkeys simples y ¿hacen falta SPIs custom? (a pedido)

**Contexto:** `.planning/PROJECT.md` marca **"Java KC SPIs — Out of Scope: all KC customization via built-in flows + FreeMarker themes only"**. La pregunta del usuario es si ese constraint aguanta dados los objetivos (passkeys simples de usar, personalización total). **Conclusión: el constraint es correcto; ningún objetivo actual justifica un SPI.** Detalle:

**Passkeys — la fricción es de diseño de flow, no de SPI faltante.**
- Keycloak 26.6 trae WebAuthn passwordless nativo (ya usado, `flows.tf`). No hace falta SPI para passkeys.
- La fricción real que documentan los tests (`global-setup.ts` "Case B": la required-action `webauthn-register-passwordless` **empuja** a usuarios nuevos a registrar passkey) y **KC-A** (subflow `REQUIRED`+`ALTERNATIVE` frágil) son problemas de **estructura de flow**, resolubles con config declarativa — no requieren código Java. Para "passkeys simples", lo que falta es más bien **UX**: (a) *conditional UI / autofill* (usernameless) para que el navegador ofrezca la passkey en el campo de usuario — se habilita en la config de WebAuthn, sin SPI; (b) el restructure del flow de Phase 13 (backlog) para que "intentar passkey → fallback password" sea explícito.
- **Passkey rename** (deferido: "PUT credentials/{id}/label"): la **Account REST API** de Keycloak ya expone gestión de credenciales WebAuthn (borrar, y en versiones recientes editar label). No requiere SPI — es una llamada REST desde `profile.ts`, igual que el resto de la gestión de passkeys que ya existe.

**Personalización de viajes — no toca Keycloak en absoluto.** Todo lo de las secciones 16-18 es app-side (schema Zod + DB + adapter + UI). Ningún SPI involucrado.

**El único caso donde un SPI *sería* la herramienta convencional** es **provisioning event-driven**: un `EventListenerSPI` que, al registrarse/actualizarse un usuario en Keycloak, notifique al backend para crear/sincronizar la fila en la DB (resolvería la race B-02/S-14 y el desfase de B-12 de raíz, moviendo el provisioning fuera del path de request). **Pero hay alternativa app-side más simple y ya parcialmente presente:** `upsertUser` (existe pero sin uso, B-12) + `INSERT ... ON CONFLICT` (fix propuesto para B-02). Es decir, incluso el único caso "natural" para SPI tiene una solución sin Java que además evita operar infraestructura JVM custom. **Recomendación: mantener SPIs fuera de scope.** Documentar en PROJECT.md que la decisión se re-evaluó contra los objetivos actuales y sigue válida, con "event-driven provisioning vía SPI" anotado como la única puerta que se abriría si el provisioning app-side (B-02/B-12) resultara insuficiente en producción.

## Actualización de totales tras la sexta pasada

| Categoría | Antes | Ahora | Nuevos |
|---|---|---|---|
| **Paridad demo / lógica de negocio** | 0 | 9 | BL-01..BL-05 (paridad), BL-06..BL-09 (validación de dominio) |
| **Bugs** | 19 | 21 | BL-10 (español residual), BL-11 (desfase de fecha por timezone) |
| **Arquitectura / decisiones** | 6 | 7 | Evaluación SPI: constraint "sin SPIs" validado contra objetivos |

### Síntesis para el objetivo de producto (una línea)

El backend/DB modela **más** de lo que la UI deja crear (`is_optional`, `is_generic`, `maps_url`, `zoom_level`, `time` son parcial- o totalmente inalcanzables desde el editor), y el **adapter descarta** varios de esos campos antes de la vista — de modo que un viaje de usuario **no puede verse como la demo**, y el `tripAdapter`/`getMapsUrl` está atado a datos de Japón hardcodeados. Sumado a la **ausencia total de validación de coherencia temporal** (BL-06/BL-07), el planificador hoy permite construir itinerarios visualmente incompletos e internamente imposibles. Cerrar esto — exponer los campos que ya existen en el editor, propagar `maps_url`/`time` por el adapter, y validar fechas cruzadas — es el trabajo de mayor impacto para el objetivo declarado, y **no requiere ningún SPI**.

**Nota de método (sexta pasada):** verificado sobre el árbol real trazando la ruta completa `editor → schema Zod → DB → API type → tripAdapter → vista`. BL-01/BL-02 confirmados por ausencia de los campos en `CreateActivitySchema` (`schemas.ts:56-65`) y en el form (`activities.ts`). BL-03 confirmado leyendo que `tripDetail` usa `getMapsUrl(activity.name)` (tabla hardcodeada de Japón) e ignora `activity.maps_url`, y que el adapter no propaga `maps_url`. BL-11 es un bug de timezone estándar de `new Date(dateOnly)`. La evaluación de SPIs se hizo contra `.planning/PROJECT.md` (scope declarado) y las capacidades nativas de Keycloak 26.6. Sin ejecución de código.

---

---

# Séptima pasada — entorno vivo: logs de containers, tests corridos, y build reproducido

> **Esta es la primera pasada que ejecuta cosas.** Con el stack local levantado (`docker ps`: Keycloak 26.6.1, Postgres 16, Mailpit — todos arriba) se leyeron logs reales, se corrió la suite de tests del backend, y se reprodujo el build del Worker. Resultado: **varios hallazgos que antes eran teóricos ahora están confirmados empíricamente**, y aparece un **fallo de build que bloquea el deploy** con causa raíz identificada.

## 20. Entorno vivo — hallazgos ejecutando, no leyendo

### O-08 (Alta, ops — **build roto, deploy bloqueado**) — `wrangler deploy --dry-run` falla por `string_decoder`; causa raíz = `compatibility_date` vieja (O-04)
Reproducido: `cd backend && npm run build` (que es `wrangler deploy --dry-run`) **falla**:

```
X [ERROR] Could not resolve "string_decoder"
    ../node_modules/split2/index.js:20:34:
      20 │ const { StringDecoder } = require('string_decoder')
    The package "string_decoder" wasn't found on the file system but is built into node.
    - Make sure to prefix the module name with "node:" or update your
      compatibility_date to 2024-09-23 or later.
```

`split2` (dependencia transitiva del stack `postgres`/`pg`) hace `require('string_decoder')` (built-in de Node sin prefijo `node:`), y el bundler de Wrangler **no lo resuelve** porque `backend/wrangler.toml` tiene `compatibility_date = "2024-01-01"` (el hallazgo **O-04** de la 2ª pasada). El propio error da el fix: **`compatibility_date ≥ 2024-09-23`** (con `nodejs_compat`, que ya está activo). Esto eleva O-04 de "Baja — se pierden fixes de runtime" a **problema activo que rompe el build**:
- `npm run build` falla → y como **`wrangler deploy` usa el mismo bundler**, el deploy real fallaría idénticamente. **El backend, hoy, no se puede desplegar.**
- Concatena con **O-01/O-02** (los deploys no corren build/typecheck ni dependen del CI): el pipeline ni siquiera detectaría esto antes de intentar publicar; y como el `deploy-backend.yml` hace `wrangler deploy` directo, un push a `main` que dispare el deploy **fallaría en el step de deploy** (o peor, dejaría el Worker en un estado inconsistente según el punto de fallo).

**Fix (el bloqueo inmediato es una línea):** subir `compatibility_date` a `2024-09-23` o posterior en `wrangler.toml` y re-verificar `npm run build`. Puede que detrás de `string_decoder` aparezcan más sorpresas de `nodejs_compat` (otras built-ins sin prefijo `node:`), así que "una línea" desbloquea *esta* resolución, no garantiza el build entero en verde de un tiro. Aun así es el hallazgo de mayor urgencia operacional del análisis: el objetivo "production deployment" (deferido en PROJECT.md) está **bloqueado** hasta resolverlo.

### KC-A — **CONFIRMADO EN RUNTIME** (era teórico en la 5ª pasada)
Los logs de Keycloak (`docker logs keycloak-keycloak-1`) están **inundados**, en cada request de autenticación, con:

```
WARN [org.keycloak.authentication.DefaultAuthenticationFlow]
  REQUIRED and ALTERNATIVE elements at same level!
  Those alternative executions will be ignored: [webauthn-authenticator-passwordless]
```

Esto es prueba directa de KC-A (sección 15): Keycloak **está ignorando la ejecución `webauthn-authenticator-passwordless`** en el subflow `passkey-forms`, en **cada** login, ahora mismo. El mecanismo exacto (por qué no es un bypass) no lo puedo afirmar desde el log solo: lo probable es que `passkey-forms` **falle** (el `auth-username-form` REQUIRED no es un autenticador de credencial, así que el subflow no completa sin el webauthn ignorado) y Keycloak caiga al ALTERNATIVE `password-forms` — pero eso es hipótesis, no lectura directa. Lo **cierto** es que la ejecución de passkey se descarta en cada request.

**Corroboración en vivo (corrí los specs de passkey):** con el stack arriba corrí `npx playwright test --project=chromium-passkeys`. **Los 3 tests fallan**: los tres esperan que Keycloak presente su página de confirmación de registro de passkey (botón "Register", previo a la ceremonia WebAuthn) y **nunca aparece** (timeout 15s); el navegador queda **autenticado en `profile.html`** sin haber pasado por la ceremonia de passkey. Atribución honesta:
- PROJECT.md ya lista *"passkeys ×3"* como **known-failing** en estabilización (Phase 18), así que **confirmo un estado ya conocido**, no descubro uno nuevo.
- El log de KC-A (webauthn ignorado) es un **candidato concreto de causa raíz** para ese fallo que el equipo debería verificar en la Phase 18/13: si la ejecución de passkey se descarta, la ceremonia no se presenta — que es exactamente el síntoma observado. No puedo probar la causación al 100% desde aquí (podría ser también test-bug tras el rewrite del login-helper de Phase 17), pero la correlación log↔síntoma es fuerte.
- Para el objetivo del usuario *"passkeys de manera simple"*: **hoy, en este entorno, la ruta de passkey no funciona** (los tests que la ejercitan fallan, y el flow está mal formado según el propio Keycloak). Sea test-bug o config-bug, la afirmación "passkeys funcionan" no se sostiene en el estado actual.
- El fix candidato es el restructure de Phase 13 (subflow de credencial REQUIRED con `webauthn|password` como ALTERNATIVEs internas), que elimina el warning `REQUIRED and ALTERNATIVE` y haría que la passkey se presente de verdad. Sube a prioridad: es a la vez un smell de seguridad, un flow disfuncional en runtime, y el bloqueante del objetivo de passkeys.

### KC-C — **VERIFICADO BENIGNO (falso positivo)** — Warning de logout de cliente
`docker logs` muestra, en el flujo de logout:

```
WARN [org.keycloak.services.managers.AuthenticationManager]
  Some clients have not been logged out for user session-test@local
  in japan-trip realm: japan-trip-frontend
```

> **Resuelto con verificación en vivo — no es un bug.** Mi lectura inicial ("sesión residual → SSO silencioso sin re-auth") era incorrecta. Este es el mensaje **estándar** de Keycloak para un cliente público SPA sin backchannel/frontchannel logout URL — config normal para un SPA. El warning solo dice que KC no pudo *empujar* una notificación al cliente, cosa que un SPA no necesita.

**Prueba discriminante ejecutada:** corrí `npx playwright test session-management.spec.ts --project=chromium` contra el stack en vivo → **7/7 tests en verde (34s)**, incluyendo:
- *"logout destroys KC session and returns to login prompt"* — asserta vía la Admin API que **`sessions.length === 0`** tras el logout, y que aparece `#dashboard-login-prompt`. **El logout SÍ destruye la sesión server-side de Keycloak.**
- *"logout clears app sessionStorage tokens"*, *"new browser context without KC cookie requires re-login"*, *"logout in one tab makes other tabs unauthenticated on next navigation"* — todos verdes.

Con la sesión efectivamente destruida en el logout, el warning es **puramente informativo**. KC-C queda **cerrado como no-issue**. (Se conserva documentado para que una futura lectura del log no lo re-levante como bug.)

**Dato de contraste valioso para TQ-03:** este run muestra que **la suite E2E no está uniformemente rota** — `session-management` (7 tests, incluyendo lógica multi-tab y multi-context) está **bien escrita y pasa en vivo**, mientras `passkeys` (3 tests) falla. La calidad de los specs es heterogénea: los de sesión son sólidos; el problema está concentrado en passkeys (KC-A) y en los patrones de sleeps/skips de otros specs.

### KC-D (Baja) — "Non-secure context" en POST cross-origin (contexto de S-21)
```
WARN [org.keycloak.cookie.DefaultCookieProvider] Non-secure context detected;
  cookies are not secured, and will not be available in cross-origin POST requests.
```
Esperable en local (HTTP puro), pero confirma en runtime la preocupación de **S-21** (`sslRequired: external`): las cookies de Keycloak no se marcan `Secure` en contexto no-HTTPS, y no viajarán en POST cross-origin. En prod detrás de Railway/proxy hay que asegurar HTTPS extremo-a-extremo y los headers de proxy correctos, o algunos flujos cross-origin fallarán silenciosamente.

### O-07 (Baja, ops) — El healthcheck de Keycloak está roto: `curl` no existe en la imagen KC 26
`docker inspect` del container: `Status: unhealthy, FailingStreak: 224`, con `Output: "/bin/sh: line 1: curl: command not found"`. El healthcheck de `docker-compose.yml:41` usa `curl -sf http://localhost:8080/realms/japan-trip`, pero **la imagen `quay.io/keycloak/keycloak:26.6.1` no incluye `curl`** (Keycloak lo removió hace varias versiones). Resultado: el container está **sano y sirviendo auth** (los logs lo prueban), pero se reporta `unhealthy` para siempre. Riesgo: cualquier orquestación que espere `condition: service_healthy` sobre Keycloak **colgaría indefinidamente**; y el señalizador de salud es inútil para diagnóstico real. **Fix:** usar el endpoint de salud vía un método disponible en la imagen — p. ej. el management port 9000 (`/health/ready`) con una comprobación que no dependa de `curl` (bash `/dev/tcp`, o `wget` si está, o el healthcheck nativo de KC), o añadir curl en un Dockerfile derivado.

## 21. Calidad de los tests (a pedido — "cómo están escritos")

Se corrió la suite del backend: **30 tests, 5 archivos, todos en verde** (`vitest run`, 769ms). Pero **verde no significa lo que parece** en las rutas que dependen de datos.

### TQ-01 (Media, **tests vacuos**) — Los tests de rutas con DB "pasan" aceptando el 500 de una DB inexistente
`backend/src/routes/public.test.ts` + `index.test.ts`

Los tests apuntan a `DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb'` — una DB que **no existe** (al correr, el log muestra `password authentication failed for user "mock"`). Cada request que toca la DB lanza y la ruta responde **500**. Y los tests **aceptan el 500 como válido**:

```ts
it('valid UUID + public trip → 200 (or 500 without real DB)', async () => {
  const res = await app.request(`/api/public/trips/${VALID_SLUG}`, {}, mockEnv);
  expect([200, 500]).toContain(res.status);        // ← 500 pasa
  if (res.status === 200) { expect(body.success).toBe(true); }  // ← nunca corre
});
```

De los 4 tests de `public.test.ts`, **3 son efectivamente vacuos**: el que valida el trip público, el de trip privado (`[404, 500]`), y el de "no matching trip" (`[404, 500]`) — todos reciben 500, pasan, y sus assertions reales están detrás de un `if (status === 200/404)` que **nunca se ejecuta**. Verifican los requisitos SHARE-02/SHARE-04 **solo de nombre**: una regresión que rompiera el filtro `is_public` (fugando trips privados) o el 404-de-inexistente **no sería detectada**. Solo el test "invalid UUID → 400" asserta algo real (se rechaza en la capa de regex, antes de la DB). **Fix:** correr estos tests contra una DB real (ver TQ-02) y **eliminar el `500` de los `toContain`** — un 500 debe hacer **fallar** el test, no pasarlo.

### TQ-02 (Media) — No hay DB de test real, teniendo Postgres corriendo en Docker
La suite unitaria nunca ejercita la capa de datos (queries, la cascada de ownership, la distinción 403-vs-404 de `trips.ts` — el corazón de la autorización, ya señalado en **T-01**). La ironía: **hay un Postgres 16 sano en Docker** (`keycloak-postgres-1`, puerto 5432) que los tests podrían usar. Apuntar el `mockEnv` a una DB de test efímera (con las migraciones + un seed mínimo) convertiría los tests vacuos de TQ-01 en tests reales y cerraría T-01. Es el cambio de mayor ROI para la confianza de la suite.

### TQ-03 (Media, **flakiness y skips silenciosos**) — La suite E2E está construida para pasar/saltear, no para atrapar regresiones
`tests/e2e/*`

- **31 `waitForTimeout` (sleeps duros)** repartidos por `trips`, `auth`, `city-pages`, `landing`, etc. (p. ej. `trips.spec.ts:67 waitForTimeout(500)`, `auth.spec.ts:235 waitForTimeout(1500)`). Los sleeps fijos son el anti-patrón clásico de Playwright: lentos (siempre esperan el total) **y** flaky (demasiado cortos bajo carga). La práctica correcta es *web-first assertions* (`await expect(locator).toBeVisible()`) que reintentan solas. Para un milestone (v3.1) cuyo objetivo literal es *"estabilizar el E2E"*, 31 sleeps fijos son flakiness incorporada.
- **35 skips condicionales** (`test.skip(!backendUp, ...)`, `test.skip(!!process.env.SKIP_REAL_AUTH, ...)`, "Frontend not running", "KC not available"). Los tests **se auto-saltean** cuando el entorno no está completo, en vez de fallar. Un test saltado es un test verde que **no verifica nada** — y con este patrón, "E2E passing" puede significar "media suite se salteó porque el backend no estaba arriba". Combinado con TQ-01 (aceptar 500), hay un patrón sistémico: **la suite está diseñada para no fallar, no para detectar defectos.**
- **1 spec saltado incondicionalmente**: `trip-edit-integration.spec.ts` hace `test.skip(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration')` — un archivo entero de test muerto/pre-escrito que nunca corre. Debería vivir en una branch o estar marcado de forma que no cuente como "cobertura".

### Nota positiva — los tests de middleware son sólidos
`auth.test.ts` y `cors.test.ts` asertan **exactamente** (401 con `success:false` para token ausente/malformado/audience inválido; comportamiento CORS determinista) **sin** tocar la DB, así que son deterministas y significativos. `index.test.ts` (8 tests) cubre el wiring básico. El problema de calidad está **concentrado en las rutas que dependen de datos** (public, y por ausencia trips) — precisamente donde vive la lógica de negocio y de autorización. Arreglar TQ-02 (DB de test real) desbloquea arreglar TQ-01 y T-01 de una vez.

## 22. Vulnerabilidades de dependencias — `npm audit` en vivo (corrige el número del candidato v3.2)

`.planning/v3.2-CANDIDATE-REQUIREMENTS.md` cita *"21 known dependency vulnerabilities (2 critical)"*. **El `npm audit` actual no coincide** — el número está stale o se contó distinto (con devDeps de otra fecha). Estado real hoy:

| Workspace | Resultado `npm audit` |
|---|---|
| root | 3 (1 moderate, 2 high) |
| backend | 2 high |
| frontend | 1 moderate (prod) / varios en devDeps |
| tests | **0** |
| **críticas** | **0** (no hay ninguna crítica) |

**Las dos que importan de verdad** (el resto es dev-tooling: `esbuild`/`vite`/`brace-expansion`/`@hono/node-server`, todas de superficie dev-server, no de runtime de producción):

### D-VULN-01 (High) — `drizzle-orm <0.45.2`: SQL injection vía identificadores mal escapados
`GHSA-gpj5-g38j-94v9` — afecta **toda la capa de datos** (el ORM del backend). La vulnerabilidad es en el escape de **identificadores** SQL (nombres de tabla/columna dinámicos), **no** en los valores parametrizados. El repo usa identificadores **estáticos** (el schema Drizzle es fijo, ningún nombre de columna viene de input de usuario), así que la explotabilidad práctica es **baja** — pero es un advisory HIGH sobre el ORM y el fix es un bump de versión (`drizzle-orm@0.45.2`, breaking). Recomendado actualizar y correr los tests (que, ver TQ-02, hoy no ejercitan las queries — otra razón para cerrar ese gap antes de bumpear).

### D-VULN-02 (Moderate) — `dompurify <=3.4.11`: el control anti-XSS tiene su propia vulnerabilidad
Notable **porque toda la defensa XSS de las pasadas 1-3 descansa en DOMPurify** (`tripDetail.ts`, `map.ts`). Una vuln en la librería de saneo debilita justo el control del que depende la vista cross-user. Fix: bump a la versión parcheada. Con esto + S-23 (Leaflet sin SRI) + M-07 (sin CSP), refuerza que la postura XSS del frontend necesita las tres cosas: sanear con una DOMPurify **al día**, pinear dependencias, y una CSP de respaldo.

**Nota:** correr `npm audit fix` sin `--force` para los parches no-breaking, y planificar los breaking (`drizzle-orm`, `vite`) con testing. Que `tests/` tenga 0 vulns y `backend`/`frontend` no, sugiere que las dev-deps de build son la mayor fuente — priorizar las de runtime (drizzle-orm, dompurify) sobre las de tooling.

## Actualización de totales tras la séptima pasada

| Categoría | Antes | Ahora | Nuevos |
|---|---|---|---|
| **CI/CD-Ops** | 6 | 8 | **O-08 (build roto / deploy bloqueado, Alta)**, O-07 (healthcheck KC roto) |
| **Auth flow / IdP (runtime)** | 2 | 4 | KC-C (**verificado benigno — cerrado**, 7/7 session-management verdes), KC-D (cookies no-secure); **KC-A confirmado en runtime + corroborado con los 3 specs de passkey fallando en vivo** |
| **Calidad de tests** | 0 | 3 | TQ-01 (tests vacuos aceptan 500), TQ-02 (sin DB de test real), TQ-03 (E2E: sleeps + skips + spec muerto) |
| **Dependencias** | 0 | 2 | D-VULN-01 (drizzle-orm HIGH SQLi-identificadores), D-VULN-02 (dompurify — el control XSS); v3.2 "21 vulns/2 críticas" desmentido (0 críticas hoy) |

### Lo confirmado empíricamente en esta pasada (antes teórico)
1. **KC-A** pasó de "diseño frágil" a **"Keycloak ignora la ejecución de passkey en cada request"** (log directo) **+ los 3 specs de passkey fallan en vivo** (la ceremonia de registro nunca se presenta). Candidato de causa raíz del "passkeys ×3 known-failing". Sube de prioridad y toca directo el objetivo "passkeys simples".
2. **O-04** (compat date vieja) pasó de "Baja, se pierden fixes" a **"rompe el build → bloquea el deploy"** (O-08, reproducido).
3. **La suite verde no garantiza corrección**: tests de ruta vacuos (TQ-01) + skips silenciosos (TQ-03) significan que "todo pasa" convive con lógica de negocio/autorización sin ejercitar.

**Nota de método (séptima pasada):** primera pasada con ejecución. Comandos corridos: `docker ps`/`docker logs`/`docker inspect` (Keycloak/Postgres/Mailpit), `npm test` en `backend/` (30 tests verdes, salida real inspeccionada), `npm run build` en `backend/` (fallo de `string_decoder` reproducido y root-causado a `compatibility_date`), y `npx playwright test --project=chromium-passkeys` contra el stack en vivo (frontend/backend/KC arriba) — **los 3 tests de passkey fallan**, todos esperando la página "Register" de KC que no aparece, con el navegador autenticado en `profile.html`. Esto corrobora KC-A y coincide con el estado "passkeys ×3 known-failing" de PROJECT.md. Además, para cerrar KC-C, se corrió `session-management.spec.ts --project=chromium` en vivo → **7/7 verdes (34s)**, con la aserción `sessions.length === 0` post-logout confirmando que el logout destruye la sesión de KC (KC-C **cerrado como benigno**). No se corrió la suite E2E completa (las demás specs usan sleeps duros y skips condicionales; ver TQ-03, cuyos conteos se verificaron con `rg`). Los dos runs en vivo (passkeys 3/3 rojo, session-management 7/7 verde) muestran que la calidad de la suite es heterogénea, no uniformemente rota.

---

# Ledger de verificación — qué está probado, qué es estáticamente cierto, y qué queda por verificar

> Añadido tras la pregunta "¿algo que quede por verificar?". Clasifica cada hallazgo por su **grado de evidencia**, para que quede claro dónde una prueba en vivo agregaría valor y dónde sería redundante.

### A. Verificado empíricamente (ejecutado en esta sesión)
- **O-08** — build del backend falla (`string_decoder`), reproducido con `npm run build`.
- **KC-A** — Keycloak ignora la ejecución de passkey: log directo en cada request **+** 3/3 specs de passkey fallan en vivo.
- **KC-C** — **cerrado como benigno**: 7/7 de `session-management.spec.ts` en verde, `sessions.length === 0` post-logout.
- **KC-D**, **O-07** — vistos en `docker logs`/`docker inspect` (cookies no-secure; healthcheck roto por `curl` ausente).
- **TQ-01** — tests de ruta vacuos: corrida real muestra el 500 de la DB mock que los tests aceptan.
- **BL-11** — desfase de fecha por timezone: reproducido (`2026-02-22 → Feb 21` en TZ negativos).
- **D-VULN-01/02** — `npm audit` en vivo (drizzle-orm HIGH, dompurify moderate; 0 críticas).

### B. Estáticamente cierto — un test en vivo sería confirmatorio, no revelador
Estos se siguen **necesariamente** del código; no hay ambigüedad de runtime que una ejecución resuelva:
- **BL-06 / BL-07 / BL-08 / BL-09** — `schemas.ts` no tiene **ningún** `.refine()`; por la semántica de Zod, un schema sin refinamiento **acepta** end<start, PATCH vacío, y lat/lng fuera de rango. La ausencia es verificable por lectura (grep) y determina el comportamiento. *(Intenté además una prueba en vivo vía API autenticada; quedó bloqueada por la fricción de capturar un token PKCE al recargar el dashboard — pero no cambia la certeza: el intento habría confirmado lo que el código ya garantiza.)*
- **BL-01 / BL-02 / BL-03 / BL-04 / BL-05** — la ausencia de campos en el form y en `CreateActivitySchema`, y el descarte en `tripAdapter`, son hechos de código (lectura directa), no comportamientos inciertos.
- **S-01** (OTP `Math.random`), **S-05**, **B-01**, **N-01/N-02** — todos determinados por el código leído.

### C. Queda por verificar en vivo (valor real, no ejecutado esta sesión)
- **La suite E2E completa** — solo se corrieron `passkeys` (rojo) y `session-management` (verde). Falta correr `trips`, `trip-edit`, `public-sharing`, `otp`, `auth`, `accessibility`, `pwa`, etc. con frontend+backend arriba, para un mapa real de verde/rojo (el milestone v3.1 es precisamente eso).
- **Tests unitarios del frontend** (`dashboard.test.ts` y otros bajo `frontend/`) — no se corrieron.
- **BL-06/BL-07 vía API autenticada** — la certeza estática es total, pero una prueba end-to-end (crear un viaje con `end < start` desde la UI y verlo aceptado) sería una demo contundente para el equipo; requiere resolver la captura de token o usar el editor real en navegador.
- **BL-03 en la vista pública** — crear un viaje de usuario, compartirlo, y confirmar visualmente que el link "Google Maps" no aparece y que `time` no se muestra. Cerraría el círculo de la paridad con la demo.
- **El fix de O-08** — bumpear `compatibility_date` y re-correr `npm run build` para confirmar que desbloquea (y ver si aparecen más built-ins sin prefijo).
- **S-23** (Leaflet sin SRI) — verificable con un test que compruebe presencia de `integrity` en los `<script>` de las 9 páginas.

### Áreas del repo no auditadas en profundidad en ninguna pasada
- Módulos estáticos de bajo riesgo ya confirmados DOM-safe: `search.ts`/`countdown.ts`/`theme.ts`.
- Los specs E2E individuales a nivel de aserción (más allá de conteos de anti-patrones en TQ-03) — no se leyó cada `expect` de los ~103 tests.
- Rendimiento/carga, y el comportamiento real de la PWA offline (el SW y sus gaps se analizaron por lectura, no ejecutando el modo offline).

**Conclusión:** los hallazgos de **seguridad e infraestructura** de mayor severidad (S-01, S-19, O-08, KC-A) están **verificados o son de código directo**. Lo que más valor tendría verificar a continuación es **correr la suite E2E completa** (mapa real de estado) y **una demo end-to-end de los gaps de validación de fechas** (BL-06/BL-07) — no porque haya duda de que existen, sino porque verlos en la UI del producto es el argumento más difícil de refutar frente a "anda bien".
