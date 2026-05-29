# Phase 5: Internationalization (Spanish → English) - Pattern Map

**Mapped:** 2026-05-09
**Files analyzed:** 22 files (5 app HTML + 8 city HTML + 7 TS pages/modules + 1 TS data + 1 JSON + 1 spec)
**Analogs found:** N/A — translation pass. Every file's pattern source is itself.
**Pattern type column replaces Match Quality.**

---

## File Classification

| File | Role | Data Flow | Primary Pattern Type |
|------|------|-----------|----------------------|
| `frontend/index.html` | HTML page | static | `lang` attr, `textContent` nodes, `aria-label` attrs |
| `frontend/dashboard.html` | HTML page | static | `lang` attr, `textContent` nodes, `placeholder`, `aria-label` |
| `frontend/profile.html` | HTML page | static | `lang` attr, `textContent` nodes, section headings |
| `frontend/trip.html` | HTML page | static | `lang` attr, `aria-label` attrs |
| `frontend/trip-edit.html` | HTML page | static | `lang` attr, `textContent` nodes, `placeholder`, label text |
| `frontend/tokyo.html` (×8 city pages) | HTML page | static | `lang` attr, `<meta>` description, skip-link text, date string, `title` attr, h3 |
| `frontend/src/components/Navbar.ts` | component | request-response | `innerHTML` template literals, `textContent`, `aria-label` attrs |
| `frontend/src/components/SearchBar.ts` | component | request-response | `innerHTML` template literals, `placeholder`, `aria-label`, badge strings |
| `frontend/src/pages/profile.ts` | page module | request-response | `innerHTML` string, `textContent` assignment, locale call, modal `innerHTML` |
| `frontend/src/pages/dashboard.ts` | page module | CRUD | `setAttribute`, `textContent`, locale call, template literal |
| `frontend/src/pages/tripDetail.ts` | page module | CRUD | `innerHTML` template literal, `setAttribute`, `textContent` |
| `frontend/src/pages/trip-edit/destinations.ts` | page module | CRUD | `textContent`, `placeholder`, `setText()` call |
| `frontend/src/pages/trip-edit/hotels.ts` | page module | CRUD | `textContent`, `placeholder`, `setText()` call |
| `frontend/src/pages/trip-edit/days.ts` | page module | CRUD | `textContent`, `placeholder`, `setText()` call |
| `frontend/src/pages/trip-edit/activities.ts` | page module | CRUD | `textContent`, `title` attr, `setText()` call |
| `frontend/src/pages/trip-edit/metadata.ts` | page module | CRUD | `setText()` call, `textContent` |
| `frontend/src/modules/map.ts` | module | event-driven | `innerHTML` template literal, `setAttribute`, `textContent`, `title` attr |
| `frontend/src/modules/widgets.ts` | module | request-response | `innerHTML` template literal, `setAttribute`, object literal dictionary |
| `frontend/src/modules/search.ts` | module | request-response | template literal, locale call |
| `frontend/src/data/itinerary.ts` | data | static | object literal string values (day names, activity notes) |
| `frontend/public/manifest.json` | config | static | JSON string properties |
| `uat-passkeys.spec.ts` | E2E test | test | `toContain()` assertion — must mirror profile.ts string |

---

## Critical Cross-File Relationship: `map.ts` ↔ `tripDetail.ts`

These two files must be translated **in the same task**. Any divergence produces different text in the map popup vs. the legend panel.

| Spanish string | `map.ts` line(s) | `tripDetail.ts` line(s) | Notes |
|----------------|-----------------|------------------------|-------|
| `` `Opción ${activity.optional}` `` | 52 | 114 | optional-badge span |
| `Ver en Maps` | 57 | 122, 140 | popup link text (two popups) |
| `Cómo llegar` | 57 | 127, 144 | popup link text (two popups) |
| `Alojamiento` | 63 | 134 | hotel popup paragraph |
| `Filtrar por día` | 89 | 170 | `aria-label` on day-selector |
| `Este día tiene opciones alternativas` | 98 | 180 | `btn.title` on day buttons |
| `Centrar mapa en hotel` | 128 | 212 | `aria-label` on hotel button |
| `Mostrando todos los días` | 205 | 259 | screen-reader announcement |
| `` `Mostrando ${dayData.label}: ... ubicaciones` `` | 225 | 285 | screen-reader announcement |
| `Lista de actividades por día` | 234 | 299 | `aria-label` on legend-grid |
| `Opciones` | 254 | 319 | day-group badge text |
| `Ver en Google Maps` | ~300 | 373 | legend `mapsLink.title` |
| `Cómo llegar` (title attr) | ~305 | 381 | legend `dirLink.title` |

**map.ts-only strings** (no tripDetail.ts counterpart):
- `Mapa de ${data.name} cargado con ${allMarkers.length} ubicaciones` (line 147) — `announceToScreenReader` call
- `Ver itinerario` — overview map popup (check map.ts for exact line via grep if needed)

---

## Critical Cross-File Relationship: `profile.ts` ↔ `uat-passkeys.spec.ts`

Must be translated in the **same commit**.

| `profile.ts` line | Current string | `uat-passkeys.spec.ts` line | Assertion |
|-------------------|----------------|----------------------------|-----------|
| 78 | `'No tenés passkeys registrados todavía.'` | 108 | `expect(initialText).toContain('No tenés passkeys')` |

The spec asserts a **substring** (`'No tenés passkeys'`). When translating, the new English string in `profile.ts` must contain whatever substring the spec is updated to check. Recommended update:
- `profile.ts:78` → `'You don\'t have any passkeys registered yet.'`
- `uat-passkeys.spec.ts:108` → `expect(initialText).toContain("You don't have any passkeys")`

