# Phase 2: Trip Builder - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Full trip edit UI on a new `trip-edit.html?tripId=X` page: CRUD for destinations (with geocoder), hotels (name, URL, check-in/out), days (label, date, color, bulk generate), and activities (name, time, notes, geocoder, reorder). Public/private toggle for the trip (SHARE-01). One Drizzle migration adds `activities.time` (text, nullable) and `hotels.url` (text, nullable).

</domain>

<spec_lock>
## Requirements (locked via UI-SPEC.md)

**All UI/UX decisions are locked.** See `02-UI-SPEC.md` for the full visual and interaction contract.

Downstream agents MUST read `02-UI-SPEC.md` before planning or implementing. UI decisions are not duplicated here.

**In scope (from UI-SPEC.md):**
- Single scrolling `trip-edit.html` page
- Destinations as always-expanded accordion sections (`.dest-section`)
- Geocoder widget: text input + "Buscar lugar" button + inline results list (max 5)
- Activity reorder: ▲/▼ buttons per row (`.btn-icon`), PATCH to `reorderActivities` on click
- Public/private: native checkbox, label "Hacer público"
- Day color picker: 8 swatches using `--marker-1` through `--marker-8`
- Error display: inline `.error-msg` immediately after failing form group
- Destructive confirm: `.overlay`/`.modal` pattern with "Cancelar" + "Eliminar" (`.btn-danger`)
- All copy strings in Spanish (full table in UI-SPEC.md §Copywriting Contract)
- Component classes, spacing scale, typography scale, color tokens — all defined in UI-SPEC.md

**Out of scope (from UI-SPEC.md / REQUIREMENTS.md):**
- Drag-to-reorder destinations or days (no backend endpoint; deferred per REQUIREMENTS.md)
- Map preview on the edit page (trip.html handles the map view)
- Cover image upload (URL paste via existing `cover_image_url` field is sufficient for v1)

</spec_lock>

<decisions>
## Implementation Decisions

### Edit form placement
- **D-01:** Both add and edit operations for all entities (destination, hotel, day, activity) use the existing `.overlay`/`.modal` pattern — same DOM pattern as destructive confirms and dashboard's "create trip" form. Reuse existing CSS classes verbatim; no new modal styles needed.
- **D-02:** Single modal DOM element reused per entity type, dynamically populated. Title changes ("Agregar destino" vs "Editar destino"); fields are pre-filled for edit, empty for add. The geocoder widget (`.geocoder-widget` from UI-SPEC) appears inside destination and activity edit/add modals for coordinate resolution. Hotel edit/add modal also includes a geocoder for optional coordinates.
- **D-03:** Four distinct modal configurations needed: destination modal (city, country, start/end dates, geocoder), hotel modal (name, URL, check-in/out, optional geocoder), day modal (label, date, color picker), activity modal (name, time, notes, optional geocoder).

### Migration (TRIP-08 extended)
- **D-04:** The TRIP-08 Drizzle migration must add TWO columns: `activities.time` (text, nullable) and `hotels.url` (text, nullable). The hotel URL field is required by TRIP-04 but is missing from the current schema (`backend/src/db/schema.ts`) and `UpsertHotelSchema` — both must be updated. The planner must treat this as a single migration with two additions.

### Claude's Discretion
- Whether to use one shared modal DOM element or separate elements per entity type — Claude's choice based on what produces cleaner TypeScript
- Exact order of fields within each modal form
- Whether "Generar todos los días" is a smart merge or destructive replace — not discussed; Claude should default to smart merge (add only missing days, skip days already present for that date) as the safer UX

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI/UX Contract (MANDATORY)
- `.planning/phases/02-trip-builder/02-UI-SPEC.md` — Full visual and interaction contract. Every new component class, color token, spacing value, copy string, and interaction flow is defined here. Read this first.

### Requirements & Goals
- `.planning/REQUIREMENTS.md` — TRIP-01 through TRIP-08 and SHARE-01 definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 2 — five success criteria that define done

