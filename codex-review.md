# Codex Review - PruebaMapJapan

Fecha de reevaluacion: 2026-06-23 America/Buenos_Aires  
Logs de contenedores: 2026-06-24 UTC  
Repo: `PruebaMapJapan`  
Foco: full scan del repo, pruebas locales, E2E, IDP/Keycloak, sesiones, passkeys, OTP, public sharing, superficies XSS y calidad de cobertura.

## Resumen ejecutivo

La base tecnica sigue siendo razonable: frontend Vite/TypeScript, backend Hono sobre Workers, Keycloak como IdP, Authorization Code + PKCE en el cliente publico, verificacion JWT por JWKS en backend, validacion con Zod, ownership checks en rutas de trips y una suite amplia de Vitest/Playwright.

El resultado actual de la reevaluacion no confirma una regresion general del producto, pero si confirma que la cobertura E2E de autenticacion real no es confiable. El flujo WebAuthn passwordless sigue emitiendo warnings de Keycloak indicando que `webauthn-authenticator-passwordless` es ignorado por mezcla invalida de ejecuciones `REQUIRED` y `ALTERNATIVE`. Ademas, la suite real de auth falla en `global-setup.ts` antes de ejecutar tests porque espera `page.waitForURL(/localhost:8080/)` con carga completa de la pagina Keycloak, y ese `load` no se completa de forma confiable. Un diagnostico manual con Playwright si mostro que el click redirige a Keycloak, por lo que el problema inmediato es el harness, no el boton.

Los checks unitarios y typechecks pasan. Playwright Chromium con `SKIP_REAL_AUTH=true` completa con 64 passed, 14 skipped, 2 failed y 8 not run. Los dos fallos actuales son de fixtures que esperan capturar un Bearer token desde requests del dashboard, pero la sesion real no queda reconstruida por `storageState`/`sessionStorage`. Esto reemplaza el hallazgo antiguo de 500 generalizado en public sharing: hoy `/api/public/trips/not-a-uuid` devuelve 400 manualmente, pero la cobertura funcional de public sharing sigue bloqueada por el setup autenticado.

## Validacion de gaps solicitados

- Secret audit:
  - Validado a nivel de herramientas dedicadas automatizadas: Gitleaks full-history y TruffleHog full-history verified.
  - Resultado: Gitleaks falla con 14 findings redacted `generic-api-key`; TruffleHog verified no encuentra secretos verificados.
  - No se puede declarar "certification-grade clean" hasta triagear cada finding y rotar cualquier valor real historico.

- WCAG/accessibility:
  - Validado con axe-core 4.12.1, Lighthouse accessibility, keyboard traversal Playwright y contraste computado.
  - Resultado: falla automatizada por `aria-allowed-attr`, `color-contrast`, y en Tokyo tambien `heading-order`/`target-size`.
  - Sigue faltando lo que no puede automatizarse bien: lector de pantalla real, mobile assistive tech y revision manual de todos los estados interactivos.

- Performance:
  - Validado con Lighthouse 13.4.0 sobre `vite preview`/`dist`.
  - Resultado: landing desktop OK (96), pero mobile landing 73 con LCP 5.856s y Tokyo mobile 69 con LCP 6.261s.
  - No es field data/Core Web Vitals real de usuarios; es lab audit local con throttling.

## Ambiente levantado

Servicios iniciados:

- `docker compose up -d` en `keycloak/`.
- Frontend dev server: `http://localhost:5173/PruebaMapJapan/`.
- Backend dev server: `http://localhost:8787`.
- Keycloak: `http://localhost:8080/realms/japan-trip`.
- Mailpit: `http://localhost:8025`.
- Postgres: `localhost:5432`.

Estado observado:

- `GET http://localhost:5173/PruebaMapJapan/`: 200.
- `GET http://localhost:8787/api/health`: 200.
- `GET http://localhost:8080/realms/japan-trip`: 200.
- `docker ps`: `keycloak-keycloak-1` queda `unhealthy` aunque el realm responde 200.
- Vite no puede arrancar dentro del sandbox por `Cannot read directory "../../../..": Access is denied`; arranca fuera del sandbox.

## Comandos ejecutados y resultados

### Unitarias y TypeScript

- `npm.cmd run typecheck --workspace=frontend`
  - OK.
- `npm.cmd run typecheck --workspace=backend`
  - OK.
- `npm.cmd run test:run --workspace=frontend`
  - 9 files passed.
  - 97 tests passed.
- `npm.cmd test --workspace=backend`
  - 5 files passed.
  - 30 tests passed.
  - Aun imprime errores reales de Postgres en tests publicos: `password authentication failed for user "mock"`. Los tests pasan porque aceptan 500 en escenarios funcionales, lo cual reduce el valor de cobertura.

### Build, Terraform y despliegue

- `npm.cmd run build --workspace=frontend`
  - OK fuera del sandbox.
  - Vite genero `frontend/dist` correctamente: 67 modules transformed.
  - Bundle principal observado: `leaflet` 149.63 kB, `Navbar` 38.88 kB, `trip-edit` 36.83 kB, `DOMPurify` 29.14 kB, `SearchBar` 28.35 kB.

- `npm.cmd run build --workspace=backend`
  - Falla en `wrangler deploy --dry-run`.
  - Wrangler 3.114.17 reporta version vieja y recomienda Wrangler 4.
  - Build falla con 25 errores por imports de Node built-ins desde `pg`/dependencias: `events`, `fs`, `util`, `dns`, `net`, `crypto`, `tls`, `path`, `stream`, `string_decoder`.
  - Wrangler sugiere prefijar con `node:` o actualizar `compatibility_date` a `2024-09-23` o posterior, pero el riesgo real es que el bundle del Worker arrastra `pg`/`node-postgres` aunque produccion deberia usar Neon HTTP.

- `terraform -chdir=terraform/keycloak validate`
  - OK.

- `terraform -chdir=terraform/cloudflare validate`
  - OK con warnings.
  - `cloudflare_worker_secret` esta deprecado; recomienda `cloudflare_workers_secret`.

- Produccion publica:
  - `curl -I https://manud.github.io/PruebaMapJapan/`: 404 desde GitHub Pages.
  - `curl -I https://manud.github.io/PruebaMapJapan/manifest.json`: 404 desde GitHub Pages.
  - `curl -I https://prueba-map-japan-api.manud.workers.dev/api/health`: DNS no resuelve.
  - Conclusion: no se pudo validar una produccion viva; los endpoints publicos probables no estan publicados o no existen bajo esos hostnames.

### DB y API edge checks