Also verify `uat-passkeys.spec.ts` lines 185 and 189 for any additional Spanish assertions (not seen in the read window — grep before closing the task).

---

## Shared Cross-Cutting Pattern 1: Locale Calls (`es-ES` → `en-US`)

These are invisible to plain-text accent-char grep. Requires separate audit: `rg "es-ES" frontend/src`.

| File | Line | Current call |
|------|------|--------------|
| `frontend/src/pages/dashboard.ts` | 26 | `toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })` |
| `frontend/src/pages/profile.ts` | 86 | `toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })` |
| `frontend/src/modules/widgets.ts` | 93 | `toLocaleDateString('es-ES', { weekday: 'short' })` |
| `frontend/src/modules/search.ts` | 106 | `` toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) `` (API trip subtitle) |
| `frontend/src/modules/search.ts` | 158 | `toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })` |

All change to `'en-US'` with identical options objects.

---

## Shared Cross-Cutting Pattern 2: `lang="es"` HTML Attribute

Requires separate audit: `rg 'lang="es"' frontend/*.html`.

All 13 HTML files: `frontend/index.html`, `dashboard.html`, `profile.html`, `trip.html`, `trip-edit.html`, `tokyo.html`, `kyoto.html`, `osaka.html`, `hiroshima.html`, `nara.html`, `nikko.html`, `kamakura.html`, `hakone.html`.

Change `<html lang="es">` → `<html lang="en">` in every file.

Also: `frontend/public/manifest.json` line 12: `"lang": "es"` → `"lang": "en"`.

---

## Pattern Assignments

### Wave 0: `frontend/src/components/Navbar.ts` (component, innerHTML template)

**Pattern type:** Shadow DOM `innerHTML` template literal + `textContent` in `renderNavLinks()`

**Strings at exact lines** (all inside `private render()` and `private renderNavLinks()`):

```typescript
// Line 292 — aria-label on <nav>
<nav role="navigation" aria-label="Navegación principal">

// Line 294 — aria-label on brand link
<a href="index.html" class="nav-brand" aria-label="Ir al inicio">

// Line 301 — aria-label on top-nav div
<div class="top-nav" role="tablist" aria-label="Navegación">

// Line 304 — login button text
<button type="button" class="nav-auth-btn nav-auth-login" hidden>Iniciar sesión</button>

// Line 305 — logout button text
<button type="button" class="nav-auth-btn nav-auth-logout" hidden>Cerrar sesión</button>

// Line 307 — theme toggle aria-label
<button class="theme-toggle" type="button" aria-label="Cambiar tema">

// Line 317 — "Inicio" nav link (renderNavLinks)
`<a href="index.html" class="nav-link..." ...>Inicio</a>`

// Line 318 — "Mis viajes" nav link (renderNavLinks)
`<a href="dashboard.html" class="nav-link..." ...>Mis viajes</a>`
```

**Translations:**
- `"Navegación principal"` → `"Main navigation"`
- `"Ir al inicio"` → `"Go to home"`
- `"Navegación"` → `"Navigation"`
- `Iniciar sesión` → `Sign in`
- `Cerrar sesión` → `Sign out`
- `"Cambiar tema"` → `"Toggle theme"`
- `Inicio` → `Home`
- `Mis viajes` → `My Trips`

---

### Wave 0: `frontend/src/components/SearchBar.ts` (component, innerHTML + renderResults)

**Pattern type:** Shadow DOM `innerHTML` template + `renderResults()` method returning HTML strings

```typescript
// Line 330-331 — input placeholder and aria-label
placeholder="Buscar..."
aria-label="Buscar actividades, lugares, días"

// Line 337 — clear button aria-label
aria-label="Limpiar búsqueda"

// Line 345 — dropdown aria-label
aria-label="Resultados de búsqueda"

// Line 447 — empty state text
<div>No se encontraron resultados</div>

// Line 456 — section header in renderResults()
html += '<li class="section-header">Ciudades</li>';

// Line 476 — result badge values
result.type === 'activity' ? 'lugar' : result.type === 'day' ? 'día' : result.type

// Lines 485-487 — keyboard hints
<span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
<span><kbd>↵</kbd> seleccionar</span>
<span><kbd>esc</kbd> cerrar</span>
```

**Translations:**
- `"Buscar..."` → `"Search..."`
- `"Buscar actividades, lugares, días"` → `"Search activities, places, days"`
- `"Limpiar búsqueda"` → `"Clear search"`
- `"Resultados de búsqueda"` → `"Search results"`
- `No se encontraron resultados` → `No results found`
- `Ciudades` → `Cities`
- `'lugar'` → `'place'`, `'día'` → `'day'`
- `navegar` → `navigate`, `seleccionar` → `select`, `cerrar` → `close`

---

### Wave 1: `frontend/index.html` (HTML page, static text)

**Pattern type:** Static HTML text nodes, `aria-label` attributes, `lang` attribute

```html
<!-- Line 2 -->
<html lang="es">

<!-- Line 7 -->
<meta name="description" content="Travel Planner — Planificá tu próximo viaje con mapas interactivos, días y actividades.">

<!-- Line 248 — skip link -->
<a href="#main-content" class="skip-link">Saltar al contenido principal</a>

<!-- Line 258 — loading span -->
<span>Cargando...</span>

<!-- Line 262 — hero section aria-label -->
<section class="landing-hero" id="landing-hero" aria-label="Bienvenida">

<!-- Line 264 — hero h1 -->
<h1 class="landing-title">Tu próximo viaje,<br>perfectamente planificado.</h1>

<!-- Line 265 — tagline paragraph -->
<p class="landing-tagline">Planificá tu próximo viaje. Días, destinos y actividades, todo en un mapa interactivo.</p>

<!-- Line 267-268 — login button -->
Iniciar sesión

<!-- Line 270 — demo link -->
Ver demo

<!-- Line 281 — countdown title -->
<p class="demo-countdown-title">Faltan para el viaje</p>

<!-- Lines 283-286 — countdown labels -->
<span class="countdown-label">días</span>
<span class="countdown-label">horas</span>
<span class="countdown-label">minutos</span>
<span class="countdown-label">segundos</span>

<!-- Line 289 — cities section aria-label -->
<div class="demo-cities" aria-label="Ciudades del itinerario">

<!-- Line 297 — Tokyo return chip -->
<a href="tokyo2.html" class="city-chip">Tokyo (regreso)</a>
```

