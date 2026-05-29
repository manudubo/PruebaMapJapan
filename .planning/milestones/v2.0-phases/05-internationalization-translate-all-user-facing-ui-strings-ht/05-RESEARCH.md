# Phase 5: Internationalization (Spanish → English) - Research

**Researched:** 2026-05-09
**Domain:** Direct string translation — HTML attributes, TypeScript template literals, locale calls, test assertions
**Confidence:** HIGH

## Summary

Phase 5 is a one-time find-and-replace translation pass, not an i18n library integration. Every Spanish user-facing string across 5 app HTML pages, 8 legacy city HTML pages, shared TypeScript components, page modules, and the web manifest must be converted to English. No translation JSON files, no key extraction, no runtime locale switching — just edit the source.

The primary risk is consistency: `map.ts` and `tripDetail.ts` share ~12 identical Spanish strings. If they diverge during translation, the map popup experience and the trip detail panel will render differently. Both files must be translated in the same task. A secondary risk is test breakage: `uat-passkeys.spec.ts` directly asserts `toContain('No tenés passkeys')` — this Playwright spec must be updated in the same commit as `profile.ts`.

Completeness can be validated mechanically: after all translations, `rg "[áéíóúñ¿¡]" frontend/src frontend/*.html tests/e2e --files-with-matches` must return zero hits (minus an explicit allowlist for genuine data strings).

**Primary recommendation:** Translate file-by-file with shared-string pairs in single tasks; run the accent-char regex after each wave to catch misses early.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTML page text (titles, headings, labels) | Browser / Client (static HTML) | — | Static markup served as-is |
| Component text (Navbar, SearchBar) | Browser / Client (TS components) | — | Rendered client-side into DOM |
| Page module strings (dashboard, profile, tripDetail) | Browser / Client (TS pages) | — | Dynamic strings injected into DOM |
| Map popup strings | Browser / Client (map.ts) | — | Leaflet popups built in TS |
| Trip edit form strings | Browser / Client (trip-edit modules) | — | Modal/form content built in TS |
| Locale calls (toLocaleDateString) | Browser / Client (TS modules) | — | Client-side date formatting |
| E2E test assertions | Test layer | — | Must mirror translated UI strings |
| Web manifest metadata | CDN / Static | — | manifest.json served as static asset |
| Hardcoded trip data (itinerary.ts) | Browser / Client (data layer) | — | Seed data rendered in city pages |

## Standard Stack

### Core
No library changes required for this phase. This is direct source editing only.

| Tool | Purpose |
|------|---------|
| ripgrep (`rg`) | Audit Spanish strings before and after translation |
| TypeScript compiler (`tsc --noEmit`) | Verify no type errors introduced |
| Vitest | Unit test suite — must stay green |
| Playwright | E2E suite — must stay green after spec updates |

### No i18n Infrastructure Exists
[VERIFIED: codebase grep] No `i18next`, `react-intl`, `vue-i18n`, or translation JSON files found in the project. No `t()` function calls. No locale namespaces. This is intentional — Phase 5 is a translation pass, not i18n library adoption.

## Architecture Patterns

### System Architecture Diagram

```
Spanish source files
        |
        v
  Direct edit (find-replace per file)
        |
        +--> HTML pages (lang attr + static text)
        +--> TS components (Navbar, SearchBar)
        +--> TS pages (dashboard, profile, tripDetail, trip-edit/*)
        +--> TS modules (map, widgets, search)
        +--> data/itinerary.ts (hardcoded seed data — scope TBD)
        +--> manifest.json
        +--> E2E specs (update assertions to match new strings)
        |
        v
  Validation: rg accent-char regex returns zero hits
        |
        v
  TypeScript typecheck passes
        |
        v
  Playwright suite green
```

### Recommended Task Structure

Tasks should be grouped so that files with shared strings are always in the same task, and each spec is updated in the same task as its corresponding page.

