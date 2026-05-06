---
phase: 03-public-sharing
plan: "01"
subsystem: backend/tests
tags: [tdd, red, public-route, slug]
dependency_graph:
  requires: []
  provides: [slug-based-public-route-tests]
  affects: [backend/src/routes/public.ts]
tech_stack:
  added: []
  patterns: [vitest in-process app.request testing]
key_files:
  created:
    - backend/src/routes/public.test.ts
  modified: []
decisions:
  - All 4 tests are RED (not just 3-4): Number(uuid) = NaN -> 400 for any UUID slug input, so tests 1 and 2 also fail today
metrics:
  duration: "< 5 minutes"
  completed: "2026-05-06"
  tasks_completed: 1
  tasks_planned: 1
requirements: [SHARE-02, SHARE-04]
---

# Phase 03 Plan 01: Slug-based Public Trip Route — TDD RED Summary

**One-liner:** 4 failing Vitest tests asserting slug-based UUID route behavior against the current integer-based public.ts route.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write RED tests for slug-based public route | ff4facd | backend/src/routes/public.test.ts |

## What Was Built

Created `backend/src/routes/public.test.ts` with a `describe` block covering 4 tests for the future `GET /api/public/trips/:slug` endpoint:

1. **Valid UUID + public trip** — expects [200, 500]; fails RED today (gets 400)
2. **Valid UUID + private trip** — expects [404, 500]; fails RED today (gets 400)
3. **Invalid UUID format** — expects 400 with `error: 'Invalid slug'`; fails RED (gets 'Invalid trip id')
4. **Valid UUID + no matching trip** — expects [404, 500]; fails RED today (gets 400)

## RED State Confirmation

All 4 tests fail. Root cause: current `public.ts` uses `Number(param)` / `isNaN()` validation. Any UUID string is NaN, returning 400 "Invalid trip id" before any DB access. This means:

- Tests 1, 2, 4: fail because 400 is not in [200,500] / [404,500]
- Test 3: fails because error message is "Invalid trip id" not "Invalid slug"

The success criteria requires at minimum Tests 3 and 4 RED — all 4 being RED satisfies and exceeds that bar.

## Deviations from Plan

### Auto-observed (not a fix needed)

**All 4 tests are RED (plan predicted 1-2 passing):** The plan predicted Tests 1 and 2 would pass at [200,500] / [404,500] today because "without a real DB, the route returns 500". However, the validation guard runs before DB access, returning 400 for all UUID slugs. This is expected behavior given the current integer-based route — no fix needed. 03-02 will make all 4 GREEN.

## Threat Flags

None — test file only, no production code or network surfaces introduced.

## Known Stubs

None — no UI components or data rendering involved.

## Self-Check: PASSED

- `backend/src/routes/public.test.ts` exists: FOUND
- Commit ff4facd exists: FOUND
- `npm test` shows 4 failures in public.test.ts: CONFIRMED