**Translations:**
- `lang="es"` → `lang="en"`
- meta description: remove Spanish, use English equivalent
- `Saltar al contenido principal` → `Skip to main content`
- `Cargando...` → `Loading...`
- `aria-label="Bienvenida"` → `aria-label="Welcome"`
- `Tu próximo viaje,<br>perfectamente planificado.` → `Your next trip,<br>perfectly planned.`
- tagline → English equivalent
- `Iniciar sesión` → `Sign in`
- `Ver demo` → `View demo`
- `Faltan para el viaje` → `Days until the trip`
- `días` → `days`, `horas` → `hours`, `minutos` → `minutes`, `segundos` → `seconds`
- `aria-label="Ciudades del itinerario"` → `aria-label="Itinerary cities"`
- `Tokyo (regreso)` → `Tokyo (return)`

---

### Wave 1: `frontend/dashboard.html` (HTML page, static text + modal)

**Pattern type:** Static HTML text nodes, modal HTML, form labels, placeholder attributes

```html
<!-- Line 2 -->
<html lang="es">

<!-- Line 13 — title -->
<title>Mis viajes</title>

<!-- Line 274 — skip link -->
<a href="#main-content" class="skip-link">Saltar al contenido principal</a>

<!-- Line 283 — h1 default text -->
<h1 id="dashboard-greeting">Mis viajes</h1>

<!-- Line 290 — new trip button -->
Nuevo viaje

<!-- Line 297 — login prompt paragraph -->
Iniciá sesión para ver y gestionar tus viajes.

<!-- Line 298 — login prompt button -->
<button id="auth-login-prompt-btn" class="btn btn-primary" type="button">Iniciar sesión</button>

<!-- Line 303 — loading state -->
<div class="trips-empty">Cargando viajes…</div>

<!-- Line 312 — modal h2 -->
<h2 id="create-trip-title">Crear nuevo viaje</h2>

<!-- Lines 315-316 — form labels + placeholder -->
<label for="trip-name">Nombre del viaje *</label>
<input ... placeholder="ej. Japón 2027" ...>

<!-- Lines 319-320 — description label + placeholder -->
<label for="trip-description">Descripción</label>
<textarea ... placeholder="Descripción opcional"></textarea>

<!-- Lines 324, 328 — date labels -->
<label for="trip-start">Fecha de inicio</label>
<label for="trip-end">Fecha de fin</label>

<!-- Line 334 — cancel button -->
<button type="button" id="create-trip-cancel" class="btn btn-secondary">Cancelar</button>

<!-- Line 335 — submit button -->
<button type="submit" class="btn btn-primary">Crear viaje</button>
```

**Translations:**
- `lang="es"` → `lang="en"`
- `Mis viajes` (title + h1) → `My Trips`
- `Saltar al contenido principal` → `Skip to main content`
- `Nuevo viaje` → `New Trip`
- `Iniciá sesión para ver y gestionar tus viajes.` → `Sign in to view and manage your trips.`
- `Iniciar sesión` → `Sign in`
- `Cargando viajes…` → `Loading trips…`
- `Crear nuevo viaje` → `Create New Trip`
- `Nombre del viaje *` → `Trip name *`, placeholder `ej. Japón 2027` → `e.g. Japan 2027`
- `Descripción` → `Description`, `Descripción opcional` → `Optional description`
- `Fecha de inicio` → `Start date`, `Fecha de fin` → `End date`
- `Cancelar` → `Cancel`
- `Crear viaje` → `Create trip`

---

### Wave 2: City HTML pages — `frontend/tokyo.html` (representative; ×8 files)

**Pattern type:** Static HTML — `lang`, `<meta>`, skip-link, date string, `aria-label`, `title` attr, h3

```html
<!-- Line 2 -->
<html lang="es">

<!-- Line 7 — meta description -->
<meta name="description" content="Itinerario de Tokyo - 22 Feb a 1 Mar 2026">

<!-- Line 10 — title -->
<title>Tokyo – Japón 2026</title>

<!-- Line 31 — skip link -->
<a href="#main-content" class="skip-link">Saltar al contenido principal</a>

<!-- Line 39 — date string in header -->
<p>22 Febrero – 1 Marzo 2026 · 8 días</p>

<!-- Line 41 — day-selector aria-label (also set by map.ts at runtime) -->
aria-label="Filtrar por día"

<!-- Line 43 — map aria-label -->
aria-label="Mapa de Tokyo"

<!-- Line 44 — hotel button title + aria-label -->
title="Ir al hotel" aria-label="Centrar mapa en hotel"

<!-- Line 46 — legend aria-label -->
aria-label="Leyenda de actividades"

<!-- Line 47 — activities h3 -->
<h3>Actividades</h3>
```

