---
phase: 14-e2e-expansion-new-user-parity
plan: "03"
subsystem: e2e-test-infrastructure
tags: [playwright, global-setup, keycloak, storageState, new-user]
dependency_graph:
  requires: []
  provides: [".auth/new-user.json storageState", ".auth/new-user-session.json sessionStorage", "kcLoginNewUser()", "isNewUserStorageStateFresh()"]
  affects: ["tests/e2e/new-user-trip-creation.spec.ts (plan 04)"]
tech_stack:
  added: []
  patterns: ["parameterized KC login via prompt-button + PKCE flow", "freshness guard on storageState files"]
key_files:
  created: []
  modified:
    - tests/global-setup.ts
    - tests/.env.test.example
decisions:
  - "kcLogin() updated to prompt-button flow (Rule 3): committed simple version was broken under check-sso since dashboard shows #auth-login-prompt-btn rather than auto-redirecting to KC"
  - "kcLoginNewUser() mirrors kcLogin() with new_user_test credentials and separate output paths"
metrics:
  duration: "15 minutes"
  completed: "2026-06-08T23:44:35Z"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 14 Plan 03: Global Setup New User Login Summary

Extended `global-setup.ts` with a second parameterized KC login for `new_user_test` using the prompt-button PKCE flow, producing `.auth/new-user.json` + `.auth/new-user-session.json` for the new-user E2E spec (Plan 04).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add kcLoginNewUser() and freshness guard | 11b5e1d | tests/global-setup.ts |
| 2 | Add new_user_test env vars to .env.test.example | c4e2108 | tests/.env.test.example |

## What Was Built

**tests/global-setup.ts:**
- Added `NEW_USER_STORAGE_STATE_PATH` and `NEW_USER_SESSION_STORAGE_PATH` constants after existing constants (line 17-18)
- Added `isNewUserStorageStateFresh()` function mirroring existing `isStorageStateFresh()` pattern
- Added `kcLoginNewUser()` function using `E2E_NEW_USER_USERNAME` / `E2E_NEW_USER_PASSWORD`, writing to `new-user.json` / `new-user-session.json`
- Updated `globalSetup()` SKIP_REAL_AUTH block to call `kcLoginNewUser()` with freshness guard, parallel to existing testuser login

**tests/.env.test.example:**
- Appended `E2E_NEW_USER_USERNAME=new_user_test`
- Appended `E2E_NEW_USER_PASSWORD=<see SETUP.md for Terraform variable new_user_test_password>`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated kcLogin() to correct prompt-button flow**
- **Found during:** Task 1 analysis
- **Issue:** The committed `kcLogin()` called `goto(dashboard.html)` then immediately tried `getByLabel(/username|email/i)`, assuming KC would auto-redirect to the login form. Under `check-sso` (keycloak.ts:43), the dashboard does NOT auto-redirect — it stays on dashboard.html and shows `#auth-login-prompt-btn`. The KC form never appears without clicking that button first, so `getByLabel` would time out.
- **Fix:** Replaced simple 4-step login with the prompt-button flow: click `#auth-login-prompt-btn` → wait for KC URL → handle "Try Another Way" if visible → fill credentials → sign in. Applied the same fix to both `kcLogin()` (testuser) and the new `kcLoginNewUser()`.
- **Files modified:** tests/global-setup.ts
- **Commit:** 11b5e1d

## Verification

All acceptance criteria met:

```
rg "kcLoginNewUser" tests/global-setup.ts       → 2 matches (definition line 97, call site line 166)
rg "isNewUserStorageStateFresh" tests/global-setup.ts → 2 matches (definition line 43, call site line 165)
rg "new-user\.json" tests/global-setup.ts       → match (line 17 constant, line 168 console.log)
rg "new-user-session\.json" tests/global-setup.ts → match (line 18 constant, line 135 writeFileSync)
rg "E2E_NEW_USER_USERNAME" tests/global-setup.ts → match (line 123)
rg "E2E_NEW_USER_PASSWORD" tests/global-setup.ts → match (line 130)
rg "E2E_NEW_USER_USERNAME" tests/.env.test.example → match (line 13, value new_user_test)
rg "E2E_NEW_USER_PASSWORD" tests/.env.test.example → match (line 14)
rg "E2E_TEST_USERNAME" tests/.env.test.example  → match (line 1, value e2e-test@local, unchanged)
```

TypeScript is compiled by Playwright's internal transpiler (no tests/tsconfig.json exists); no separate tsc check available.

## Known Stubs

None — the output paths `.auth/new-user.json` and `.auth/new-user-session.json` are generated at runtime during real-auth test runs; they do not exist at commit time by design (gitignored).

## Threat Flags

None — this plan introduces no new network endpoints, API paths, or schema changes. The new credential env vars follow the same pattern as existing E2E env vars (gitignored `.env.test`, placeholder values in `.env.test.example`).

## Self-Check: PASSED

- [x] tests/global-setup.ts modified and committed (11b5e1d)
- [x] tests/.env.test.example modified and committed (c4e2108)
- [x] kcLoginNewUser() present with 2+ references
- [x] isNewUserStorageStateFresh() present with 2+ references
- [x] new-user.json path referenced
- [x] new-user-session.json path referenced
- [x] E2E_NEW_USER_USERNAME and E2E_NEW_USER_PASSWORD in both global-setup.ts and .env.test.example
