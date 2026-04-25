# Architecture Research

**Focus:** Trip builder UI integration into existing MPA
**Date:** 2026-04-25
**Confidence:** HIGH — based on direct codebase analysis

---

## Recommended Approach for Trip Builder UI

**Recommendation: Inline editing on the trip detail page (trip.html), not a separate page.**

The trip detail page (`trip.html` + `tripDetail.ts`) already owns the full `ApiTrip` object in memory after load, renders destination tabs, manages the Leaflet map lifecycle, and is the natural context where a user already *sees* their trip. Adding an edit mode to this page avoids a round-trip to a separate page, keeps the map visible while editing (critical for placing activity pins), and doesn't require a new Vite entry point.

Concretely: the page gains an `isOwner` boolean (compare `trip.user_id` against `getUserInfo().id`), and owner-only UI (edit buttons, add-destination button, inline forms) is conditionally rendered. Non-owners (and public viewers) see the read-only view unchanged. The page already has the auth infrastructure (`initKeycloak`, `isAuthenticated`) to determine this at load time.

A separate `trip-edit.html` page would require duplicating the entire map init, destination tab logic, and trip-loading flow — all of which lives in `tripDetail.ts`. It also breaks the mental model: the user clicks "Edit" and lands on a different URL with no map visible until they save.

---

## Component Design for Nested Data

The hierarchy is: Trip → Destinations → (Hotel, Days → Activities). The recommended approach is **disclosure-based inline forms** — each level renders a collapsed summary with an "Add" or "Edit" button that expands a form in place, saves via API on submit, then re-renders only the affected sub-tree.

**Level 1 — Trip metadata** (name, description, dates, is_public):
- Small edit form rendered inline at the top of the page, shown/hidden via a trip-level "Edit" button.
- On save: `updateTrip(tripId, data)` → update the in-memory `currentTrip` object → re-render the title/subtitle only.
- No page reload required.

**Level 2 — Destinations** (city, dates, lat/lng, zoom):
- Each destination tab gets an "Edit" icon. Clicking it opens a panel (not a modal) in the sidebar/legend area with the destination's current values.
- "Add Destination" button appends a blank form below the tab list.
- On save: `createDestination` / `updateDestination` → insert/update into `currentTrip.destinations` → rebuild dest tabs, call `loadDestination()` for the active one.
- Deletion: "Delete" button with confirmation, then `deleteDestination` → remove from `currentTrip.destinations` → rebuild tabs, jump to index 0.

**Level 3 — Hotel** (name, lat/lng, check-in/out):
- Hotel is a single optional entity per destination. One "Set hotel" / "Edit hotel" button in the legend area.
- Expands a small form. On save: `upsertHotel` (PUT `/trips/:id/destinations/:destId/hotel`) → update `currentTrip.destinations[destIndex].hotel` → re-render hotel marker on map.
- Note: `client.ts` currently lacks `upsertHotel` — must be added.

**Level 4 — Days** (date, label, color):
- Days appear in the legend as day-group sections. Each gets an "Edit" icon and a delete button.
- "Add Day" button appended after the last day-group.
- On save: `createDay` / `updateDay` → insert/update into `currentTrip.destinations[destIndex].days` → rebuild the day filter and legend for this destination only (not the whole trip).
- Color picker input (`<input type="color">`) sets `color_hex`.
- Note: `updateDay` is absent from `client.ts` — must be added.

**Level 5 — Activities** (name, lat/lng, notes, optional, order):
- Each legend item gets an "Edit" icon (pencil) and a drag handle for reorder.
- "Add Activity" button at the bottom of each day-group.
- On save: `createActivity` / `updateActivity` → insert/update into the day's `activities` array → refresh only that day's markers on the map (remove old markers, add new ones).
- For location: provide `lat`/`lng` number inputs (the user types coordinates or uses the map click integration described below). The backend accepts string lat/lng in the Zod schema; the client must stringify.
- Note: `deleteActivity` is in `client.ts`. `updateActivity` is in `client.ts`. Reorder (`reorderActivities`) is in the backend but not in `client.ts` — must be added.