- Inspeccion SQL read-only via Docker/Postgres:
  - Tablas app presentes: `users`, `trips`, `destinations`, `hotels`, `days`, `activities`, `email_otp_codes`.
  - Columnas migradas presentes:
    - `trips.public_slug uuid`.
    - `hotels.url text`.
    - `activities.time text`.
    - `email_otp_codes` con `code_hash`, `expires_at`, `used_at`, `attempts`, `created_at`.
  - Indices presentes: `trips_public_slug_idx`, `trips_user_id_idx`, `users_keycloak_id_idx`, `destinations_trip_id_idx`, `days_destination_id_idx`, `activities_day_id_idx`.
  - Extensiones instaladas: solo `plpgsql`.
  - `select gen_random_uuid();` funciona en el Postgres local.

- Clean-room migration check:
  - Se creo DB temporal `codex_migration_check`.
  - Se aplicaron los SQL en `backend/src/db/migrations/*.sql` con `psql -v ON_ERROR_STOP=1`.
  - Resultado: todos los migrations aplican sin error desde cero.
  - Se verificaron columnas/indices clave y `gen_random_uuid()`.
  - Se elimino la DB temporal al terminar.

- API probes:
  - `GET /api/trips` sin auth: 401.
  - `POST /api/trips` sin auth con body invalido: 401, correcto porque auth se evalua antes que validacion funcional.
  - `GET /api/public/trips/not-a-uuid`: 400.
  - CORS preflight desde `https://evil.example`: 204 sin `Access-Control-Allow-Origin`, correcto.
  - CORS preflight desde `https://manud.github.io`: 204 con `Access-Control-Allow-Origin: https://manud.github.io`, correcto.
  - Path traversal-ish `/api/public/trips/../../etc/passwd`: 404.
  - Encoded traversal-ish slug con `%5C..%5C..`: 400 `Invalid slug`.

### Seguridad, dependencias y secretos

- `npm.cmd audit --workspaces --audit-level=moderate`
  - 18 vulnerabilities:
    - 10 moderate.
    - 6 high.
    - 2 critical.
  - Paquetes/riesgos principales:
    - `drizzle-orm <0.45.2`: high, SQL injection via identifier escaping.
    - `hono <=4.12.24`: high, multiples advisories incluyendo CORS wildcard con credentials, JWT/cookie helpers, body limit bypass y cache leakage en middleware.
    - `dompurify <=3.4.10`: moderate, multiples bypasses en modos/configuraciones concretas.
    - `form-data`: high, CRLF injection.
    - `undici`: high, request/response smuggling, DoS y header/cookie issues.
    - `ws`: high, memory disclosure/DoS.
    - `esbuild`/`vite`/`wrangler`/`miniflare`: moderate/high via dev server o tooling.
  - `npm audit fix` cubre parte; varios fixes requieren `--force` y upgrades potencialmente breaking (`drizzle-orm`, `vite`, `wrangler`).

- `npm.cmd audit --prefix tests --audit-level=moderate`
  - 0 vulnerabilities.

- Secret scan local, valores enmascarados:
  - Secretos reales aparecen en archivos gitignored:
    - `backend/.dev.vars`.
    - `tests/.env.test`.
    - Terraform state/local provider caches bajo `.terraform/`.
  - `git ls-files` no lista `backend/.dev.vars`, `tests/.env.test`, `terraform/*/terraform.tfstate`, `terraform/*/local.tfvars` ni `.claude/settings.local.json`; esos archivos no estan trackeados.
  - Hay muchos ejemplos y planning docs con placeholders o comandos que contienen nombres de secrets; no se confirmo exposicion de valores reales trackeados en el scan enmascarado.
  - `git grep` sobre tracked files encontro muchos nombres de secrets/placeholders en docs/planning/examples y comandos.
  - `git log --all -G` muestra multiples commits historicos tocando patrones de secrets/placeholders; no se imprimieron valores.
  - Un scanner de alta entropia simple sobre tracked files no reporto findings en la salida final, pero esto no reemplaza Gitleaks/TruffleHog.

- Gitleaks full-history:
  - `docker run zricethezav/gitleaks:latest detect --source=/repo --redact --report-format=json`.
  - Escaneo 438 commits y ~66.17 MB.
  - Resultado: 14 findings redacted, todos `generic-api-key`.
  - Ubicaciones afectadas sin exponer valores:
    - `.planning/milestones/v3.0-phases/13-security-audit-documentation/13-01-PLAN.md`.
    - `.planning/milestones/v3.0-phases/13-security-audit-documentation/13-02-PLAN.md`.
    - `.planning/milestones/v3.0-phases/13-security-audit-documentation/13-03-PLAN.md`.
    - `.planning/phases/07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-/07-08-SUMMARY.md`.
    - `.planning/phases/08-demo-trip-seed-a-public-demo-trip-in-the-database-add-view-d/08-01-PLAN.md`.
    - `.planning/phases/13-security-audit-documentation/13-01-PLAN.md`.
    - `.planning/phases/13-security-audit-documentation/13-02-PLAN.md`.
    - `.planning/phases/13-security-audit-documentation/13-03-PLAN.md`.
    - `backend/.dev.vars.example`.
    - `backend/src/auth/keycloak.test.ts`.
    - `backend/src/index.test.ts`.
    - `backend/src/routes/public.test.ts`.
  - Evidencia local: `test-results/gitleaks-report.json`, con secrets redacted.

- TruffleHog full-history:
  - `docker run trufflesecurity/trufflehog:latest git file:///repo --json --no-update --only-verified`.
  - Version reportada: 3.95.6.
  - Escaneo 12,009 chunks y 66,355,206 bytes.
  - Resultado: `verified_secrets: 0`, `unverified_secrets: 0` en la corrida verificada.
  - Evidencia local: `test-results/trufflehog-verified.jsonl`.
  - Esto reduce el riesgo de secretos activos verificables, pero no cancela los 14 findings de Gitleaks: hay que triagearlos y rotar cualquier valor real que haya existido historicamente.

### Headers, PWA, accesibilidad y email

- Headers frontend dev (`curl -I /PruebaMapJapan/`):
  - `Content-Type: text/html`.
  - `Cache-Control: no-cache`.
  - `Vary: Origin`.
  - No CSP, HSTS, X-Frame-Options ni Referrer-Policy desde Vite dev. Esto no prueba GitHub Pages prod, pero significa que la app estatica depende del host para headers de seguridad.

- Headers backend dev (`curl -I /api/health`):
  - `content-security-policy: default-src 'none'`.
  - `x-frame-options: DENY`.
  - `strict-transport-security: max-age=31536000; includeSubDomains`.
  - `referrer-policy: no-referrer`.
  - `access-control-expose-headers: Content-Length`.

