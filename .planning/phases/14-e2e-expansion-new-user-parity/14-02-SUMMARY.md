---
phase: 14-e2e-expansion-new-user-parity
plan: "02"
subsystem: tests/e2e
tags: [playwright, auth, ropc-removal, storageState]
dependency_graph:
  requires: []
  provides: [ROPC-free trip-edit-integration spec]
  affects: [tests/e2e/trip-edit-integration.spec.ts]
tech_stack:
  added: []
  patterns: [Authorization-header token capture via waitForRequest, sessionStorage replay via addInitScript]
key_files:
  created: []
  modified:
    - tests/e2e/trip-edit-integration.spec.ts
decisions:
  - "Use waitForRequest Authorization-header capture for token extraction (not kc.token evaluate — kc is not a window global)"
  - "serial mode required: tests share mutable server state (trip create/delete); parallel execution would race"
metrics:
  duration: ~8 minutes
  completed: "2026-06-08T23:42:23Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
  files_created: 0
---

# Phase 14 Plan 02: ROPC Removal from trip-edit-integration Summary

ROPC (`grant_type: password`) eliminated from `trip-edit-integration.spec.ts`; all 5 tests now use storageState + sessionStorage replay + Authorization-header token capture.

## What Was Built

Modified `tests/e2e/trip-edit-integration.spec.ts` to remove the prohibited ROPC auth grant and replace it with the established storageState pattern used by other specs in the suite.

**Changes made:**
- Deleted `loginAndGetToken()` function (lines 22–66 including JSDoc) which made a direct `grant_type: password` call to Keycloak
- Added `import * as fs` and `import * as path` for session.json reading
- Added `test.describe.configure({ mode: 'serial' })` — required because tests create/delete shared server resources
- Added `sessionEntries` IIFE that reads `.auth/session.json` for keycloak-js sessionStorage replay
- Added `test.beforeEach` with `context.addInitScript` to restore sessionStorage before any navigation (Playwright bug #31108 workaround — keycloak-js reads sessionStorage at page load time)
- Replaced all 5 `loginAndGetToken(page)` call sites with `waitForRequest` Authorization-header capture pattern
- `createTrip(page, token)` function signature and body unchanged

## Acceptance Criteria Verified

- `rg "grant_type" tests/e2e/trip-edit-integration.spec.ts` → no match (PASS)
- `rg "loginAndGetToken" tests/e2e/trip-edit-integration.spec.ts` → no match (PASS)
- `rg "mode.*serial" tests/e2e/trip-edit-integration.spec.ts` → match (PASS)
- `rg "addInitScript" tests/e2e/trip-edit-integration.spec.ts` → match (PASS)
- `rg -c "waitForRequest" tests/e2e/trip-edit-integration.spec.ts` → 5 (PASS)
- `rg "session\.json" tests/e2e/trip-edit-integration.spec.ts` → match (PASS)
- `rg "createTrip" tests/e2e/trip-edit-integration.spec.ts` → function + 5 call sites (PASS)
- TypeScript: no tsconfig.json in tests/ — Playwright manages its own transpilation; pre-existing `data: unknown` patterns unchanged from original file

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | f0e9533 | refactor(14-02): remove ROPC from trip-edit-integration spec |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The spec is test infrastructure only; no UI data rendering.

## Runtime Precondition

Each test's `waitForRequest` waits for the dashboard to make an authenticated API call. If `.auth/user.json` storageState is stale or missing, keycloak-js will redirect to the KC login page (no authenticated API call) and the `waitForRequest` will time out. This is inherent to the storageState approach — the global setup (`global-setup.ts`) must run before these tests to generate valid storageState.

## Self-Check: PASSED

- FOUND: tests/e2e/trip-edit-integration.spec.ts
- FOUND: .planning/phases/14-e2e-expansion-new-user-parity/14-02-SUMMARY.md
- FOUND commit: f0e9533