**Translations (apply to all 8 city files with city-specific values):**
- `lang="es"` → `lang="en"`
- meta description → English (e.g., `"Tokyo itinerary - Feb 22 to Mar 1, 2026"`)
- title: `"Tokyo – Japón 2026"` → `"Tokyo – Japan 2026"` (pattern: replace `Japón` → `Japan`)
- `Saltar al contenido principal` → `Skip to main content`
- date string: `"22 Febrero – 1 Marzo 2026 · 8 días"` → `"Feb 22 – Mar 1, 2026 · 8 days"` (en-US format)
- `aria-label="Filtrar por día"` → `aria-label="Filter by day"` (also change in map.ts and tripDetail.ts)
- `aria-label="Mapa de Tokyo"` → `aria-label="Map of Tokyo"`
- `title="Ir al hotel"` → `title="Go to hotel"`
- `aria-label="Centrar mapa en hotel"` is set by map.ts at runtime (line 128/129) — HTML attr on button can say either; map.ts overwrites it
- `aria-label="Leyenda de actividades"` → `aria-label="Activity legend"`
- `<h3>Actividades</h3>` → `<h3>Activities</h3>`

---

### Wave 3: `frontend/src/pages/profile.ts` (page module, innerHTML + textContent)

**Pattern type:** `innerHTML` string literal for list items, `setText()` calls, `toLocaleDateString` locale, modal `innerHTML` template

```typescript
// Line 78 — empty passkey list state (innerHTML assignment)
list.innerHTML =
  '<li style="...">No tenés passkeys registrados todavía.</li>';

// Lines 86-89 — locale call inside map()
new Date(c.createdDate).toLocaleDateString('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

// Line 96 — passkey meta text (template literal)
`<span class="passkey-meta">Registrado: ${created}</span>`

// Line 99 — delete button text
Eliminar

// Line 113 — error state innerHTML
'<li style="...">No se pudo cargar la lista de passkeys.</li>'

// Line 127 — error in registerPasskey()
showStatus('passkey-status', 'Error al iniciar el registro de passkey.', 'error');

// Lines 160-165 — modal innerHTML in buildDeleteModal()
modal.innerHTML = `
  <h2>¿Eliminar passkey?</h2>
  <p>Esta acción no se puede deshacer.</p>
  <div class="form-actions">
    <button class="btn btn-secondary" id="passkey-delete-cancel">Cancelar</button>
    <button class="btn btn-danger" id="passkey-delete-confirm">Eliminar</button>
  </div>
`;

// Line 199 — in-progress button text
freshConfirm.textContent = 'Eliminando…';

// Line 205 — restore button text after error
freshConfirm.textContent = 'Eliminar';
```

**Translations:**
- `No tenés passkeys registrados todavía.` → `You don't have any passkeys registered yet.`
- `'es-ES'` → `'en-US'`
- `Registrado: ${created}` → `Registered: ${created}`
- `Eliminar` (button) → `Delete`
- `No se pudo cargar la lista de passkeys.` → `Could not load passkey list.`
- `Error al iniciar el registro de passkey.` → `Error starting passkey registration.`
- `¿Eliminar passkey?` → `Delete passkey?`
- `Esta acción no se puede deshacer.` → `This action cannot be undone.`
- `Cancelar` → `Cancel`
- `Eliminando…` → `Deleting…`

---

### Wave 3 (same task): `uat-passkeys.spec.ts` (E2E spec, toContain assertion)

**Pattern type:** Playwright `expect().toContain()` substring assertion

```typescript
// Line 108 — WILL BREAK if profile.ts is translated without this change
expect(initialText).toContain('No tenés passkeys');
```

**Translation:**
```typescript
expect(initialText).toContain("You don't have any passkeys");
```

Also grep lines 185 and 189 for any additional Spanish string assertions before closing this task.

---

### Wave 4: `frontend/src/pages/dashboard.ts` (page module, template literals + textContent)

**Pattern type:** `setAttribute()` with template literal, `textContent` assignment, template literal, locale call

```typescript
// Line 26 — locale call in formatDateRange()
new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

// Line 37 — aria-label via setAttribute
card.setAttribute('aria-label', `Ver viaje: ${trip.name}`);

// Line 51 — badge textContent
badge.textContent = 'Público';

// Line 81 — destinations count
dests.textContent = `${destCount} destino${destCount !== 1 ? 's' : ''}`;

// Line 94 — edit link
editLink.textContent = 'Editar';

// Lines 111-112 — empty state text nodes
p1.textContent = 'Todavía no tenés ningún viaje guardado.';
p2.textContent = '¡Creá tu primer itinerario con el botón de arriba!';

// Line 127 — greeting
greeting.textContent = name ? `Hola, ${name.split(' ')[0]}` : 'Mis viajes';

// Line 245 — fetch error
setText(errP, `No se pudieron cargar los viajes: ${(err as Error).message}`);
```

**Translations:**
- `'es-ES'` → `'en-US'`
- `` `Ver viaje: ${trip.name}` `` → `` `View trip: ${trip.name}` ``
- `'Público'` → `'Public'`
- `` `${destCount} destino${destCount !== 1 ? 's' : ''}` `` → `` `${destCount} destination${destCount !== 1 ? 's' : ''}` ``
- `'Editar'` → `'Edit'`
- `'Todavía no tenés ningún viaje guardado.'` → `"You don't have any trips saved yet."`
- `'¡Creá tu primer itinerario con el botón de arriba!'` → `'Create your first itinerary with the button above!'`
- `` `Hola, ${name.split(' ')[0]}` `` → `` `Hello, ${name.split(' ')[0]}` ``
- `'Mis viajes'` (fallback) → `'My Trips'`
- `` `No se pudieron cargar los viajes: ${...}` `` → `` `Could not load trips: ${...}` ``

---

### Wave 5: `frontend/src/pages/tripDetail.ts` (page module — translate WITH map.ts)

**Pattern type:** `innerHTML` template literal, `setAttribute()`, `textContent`, screen-reader calls