- PWA:
  - `GET /PruebaMapJapan/manifest.json`: OK.
  - Manifest usa iconos remotos de `cdn-icons-png.flaticon.com`; esto debilita install/offline y privacidad porque los iconos no son first-party/precacheados.
  - `GET /PruebaMapJapan/sw.js`: OK.
  - `frontend/src/main.ts` registra el service worker solo en `import.meta.env.PROD`.
  - Probe local dev: `navigator.serviceWorker.getRegistrations()` devolvio `count: 0`, esperado por la condicion `PROD`, pero significa que no se valido offline real en dev.
  - `sw.js` precachea HTML y manifest, pero no lista assets hasheados de Vite (`assets/*.js/css`) ni `demo-hero.jpg`; depende de cache runtime despues de primera carga.
  - `vite preview` sobre `frontend/dist` en `127.0.0.1:4173`:
    - SW registrado con scope `/PruebaMapJapan/`.
    - `navigator.serviceWorker.controller` true despues de la primera carga.
    - Reload offline de landing devuelve 200 y titulo `Travel Planner`.
  - Esto valida offline basico para landing en build local; no valida GitHub Pages real ni todas las paginas offline.

- Accesibilidad/keyboard smoke:
  - Landing dev tiene `h1Count: 1`.
  - Tiene skip link.
  - Primer `Tab` enfoca `Skip to main content`.
  - No se hizo auditoria manual completa de lector de pantalla; contraste se cubrio con axe/Lighthouse y un probe computado, no con una revision humana pixel-perfect.
  - Smoke sobre `dist` para 13 paginas:
    - Todas respondieron 200.
    - Todas tienen `main` y skip link.
    - No se encontraron botones sin nombre accesible ni imagenes sin `alt` en el DOM inicial.
    - `trip.html` inicial tiene `h1: 0`, hallazgo de accesibilidad/estructura.
    - DomContentLoaded local observado entre 10ms y 60ms, salvo recursos/mapa segun pagina; esto no equivale a Lighthouse ni Core Web Vitals.

- Axe-core WCAG audit sobre `vite preview`/`dist`:
  - Herramienta: `@axe-core/cli` 4.12.1 con Chrome/ChromeDriver 149 instalados via `browser-driver-manager`.
  - Paginas auditadas: 13 HTML de usuario en `frontend/dist` (`silent-check-sso.html` excluido de conclusiones por ser helper iframe).
  - Tags: `wcag2a,wcag2aa,wcag21a,wcag21aa`.
  - Resultado: 15 violaciones en total.
  - Violacion critica repetida en 12 paginas: `aria-allowed-attr` sobre el search input.
    - Causa concreta: `aria-expanded="false"` en un `input` donde axe indica que ese atributo no esta permitido para ese rol.
  - Violaciones serias de contraste:
    - Landing: `#landing-loading > span`, `.demo-countdown-title`.
    - Dashboard: `.nav-link`.
    - Profile: 13 nodos, incluyendo `#profile-name`, `#section-info-title` y labels de filas de perfil.
  - Evidencia local: `test-results/axe-wcag-preview.json`.
  - Limite: axe automatizado detecta solo una parte de problemas WCAG; no reemplaza lector de pantalla ni revision humana.

- Keyboard traversal y contraste computado:
  - Playwright recorrio los primeros 30 `Tab` stops en las mismas 13 paginas.
  - Resultado: no se detectaron traps obvios, foco oculto ni controles interactivos enfocados sin nombre accesible en ese tramo.
  - Contraste computado adicional:
    - Landing: 5 candidatos bajo umbral.
    - Profile: 4 candidatos bajo umbral.
    - Itinerary/static pages: varios candidatos, con maximo truncado a 25 por pagina en Tokyo/Kyoto/Osaka/Takayama.
  - Este contraste computado es smoke complementario; puede tener falsos positivos en overlays/imagenes, pero confirma que el area necesita revision visual/manual.
  - Evidencia local: `test-results/keyboard-contrast-report.json`.

- Lighthouse performance/accessibility audit sobre `vite preview`/`dist`:
  - Herramienta: Lighthouse 13.4.0 via `npm exec`.
  - El CLI escribio JSON valido, pero salio con `EPERM` al limpiar directorios temporales de Windows (`AppData\Local\Temp\lighthouse.*`); se documento como issue de runner, no de app.
  - Landing desktop:
    - Performance 96, Accessibility 90, Best Practices 73, SEO 100.
    - FCP 891 ms, LCP 1,209 ms, TBT 0 ms, CLS 0, Speed Index 891 ms.
  - Landing mobile throttled:
    - Performance 73, Accessibility 90, Best Practices 73, SEO 100.
    - FCP 2,929 ms, LCP 5,856 ms, TBT 0 ms, CLS 0, Speed Index 2,929 ms.
  - Dashboard mobile throttled:
    - Performance 88, Accessibility 91, Best Practices 73, SEO 100.
    - FCP/LCP/Speed Index 3,039 ms, TBT 0 ms, CLS 0.
  - Tokyo mobile throttled:
    - Performance 69, Accessibility 91, Best Practices 73, SEO 100.
    - FCP 3,629 ms, LCP 6,261 ms, TBT 0 ms, CLS 0, Speed Index 3,629 ms.
  - Lighthouse tambien marca:
    - `aria-allowed-attr`.
    - `color-contrast`.
    - third-party cookies.
    - console errors: 404 de recurso y bloqueo CSP al intentar framear `http://localhost:8080/`.
    - en `tokyo.html`: `heading-order` y `target-size`.
  - Evidencia local:
    - `test-results/lighthouse-index-desktop.json`.
    - `test-results/lighthouse-index-mobile.json`.
    - `test-results/lighthouse-dashboard-mobile.json`.
    - `test-results/lighthouse-tokyo-mobile.json`.

- Email:
  - Mailpit API responde 200 y contiene al menos un email OTP local.
  - El OTP backend envio un email local desde `TravelMap <noreply@example.com>`.
  - Varios templates de Keycloak email son wrappers minimos o archivos muy pequenos; algunos HTML/text estan vacios o delegan completamente a mensajes base.
  - No se valido end-to-end verify-email/password-reset mediante UI real.

### Playwright

- `SKIP_REAL_AUTH=true WAIT_FOR_FRONTEND=true WAIT_FOR_BACKEND=true npm.cmd test`
  - Suite all-browser comenzo 267 tests.
  - Se corto por timeout del comando despues de 5 minutos en 246/267.
  - Se observaron fallos masivos en Firefox con `browserContext.newPage: Cannot read properties of undefined (reading '_page')`.
  - WebKit llego a fallos/timeouts de integracion esperando requests autenticados.

- `SKIP_REAL_AUTH=true WAIT_FOR_FRONTEND=true WAIT_FOR_BACKEND=true npm.cmd test -- --project=chromium`
  - 88 tests.
  - 64 passed.
  - 14 skipped.
  - 2 failed.
  - 8 did not run.
  - Fallos:
    - `public-sharing.spec.ts`: `beforeAll` timeout esperando capturar Bearer token desde un request `/api/`.
    - `trip-edit-integration.spec.ts`: timeout esperando request `/api/` con header `Authorization: Bearer`.