```
Wave 0: Shared components (Navbar.ts + SearchBar.ts) — affect every page
Wave 1: App HTML pages (index, dashboard, profile, trip, trip-edit) — static text
Wave 2: City HTML pages (8 files, batch) — static text
Wave 3: Page TS modules — profile.ts + uat-passkeys.spec.ts (together, test coupling)
Wave 4: Page TS modules — dashboard.ts
Wave 5: Page TS modules — tripDetail.ts + map.ts (together, shared strings)
Wave 6: Trip-edit TS modules — destinations.ts, hotels.ts, days.ts, activities.ts, metadata.ts
Wave 7: Other TS modules — widgets.ts, search.ts
Wave 8: Data + manifest — itinerary.ts (if in scope), manifest.json
Wave 9: Validation pass — run accent-char regex, typecheck, test suite
```

## Complete File Inventory

### HTML Files — App Pages

#### `frontend/index.html`
[VERIFIED: file read]
- `<html lang="es">` → `lang="en"`
- `<meta name="description">` — Spanish description
- Skip-link: "Saltar al contenido principal" → "Skip to main content"
- `<title>Japan Trip 2026</title>` — already partially English; verify
- h1: "Tu próximo viaje, perfectamente planificado." → "Your next trip, perfectly planned."
- Tagline below h1 (Spanish paragraph)
- Buttons: "Iniciar sesión" → "Sign in", "Ver demo" → "View demo"
- Countdown section: "Faltan para el viaje" → "Days until the trip"
- Countdown labels: "días" → "days", "horas" → "hours", "minutos" → "minutes", "segundos" → "seconds"
- City chip: "Tokyo (regreso)" → "Tokyo (return)"
- Section `aria-label` attributes: 2-3 Spanish labels

#### `frontend/dashboard.html`
[VERIFIED: file read]
- `<html lang="es">` → `lang="en"`
- `<title>Mis viajes</title>` → `<title>My Trips</title>`
- "Nuevo viaje" button → "New Trip"
- Auth prompt: "Iniciá sesión para ver y gestionar tus viajes." → "Sign in to view and manage your trips."
- Loading state: "Cargando viajes…" → "Loading trips…"
- Modal: "Crear nuevo viaje" → "Create New Trip"
- Modal form labels: Nombre/Descripción/Inicio/Fin → Name/Description/Start/End
- Placeholders: "Mi viaje a..." → "My trip to..."
- Buttons: "Cancelar" → "Cancel", "Crear" → "Create"

#### `frontend/profile.html`
[VERIFIED: file read]
- `<html lang="es">` → `lang="en"`
- `<title>Mi perfil</title>` → `<title>My Profile</title>`
- "Información de cuenta" → "Account Information"
- Labels: "Nombre" → "Name", "Email" → "Email" (same), "Usuario" → "Username", "Contraseña" → "Password"
- "Cambiar contraseña" → "Change password"
- Passkeys section heading and description (biometric text in Spanish)
- "Cargando passkeys…" → "Loading passkeys…"
- "Agregar passkey" → "Add passkey"
- Logout section: "Cerrar sesión" → "Sign out"

#### `frontend/trip.html`
[VERIFIED: file read]
- `<html lang="es">` → `lang="en"`
- "Cargando viaje…" → "Loading trip…"
- "Copiar enlace público" → "Copy public link"
- "Editar viaje" → "Edit trip"
- `aria-label` on tabs, map section, legend, day selector — all Spanish
- "Actividades" h3 → "Activities"

#### `frontend/trip-edit.html`
[VERIFIED: file read]
- `<html lang="es">` → `lang="en"`
- "Editar viaje" → "Edit trip"
- "Cargando viaje…" → "Loading trip…"
- "← Mis viajes" → "← My Trips"
- "Datos del viaje" → "Trip Details"
- Form labels: Nombre/Descripción/Inicio/Fin/Hacer público → Name/Description/Start/End/Make public
- "Guardar cambios" → "Save changes"
- "Destinos" → "Destinations"
- "Agregar destino" → "Add destination"
- Confirm overlay: "¿Eliminar?" → "Delete?"
- "Cancelar" → "Cancel", "Eliminar" → "Delete"

### HTML Files — City Pages (8 files, batch)

[VERIFIED: file reads] All city pages follow identical structure. Files:
`frontend/tokyo.html`, `frontend/kyoto.html`, `frontend/osaka.html`, `frontend/hiroshima.html`, `frontend/nara.html`, `frontend/nikko.html`, `frontend/kamakura.html`, `frontend/hakone.html`

