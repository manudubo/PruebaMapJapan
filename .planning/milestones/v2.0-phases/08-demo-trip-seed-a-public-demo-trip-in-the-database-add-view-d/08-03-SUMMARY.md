---
phase: 08-otp-passkey-campaign
plan: "03"
subsystem: frontend-tests
tags: [tdd, passkey, otp, vitest, red-tests]
dependency_graph:
  requires: []
  provides:
    - frontend/src/modules/passkeyCampaign.test.ts
    - frontend/src/modules/passkeyCampaign.ts (stub)
    - frontend/src/pages/dashboard.test.ts
    - frontend/src/pages/dashboard.ts (handleVerifyOtp stub export)
  affects:
    - frontend/vitest.config.ts
tech_stack:
  added: []
  patterns:
    - "co-located test files in src/ alongside implementation"
    - "vi.mock hoisting before named imports"
    - "Object.defineProperty for PublicKeyCredential stub in jsdom"
key_files:
  created:
    - frontend/src/modules/passkeyCampaign.test.ts
    - frontend/src/modules/passkeyCampaign.ts
    - frontend/src/pages/dashboard.test.ts
  modified:
    - frontend/src/pages/dashboard.ts
    - frontend/vitest.config.ts
decisions:
  - "Created passkeyCampaign.ts stub so tsc is satisfied; plan 08-05 replaces with real impl"
  - "Added handleVerifyOtp export stub to dashboard.ts; plan 08-07 wires real logic"
  - "Extended vitest.config.ts include to src/**/*.test.ts for co-located tests"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-05-25"
  tasks_completed: 2
  files_changed: 5
requirements_addressed:
  - PASS-04
  - PASS-07
---

# Phase 08 Plan 03: RED Test Stubs for Passkey Campaign + Dashboard UPDATE_PASSWORD Gate

TDD gate stubs for PASS-04 (passkey campaign module) and PASS-07 (dashboard UPDATE_PASSWORD after OTP verify). Tests are intentionally RED — they will turn green only when plans 08-05 and 08-07 implement the features.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write RED passkeyCampaign.test.ts | a6894ea | frontend/src/modules/passkeyCampaign.test.ts, passkeyCampaign.ts (stub), vitest.config.ts |
| 2 | Write RED dashboard.test.ts stubs for PASS-07 | b0aaed9 | frontend/src/pages/dashboard.test.ts, dashboard.ts (stub export) |

## Verification Results

```
npm run typecheck  → exit 0 (both new test files type-check cleanly)
npm run test:run   → 2 new tests failing (RED), 77 existing tests still passing
```

### passkeyCampaign.test.ts RED state
- Test 1 (no WebAuthn): PASSES (stub is correctly no-op)
- Test 2 (cookie present): PASSES (stub is correctly no-op)
- Test 3 (happy path cookie+redirect): FAILS — stub does not write cookie or call keycloak.login
1 failing test confirms RED gate is in place.

### dashboard.test.ts RED state
- Test 1 (webauthnCapable=false → UPDATE_PASSWORD): FAILS — stub does not call keycloak.login
- Test 2 (webauthnCapable=true → no UPDATE_PASSWORD): PASSES — stub is correctly no-op
1 failing test confirms RED gate is in place.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created type stubs to satisfy typecheck**
- **Found during:** Task 1
- **Issue:** Plan required `npm run typecheck` to exit 0, but importing `@/modules/passkeyCampaign` (non-existent) and `handleVerifyOtp` from dashboard.ts (not exported) would cause tsc errors.
- **Fix:** Created `passkeyCampaign.ts` with a no-op stub export; added `export async function handleVerifyOtp` no-op stub to `dashboard.ts`. Plans 08-05 and 08-07 replace/wire these stubs.
- **Files modified:** `frontend/src/modules/passkeyCampaign.ts`, `frontend/src/pages/dashboard.ts`

**2. [Rule 3 - Blocking] Extended vitest.config.ts include pattern**
- **Found during:** Task 1
- **Issue:** `vitest.config.ts` include was `tests/**/*.test.ts` only — running `npx vitest run src/modules/passkeyCampaign.test.ts` returned "No test files found".
- **Fix:** Extended include to `['tests/**/*.test.ts', 'src/**/*.test.ts']` so co-located tests in `src/` are picked up.
- **Files modified:** `frontend/vitest.config.ts`

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. Test files only.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| frontend/src/modules/passkeyCampaign.test.ts | FOUND |
| frontend/src/modules/passkeyCampaign.ts | FOUND |
| frontend/src/pages/dashboard.test.ts | FOUND |
| commit a6894ea | FOUND |
| commit b0aaed9 | FOUND |