**Pattern for all levels:** Changes are applied to a mutable `currentTrip: ApiTrip` variable in `tripDetail.ts` (already module-level, just needs to be declared `let` not `const`). Each save operation does: API call → mutate `currentTrip` → targeted re-render. Never reload the full trip from the API after an edit — that doubles latency and breaks any in-progress edits.

**Forms: plain `<form>` elements, no Web Components.** The nested editing UI is page-specific and not reused elsewhere. Building it as Web Components adds Shadow DOM complexity that makes reading and mutating the outer `currentTrip` harder. The existing pattern (dashboard's create-trip modal is a plain `<form>` in HTML with JS event listeners) should be followed consistently.

---

## State Management Approach

Keep the existing pattern: module-level variables in `tripDetail.ts`, no external state library.

```
let currentTrip: ApiTrip | null = null;   // mutable source of truth
let isOwner = false;                       // derived once after auth
let activeDestIndex = 0;                  // current tab
```

After every mutating API call, update `currentTrip` in place (e.g. `currentTrip.destinations.push(newDest)` or replace the specific object by id) and call the appropriate targeted render function. The render functions are already structured to accept `ApiTrip` and an index — they can be called repeatedly without side effects.

**Edit mode toggle:** A boolean `editMode` flag controls whether edit buttons/forms are visible. Toggle it with a top-level "Edit trip" / "Done" button visible only to the owner. This avoids a proliferation of show/hide logic scattered across render functions — one CSS class on `<body>` or a container element (`body.edit-mode .edit-controls { display: flex }`) handles it cleanly.

**Token refresh during long sessions:** The existing `keycloak.onTokenExpired` handler in `auth/keycloak.ts` already calls `refreshToken()` automatically. `getToken()` calls `keycloak.updateToken(30)` before every API call, proactively refreshing if expiry is within 30 seconds. This means: any user action that triggers an API call will refresh the token as a side-effect. For passive sessions (user is typing in a form, not clicking), the `onTokenExpired` event fires and calls `refreshToken()`. Keycloak's default access token lifetime is 5 minutes with a refresh token lifetime of 30 minutes — a user editing for 30+ minutes will get automatic refreshes as long as they make at least one API call per 30 minutes, or if `onTokenExpired` fires. No additional keepalive logic is needed for this use case; the existing mechanism is sufficient.

**Optimistic UI vs save-on-server:** Use explicit save buttons per form (not auto-save on field blur). Rationale: the nested data model means a half-filled "Add Activity" form has no valid API payload until at least `name` is provided. Auto-saving fragments would require server-side draft state. Save buttons are simpler, match the existing pattern in dashboard's create-trip form, and make the state transition obvious to the user. Disable the save button while the request is in-flight (already done in dashboard's `handleCreateTrip`).

---

## Integration Points with Existing Code

**Files to modify:**

| File | Change |
|------|--------|
| `frontend/src/pages/tripDetail.ts` | Add `isOwner` detection; add edit mode toggle; add render functions for editor controls; wire create/update/delete handlers for all entity levels |
| `frontend/src/api/client.ts` | Add missing endpoints: `updateDay`, `deleteDay`, `upsertHotel`, `deleteHotel`, `reorderActivities` |
| `frontend/trip.html` | Add edit toolbar HTML, skeleton edit form elements (hidden by default), owner-only CSS classes |
| `frontend/vite.config.ts` | No change needed — `trip` entry already exists |

**Files to create:**

| File | Purpose |
|------|---------|
| (none required initially) | All builder logic lives in `tripDetail.ts` until it exceeds ~600 lines, then extract to `frontend/src/modules/tripBuilder.ts` |

**Do not modify:**
- `frontend/src/modules/tripAdapter.ts` — the read-only view still uses it; editing works directly on `ApiTrip`, not `CityData`
- `frontend/src/components/Navbar.ts` — no changes needed for builder
- Backend — all CRUD routes exist; no new endpoints needed

**Map interaction for activity pin placement:** Leaflet supports click events on the map (`map.on('click', handler)`). When an "Add Activity" or "Edit Activity" form is open and the user clicks the map, capture `e.latlng` and populate the `lat`/`lng` inputs. A visual indicator (temporary marker) should be placed at the clicked point until the form is saved. Wire this up in the activity form open/close lifecycle. The `currentMap` reference is already a module-level variable in `tripDetail.ts` — no new globals needed.