Key strings (with shared counterparts in map.ts already listed in the cross-file table above):

```typescript
// Line 49 — aria-label via setAttribute
tabsEl.setAttribute('aria-label', 'Destinos del viaje');

// Line 114 — optional badge in buildPopup() template literal
`<span class="optional-badge">Opción ${activity.optional}</span>`

// Line 122 — popup link text
<span>Ver en Maps</span>

// Line 127 — popup link text
<span>Cómo llegar</span>

// Line 134 — hotel popup paragraph
`<h4>${hotel.name}</h4><p>Alojamiento</p>`

// Line 170 — day-selector aria-label (setAttribute)
daySelector.setAttribute('aria-label', 'Filtrar por día');

// Line 180 — day button title
btn.title = 'Este día tiene opciones alternativas';

// Line 212 — hotel button aria-label
hotelBtn.setAttribute('aria-label', 'Centrar mapa en hotel');

// Line 226 — screen-reader announcement
announceToScreenReader(`Mapa de ${data.name} cargado con ${allMarkers.length} ubicaciones`);

// Line 259 — screen-reader announcement (setupDayFilter)
announceToScreenReader('Mostrando todos los días');

// Lines 284-286 — screen-reader announcement
announceToScreenReader(
  `Mostrando ${dayData.label}: ${markersByDay[selectedDay].length} ubicaciones`
);

// Line 299 — legend-grid aria-label
legendGrid.setAttribute('aria-label', 'Lista de actividades por día');

// Line 319 — day-group badge
badge.textContent = 'Opciones';

// Line 373 — legend maps link title
mapsLink.title = 'Ver en Google Maps';

// Line 381 — legend dir link title
dirLink.title = 'Cómo llegar';

// Line 477 — error page back-link
link.textContent = 'Volver al dashboard';

// Lines 497, 514, 539 — showError() calls
showError(`No se pudo cargar el viaje: ${(err as Error).message}`);
showError('No se especificó un viaje. Revisá la URL.');
showError('No tenés acceso a este viaje. Pedile al dueño el enlace público.');

// Lines 563-564 — copy-link button
setText(copyLinkBtn, '¡Copiado!');
setTimeout(() => { setText(copyLinkBtn, 'Copiar enlace público'); }, 2000);
```

**Translations (match map.ts exactly for shared strings):**
- `'Destinos del viaje'` → `'Trip destinations'`
- `` `Opción ${activity.optional}` `` → `` `Option ${activity.optional}` ``
- `Ver en Maps` → `View on Maps`
- `Cómo llegar` (popup link) → `Directions`
- `Alojamiento` → `Accommodation`
- `'Filtrar por día'` → `'Filter by day'`
- `'Este día tiene opciones alternativas'` → `'This day has alternative options'`
- `'Centrar mapa en hotel'` → `'Center map on hotel'`
- `` `Mapa de ${data.name} cargado con ${allMarkers.length} ubicaciones` `` → `` `Map of ${data.name} loaded with ${allMarkers.length} locations` ``
- `'Mostrando todos los días'` → `'Showing all days'`
- `` `Mostrando ${dayData.label}: ${...} ubicaciones` `` → `` `Showing ${dayData.label}: ${...} locations` ``
- `'Lista de actividades por día'` → `'Activity list by day'`
- `'Opciones'` → `'Options'`
- `'Ver en Google Maps'` → `'View on Google Maps'`
- `'Cómo llegar'` (title attr) → `'Directions'`
- `'Volver al dashboard'` → `'Back to dashboard'`
- `'¡Copiado!'` → `'Copied!'`
- `'Copiar enlace público'` → `'Copy public link'`
- Error strings → as specified in RESEARCH.md

---

### Wave 5: `frontend/src/modules/map.ts` (module — translate WITH tripDetail.ts)

**Pattern type:** `innerHTML` template literal inside `createPopupContent()` and `createHotelPopup()`, `setAttribute()`, `textContent`, `title` attr, `announceToScreenReader` calls

```typescript
// Line 52 — optional badge in createPopupContent()
`<span class="optional-badge">Opción ${activity.optional}</span>`

// Line 57 — popup links text (one template string for both links)
<span>Ver en Maps</span>  ...  <span>Cómo llegar</span>

// Line 63 — hotel popup
`<h4>${hotel.name}</h4><p>Alojamiento</p>`

// Line 66 — hotel popup links (same pattern as line 57)
<span>Ver en Maps</span>  ...  <span>Cómo llegar</span>

// Line 89 — setAttribute in initCityMap()
daySelector.setAttribute('aria-label', 'Filtrar por día');

// Line 98 — day button title
btn.title = 'Este día tiene opciones alternativas';

// Line 128 — hotel button aria-label
hotelBtn.setAttribute('aria-label', 'Centrar mapa en hotel');

// Line 147 — announceToScreenReader
announceToScreenReader(`Mapa de ${data.name} cargado con ${allMarkers.length} ubicaciones`);

// Line 205 — announceToScreenReader (setupDayFilter, deselect)
announceToScreenReader('Mostrando todos los días');

// Line 225 — announceToScreenReader (setupDayFilter, select)
announceToScreenReader(`Mostrando ${dayData.label}: ${markersByDay[selectedDay].length} ubicaciones`);

// Line 234 — aria-label on legendGrid
legendGrid.setAttribute('aria-label', 'Lista de actividades por día');

// Line 254 — day-group badge
badge.textContent = 'Opciones';

// ~Line 300 — mapsLink.title in createLegendItem()
mapsLink.title = 'Ver en Google Maps';   // (verify exact line with grep)

// ~Line 305 — dirLink.title in createLegendItem()
dirLink.title = 'Cómo llegar';           // (verify exact line with grep)
```

