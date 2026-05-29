---
phase: 08-otp-passkey-campaign
plan: "02"
subsystem: backend/auth
tags: [tdd, otp, auth, vitest, typescript]
dependency_graph:
  requires: []
  provides: [PASS-05-red-tests]
  affects: [backend/src/routes/auth.ts]
tech_stack:
  added: []
  patterns: [TDD RED gate, Hono app.request in-process testing]
key_files:
  created:
    - backend/src/routes/auth.test.ts
  modified:
    - backend/src/types/index.ts
    - backend/src/index.test.ts
    - backend/src/routes/public.test.ts
decisions:
  - "Mirrored OTP_SECRET + RESEND_API_KEY in Env from parallel wave 08-01 to unblock typecheck"
metrics:
  duration: ~8min
  completed: 2026-05-25
---

# Phase 08 Plan 02: RED Auth Test Stubs Summary

TDD RED gate — 4 failing tests for `/api/auth/otp-request` and `/api/auth/otp-verify` that return 404 until Wave 2 mounts the auth route in plan 08-04.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Write RED auth.test.ts | 781faea | backend/src/routes/auth.test.ts, backend/src/types/index.ts, backend/src/index.test.ts, backend/src/routes/public.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added OTP_SECRET and RESEND_API_KEY to Env interface**
- **Found during:** Task 1
- **Issue:** `Env` interface in `backend/src/types/index.ts` lacked `OTP_SECRET` (plan 08-01 adds it in parallel wave 1). The new test file uses `OTP_SECRET` in `mockEnv: Env`, so typecheck failed. Existing test files `index.test.ts` and `public.test.ts` also broke because their `mockEnv` objects became incomplete against the updated `Env` type.
- **Fix:** Added `OTP_SECRET: string` and `RESEND_API_KEY?: string` to `Env` (identical to 08-01's planned addition — merge is idempotent). Updated `mockEnv` in both pre-existing test files.
- **Files modified:** backend/src/types/index.ts, backend/src/index.test.ts, backend/src/routes/public.test.ts
- **Commit:** 781faea

## Verification Results

```
npm run typecheck  → exit 0
npx vitest run src/routes/auth.test.ts → 4 FAILED (expected RED: 404 vs 401)
```

## TDD Gate Compliance

RED gate commit: 781faea (`test(08-02): add RED auth test stubs for OTP endpoints`)
GREEN gate: deferred to plan 08-04 (auth route mounting)

## Known Stubs

None — this plan is a test-only RED gate. No implementation stubs.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced in this plan. The test file exercises the existing middleware trust boundary (T-08-03 in plan threat model).

## Self-Check: PASSED

- backend/src/routes/auth.test.ts: FOUND
- backend/src/types/index.ts: modified with OTP_SECRET
- Commit 781faea: FOUND