**Destination lat/lng / zoom:** When creating a destination, the user needs to set the map center coordinates. Two options: (1) geocoding lookup by city name (requires a third-party API, adds complexity), (2) manual lat/lng inputs with a "pick from map" button. Recommendation: manual inputs for v1, same map-click pattern as activities. Add a helper to parse the inputs as floats — the backend Zod schema accepts strings, so `String(lat)` before the API call.

---

## Build Order

Dependencies flow from data model outward to UI interactions. Build in this order:

**1. API client completeness (hours)**
Add the 5 missing client functions (`updateDay`, `deleteDay`, `upsertHotel`, `deleteHotel`, `reorderActivities`) to `client.ts`. These are mechanical wrappers over the existing `request()` helper. No other work is blocked on anything before this.

**2. Owner detection and edit mode toggle (hours)**
In `tripDetail.ts`, after the trip loads: compare `trip.user_id` against `getUserInfo()?.id`, set `isOwner`, render an "Edit" button if true. Toggling `document.body.classList.toggle('edit-mode')` controls visibility of all editor controls via CSS. Write the CSS rules in `trip.html`. This is the scaffolding all subsequent steps depend on.

**3. Trip-level edit form (1 day)**
Inline form for trip name, description, dates, is_public. Save via `updateTrip`. This is the simplest case (flat object) and validates the pattern for deeper levels.

**4. Destination CRUD (1–2 days)**
Add destination button, edit panel, delete with confirmation. Includes the map-click-for-coordinates integration. After save, rebuild dest tabs and reload the active destination view.

**5. Hotel upsert form (half day)**
Single form per destination. Reuses the map-click-for-coordinates pattern. After save, re-render the hotel marker on the current map instance.

**6. Day CRUD (1 day)**
Add/edit/delete days. Includes color picker. After each save, rebuild the day filter and legend for the current destination only.

**7. Activity CRUD (2 days)**
Most complex level. Add/edit/delete activities, map-click for pin placement, temporary marker preview. After each save, remove and re-add only the affected day's markers.

**8. Activity reorder (1 day, deferrable)**
Drag-to-reorder using HTML5 drag-and-drop or pointer events. Calls `reorderActivities` on drop. Can be deferred to a later phase without blocking any other builder feature.

---

## Tradeoffs Considered

**Separate `trip-edit.html` page vs inline editing on `trip.html`:**
Separate page would give a clean slate and simpler state (no read/edit mode split), but requires duplicating ~400 lines of map and tab logic from `tripDetail.ts`, creates a navigation seam (user leaves the map to edit), and adds a Vite entry point. Inline editing wins because the existing page already owns everything needed and the map must stay visible for pin placement.

**Web Components for editor panels vs plain JS/HTML:**
Web Components would encapsulate each editor panel (destination editor, day editor, activity editor) cleanly. But: Shadow DOM makes it harder to read/mutate `currentTrip` without custom events or property setters; the existing editor patterns (dashboard modal) don't use Web Components; and the builder panels are page-specific, not reusable. Plain JS/HTML wins for maintainability in this context.

**Auto-save (per-field) vs explicit save buttons:**
Auto-save on blur is common in rich editors but requires: debouncing, partial-payload handling, conflict resolution if the user edits faster than requests complete, and error display that doesn't interrupt typing. The trip data model has required fields at every level (`city_name`, `country` for destinations; `date` for days; `name` for activities) — auto-saving incomplete forms would send invalid requests. Explicit save buttons are simpler and correct here.

**Optimistic UI (update local state before API confirms) vs pessimistic:**
Optimistic would feel faster but requires rollback logic on API failure, which is especially tricky for create operations where the server assigns the new entity's ID (needed for nested creates). Pessimistic (wait for server response, then update UI) is the right default for a v1 builder. The latency on Cloudflare Workers + Neon is low enough (typically <100ms for simple inserts) that pessimistic saves won't feel sluggish.

**Single `currentTrip` object vs separate state per entity level:**
A separate "destinations store", "days store" etc. would reduce re-render scope but adds synchronization complexity — any mutation at one level must propagate to parent. A single `currentTrip` tree is simpler and matches what the API returns. Targeted re-renders (rebuild only the day-group for a saved activity, not the entire legend) keep performance acceptable even with a large trip.