Use identical English translations as listed for tripDetail.ts above.

---

### Wave 6: `frontend/src/pages/trip-edit/destinations.ts` (page module, textContent + geocoder)

**Pattern type:** `title.textContent` (modal title), `buildFormGroup()` label strings, `placeholder`, `btn.textContent`, `setText()` calls

```typescript
// Line 44 — initial modal title
title.textContent = 'Agregar destino';

// Lines 50-51 — form group labels (passed as string args to buildFormGroup())
buildFormGroup('Ciudad', ...)
buildFormGroup('País', ...)

// Lines 55-56 — date group labels
buildFormGroup('Llegada', ...)
buildFormGroup('Salida', ...)

// Line 63 — geocoder label
geocoderLabel.textContent = 'Coordenadas (opcional)';

// Line 72 — geocoder input placeholder
gInput.placeholder = 'Buscar lugar o pegar URL de Google Maps…';

// Line 79 — geocoder button
gBtn.textContent = 'Buscar lugar';

// Lines 117, 124 — form action buttons
cancelBtn.textContent = 'Cancelar';
saveBtn.textContent = 'Guardar';

// Line 183 — openModal() dynamic title
setText(modalTitle, dest ? 'Editar destino' : 'Agregar destino');

// Line 229, 237 — geocoder result buttons (Google Maps URL path + no-results)
btn.textContent = 'Encontrado';
btn.textContent = 'Sin resultados. Probá con otra búsqueda.';

// Line 245 — loading state during Nominatim search
geocoderBtn.textContent = 'Buscando…';

// Line 255 — no-results for Nominatim
btn.textContent = 'Sin resultados. Probá con otra búsqueda.';

// Line 275 — geocoder error
setText(formError, 'Error al buscar la ubicación. Intentá de nuevo.');

// Line 291 — save button loading state
setText(saveBtn, 'Guardando…');
```

**Translations:**
- `'Agregar destino'` → `'Add destination'`, `'Editar destino'` → `'Edit destination'`
- `'Ciudad'` → `'City'`, `'País'` → `'Country'`
- `'Llegada'` → `'Arrival'`, `'Salida'` → `'Departure'`
- `'Coordenadas (opcional)'` → `'Coordinates (optional)'`
- `'Buscar lugar o pegar URL de Google Maps…'` → `'Search location or paste Google Maps URL…'`
- `'Buscar lugar'` → `'Search location'`
- `'Cancelar'` → `'Cancel'`, `'Guardar'` → `'Save'`
- `'Encontrado'` → `'Found'`
- `'Sin resultados. Probá con otra búsqueda.'` → `'No results. Try a different search.'`
- `'Buscando…'` → `'Searching…'`
- `'Error al buscar la ubicación. Intentá de nuevo.'` → `'Error searching location. Please try again.'`
- `'Guardando…'` → `'Saving…'`

Also check for delete-confirm and section header strings further in the file (RESEARCH.md lists `'¿Eliminar destino?'`, `'Hotel'`, `'Días'`, `'Editar'`, `'Eliminar'`, `'Eliminando…'`).

---

### Wave 6: `frontend/src/pages/trip-edit/hotels.ts` (page module — same geocoder pattern)

**Pattern type:** Identical pattern to destinations.ts — `textContent`, `placeholder`, `setText()`

```typescript
// Line 44 — initial modal title
title.textContent = 'Agregar hotel';

// Line 64 — geocoder label
geocoderLabel.textContent = 'Coordenadas (opcional)';

// Line 73 — geocoder placeholder
gInput.placeholder = 'Buscar lugar o pegar URL de Google Maps…';

// Line 80 — geocoder button
gBtn.textContent = 'Buscar lugar';

// Lines 118, 125 — form buttons
cancelBtn.textContent = 'Cancelar';
saveBtn.textContent = 'Guardar';

// Line 184 — openModal() dynamic title
setText(modalTitle, hotel ? 'Editar hotel' : 'Agregar hotel');

// Lines 229, 237 — geocoder result buttons (same as destinations.ts)
btn.textContent = 'Encontrado';
btn.textContent = 'Sin resultados. Probá con otra búsqueda.';

// Line 244 — loading state
geocoderBtn.textContent = 'Buscando…';

// Line 291 — save loading
setText(saveBtn, 'Guardando…');
```

Same translation list as destinations.ts for shared strings. Additional hotel-specific strings (from RESEARCH.md): `'¿Eliminar hotel?'`, `'Esta acción no se puede deshacer.'`, `'Sin hotel asignado.'`, `'Agregar hotel'` — locate via grep if exact lines needed.

---

### Wave 6: `frontend/src/pages/trip-edit/days.ts` (page module)

**Pattern type:** `textContent`, `placeholder`, `setText()`, color-swatch `aria-label`

```typescript
// Line 53 — initial modal title
title.textContent = 'Agregar día';

// Line 64 — label field label
labelEl.textContent = 'Etiqueta';

// Line 71 — label field placeholder
lInput.placeholder = 'Ej: Día libre en Tokio';

// Line 80 — date field label
dateLabelEl.textContent = 'Fecha';

// Line 94 — color field label
colorLabelEl.textContent = 'Color';

// Line 109 — color swatch aria-label (already uses number, "Color" may be acceptable)
swatch.setAttribute('aria-label', `Color ${n}`);

// Line 187 — openModal() dynamic title
setText(modalTitle, day ? 'Editar día' : 'Agregar día');

// Line 240 — save loading
setText(saveBtn, 'Guardando…');

// Line 287 — delete confirm title
setText(confirmTitle, '¿Eliminar día?');

// Line 372 — generate button restore
setText(genBtn, 'Generar todos los días');

// Line 393 — add day button
addBtn.textContent = 'Agregar día';

// Line 405 — generate button initial
genBtn.textContent = 'Generar todos los días';

// Line 413 — generate loading state
setText(genBtn, 'Generando…');

// Line 420 — generate restore
setText(genBtn, 'Generar todos los días');

// Line 430 — empty state
setText(emptyP, 'Sin días. Agregá un día o usá "Generar todos los días".');
```