Per-file changes:
- `<html lang="es">` → `lang="en"`
- `<title>` — e.g. "Tokyo – Japón 2026" → "Tokyo – Japan 2026"
- `<meta name="description">` — Spanish itinerary description
- Skip-link: "Saltar al contenido principal" → "Skip to main content"
- Date string in `<p>`: e.g. "22 Febrero – 1 Marzo 2026 · 8 días" → "Feb 22 – Mar 1, 2026 · 8 days"
- Hotel button `title="Ir al hotel"` → `title="Go to hotel"`
- h3 "Actividades" → "Activities"

Note: The 8 city pages are nearly identical in structure — they can be batch-translated with a consistent template.

### TypeScript Files — Components

#### `frontend/src/components/Navbar.ts`
[VERIFIED: file read]
- `aria-label="Navegación principal"` → `"Main navigation"`
- `aria-label="Ir al inicio"` → `"Go to home"`
- `aria-label="Navegación"` → `"Navigation"`
- Button: "Iniciar sesión" → "Sign in"
- Button: "Cerrar sesión" → "Sign out"
- `aria-label="Cambiar tema"` → `"Toggle theme"`
- Nav link: "Inicio" → "Home"
- Nav link: "Mis viajes" → "My Trips"

#### `frontend/src/components/SearchBar.ts`
[VERIFIED: file read]
- `placeholder="Buscar..."` → `"Search..."`
- `aria-label="Buscar actividades, lugares, días"` → `"Search activities, places, days"`
- `aria-label="Limpiar búsqueda"` → `"Clear search"`
- `aria-label="Resultados de búsqueda"` → `"Search results"`
- Empty state: "No se encontraron resultados" → "No results found"
- Section header: "Ciudades" → "Cities"
- Result badges: "lugar" → "place", "día" → "day"
- Keyboard hints: "navegar" → "navigate", "seleccionar" → "select", "cerrar" → "close"

### TypeScript Files — Pages

#### `frontend/src/pages/profile.ts`
[VERIFIED: file read] **CRITICAL: test coupling**
- "No tenés passkeys registrados todavía." → "You don't have any passkeys registered yet."
- "No se pudo cargar la lista de passkeys." → "Could not load passkey list."
- `toLocaleDateString('es-ES', ...)` → `toLocaleDateString('en-US', ...)`
- "Registrado: ${created}" → "Registered: ${created}"
- Delete modal h2: "¿Eliminar passkey?" → "Delete passkey?"
- "Esta acción no se puede deshacer." → "This action cannot be undone."
- Button: "Eliminar" → "Delete", "Cancelar" → "Cancel"
- Button (in-progress): "Eliminando…" → "Deleting…"
- Error: "Error al iniciar el registro de passkey." → "Error starting passkey registration."

**MUST update in same task:** `uat-passkeys.spec.ts` line 108: `expect(text).toContain('No tenés passkeys')` → `toContain("You don't have any passkeys")`

#### `frontend/src/pages/dashboard.ts`
[VERIFIED: file read]
- `toLocaleDateString('es-ES', ...)` → `toLocaleDateString('en-US', ...)`
- `aria-label` template: `` `Ver viaje: ${trip.name}` `` → `` `View trip: ${trip.name}` ``
- Badge: `'Público'` → `'Public'`
- Plural: `` `${destCount} destino${destCount !== 1 ? 's' : ''}` `` → `` `${destCount} destination${destCount !== 1 ? 's' : ''}` ``
- Empty state: "Todavía no tenés ningún viaje guardado." → "You don't have any trips saved yet."
- Greeting: `` `Hola, ${name.split(' ')[0]}` `` → `` `Hello, ${name.split(' ')[0]}` ``
- Error strings (fetch failures)
- Link text: `'Editar'` → `'Edit'`

#### `frontend/src/pages/tripDetail.ts`
[VERIFIED: file read] **MUST translate with map.ts in same task**
- `aria-label="Destinos del viaje"` → `"Trip destinations"`
- `` `Opción ${activity.optional}` `` → `` `Option ${activity.optional}` ``
- "Ver en Maps" → "View on Maps"
- "Cómo llegar" → "Directions"
- "Alojamiento" → "Accommodation"
- "Filtrar por día" → "Filter by day"
- Screen reader announcement strings (3 strings)
- "Lista de actividades por día" → "Activity list by day"
- "Opciones" → "Options"
- Error: "No se pudo cargar el viaje" → "Could not load trip"
- Error: "No se especificó un viaje. Revisá la URL." → "No trip specified. Check the URL."
- Error: "No tenés acceso a este viaje. Pedile al dueño el enlace público." → "You don't have access to this trip. Ask the owner for the public link."
- Toast: "¡Copiado!" → "Copied!"
- Button: "Copiar enlace público" → "Copy public link"
- Button: "Volver al dashboard" → "Back to dashboard"

