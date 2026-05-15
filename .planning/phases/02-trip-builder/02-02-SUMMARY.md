---
phase: 02-trip-builder
plan: 02
subsystem: api
tags: [typescript, api-client, fetch, types]

requires:
  - phase: 02-trip-builder
    provides: existing API client pattern with request() helper and base types

provides:
  - updateDay, deleteDay functions for Day CRUD
  - getHotel, upsertHotel, deleteHotel functions for Hotel CRUD
  - reorderActivities function (POST) for drag-and-drop ordering
  - ApiHotel.url field (string | null)
  - ApiActivity.time field (string | null)

affects:
  - 02-trip-builder wave 1+ plans that call hotel/day/activity endpoints

tech-stack:
  added: []
  patterns:
    - "All new client functions follow request<T>() pattern with auth: true"
    - "Hotel endpoints use PUT for upsert (idempotent create-or-replace)"
    - "reorderActivities uses POST per backend route definition"

key-files:
  created: []
  modified:
    - frontend/src/api/client.ts
    - frontend/src/types/index.ts

key-decisions:
  - "reorderActivities uses POST not PATCH — matches backend tripsRoute.post('.../reorder')"
  - "upsertHotel uses PUT for idempotent create-or-replace semantics"
  - "ApiHotel import added to client.ts to type hotel endpoint return values"

patterns-established:
  - "Hotel endpoints section placed between Day and Activity sections in client.ts"

requirements-completed: [TRIP-03, TRIP-04, TRIP-05, TRIP-06]

duration: 8min
completed: 2026-05-03
---

# Phase 02 Plan 02: API Client Extensions Summary

**6 missing API client functions added (updateDay, deleteDay, getHotel, upsertHotel, deleteHotel, reorderActivities) and ApiHotel/ApiActivity types extended with url and time fields**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-03T16:43:00Z
- **Completed:** 2026-05-03T16:51:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended ApiHotel with `url: string | null` and ApiActivity with `time: string | null`
- Added updateDay and deleteDay to the Day endpoints section
- Added Hotel endpoints section with getHotel (GET), upsertHotel (PUT), deleteHotel (DELETE)
- Added reorderActivities using POST with `{ ordered_ids: number[] }` body per backend contract

## Task Commits

1. **Task 1: Extend ApiHotel and ApiActivity types** - `8167e51` (feat)
2. **Task 2: Add 6 missing functions to client.ts** - `8abca56` (feat)

## Files Created/Modified
- `frontend/src/types/index.ts` - Added `url: string | null` to ApiHotel, `time: string | null` to ApiActivity
- `frontend/src/api/client.ts` - Added ApiHotel import + 6 new exported async functions

## Decisions Made
- reorderActivities uses `method: 'POST'` to match backend `tripsRoute.post('.../reorder')` definition
- upsertHotel uses `method: 'PUT'` for idempotent create-or-replace semantics
- All 6 new functions use `auth: true` per threat model T-02-02-01

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 functions available for Wave 1+ plans that implement hotel, day, and activity UI
- TypeScript compiles clean with 0 errors after all changes
- reorderActivities POST method confirmed matching backend route contract

---
*Phase: 02-trip-builder*
*Completed: 2026-05-03*

## Self-Check: PASSED

- `frontend/src/types/index.ts` - FOUND, contains `url: string | null` and `time: string | null`
- `frontend/src/api/client.ts` - FOUND, exports all 6 functions
- Commit `8167e51` - FOUND (Task 1)
- Commit `8abca56` - FOUND (Task 2)
- `cd frontend && npx tsc --noEmit` - exits 0