**Translations:**
- `'Agregar día'` → `'Add day'`, `'Editar día'` → `'Edit day'`
- `'Etiqueta'` → `'Label'`
- `'Ej: Día libre en Tokio'` → `'E.g.: Free day in Tokyo'`
- `'Fecha'` → `'Date'`
- `'Color'` — unchanged (already English-compatible; `Color 1` through `Color 8`)
- `'Guardando…'` → `'Saving…'`
- `'¿Eliminar día?'` → `'Delete day?'`
- `'Generar todos los días'` → `'Generate all days'`
- `'Agregar día'` → `'Add day'`
- `'Generando…'` → `'Generating…'`
- `'Sin días. Agregá un día o usá "Generar todos los días".'` → `'No days. Add a day or use "Generate all days".'`

Also check for delete-confirm warning string (`'Se eliminarán todas las actividades de este día.'`) and 3 generate error strings — locate via grep.

---

### Wave 6: `frontend/src/pages/trip-edit/activities.ts` (page module)

**Pattern type:** `textContent`, `title` attr, `setText()` — same pattern as other trip-edit modules

Key lines from grep results:
- Line 50: `title.textContent = 'Agregar actividad'`
- Line 196: `setText(modalTitle, act ? 'Editar actividad' : 'Agregar actividad')`
- Line 303: `setText(saveBtn, 'Guardando…')`
- Line 362: `setText(confirmTitle, '¿Eliminar actividad?')`
- Line 452: `addBtn.textContent = 'Agregar actividad'`
- Line 467: `setText(emptyP, 'Sin actividades. Agregá la primera.')`
- Line 491: `upBtn.title = 'Subir'`
- Line 512: `downBtn.title = 'Bajar'`

**Translations:**
- `'Agregar actividad'` → `'Add activity'`, `'Editar actividad'` → `'Edit activity'`
- `'Guardando…'` → `'Saving…'`
- `'¿Eliminar actividad?'` → `'Delete activity?'`
- `'Sin actividades. Agregá la primera.'` → `'No activities. Add the first one.'`
- `'Subir'` → `'Move up'`, `'Bajar'` → `'Move down'`

Form labels (`'Nombre'`, `'Hora (opcional)'`, `'Notas (opcional)'`, `'Coordenadas (opcional)'`) and geocoder strings follow the same pattern as destinations.ts — same translations apply.

---

### Wave 6: `frontend/src/pages/trip-edit/metadata.ts` (page module, setText only)

**Pattern type:** `setText()` calls exclusively — simplest file in the wave

```typescript
// Line 34 — save loading state
setText(saveBtn, 'Guardando…');

// Line 45 — save success state
setText(saveBtn, 'Guardado');

// Line 46 — save restore
setTimeout(() => { if (saveBtn) setText(saveBtn, 'Guardar cambios'); }, 1500);

// Line 49 — error message
errorEl.textContent = 'No se pudo guardar. Verificá tu conexión e intentá de nuevo.';

// Line 54 — save restore in finally
if (saveBtn.textContent === 'Guardando…') setText(saveBtn, 'Guardar cambios');
```

**Translations:**
- `'Guardando…'` → `'Saving…'`
- `'Guardado'` → `'Saved'`
- `'Guardar cambios'` → `'Save changes'` (appears on lines 46 AND 54 — update both)
- `'No se pudo guardar. Verificá tu conexión e intentá de nuevo.'` → `'Could not save. Check your connection and try again.'`

---

### Wave 7: `frontend/src/modules/widgets.ts` (module, innerHTML + object literal)

**Pattern type:** `innerHTML` template literal, `setAttribute()`, object literal dictionary, empty/error state strings

```typescript
// Line 33-34 — section aria-label and h3 title
section.setAttribute('aria-label', `Información local de ${cityName}`);
section.innerHTML = `<h3 class="widgets-title">Información Local: ${cityName}</h3>...`

// Lines 38-47 — widget card h4 headings inside innerHTML
<h4 id="weather-title">Clima & Pronóstico</h4>
<h4 id="news-title">Noticias</h4>
<h4 id="events-title">Eventos</h4>

// Lines 39-47 — sr-only loading strings
<span class="sr-only">Cargando clima...</span>
<span class="sr-only">Cargando noticias...</span>
<span class="sr-only">Cargando eventos...</span>

// Line 93 — locale call in renderWeather()
toLocaleDateString('es-ES', { weekday: 'short' })

// Lines 103-104 — aria-labels in renderWeather()
aria-label="Temperatura actual"
aria-label="Pronóstico de 4 días"

// Lines 109-111 — WEATHER_CONDITIONS dictionary (object literal)
const WEATHER_CONDITIONS: Record<number, string> = {
  0: 'Despejado', 1: 'Poco nuboso', 2: 'Parcial nublado', 3: 'Nublado',
  45: 'Niebla', 51: 'Llovizna', 61: 'Lluvia', 71: 'Nieve', 95: 'Tormenta'
};

// Line 115 — fallback condition
return WEATHER_CONDITIONS[code] ?? 'Variable';

// Line 197 — calendar button title/aria-label template
`title="Agregar al calendario" aria-label="Agregar ${title} al calendario"`

// Line 207 — empty state
`No se encontraron ${type === 'news' ? 'noticias' : 'eventos'} recientes.`

// Line 162 — error fallback
renderError(container, 'Recarga para ver contenido');
```