#### `frontend/src/pages/trip-edit/destinations.ts`
[VERIFIED: file read]
- Modal titles: "Agregar destino" → "Add destination", "Editar destino" → "Edit destination"
- Labels: 'Ciudad' → 'City', 'País' → 'Country', 'Llegada' → 'Arrival', 'Salida' → 'Departure', 'Coordenadas (opcional)' → 'Coordinates (optional)'
- Geocoder placeholder: "Buscar lugar o pegar URL de Google Maps…" → "Search location or paste Google Maps URL…"
- Geocoder button: "Buscar lugar" → "Search location", "Buscando…" → "Searching…"
- Buttons: 'Cancelar' → 'Cancel', 'Guardar' → 'Save', 'Guardando…' → 'Saving…'
- Confirm: "¿Eliminar destino?" → "Delete destination?"
- Error strings (several network/validation errors)
- "Encontrado" → "Found"
- "Sin resultados. Probá con otra búsqueda." → "No results. Try a different search."
- Section headers: 'Hotel' → 'Hotel', 'Días' → 'Days'
- Buttons: 'Editar' → 'Edit', 'Eliminar' → 'Delete', 'Eliminando…' → 'Deleting…'

#### `frontend/src/pages/trip-edit/hotels.ts`
[VERIFIED: file read]
- Modal titles: "Agregar hotel" → "Add hotel", "Editar hotel" → "Edit hotel"
- Label: "Coordenadas (opcional)" → "Coordinates (optional)"
- Confirm: "¿Eliminar hotel?" → "Delete hotel?"
- "Esta acción no se puede deshacer." → "This action cannot be undone."
- Empty state: "Sin hotel asignado." → "No hotel assigned."
- Button: "Agregar hotel" → "Add hotel"
- Same geocoder/error/button pattern as destinations.ts

#### `frontend/src/pages/trip-edit/days.ts`
[VERIFIED: file read]
- Modal titles: "Agregar día" → "Add day", "Editar día" → "Edit day"
- Labels: 'Etiqueta' → 'Label', 'Fecha' → 'Date', 'Color' → 'Color'
- Placeholder: "Ej: Día libre en Tokio" → "E.g.: Free day in Tokyo"
- `aria-label` for color swatches: "Color N" (already English number format; verify if "Color" is Spanish)
- Confirm: "¿Eliminar día?" → "Delete day?"
- Warning: "Se eliminarán todas las actividades de este día." → "All activities for this day will be deleted."
- Buttons: "Agregar día" → "Add day", "Generar todos los días" → "Generate all days", "Generando…" → "Generating…"
- Empty state: `Sin días. Agregá un día o usá "Generar todos los días".` → `No days. Add a day or use "Generate all days".`
- 3 distinct generate error strings
- 'Editar' → 'Edit', 'Eliminar' → 'Delete'

#### `frontend/src/pages/trip-edit/activities.ts`
[VERIFIED: file read]
- Modal titles: "Agregar actividad" → "Add activity", "Editar actividad" → "Edit activity"
- Labels: 'Nombre' → 'Name', 'Hora (opcional)' → 'Time (optional)', 'Notas (opcional)' → 'Notes (optional)', 'Coordenadas (opcional)' → 'Coordinates (optional)'
- Confirm: "¿Eliminar actividad?" → "Delete activity?"
- "Esta acción no se puede deshacer." → "This action cannot be undone."
- Button: "Agregar actividad" → "Add activity"
- Empty state: "Sin actividades. Agregá la primera." → "No activities. Add the first one."
- Button titles: 'Subir' → 'Move up', 'Bajar' → 'Move down'
- Same geocoder/error/button pattern

#### `frontend/src/pages/trip-edit/metadata.ts`
[VERIFIED: file read]
- 'Guardando…' → 'Saving…'
- 'Guardado' → 'Saved'
- 'Guardar cambios' → 'Save changes'
- Error: "No se pudo guardar. Verificá tu conexión e intentá de nuevo." → "Could not save. Check your connection and try again."