- `WAIT_FOR_FRONTEND=true WAIT_FOR_BACKEND=true npm.cmd test -- --project=chromium`
  - Falla en `global-setup.ts` antes de ejecutar tests.
  - Error: `page.waitForURL: Timeout 15000ms exceeded` en la espera de `localhost:8080`.

- Diagnostico de real-auth sin conservar cambios de codigo/tests:
  - El bloqueo del setup se reproduce con el codigo actual porque `loginViaKcForm()` consulta `isVisible({ timeout })` sobre `#auth-login-prompt-btn`, pero `isVisible()` no espera hasta que el prompt aparezca.
  - La misma ruta avanza si el helper espera explicitamente el prompt visible y espera la navegacion a Keycloak con `waitUntil: 'commit'`.
  - Con ese ajuste diagnostico temporal, `npm.cmd test -- --project=chromium` llego a ejecutar tests reales:
    - 77 passed.
    - 4 failed.
    - 7 did not run.
  - Fallos observados en esa corrida diagnostica:
    - `otp.spec.ts`: expired OTP espera texto `/expir/`, backend responde `{"success":false,"error":"otp_not_found"}`.
    - `public-sharing.spec.ts`: guest slug view queda en `Loading trip...`.
    - `new-user-trip-creation.spec.ts`: el primer marker abre popup de hotel (`Tokyo Hotel`) en vez de actividad (`Senso-ji Temple`).
    - `trip-edit-integration.spec.ts`: timeout esperando request `/api/` con `Authorization: Bearer`.
  - `npm.cmd test -- --project=chromium-passkeys` tambien se ejecuto en el diagnostico:
    - 3 failed.
    - Los tres tests esperan un control de registro (`[data-action="register-passkey"], #register-passkey-btn, button:has-text("Register passkey")`) que no aparece.

### Diagnostico manual de login

Script Playwright manual:

- Navega a `http://localhost:5173/PruebaMapJapan/dashboard.html`.
- Espera 3 segundos.
- Verifica que `#auth-login-prompt-btn` esta visible.
- Hace click.
- Despues de 5 segundos la URL es:
  - `http://localhost:8080/realms/japan-trip/protocol/openid-connect/auth?...`

Conclusion: el boton redirige. El fallo de `global-setup.ts` esta en la forma de esperar la navegacion/carga de Keycloak.

### API manual

- `GET http://localhost:8787/api/public/trips/not-a-uuid`
  - Resultado: 400.
  - El 500 para slug invalido reportado en la revision anterior ya no se reprodujo en este ambiente.

### Logs Keycloak

`docker logs --tail 200 keycloak-keycloak-1` sigue mostrando repetidamente:

```text
REQUIRED and ALTERNATIVE elements at same level! Those alternative executions will be ignored: [webauthn-authenticator-passwordless]
```

Tambien aparecen warnings de contexto HTTP no seguro, esperables en local pero relevantes para pruebas cross-origin/cookies.

## Hallazgos criticos

### 1. WebAuthn passwordless sigue siendo ignorado por el flow activo

Evidencia:

- Logs actuales de Keycloak repiten:
  - `REQUIRED and ALTERNATIVE elements at same level! Those alternative executions will be ignored: [webauthn-authenticator-passwordless]`
- `terraform/keycloak/flows.tf` mantiene dentro de `passkey-forms`:
  - `auth-username-form` como `REQUIRED`.
  - `webauthn-authenticator-passwordless` como `ALTERNATIVE`.
- Keycloak advierte exactamente que esa mezcla hace que el authenticator alternativo sea ignorado.

Impacto:

- La promesa passkey-first/passwordless no esta garantizada.
- Usuarios pueden caer al flujo password aunque el sistema parezca configurado para passkeys.
- Los tests de passkeys no pueden considerarse una validacion real del flujo activo.

Recomendacion:

- Reestructurar el browser flow:
  - `auth-cookie` como alternativa superior.
  - Un subflow REQUIRED de credenciales.
  - Dentro de ese subflow, passkey y password como alternativas bien separadas, sin mezclar `REQUIRED` y `ALTERNATIVE` al mismo nivel invalido.
- Agregar un test automatizado de contrato contra Admin REST API que falle si el flow activo emite esa estructura.

### 2. La configuracion de Keycloak sigue teniendo fuentes divergentes

Evidencia:

- `terraform/keycloak/main.tf`: `browser_flow = "browser-passkey"`.
- `keycloak/realm-export.json`: `"browserFlow": "browser"`.
- `keycloak/apply-local-settings.sh`: fuerza `"browserFlow": "browser"`.
- Terraform define `web_authn_passwordless_policy.relying_party_id = "localhost"`.
- `realm-export.json` tambien tiene `webAuthnPolicyPasswordlessRpId: "localhost"`.

Impacto:

- No hay una fuente unica de verdad para local, terraform y export/import.
- Un entorno puede estar aplicando `browser` mientras otro cree estar usando `browser-passkey`.
- Cambiar RP ID mas adelante invalida passkeys ya registradas para otro dominio.

Recomendacion:

- Elegir una fuente de verdad y hacer que Terraform, export y scripts locales converjan.
- Separar claramente realm local (`rpId=localhost`) y realm prod (`rpId` del dominio real).
- Versionar una prueba de drift que compare realm activo contra archivos del repo.

## Hallazgos altos

### 3. `global-setup.ts` ya intenta clickear el prompt, pero espera mal la navegacion real de Keycloak

Este hallazgo actualiza el reporte anterior. La revision vieja decia que `global-setup.ts` esperaba un redirect automatico desde `dashboard.html`; eso ya fue corregido. El archivo ahora busca `#auth-login-prompt-btn` y lo clickea.

Evidencia actual:

- `tests/global-setup.ts` hace click en el prompt si esta visible.
- La suite sin `SKIP_REAL_AUTH` falla en:
  - `page.waitForURL(/localhost:8080/, { timeout: 15_000 })`.
- Un diagnostico manual con Playwright confirma:
  - boton visible.
  - click exitoso.
  - URL final en `localhost:8080/realms/japan-trip/protocol/openid-connect/auth?...`.

Impacto:

- Auth real, session lifecycle, passkeys y parte de OTP no corren de punta a punta.
- La suite falla antes de validar comportamiento de producto.
- Se crean falsos bloqueos por timing/load event de Keycloak.

Recomendacion:

- Cambiar la espera a una condicion menos fragil:
  - esperar explicitamente `#auth-login-prompt-btn` con `waitFor({ state: 'visible' })` antes de clickear, y
  - usar `page.waitForURL(/localhost:8080/, { waitUntil: 'commit' })`, o esperar directamente `#username, input[name="username"], input[autocomplete="username"]`.
- Capturar screenshot/URL/console en global setup al fallar.
- Separar setup real-auth de tests guest/mock para que un problema de IdP no bloquee toda la suite.

