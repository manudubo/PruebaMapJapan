---
phase: 16-independent-spec-fixes
plan: 01
subsystem: e2e-tests
tags: [playwright, public-sharing, fixtures, cleanup]
key-files:
  modified:
    - tests/e2e/public-sharing.spec.ts
metrics:
  tasks_completed: 1
  tasks_total: 1
  commits: 1
---

# Plan 16-01 Summary: public-sharing spec rewrite

## What Was Built

Rewrote `tests/e2e/public-sharing.spec.ts` to eliminate all hardcoded UUIDs and trip IDs.

**SHARE-01** — Four hardcoded constants removed:
- `PUBLIC_SLUG = '4dd5492e-...'`
- `PRIVATE_SLUG = 'e3214d9f-...'`
- `PUBLIC_TRIP_ID = '1'`
- `expect(body.data.name).toBe('Japan 2026')` (hardcoded seed trip name)

Replaced with dynamic fixture management:
- `beforeAll` creates two trips (one public, one private) via `POST /api/trips` using a live Bearer JWT extracted through the `getToken` helper
- `afterAll` deletes both fixture trips via `DELETE /api/trips/:id`
- Module-level `let` variables (`publicTripId`, `publicSlug`, `privateSlug`, `privateTripId`) hold the runtime values

**SHARE-02** — Removed stale negative assertion:
```
expect(title).not.toBe('Cargando viaje…')
```
The Spanish placeholder was deleted in Phase 5; this assertion was testing against a string that no longer exists. Replaced with `expect(title).toBe(TEST_PUBLIC_TRIP_NAME)` — a positive assertion against the known fixture name.

All three describe blocks wrapped in a serial top-level `test.describe('Public sharing')` to enforce `beforeAll`/`afterAll` scoping.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | ff2393a | fix(16-01): rewrite public-sharing spec with self-contained beforeAll/afterAll |

## Deviations

- `BACKEND_URL` constant retained alongside `API_BASE` (cleaner to keep for `isBackendRunning()` than to derive via string manipulation)
- `privateTripId` variable added to enable cleanup of the private fixture trip in `afterAll` (plan noted this addition explicitly)

## Self-Check: PASSED

- `grep "4dd5492e\|e3214d9f\|PUBLIC_SLUG\|PRIVATE_SLUG\|PUBLIC_TRIP_ID" tests/e2e/public-sharing.spec.ts` → no matches ✓
- `grep "Cargando viaje" tests/e2e/public-sharing.spec.ts` → no matches ✓
- `grep "Japan 2026" tests/e2e/public-sharing.spec.ts` → no matches ✓
- `grep "beforeAll\|afterAll\|getToken\|publicSlug\|privateSlug\|publicTripId" tests/e2e/public-sharing.spec.ts` → all six identifiers present ✓
- `grep "TEST_PUBLIC_TRIP_NAME\|Phase16 Public Fixture Trip" tests/e2e/public-sharing.spec.ts` → match ✓
- TypeScript check (tsc --noEmit from frontend): exit 0, no errors ✓