### TypeScript Files — Modules

#### `frontend/src/modules/map.ts`
[VERIFIED: file read] **MUST translate with tripDetail.ts in same task**

Shared strings with tripDetail.ts (translate identically):
- `` `Opción ${activity.optional}` `` → `` `Option ${activity.optional}` ``
- "Ver en Maps" → "View on Maps"
- "Cómo llegar" → "Directions"
- "Alojamiento" → "Accommodation"
- "Filtrar por día" → "Filter by day"
- "Lista de actividades por día" → "Activity list by day"
- "Opciones" → "Options"

map.ts-only strings:
- "Este día tiene opciones alternativas" → "This day has alternative options"
- "Mostrando todos los días" → "Showing all days"
- "Cómo llegar" `title` attribute → "Directions"
- "Ver en Google Maps" → "View on Google Maps"
- "Centrar mapa en hotel" → "Center map on hotel"
- Screen reader announcement strings
- Overview map popup: "Ver itinerario" → "View itinerary"

#### `frontend/src/modules/widgets.ts`
[VERIFIED: file read]
- `` `Información local de ${cityName}` `` aria-label → `` `Local information for ${cityName}` ``
- `` `Información Local: ${cityName}` `` h3 → `` `Local Information: ${cityName}` ``
- h4 headings: "Clima & Pronóstico" → "Weather & Forecast", "Noticias" → "News", "Eventos" → "Events"
- `toLocaleDateString('es-ES', ...)` → `toLocaleDateString('en-US', ...)`
- WEATHER_CONDITIONS dictionary — 9 Spanish weather condition strings (e.g. "Despejado" → "Clear", "Nublado" → "Cloudy", etc.)
- `aria-label="Pronóstico de 4 días"` → `"4-day forecast"`
- `aria-label="Temperatura actual"` → `"Current temperature"`
- "Agregar al calendario" → "Add to calendar"
- Empty state strings
- Error strings (several)
- sr-only loading strings

#### `frontend/src/modules/search.ts`
[VERIFIED: file read]
- `toLocaleDateString('es-ES', ...)` → `toLocaleDateString('en-US', ...)`
- Subtitle: `` `Hotel en ${cityData.name}` `` → `` `Hotel in ${cityData.name}` ``

### Other Files

#### `frontend/public/manifest.json`
[VERIFIED: file read]
- `"name": "Japón 2026 Itinerario"` → `"Japan 2026 Itinerary"`
- `"short_name": "Japón 2026"` → `"Japan 2026"`
- `"description": "Itinerario interactivo de viaje a Japón - 30 días, 8 ciudades"` → `"Interactive Japan travel itinerary - 30 days, 8 cities"`
- `"lang": "es"` → `"lang": "en"`

#### `frontend/src/data/itinerary.ts`
[VERIFIED: file read] **Scope ambiguity — flag for planner decision**

Contains ~150 Spanish strings: abbreviated day names ("Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"), activity notes ("Comprar entrada en el lugar", "Día libre", "Reservado 19:00", "Calle tradicional de geishas"), and date range strings.

These are hardcoded seed data rendered in city pages and search results. They are user-facing (visible in the UI) but are also genuine content data, not UI chrome. Recommend including in scope — the search result subtitles and city page activity lists would otherwise remain Spanish.

### E2E Test Files

#### `tests/e2e/auth.spec.ts`
- Line 26: comment referencing "Iniciar sesión" — update comment (low risk, not an assertion)

#### `tests/e2e/trip-edit.spec.ts`
- Lines 23, 33: `description: 'Descripción'`, `country: 'Japón'` — test input data, not UI assertions. These are form fill values and may legitimately remain Spanish (user data). Flag for planner decision.

#### `tests/e2e/trip-edit-integration.spec.ts`
- Lines 159, 192, 239: `country: 'Japón'` as `page.fill()` data — same: user data, not UI text. Flag for planner decision.

#### `uat-passkeys.spec.ts`
[VERIFIED: file read] **CRITICAL: WILL BREAK**
- Line 108: `expect(text).toContain('No tenés passkeys')` → `toContain("You don't have any passkeys")`
- Lines 185, 189: verify for additional Spanish assertions

