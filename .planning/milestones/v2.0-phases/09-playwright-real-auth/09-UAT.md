---
status: complete
phase: 09-playwright-real-auth
source:
  - 09-01-SUMMARY.md
  - 09-02-SUMMARY.md
  - 09-03-SUMMARY.md
  - 09-04-SUMMARY.md
  - 09-05-SUMMARY.md
  - 09-06-SUMMARY.md
  - 09-07-SUMMARY.md
started: 2026-05-28T00:00:00.000Z
updated: 2026-05-28T00:00:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Test suite lists 82 tests in SKIP_REAL_AUTH mode
expected: Run `cd tests && SKIP_REAL_AUTH=true npx playwright test --project=chromium --list` → ends with "Total: 82 tests in 16 files" with no errors.
result: pass

### 2. CI workflow has SKIP_REAL_AUTH guard
expected: `.github/workflows/ci.yml` "Run E2E tests" step has `env: SKIP_REAL_AUTH: 'true'`.
result: pass

### 3. auth.spec.ts real-auth tests gated
expected: `test.describe('Auth flow — real session')` with `test.skip(!!process.env.SKIP_REAL_AUTH)` inside.
result: pass

### 4. globalSetup has OIDC login block
expected: `global-setup.ts` has `kcLogin()`, `isStorageStateFresh()`, `SKIP_REAL_AUTH` guard, `dotenv.config`, `Object.entries(sessionStorage)`.
result: pass

### 5. kc-admin.ts exports all 6 operations
expected: `createUser`, `deleteUser`, `resetCredentials`, `clearOtpCodes`, `expireOtpCodes`, `test` all exported; `clearOtpCodes` and `expireOtpCodes` both use try/finally.
result: pass

### 6. KC test users exist in Terraform config
expected: `terraform/keycloak/main.tf` has `keycloak_user` resources for `e2e-test@local` and `otp-test@local`, both with `email_verified = true`.
result: pass

### 7. passkeys.spec.ts uses correct CDP param spelling
expected: All `addVirtualAuthenticator` calls use `hasUserVerification` (not `haUserVerification`) in actual code.
result: pass

### 8. otp.spec.ts uses serial mode and OTP_USERNAME
expected: `test.describe.configure({ mode: 'serial' })` at module level; `E2E_OTP_USERNAME` env var used; storageState overridden with `{ cookies: [], origins: [] }`.
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