### 4. Los fixtures E2E autenticados siguen basados en un supuesto incorrecto sobre tokens de `keycloak-js`

Evidencia:

- `frontend/src/auth/keycloak.ts` comenta que tokens se guardan en `sessionStorage`.
- `tests/global-setup.ts`, `passkeys.spec.ts`, `new-user-trip-creation.spec.ts` y `trip-edit-integration.spec.ts` intentan guardar/reinyectar `sessionStorage`.
- Los archivos actuales `tests/.auth/session.json` y `tests/.auth/new-user-session.json` miden 2 bytes, consistente con `[]`.
- Playwright Chromium con `SKIP_REAL_AUTH=true` falla en:
  - `public-sharing.spec.ts` esperando un request `/api/` con `Authorization: Bearer`.
  - `trip-edit-integration.spec.ts` esperando lo mismo.

Impacto:

- `storageState` guarda cookies/localStorage, pero no reconstruye tokens en memoria del adapter.
- La app puede quedar "con cookies de SSO" pero sin Bearer en requests inmediatos.
- Los tests pasan o fallan segun timing de silent SSO y no segun el contrato real del producto.

Recomendacion:

- Dejar de depender de `sessionStorage` para tokens de `keycloak-js`.
- Para fixtures backend, usar un cliente tecnico test/worker con permisos acotados, no el cliente publico.
- Para tests de UX auth, hacer login real en navegador y esperar una senal de app autenticada.
- Para captura de token, exponer un helper de test controlado o capturar despues de una llamada API que se sabe que ocurre.

### 5. Playwright all-browser no es una senal confiable hoy

Evidencia:

- Suite all-browser con `SKIP_REAL_AUTH=true` llego a 246/267 antes del timeout.
- Firefox falla repetidamente con:
  - `browserContext.newPage: Cannot read properties of undefined (reading '_page')`.
- WebKit llega a timeouts en tests que esperan requests autenticados.

Impacto:

- El resultado "full browser" mezcla fallos de entorno, harness y producto.
- CI/local pueden dar lecturas ruidosas.

Recomendacion:

- Mantener Chromium como proyecto obligatorio hasta estabilizar Firefox/WebKit.
- Reparar instalacion/version de navegadores o fijar `npx playwright install`.
- Separar proyectos:
  - `guest/chromium`
  - `auth/chromium`
  - `passkeys/chromium`
  - `cross-browser-smoke`

### 6. OTP usa HMAC y limites basicos, pero genera codigos con `Math.random()`

Evidencia:

- `backend/src/routes/auth.ts` genera:
  - `String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')`
- Puntos positivos presentes:
  - email viene del usuario autenticado, no del body.
  - HMAC-SHA256 del codigo.
  - comparacion con acumulador constante.
  - expiracion de 10 minutos.
  - max 5 intentos sobre el OTP pendiente.

Impacto:

- `Math.random()` no es apropiado para codigos de seguridad.
- No hay rate limiting por usuario/IP/ventana mas alla de `otp_pending`.
- No hay auditoria visible de intentos fallidos.

Recomendacion:

- Usar Web Crypto:
  - `crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000`
  - idealmente con rejection sampling para evitar bias.
- Agregar rate limiting por usuario/IP.
- Loguear intentos fallidos y lockouts.
- Mantener OTP como recuperacion/fallback, no como factor equivalente a passkey.

### 7. Superficies XSS siguen existiendo en renderizado con strings

Evidencia:

- `frontend/src/pages/profile.ts` renderiza `userLabel` de credenciales en `innerHTML`.
- `frontend/src/components/SearchBar.ts` renderiza `result.title`, `result.subtitle`, `result.color` y highlight con HTML.
- `frontend/src/modules/search.ts` indexa datos de API del usuario: trip, destination, hotel, activity notes.
- `frontend/src/modules/widgets.ts` renderiza RSS/proxy data con `innerHTML`: titulo, link, source, pubDate.

Impacto:

- Si un trip/activity/passkey label/feed externo contiene HTML o atributos maliciosos, puede ejecutarse o romper el DOM.
- En una SPA autenticada, XSS es critico aunque los tokens esten en memoria porque el atacante puede actuar mientras la sesion vive.

Recomendacion:

- Preferir `createElement` + `textContent`.
- Si se necesita `<mark>` para highlight, escapar texto antes de insertar HTML.
- Validar colores antes de interpolar en `style`.
- Sanitizar links externos y permitir solo `http:`/`https:`.
- Agregar pruebas con payloads como `<img src=x onerror=...>` en:
  - passkey label.
  - trip name.
  - activity notes.
  - RSS title/source.

### 8. El backend no pasa `wrangler deploy --dry-run`

Evidencia:

- `npm.cmd run build --workspace=backend` falla fuera del sandbox.
- Wrangler reporta 25 errores resolviendo Node built-ins (`fs`, `net`, `tls`, `events`, `crypto`, etc.) desde `pg`/dependencias.
- `backend/src/db/index.ts` importa `pg` y `drizzle-orm/node-postgres` en el mismo modulo que tambien exporta el path Neon/serverless.
- `backend/wrangler.toml` usa `compatibility_date = "2024-01-01"` con `nodejs_compat`.

Impacto:

- El Worker puede no desplegar aunque typecheck y tests pasen.
- El dual-driver local/prod esta acoplado a nivel de import estatico; Wrangler empaqueta dependencias Node aunque en produccion se espere usar Neon HTTP.

Recomendacion:

- Separar drivers en modulos distintos, por ejemplo:
  - `db/neon.ts` para Worker/prod.
  - `db/node-postgres.ts` para dev local.
  - resolver el driver por entrypoint o import dinamico que Wrangler pueda tree-shakear.
- Actualizar Wrangler/Miniflare y `compatibility_date` de forma controlada.
- Agregar `npm run build --workspace=backend` como check obligatorio de CI.

### 9. Auditoria de dependencias encuentra vulnerabilidades altas/criticas

Evidencia:

- `npm audit --workspaces --audit-level=moderate` reporta 18 vulnerabilidades:
  - 10 moderate.
  - 6 high.
  - 2 critical.
- Paquetes clave:
  - `drizzle-orm`.
  - `hono`.
  - `dompurify`.
  - `form-data`.
  - `undici`.
  - `ws`.
  - `esbuild`/`vite`/`wrangler`/`miniflare`.
- `tests/` audit separado reporta 0 vulnerabilidades.

Impacto:

- Algunas vulnerabilidades son de tooling/dev server, pero otras estan en runtime backend (`hono`, `drizzle-orm`) o en sanitizacion frontend (`dompurify`).
- El fix de `drizzle-orm`, `vite` y `wrangler` puede requerir upgrades breaking; no conviene aplicar a ciegas sin regression tests.

Recomendacion:

- Priorizar upgrades runtime:
  - `hono`.
  - `drizzle-orm`.
  - `dompurify`.
- Despues actualizar tooling:
  - `wrangler` 4.x.
  - `vite`/`vitest` compatibles.
- Correr typecheck, unit tests, backend dry-run y Playwright smoke despues de cada grupo de upgrades.

## Hallazgos medios

### 10. Public sharing mejoro parcialmente, pero la cobertura sigue rota

Evidencia:

- Request manual:
  - `/api/public/trips/not-a-uuid` devuelve 400.
- Pero `backend/src/routes/public.ts` aun construye `db = getDb(c.env.DATABASE_URL)` antes de validar el slug.
- Si `DATABASE_URL` falta, `createDb` puede fallar antes de responder 400.
- Tests backend publicos siguen aceptando 500 sin DB real.
- E2E `public-sharing.spec.ts` no llega a crear fixtures porque no captura token.

Impacto:

- El caso invalido manual funciona con env bien configurado, pero la ruta todavia es fragil ante env ausente.
- La suite no comprueba actualmente public sharing funcional con fixture real.

Recomendacion:

- Mover validacion de slug antes de `getDb`.
- Validar `DATABASE_URL` explicitamente.
- Mockear DB en tests unitarios.
- Cambiar E2E para crear fixtures con cliente tecnico o login real estable.

### 11. El cliente frontend publico sigue permisivo en scopes/origins

Evidencia:

- `terraform/keycloak/main.tf`:
  - `web_origins = ["+"]`.
  - `full_scope_allowed = true`.
  - `direct_access_grants_enabled = false`, esto ultimo es correcto.

Impacto:

- `+` hereda origins desde redirect URIs; no es necesariamente una vulnerabilidad inmediata, pero es menos explicito.
- `full_scope_allowed` puede exponer mas claims/roles de los necesarios al cliente browser.

Recomendacion:

- Usar allowlist explicita:
  - `http://localhost:5173`
  - `https://manud.github.io`
  - dominio custom si aplica.
- Deshabilitar full scope y asignar scopes minimos.

### 12. Logout/session tests siguen mezclando modelo real con simulaciones de sessionStorage

Evidencia:

- `auth.spec.ts` setea tokens falsos en `sessionStorage` y los borra manualmente para probar logout.
- `session-management.spec.ts` tambien habla de tokens en `sessionStorage`.
- `keycloak-js` mantiene tokens en memoria, no en storage persistente controlado por Playwright.

Impacto:

- Los tests no prueban el comportamiento real de `logout()`, cookies Keycloak ni refresh failure.
- Puede haber falsos positivos en session lifecycle.

Recomendacion:

- Testear click real en logout y verificar:
  - redireccion/post-logout URI.
  - ausencia de Authorization posterior.
  - estado de prompt en dashboard.
- Modelar que `checkLoginIframe: false` implica detectar logout remoto en siguiente refresh/request, no inmediatamente.

### 13. PWA/offline no esta validado en dev y el manifest usa iconos remotos

Evidencia:

- `manifest.json` usa iconos de `cdn-icons-png.flaticon.com`.
- `src/main.ts` registra service worker solo en `import.meta.env.PROD`.
- Probe dev no encontro service worker registrado, esperado por `import.meta.env.PROD`.
- Probe sobre `vite preview`/`dist` si registro SW y permitio reload offline de landing con status 200.
- `sw.js` no precachea assets hasheados de Vite ni `demo-hero.jpg`.

Impacto:

- Offline/install funciona para landing en preview local, pero puede funcionar de forma parcial para otras paginas solo despues de cargas previas.
- Iconos remotos pueden fallar offline o filtrar requests a tercero durante install/render.
- GitHub Pages real devolvio 404 en los endpoints probados, asi que no se valido PWA en produccion publica.

Recomendacion:

- Mover iconos PWA a `frontend/public`.
- Generar/precachear manifest de assets de Vite o usar plugin PWA.
- Agregar un test sobre `vite preview` o servidor estatico de `dist` que valide:
  - SW registrado.
  - reload offline de paginas principales.
  - iconos locales accesibles.

### 14. Produccion publica no esta publicada en los endpoints esperados

Evidencia:

- `https://manud.github.io/PruebaMapJapan/`: 404.
- `https://manud.github.io/PruebaMapJapan/manifest.json`: 404.
- `https://prueba-map-japan-api.manud.workers.dev/api/health`: DNS no resuelve.
- Workflows de GitHub existen para Pages y Worker, pero no se ejecuto deploy desde esta revision.

Impacto:

- No hay evidencia de una produccion viva para usuarios.
- Aunque frontend build local pasa, el artefacto no parece publicado en GitHub Pages bajo el path configurado.
- El backend Worker tampoco es verificable publicamente y localmente no pasa dry-run.

Recomendacion:

- Revisar estado de GitHub Pages y Actions.
- Confirmar URL real de Worker o configurar `workers.dev`/route custom.
- Hacer que CI falle si `wrangler deploy --dry-run` falla.

### 15. Clean-room migrations pasan, pero falta estrategia formal de rollback/versionado

Evidencia:

- Los migrations SQL aplican desde cero en DB temporal.
- Columnas e indices clave quedan presentes.
- No hay rollback scripts.
- No se probo migracion contra una base con datos legacy variados ni downgrade.

Impacto:

- El camino fresh install esta razonablemente cubierto.
- Cambios futuros de schema podrian necesitar pasos manuales si hay datos incompatibles.

Recomendacion:

- Agregar prueba automatizada de migracion clean-room en CI.
- Agregar fixture de datos pre-migration para validar migraciones incrementales.
- Documentar politica de rollback/backups.

### 16. Headers de seguridad frontend dependen del host estatico

Evidencia:

- Frontend dev no emite CSP, HSTS, X-Frame-Options ni Referrer-Policy.
- Backend si emite headers fuertes.
- GitHub Pages no permite controlar todos los headers con la misma flexibilidad que un CDN/Worker.

Impacto:

- La SPA estatica queda sin CSP propia salvo que se sirva detras de un host/CDN que la agregue.
- Dado que ya hay superficies `innerHTML`, una CSP frontend ayudaria como defensa adicional.

Recomendacion:

- Definir headers de frontend en el hosting real: Cloudflare Pages/Worker, CDN, o mecanismo equivalente.
- CSP inicial conservadora:
  - permitir scripts propios y los origenes estrictamente necesarios.
  - remover iconos/fonts remotos o declararlos explicitamente.
- Agregar `Referrer-Policy` y `X-Content-Type-Options`.

### 17. Email/Keycloak templates tienen cobertura parcial

Evidencia:

- Mailpit recibe OTP local.
- Templates email de Keycloak son wrappers minimos o archivos vacios/delegados.
- No se ejecuto verify-email/password-reset end-to-end por UI.

Impacto:

- OTP email esta cubierto localmente, pero flujos Keycloak nativos pueden tener copy/layout roto sin que la suite lo detecte.
- Archivos vacios pueden ser intencionales por herencia de tema base, pero deberian estar documentados.

Recomendacion:

- Agregar tests E2E Mailpit para:
  - VERIFY_EMAIL.
  - password reset.
  - execute actions.
  - OTP backend.
- Verificar asunto, destino, link/action URL, idioma y expiracion.

### 18. Checklist OAuth/RFC 9700 contiene afirmaciones stale

Evidencia:

- `docs/security/rfc9700-checklist.md` dice que JWT se guarda en `sessionStorage`.
- El adapter `keycloak-js` mantiene tokens en memoria.
- La review y los tests ya muestran que `sessionStorage` queda `[]` en setup.

Impacto:

- La documentacion de seguridad puede guiar a tests o decisiones incorrectas.

Recomendacion:

- Actualizar el checklist para reflejar tokens en memoria, cookies SSO de Keycloak y limites de `check-sso`.
- Cambiar el status de controles no verificados de "Compliant" a "Partial" o "Not verified" donde corresponda.

### 19. Accesibilidad y performance ya tienen auditoria automatizada, pero no cierre WCAG manual

Evidencia:

- Smoke local `dist` cubrio 13 paginas.
- Todas tienen `main`, skip link y botones nombrados en DOM inicial.
- `trip.html` inicial tiene `h1: 0`.
- Axe-core 4.12.1 corrio sobre 13 paginas con tags WCAG 2.0/2.1 A/AA.
- Axe encontro 15 violaciones:
  - `aria-allowed-attr` critico en search input de 12 paginas por `aria-expanded` no permitido.
  - `color-contrast` serio en landing, dashboard y profile.
- Playwright recorrio 30 tab stops por pagina sin detectar focus traps obvios, foco oculto ni controles enfocados sin nombre.
- Probe de contraste computado encontro candidatos adicionales en landing, profile y paginas de itinerario.
- Lighthouse 13.4.0 corrio sobre landing desktop/mobile, dashboard mobile y Tokyo mobile.
  - Landing desktop performance 96.
  - Landing mobile performance 73, LCP 5,856 ms.
  - Dashboard mobile performance 88.
  - Tokyo mobile performance 69, LCP 6,261 ms.
- Lighthouse confirma `aria-allowed-attr`, contraste, third-party cookies, errores de consola, y en Tokyo `heading-order`/`target-size`.
- No se valido lector de pantalla real, mobile assistive tech, reduccion de movimiento ni todos los estados interactivos autenticados.

Impacto:

- La app no esta lista para declarar conformidad WCAG: hay violaciones automatizadas criticas/serias confirmadas.
- El search input tiene un patron ARIA invalido repetido en casi toda la app.
- Mobile performance es aceptable en dashboard, pero landing e itinerario tienen LCP lento en throttling.
- `trip.html` sin H1 y `tokyo.html` con heading-order/target-size degradan navegacion semantica y touch UX.

Recomendacion:

- Corregir search input: mover `aria-expanded` a un combobox/listbox valido o implementar el patron ARIA completo.
- Corregir contraste de landing/dashboard/profile y revisar manualmente overlays de paginas de itinerario.
- Corregir `trip.html` para tener H1 estable tambien en estados loading/guest/error.
- Corregir heading order y touch targets en paginas de itinerario.
- Agregar axe-core y Lighthouse CI sobre `dist` con budgets, y mantener un pase manual de teclado/lector de pantalla antes de release.
- Optimizar LCP mobile de landing/Tokyo: hero/images, preload correcto, lazy loading selectivo y reduccion de JS inicial.

### 20. API fuzzing/concurrency sigue siendo parcial

Evidencia:

- Se probaron auth ausente, slug invalido, CORS allowed/denied y traversal-ish paths.
- No se hizo fuzzing generativo de payloads autenticados.
- No se probaron carreras de edicion concurrente, idempotencia de deletes, payloads grandes o limites de body.
- Auth real sigue bloqueado/ruidoso, lo que limita pruebas de ownership y CRUD real.

Impacto:

- Hay cobertura de bordes publicos basicos, pero no de robustez bajo carga o entradas maliciosas autenticadas.

Recomendacion:

- Crear cliente tecnico de test con permisos acotados para fixtures API.
- Agregar tests de concurrencia sobre trips/destinations/days/activities.
- Agregar limites explicitos de body y tests de payload grande.

### 21. Secret scanning full-history encontro findings que requieren triage/rotacion

Evidencia:

- `git grep` y `git log -G` encuentran muchos nombres de secrets/placeholders en docs/planning/examples.
- Archivos con valores reales detectados localmente estan gitignored.
- Gitleaks full-history escaneo 438 commits y ~66.17 MB.
- Gitleaks encontro 14 findings redacted, todos `generic-api-key`.
- Findings ubicados en planning docs, ejemplos y tests:
  - `.planning/milestones/v3.0-phases/13-security-audit-documentation/*`.
  - `.planning/phases/07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-/07-08-SUMMARY.md`.
  - `.planning/phases/08-demo-trip-seed-a-public-demo-trip-in-the-database-add-view-d/08-01-PLAN.md`.
  - `.planning/phases/13-security-audit-documentation/*`.
  - `backend/.dev.vars.example`.
  - `backend/src/auth/keycloak.test.ts`.
  - `backend/src/index.test.ts`.
  - `backend/src/routes/public.test.ts`.
- TruffleHog 3.95.6 full-history verified scan reporto `verified_secrets: 0`, `unverified_secrets: 0`.
- No se imprimieron ni copiaron valores de secrets en este reporte.

Impacto:

- Ya no es solo una sospecha regex: hay 14 findings de scanner dedicado que deben clasificarse.
- TruffleHog no verifico secretos activos, lo cual reduce urgencia operacional, pero no prueba que ningun valor historico haya sido real.
- Si alguno de los Gitleaks findings corresponde a un valor real usado, debe rotarse aunque este en docs/tests o ya no este en HEAD.

Recomendacion:

- Revisar cada finding de Gitleaks localmente sin exponer valores.
- Rotar cualquier valor real o reutilizado historicamente.
- Sustituir ejemplos por placeholders inequivos (`example-value`, `test-only-not-secret`) que no activen detectores.
- Agregar Gitleaks/TruffleHog a CI con allowlist explicita para falsos positivos justificados.

## Matriz actual de cobertura