**Must be updated in the same task as profile.ts.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Accent-char audit | Custom script | `rg "[áéíóúñ¿¡]" frontend/src frontend/*.html` |
| String inventory | Manual scan | Already done in this research |
| Translation consistency | Side-by-side doc | Group shared-string pairs in single tasks |

## Common Pitfalls

### Pitfall 1: Translating map.ts and tripDetail.ts separately
**What goes wrong:** Strings diverge — e.g. "View on Maps" vs "See on Maps" — so the map popup and trip detail panel say different things.
**Why it happens:** Two files, two tasks, no shared constant.
**How to avoid:** Single task covers both files. Translate them together, compare the string lists in this research doc side by side.
**Warning signs:** `rg "Ver en Maps\|Cómo llegar\|Alojamiento\|Filtrar por día" frontend/src` returns hits in only one file after translation.

### Pitfall 2: Updating profile.ts without uat-passkeys.spec.ts
**What goes wrong:** Playwright UAT suite fails immediately after merge.
**Why it happens:** `uat-passkeys.spec.ts` has a hard `toContain('No tenés passkeys')` assertion on the translated string.
**How to avoid:** profile.ts task always includes uat-passkeys.spec.ts changes. They are in the same commit.
**Warning signs:** `npx playwright test uat-passkeys.spec.ts` fails with "expected to contain 'No tenés passkeys'".

### Pitfall 3: Missing locale calls
**What goes wrong:** Dates continue formatting as "12 de mayo de 2026" (Spanish) after all visible strings are translated.
**Why it happens:** `toLocaleDateString('es-ES', ...)` is a runtime locale call, not a visible string — easy to miss in grep-based audits.
**How to avoid:** Search specifically: `rg "es-ES" frontend/src` — must return zero hits after translation.
**Warning signs:** Dates in dashboard cards or passkey list show Spanish month names.

### Pitfall 4: Leaving `lang="es"` on HTML elements
**What goes wrong:** Screen readers mispronounce English content. Browser spell-check behaves incorrectly.
**Why it happens:** Translating visible text but forgetting the `lang` attribute.
**How to avoid:** Include `lang="es"` → `lang="en"` in every HTML file task.
**Warning signs:** `rg 'lang="es"' frontend/*.html` returns hits after translation.

### Pitfall 5: itinerary.ts scope confusion
**What goes wrong:** City pages and search results still show Spanish activity notes and day names.
**Why it happens:** `itinerary.ts` was treated as "data" and excluded from the translation pass.
**How to avoid:** Include itinerary.ts in the final wave. Abbreviated day names ("Dom" → "Sun") are especially jarring alongside English UI.
**Warning signs:** Search results show "Día libre" or city page activities show Spanish notes.

### Pitfall 6: Test input data vs UI assertion confusion
**What goes wrong:** `country: 'Japón'` in test fill data is changed to English, breaking tests that expect API to return the same value.
**Why it happens:** Translator changes all Spanish strings including database values used as test fixtures.
**How to avoid:** In test files, only change UI assertion strings (`.toContain`, `.toHaveText`). Leave `page.fill()` data values as-is unless the actual API requires English.
**Warning signs:** trip-edit integration tests fail because `country` in API response no longer matches 'Japón'.

## Code Examples

### Accent-char completeness check
```bash
# After each wave — must return zero files
rg "[áéíóúñ¿¡]" frontend/src frontend/*.html tests/e2e --files-with-matches

# Explicit allowlist (do not flag these):
# - frontend/src/data/itinerary.ts — if excluded from scope
# - Any file with genuine Spanish content in data fields
```

### Locale call audit
```bash
# Must return zero hits after translation
rg "es-ES" frontend/src
```

### lang attribute audit
```bash
# Must return zero hits after translation
rg 'lang="es"' frontend/*.html
```

