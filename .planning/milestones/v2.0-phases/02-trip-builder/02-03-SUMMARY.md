---
phase: 02-trip-builder
plan: 03
subsystem: testing
tags: [playwright, e2e, smoke-tests, trip-edit, geocoder]

requires:
  - phase: 02-trip-builder
    provides: validation strategy and requirement IDs (TRIP-01 through TRIP-08, SHARE-01)

provides:
  - tests/e2e/trip-edit.spec.ts with 8 @smoke stubs for TRIP-01 through TRIP-06, SHARE-01, TRIP-08
  - tests/e2e/geocoder.spec.ts with 2 @smoke stubs for TRIP-07
  - Wave 0 smoke suite coverage for all Phase 2 requirements

affects: [02-trip-builder/waves-1-4, ci-pipeline]

tech-stack:
  added: []
  patterns:
    - "isFrontendRunning() helper with AbortSignal.timeout(3000) for graceful skip"
    - "page.route() for API mocking without requiring running backend"
    - "test.skip(!up, 'Frontend not running') inside test body for wave-0 stubs"
    - "TRIP-08 file-system check with test.skip(!fs.existsSync(path)) for migration stub"

key-files:
  created:
    - tests/e2e/trip-edit.spec.ts
    - tests/e2e/geocoder.spec.ts
  modified: []

key-decisions:
  - "Used test.skip() inside test body (not test.skip condition) to match existing api.spec.ts pattern"
  - "TRIP-08 tests migration SQL file existence client-side via Node fs module, no browser needed"
  - "page.route() mocks for Keycloak openid-connect and realms endpoints in TRIP-01 (dashboard requires auth)"
  - "mockTrip uses string IDs ('1') matching the expected API shape for trip-edit endpoints"

patterns-established:
  - "Wave-0 stub pattern: isFrontendRunning() + test.skip(!up) gives clean skip in CI without running frontend"
  - "page.route() with method() branching for GET/PATCH on same route pattern"

requirements-completed:
  - TRIP-01
  - TRIP-02
  - TRIP-03
  - TRIP-04
  - TRIP-05
  - TRIP-06
  - TRIP-07
  - TRIP-08
  - SHARE-01

duration: 15min
completed: 2026-05-03
---

# Phase 2 Plan 03: Wave 0 E2E Smoke Stubs Summary

**10 @smoke Playwright test stubs covering TRIP-01 through TRIP-08 and SHARE-01, skipping gracefully when frontend is not running**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-03T16:38:00Z
- **Completed:** 2026-05-03T16:53:35Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- Created `tests/e2e/trip-edit.spec.ts` with 8 @smoke stubs: TRIP-01 (dashboard nav), TRIP-02 (metadata form), TRIP-03 (destination CRUD), TRIP-04 (hotel CRUD), TRIP-05 (day CRUD + color picker), TRIP-06 (activity CRUD + reorder), SHARE-01 (public toggle), TRIP-08 (migration SQL check)
- Created `tests/e2e/geocoder.spec.ts` with 2 @smoke stubs: TRIP-07 Nominatim mock and TRIP-07 Google Maps URL parsing
- All stubs use `isFrontendRunning()` + `test.skip(!up)` pattern for clean CI skips without a running frontend

## Task Commits

1. **Task 1: trip-edit.spec.ts** - `e235dc9` (test)
2. **Task 2: geocoder.spec.ts** - `e8afd48` (test)

## Files Created/Modified

- `tests/e2e/trip-edit.spec.ts` - 8 @smoke stubs for TRIP-01 through TRIP-06, SHARE-01, TRIP-08
- `tests/e2e/geocoder.spec.ts` - 2 @smoke stubs for TRIP-07 (Nominatim + Google Maps URL)

## Decisions Made

- Used string IDs (`'1'`) in mockTrip to match expected API shape for trip-edit endpoints (existing mockTrip.ts uses numeric IDs but the plan specified strings)
- TRIP-08 stub performs a file-system check via Node `fs` module (`__dirname` works — `tests/package.json` has no `"type": "module"`)
- Keycloak route mocks added to TRIP-01 because dashboard.html will trigger auth provider calls

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Bash execution was denied for the `npx playwright test --grep "@smoke" --project=chromium` verification step. The test files are structurally identical to the plan's code blocks and match the existing `api.spec.ts` skip pattern. Verification must be run manually or by the orchestrator:

```
cd tests && npx playwright test --grep "@smoke" --project=chromium
```

Expected result: 10 tests, all skipped (frontend not running), exit 0.

## User Setup Required

None - no external service configuration required.

## Known Stubs

All tests in both files are intentional stubs with `expect(true).toBe(true)` bodies. These stubs are Wave 0 scaffolding — assertions will be implemented in Waves 1-4 as the frontend pages are built.

## Next Phase Readiness

- Wave 0 smoke suite scaffolding complete
- Ready for Wave 1: backend schema + API route stubs (plans 04-06)
- Smoke suite should be run after each task commit per VALIDATION.md sampling rate requirements

---
*Phase: 02-trip-builder*
*Completed: 2026-05-03*
