---
phase: "20"
plan: "00"
subsystem: testing
tags: [security, testing, red-phase, vitest, otp, xss]
dependency_graph:
  requires: []
  provides:
    - backend/tests/otp-csprng.test.ts
    - frontend/tests/widgets-xss.test.ts
  affects:
    - backend CI test suite (exits non-zero until Plan 20-01)
    - frontend CI test suite (exits non-zero until Plan 20-02)
tech_stack:
  added: []
  patterns:
    - vi.stubGlobal for Web Crypto API mocking (backend)
    - source-audit test (reads .ts source, asserts absent pattern)
    - jsdom DOM assertion pattern (frontend)
key_files:
  created:
    - backend/tests/otp-csprng.test.ts
    - frontend/tests/widgets-xss.test.ts
  modified: []
decisions:
  - Source-audit test approach chosen for backend RED: reads auth.ts and asserts Math.random absent — fails in RED, passes after 20-01 fix
  - Frontend RED achieved via missing export: renderList not exported causes TypeError on all 4 tests
metrics:
  duration: "~7 minutes"
  completed: "2026-07-24T23:45:59Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 20 Plan 00: RED Test Infrastructure Summary

**One-liner:** Source-audit test for OTP CSPRNG + XSS DOM injection tests, both in RED state before fixes land.

## What Was Built

Two test files establishing RED state for the Phase 20 security fixes:

**`backend/tests/otp-csprng.test.ts`** — 4 tests:
- Source-audit RED test: reads `auth.ts` source and asserts `Math.random` is absent. Fails now (Math.random at line 123). Passes after Plan 20-01.
- Three formula spec tests verifying the `crypto.getRandomValues % 1_000_000` replacement math (these pass now and stay green).

**`frontend/tests/widgets-xss.test.ts`** — 4 tests:
- All 4 fail with `TypeError: renderList is not a function` because `renderList` is not exported from `widgets.ts`.
- After Plan 20-02 adds `export` and rewrites with DOM API, these tests turn green (asserting no `<img>`/`<script>` injection, raw text visible in textContent).

## Verification (RED State Confirmed)

- `cd backend && npm run test`: 1 failed (source-audit), 33 passed. Exit non-zero. ✓
- `cd frontend && npm run test:run`: 4 failed (widgets-xss, all TypeError), 97 passed. Exit non-zero. ✓
- Both test files referenced by name in failure output. ✓

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Backend RED + spec tests for OTP CSPRNG | 13e9a4d | backend/tests/otp-csprng.test.ts |
| 2 | Frontend RED tests for widget XSS | f10cc43 | frontend/tests/widgets-xss.test.ts |

## Deviations from Plan

None — plan executed exactly as written. Test content copied verbatim per plan spec.

## Known Stubs

None — these are test files with no data stubs.

## Threat Flags

None — test files are excluded from production builds per T-20-00-01 (accepted disposition).

## Self-Check: PASSED

- `backend/tests/otp-csprng.test.ts`: EXISTS ✓
- `frontend/tests/widgets-xss.test.ts`: EXISTS ✓
- Commit 13e9a4d: EXISTS ✓
- Commit f10cc43: EXISTS ✓
- Backend suite exits non-zero: CONFIRMED ✓
- Frontend suite exits non-zero with widgets-xss in output: CONFIRMED ✓
