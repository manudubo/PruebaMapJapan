---
phase: 02-trip-builder
plan: "05"
subsystem: frontend
tags: [trip-edit, destinations, crud, geocoder, modal, XSS-safe]
dependency_graph:
  requires: [02-04]
  provides: [destinations-crud-module]
  affects: [02-06, 02-07, 02-08]
tech_stack:
  added: []
  patterns: [section-module-split, createElement-modal, clone-swap-listener-hygiene, in-place-array-mutation]
key_files:
  created:
    - frontend/src/pages/trip-edit/destinations.ts
  modified:
    - frontend/src/pages/trip-edit.ts
decisions:
  - "Modal DOM built entirely via createElement chains — no innerHTML at all (not even for static markup) to satisfy strict grep acceptance check and XSS invariant"
  - "confirm-overlay handlers use cloneNode(true) swap before each open to prevent accumulated event listener stacking across multiple delete actions"
  - "Trip destinations array mutated in-place from API response on create/update/delete — avoids extra GET roundtrip and preserves nested hotel/days data from future plans"
  - "lat/lng parsed via parseFloat before sending; omitted from payload if empty or NaN since ApiDestination.lat/lng are typed number"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-03"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 02 Plan 05: Destinations CRUD Module Summary

Self-contained `destinations.ts` module implementing add/edit/delete destination flow with geocoder widget (Nominatim + Google Maps URL), confirm-overlay delete, and XSS-safe DOM manipulation via createElement throughout.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create destinations.ts CRUD module | 67e0e06 | frontend/src/pages/trip-edit/destinations.ts |
| 2 | Wire initDestinationsSection into trip-edit.ts orchestrator | 701710a | frontend/src/pages/trip-edit.ts |

## Decisions Made

1. **No innerHTML anywhere**: Modal scaffold built entirely via `document.createElement` chains. Even clearing lists uses `el.replaceChildren()` not `el.innerHTML = ''`. This satisfies both the strict grep check and the Phase 1 XSS invariant.

2. **Clone-swap for confirm-overlay**: Before opening the confirm delete overlay, `#confirm-delete-btn` and `#confirm-cancel-btn` are replaced with `cloneNode(true)` copies to remove any prior listeners. This prevents accumulated handler stacking when deleting multiple destinations in sequence.

3. **In-place array mutation**: After create/update/delete API calls succeed, `currentTrip.destinations` is mutated directly from the API response. This avoids a second `getTrip()` roundtrip and preserves nested `hotel`/`days` arrays that future plans (02-06, 02-07) will populate.

4. **lat/lng type safety**: Hidden inputs hold string values; `parseFloat` converts before sending. If the field is empty, the field is omitted from the payload (not sent as `NaN`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `destForm` module-level variable**
- **Found during:** TypeScript compilation (`tsc --noEmit` error TS6133)
- **Issue:** `destForm: HTMLFormElement` was declared at module scope but never read (form events are wired inside `buildModal` closure)
- **Fix:** Removed the unused variable declaration and its assignment in `buildModal`
- **Files modified:** frontend/src/pages/trip-edit/destinations.ts
- **Commit:** Included in 67e0e06 (fixed before commit)

## Known Stubs

- `dest-section-body` renders "Hotel y días aparecerán aquí." — this is the intended placeholder for plans 02-06 (hotels) and 02-07 (days). Plan goal is achieved; stub is documented and intentional.

## Threat Flags

None — all trust boundary mitigations from the threat register implemented:
- T-02-05-01: Frontend sends known fields only; backend Zod validation handles tampering
- T-02-05-02: Backend resolveDestination() ownership check handles privilege escalation
- T-02-05-03: All API response values (city_name, country, display_name) rendered via setText/textContent — no innerHTML path exists in the file
- T-02-05-04: searchNominatim passes User-Agent header (inherited from geocoder.ts)

## Self-Check

- [x] frontend/src/pages/trip-edit/destinations.ts exists
- [x] frontend/src/pages/trip-edit.ts imports initDestinationsSection
- [x] `grep "innerHTML" destinations.ts` returns empty
- [x] File contains "Se eliminarán todos los días y actividades de este destino."
- [x] File contains "Sin resultados. Probá con otra búsqueda."
- [x] Commits 67e0e06 and 701710a exist
- [x] `npx tsc --noEmit` exits 0
- [x] Playwright smoke tests: 9 skipped (no server), 1 passed

## Self-Check: PASSED