| Area | Resultado actual | Notas |
|---|---:|---|
| Frontend typecheck | OK | `tsc --noEmit` |
| Backend typecheck | OK | `tsc --noEmit` |
| Frontend production build | OK | `npm run build --workspace=frontend` |
| Backend Wrangler dry-run | Falla | Node built-ins bundled through `pg`/dependencies |
| Public frontend URL | Falla | `https://manud.github.io/PruebaMapJapan/` devuelve 404 |
| Public backend URL probable | Falla | `prueba-map-japan-api.manud.workers.dev` no resuelve |
| Terraform Keycloak validate | OK | `terraform validate` |
| Terraform Cloudflare validate | OK con warnings | `cloudflare_worker_secret` deprecado |
| Frontend Vitest | OK | 97/97 |
| Backend Vitest | OK con ruido | 30/30, pero stderr de Postgres mock en public route |
| Dev frontend | OK fuera del sandbox | Vite falla dentro del sandbox por permisos |
| Dev backend | OK | health 200 |
| Keycloak realm | HTTP 200 | container health `unhealthy` |
| Keycloak passkey flow | Falla de configuracion | warnings actuales de WebAuthn ignorado |
| DB schema local | OK | tablas/columnas/indices presentes |
| Clean-room migrations | OK | migrations aplican desde cero en DB temporal |
| Dependency audit app | Falla | 18 vulnerabilidades, incluyendo high/critical |
| Dependency audit tests | OK | 0 vulnerabilidades |
| Secret scan | Falla/triage requerido | Gitleaks full-history: 14 redacted `generic-api-key`; TruffleHog verified: 0 |
| Frontend security headers | Parcial | dev/static no tiene CSP/HSTS/XFO/Referrer-Policy |
| Backend security headers | OK basico | CSP default none, XFO DENY, HSTS, Referrer-Policy |
| PWA manifest/SW | Parcial | dist preview registra SW y landing offline 200; iconos remotos; prod 404 |
| Axe WCAG automated | Falla | 15 violaciones: `aria-allowed-attr` critico y `color-contrast` serio |
| Keyboard automated | OK parcial | 30 tab stops en 13 paginas sin traps obvios; no reemplaza manual screen-reader |
| Contrast automated | Falla/parcial | axe/Lighthouse confirman contraste; probe computado encuentra mas candidatos |
| Lighthouse performance | Parcial/falla mobile | Desktop landing 96; mobile landing 73 LCP 5.856s; Tokyo mobile 69 LCP 6.261s |
| Email local OTP | OK parcial | Mailpit contiene OTP; Keycloak email flows no validados |
| CORS/API edge smoke | OK parcial | allowed/denied preflight y traversal-ish slugs correctos |
| Playwright all-browser mock auth | Incompleto | timeout 246/267, Firefox roto |
| Playwright Chromium mock auth | Parcial | 64 passed, 14 skipped, 2 failed, 8 not run |
| Playwright real auth | Bloqueado en codigo actual | `loginViaKcForm` no espera el prompt; diagnostico temporal avanzo a 77 passed, 4 failed, 7 not run |
| Playwright passkeys real auth | Falla | 3/3 fallan esperando control de registrar passkey |
| Public invalid slug | OK manual | 400 |
| Public sharing fixture E2E | Bloqueado | no captura Bearer token |
| Trip edit integration E2E | Bloqueado | no captura Bearer token |
| Passkeys reales | No confiable | flow Keycloak ignora authenticator |
| OTP real | Parcial/no confiable | generacion Math.random y auth harness inestable |

## Backlog recomendado

### Prioridad 0

1. Arreglar `browser-passkey` para eliminar el warning `REQUIRED and ALTERNATIVE`.
2. Unificar Terraform, `realm-export.json` y `apply-local-settings.sh`.
3. Arreglar el backend Worker build: separar `pg`/node-postgres del bundle de produccion o resolver driver por entrypoint.
4. Restaurar/publicar produccion real: GitHub Pages actualmente 404 y Worker probable no resuelve.
5. Reparar `loginViaKcForm()`/`global-setup.ts`: esperar el prompt real antes del click y usar `waitUntil: 'commit'` o espera directa del username field.
6. Eliminar el supuesto de tokens en `sessionStorage` de tests, comentarios y docs.
7. Rehacer fixtures E2E autenticados con login real estable o cliente tecnico acotado.
8. Priorizar upgrades runtime con advisories high/critical: `hono`, `drizzle-orm`, `dompurify`.
9. Triagear los 14 findings de Gitleaks y rotar cualquier valor real historico.

### Prioridad 1

1. Cambiar OTP a random criptografico y agregar rate limit.
2. Cerrar XSS surfaces en `profile.ts`, `SearchBar.ts` y `widgets.ts`.
3. Mover validacion de slug antes de `getDb` en public route.
4. Hacer que tests unitarios publicos no acepten 500 como resultado funcional.
5. Estabilizar Playwright Firefox/WebKit o sacarlos de la suite obligatoria local.
6. Mover iconos PWA a first-party y validar offline sobre `dist`.
7. Actualizar Cloudflare Terraform de `cloudflare_worker_secret` a `cloudflare_workers_secret`.
8. Corregir axe/Lighthouse findings: ARIA invalido del search input, contraste, heading order y touch targets.
9. Agregar Lighthouse/axe-core/Gitleaks/TruffleHog a CI con allowlist y budgets explicitos.

### Prioridad 2

1. Reemplazar `web_origins = ["+"]` por origins explicitos.
2. Deshabilitar `full_scope_allowed` para el cliente frontend.
3. Separar realm/RP ID local y prod.
4. Encapsular Account API de Keycloak en un cliente propio y testear contrato.
5. Agregar auditoria para OTP y registro/eliminacion de passkeys.
6. Definir headers de seguridad para frontend estatico en hosting real.
7. Agregar E2E Mailpit para VERIFY_EMAIL, password reset y execute actions.
8. Actualizar `docs/security/rfc9700-checklist.md` para no afirmar almacenamiento en `sessionStorage`.
9. Agregar fuzzing/concurrency tests de API autenticada con cliente tecnico.

## Conclusion

La revision anterior sigue acertando en el riesgo principal: el punto debil no esta en TypeScript o CRUD basico, sino en la confiabilidad del IdP y de las pruebas que dicen cubrir sesiones/passkeys. La cobertura extendida agrega bloqueos serios: el backend no pasa `wrangler deploy --dry-run`, los endpoints publicos probables de produccion no estan vivos (`GitHub Pages` devuelve 404 y el Worker probable no resuelve), Gitleaks encontro 14 findings historicos que requieren triage, y axe/Lighthouse confirman problemas reales de accesibilidad. Tambien hay deuda de dependencias con advisories high/critical.

Antes de agregar funcionalidad, conviene cerrar seis frentes: arreglar el flow WebAuthn en Keycloak, hacer que el Worker compile para produccion, publicar/verificar produccion real, estabilizar el login real en Playwright, reemplazar los fixtures/docs que asumen tokens en `sessionStorage`, y triagear/rotar los findings de secretos. Despues de eso, la suite va a poder decir algo confiable sobre passkeys, OTP, sesiones, public sharing y despliegue.