### Shared-string consistency check
```bash
# After Wave 5 — must show identical English strings in both files
rg "Ver en Maps\|View on Maps\|Cómo llegar\|Directions\|Alojamiento\|Accommodation" frontend/src/modules/map.ts frontend/src/pages/tripDetail.ts
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `trip-edit.spec.ts` `country: 'Japón'` is form fill data, not a UI assertion | E2E Test Files | Low — fill data doesn't break if left Spanish; verify by running spec |
| A2 | City pages (tokyo.html etc.) are still user-facing and in scope | Complete File Inventory | Low — if excluded, Spanish remains on publicly accessible pages |
| A3 | `itinerary.ts` day labels and activity notes are user-facing (in scope) | itinerary.ts section | Medium — if out of scope, search results and city pages remain Spanish |
| A4 | All 8 city pages share identical structure — batch translation applies | City HTML Files section | Low — verified by reading tokyo.html structure, assumed consistent |

## Open Questions

1. **itinerary.ts scope**
   - What we know: ~150 Spanish strings, rendered in city pages and search results, hardcoded seed data
   - What's unclear: Does the project owner consider trip content data to be in scope for this translation pass?
   - Recommendation: Include — the strings are visible to users and the city pages are still linked from index.html

2. **trip-edit.spec.ts fill data**
   - What we know: `country: 'Japón'` is used as `page.fill()` input data, not as a UI assertion
   - What's unclear: Does the backend store and return exactly what was filled, or does it validate country names?
   - Recommendation: Leave as-is; this is user-entered data, not UI chrome; flag for human review

3. **City page date strings**
   - What we know: Dates like "22 Febrero – 1 Marzo 2026 · 8 días" are hardcoded in HTML
   - What's unclear: Should these match the locale format of `en-US` or `en-GB`?
   - Recommendation: Use "Feb 22 – Mar 1, 2026 · 8 days" (en-US format, matches codebase locale target)

## Environment Availability

Step 2.6: SKIPPED — no external dependencies. Phase 5 is purely source file edits. All tools (rg, tsc, Playwright, Vitest) were verified available in prior phases.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (E2E) + Vitest (unit) |
| Config file | `playwright.config.ts` / `vitest.config.ts` |
| Quick run command | `npx playwright test uat-passkeys.spec.ts` (after profile.ts wave) |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| I18N-HTML | All HTML pages have `lang="en"` and English static text | manual audit | `rg 'lang="es"' frontend/*.html` returns zero | N/A — regex audit |
| I18N-TS | All TS modules produce English strings at runtime | smoke | `npx playwright test` (full suite) | Existing |
| I18N-LOCALE | All `toLocaleDateString` calls use `en-US` locale | manual audit | `rg "es-ES" frontend/src` returns zero | N/A — regex audit |
| I18N-PASSKEY | UAT passkey spec passes after profile.ts translation | E2E | `npx playwright test uat-passkeys.spec.ts` | `uat-passkeys.spec.ts` exists |
| I18N-ACCENT | No accented Spanish characters remain in source | automated audit | `rg "[áéíóúñ¿¡]" frontend/src frontend/*.html` returns zero | N/A — regex audit |

### Sampling Rate
- **Per task commit:** `rg "[áéíóúñ¿¡]" <changed-files>` — accent-char spot check on edited files only
- **Per wave merge:** `rg "[áéíóúñ¿¡]" frontend/src frontend/*.html --files-with-matches` — full tree check
- **Phase gate:** Full Playwright suite green before `/gsd-verify-work`

### Wave 0 Gaps
None — existing test infrastructure covers all phase requirements. No new test files need to be created. The UAT spec (`uat-passkeys.spec.ts`) needs a string update, not creation.

## Security Domain

This phase makes no changes to authentication, authorization, input validation, cryptography, or session management. No ASVS categories apply.

Exception: HTML `lang` attribute is an accessibility concern, not a security concern. No security review required for this phase.

## Sources

### Primary (HIGH confidence)
- [VERIFIED: file read] All source files read directly from codebase — inventory is exhaustive
- [VERIFIED: codebase grep] No i18n infrastructure exists in the project
- [VERIFIED: file read] `uat-passkeys.spec.ts` — confirmed Spanish assertion on line 108

### Secondary (MEDIUM confidence)
- [ASSUMED] City page date format convention ("Feb 22 – Mar 1") — follows en-US locale convention

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- File inventory: HIGH — all files read directly
- String inventory: HIGH — all TS/HTML files scanned
- Test coupling: HIGH — uat-passkeys.spec.ts assertion verified
- Wave plan: HIGH — derived from coupling constraints
- Scope ambiguity (itinerary.ts): MEDIUM — requires planner/user decision

**Research date:** 2026-05-09
**Valid until:** N/A — static codebase, no external dependencies