### Backend Schema & Validation
- `backend/src/db/schema.ts` — Full Drizzle schema: trips, destinations, hotels, days, activities tables with all column types. Note: `hotels` table has no `url` column yet; `activities` has no `time` column yet — both are added in this phase's migration.
- `backend/src/validation/schemas.ts` — Zod schemas for all trip entities (CreateTripSchema, UpsertHotelSchema, CreateActivitySchema, etc.). These must be extended alongside the DB migration.
- `backend/src/routes/trips.ts` — All REST endpoints: trips CRUD, destinations CRUD, hotel upsert, days CRUD, activities CRUD + reorder. All authenticated. All exist and are complete.

### Frontend Reference
- `frontend/src/api/client.ts` — Typed fetch client. Has `getMyTrips`, `getTrip`, etc. New functions for create/update/delete destinations, hotels, days, activities must be added here.
- `frontend/src/pages/tripDetail.ts` — 550-line reference showing the established page pattern: URL param extraction, Keycloak init, API fetch, DOM rendering with `setText`/`setStyle`. Use this as the structural template for `trip-edit.ts`.
- `frontend/src/modules/dom.ts` — `setText(el, text)` and `setStyle(el, prop, value)` helpers from Phase 1. All new DOM manipulation must use these — never raw `innerHTML`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/modules/dom.ts` — `setText` / `setStyle`: use for all new DOM text/style mutations
- `frontend/src/modules/theme.ts` — `initTheme()`: call on page init (already in dashboard.ts and tripDetail.ts)
- `frontend/src/auth/keycloak.ts` — `initKeycloak()`, `isAuthenticated()`, `getToken()`: same auth init pattern as all other pages
- `frontend/src/api/client.ts` — `buildHeaders()`, `request<T>()` internals: extend with new CRUD functions rather than writing raw fetch calls
- `.overlay`/`.modal` CSS from `dashboard.html` inline styles — already handles focus, Escape key, backdrop. Reuse verbatim.

### Established Patterns
- MPA page structure: `trip-edit.html` (Vite entry) + `frontend/src/pages/trip-edit.ts` (TS entry). Matches dashboard.html / dashboard.ts pairing.
- Auth guard: check `isAuthenticated()` after `initKeycloak()` — redirect to login if not authenticated (same as dashboard.ts)
- URL param extraction: `new URLSearchParams(window.location.search)` pattern from tripDetail.ts
- Error display: `.error-msg` class directly after the form group (locked by UI-SPEC)
- Named exports only — no default exports on utility modules (Phase 1 decision)

### Integration Points
- `frontend/src/components/Navbar.ts` — import and register on the new page (same as all other pages)
- Vite config (`frontend/vite.config.ts`) — must add `trip-edit.html` as an entry point (MPA setup)
- `frontend/dashboard.html` — must add a link to `trip-edit.html?tripId=X` from each trip card (TRIP-01: navigate from dashboard)

### Schema Gaps (action required in this phase)
- `backend/src/db/schema.ts` `hotels` table: add `url: text('url')` (nullable)
- `backend/src/db/schema.ts` `activities` table: add `time: text('time')` (nullable)
- `backend/src/validation/schemas.ts` `UpsertHotelSchema`: add `url: z.string().url().nullable().optional()`
- `backend/src/validation/schemas.ts` `CreateActivitySchema` / `UpdateActivitySchema`: add `time: z.string().nullable().optional()`
- Generate and apply a single Drizzle migration for both columns

</code_context>

<specifics>
## Specific Ideas

- User confirmed the modal pattern explicitly via preview (showed the exact modal mockup with Ciudad/País/Llegada/Salida/Coords fields + Cancelar/Guardar buttons).

</specifics>

<deferred>
## Deferred Ideas

- Activity time UX (structured `<input type="time">` vs. free text) — not discussed; the `time text` column type in TRIP-08 allows either. Claude's discretion: use `<input type="time">` for structured HH:MM output since it stores as a text string and gives the user a validated picker.
- "Generate all days" conflict handling — not discussed; Claude's discretion: smart merge (add only missing days, skip dates already present).
- Map preview on trip-edit page — not in scope for Phase 2.
- Drag-to-reorder activities — deferred per REQUIREMENTS.md (no backend reorder endpoint for this).

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-trip-builder*
*Context gathered: 2026-04-28*