**Translations:**
- `` `Información local de ${cityName}` `` → `` `Local information for ${cityName}` ``
- `` `Información Local: ${cityName}` `` → `` `Local Information: ${cityName}` ``
- `Clima & Pronóstico` → `Weather & Forecast`
- `Noticias` → `News`, `Eventos` → `Events`
- `Cargando clima...` → `Loading weather...`, `Cargando noticias...` → `Loading news...`, `Cargando eventos...` → `Loading events...`
- `'es-ES'` → `'en-US'`
- `"Temperatura actual"` → `"Current temperature"`
- `"Pronóstico de 4 días"` → `"4-day forecast"`
- WEATHER_CONDITIONS dictionary: `'Despejado'`→`'Clear'`, `'Poco nuboso'`→`'Mostly clear'`, `'Parcial nublado'`→`'Partly cloudy'`, `'Nublado'`→`'Cloudy'`, `'Niebla'`→`'Fog'`, `'Llovizna'`→`'Drizzle'`, `'Lluvia'`→`'Rain'`, `'Nieve'`→`'Snow'`, `'Tormenta'`→`'Thunderstorm'`
- `'Variable'` → `'Variable'` (unchanged)
- `"Agregar al calendario"` → `"Add to calendar"`, `` `Agregar ${title} al calendario` `` → `` `Add ${title} to calendar` ``
- `` `No se encontraron ${'noticias'|'eventos'} recientes.` `` → `` `No recent ${'news'|'events'} found.` ``
- `'Recarga para ver contenido'` → `'Reload to view content'`

---

### Wave 7: `frontend/src/modules/search.ts` (module, locale call + template literal)

**Pattern type:** `toLocaleDateString` locale call, template literal subtitle string

```typescript
// Line 49 — hotel subtitle in buildSearchIndex()
subtitle: `Hotel en ${cityData.name}`,

// Lines 106 — API trip destination subtitle (extendSearchIndexWithApiTrip)
` · ' + new Date(dest.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })`

// Lines 117-118 — hotel subtitle in extendSearchIndexWithApiTrip
subtitle: `Hotel en ${dest.city_name} · ${trip.name}`,

// Line 158-162 — formatDateLabel() locale call
function formatDateLabel(dateKey: string): string {
  const date = new Date(dateKey);
  return date.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}
```

**Translations:**
- `` `Hotel en ${cityData.name}` `` → `` `Hotel in ${cityData.name}` ``
- `` `Hotel en ${dest.city_name} · ${trip.name}` `` → `` `Hotel in ${dest.city_name} · ${trip.name}` ``
- Both `'es-ES'` occurrences → `'en-US'`

---

### Wave 8: `frontend/public/manifest.json` (JSON config)

**Pattern type:** JSON string properties

```json
{
  "name": "Japón 2026 Itinerario",
  "short_name": "Japón 2026",
  "description": "Itinerario interactivo de viaje a Japón - 30 días, 8 ciudades",
  "lang": "es"
}
```

**Translations:**
- `"Japón 2026 Itinerario"` → `"Japan 2026 Itinerary"`
- `"Japón 2026"` → `"Japan 2026"`
- `"Itinerario interactivo de viaje a Japón - 30 días, 8 ciudades"` → `"Interactive Japan travel itinerary - 30 days, 8 cities"`
- `"lang": "es"` → `"lang": "en"`

---

### Wave 8: `frontend/src/data/itinerary.ts` (data layer — scope confirmed in scope)

**Pattern type:** Object literal string values — abbreviated day names, activity notes, date range strings

This file contains ~150 Spanish strings. Primary categories:
1. Abbreviated day names: `"Dom"`, `"Lun"`, `"Mar"`, `"Mié"`, `"Jue"`, `"Vie"`, `"Sáb"` → `"Sun"`, `"Mon"`, `"Tue"`, `"Wed"`, `"Thu"`, `"Fri"`, `"Sat"`
2. Activity notes like `"Comprar entrada en el lugar"`, `"Día libre"`, `"Reservado 19:00"`, `"Calle tradicional de geishas"` → English translations
3. Date range strings like `"22 Febrero – 1 Marzo 2026 · 8 días"` → `"Feb 22 – Mar 1, 2026 · 8 days"`

These require a full read of the file to enumerate all strings. The pattern is consistent object literal property values.

---

## No Analog Found

Not applicable — this is a translation pass, not a feature addition. Every file is its own analog. No files require patterns from external sources.

---

## Validation Commands (from RESEARCH.md)

```bash
# After each wave — must return zero files
rg "[áéíóúñ¿¡]" frontend/src frontend/*.html --files-with-matches

# Locale audit — must return zero hits
rg "es-ES" frontend/src

# lang attr audit — must return zero hits
rg 'lang="es"' frontend/*.html

# Shared-string consistency check after Wave 5
rg "Ver en Maps|View on Maps|Cómo llegar|Directions|Alojamiento|Accommodation" frontend/src/modules/map.ts frontend/src/pages/tripDetail.ts

# test coupling check after Wave 3
npx playwright test uat-passkeys.spec.ts
```

---

## Metadata

**Files with cross-file coupling constraints:**
1. `map.ts` + `tripDetail.ts` — 13 shared strings — must be same task
2. `profile.ts` + `uat-passkeys.spec.ts` — substring assertion coupling — must be same commit

**Files with invisible locale calls (not caught by accent-char grep):**
- `dashboard.ts:26`, `profile.ts:86`, `widgets.ts:93`, `search.ts:106,158`

**Pattern extraction date:** 2026-05-09
**Source confidence:** HIGH — all files read directly from codebase
