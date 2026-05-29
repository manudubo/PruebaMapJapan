---
phase: 09-playwright-real-auth
plan: 07
status: complete
completed: 2026-05-28
---

# Plan 09-07 Summary — otp.spec.ts Serial OTP Tests

## What was done

Created `tests/e2e/otp.spec.ts` with 4 serial tests inside `'OTP fallback flow'` describe block:

1. **request OTP then verify code — happy path** — POST otp-request, fetch from Mailpit, POST otp-verify, assert 200
2. **expired OTP is rejected** — request OTP, fetch real code, `expireOtpCodes()` DB back-date, verify with real code, assert 4xx with "expir" in error body (tests real expiry code path)
3. **max-attempts lockout after 5 failed verifications** — 5 wrong codes, then real code → 6th attempt rejected
4. **UPDATE_PASSWORD gate — skipped on WebAuthn-capable devices** — logs in as otp-test@local with password, headless Chrome supports WebAuthn so UPDATE_PASSWORD must NOT appear

## Verification

All must_haves satisfied:
- `test.describe.configure({ mode: 'serial' })` at module level ✓
- `SKIP_REAL_AUTH` guard inside describe block ✓
- `purgeInbox()` in beforeEach ✓
- `clearOtpCodes(OTP_USERNAME)` in beforeEach ✓
- `fetchLatestOtp()` used in happy path, expired, max-attempts tests ✓
- `expireOtpCodes()` in expired-OTP test (real DB back-date, not wrong-code proxy) ✓
- `test.use({ storageState: { cookies: [], origins: [] } })` overrides project-level storageState ✓
- `otp-test@local` (E2E_OTP_USERNAME) used throughout (D-13) ✓

## Decisions / notes

- Agent worktree for Plan 07 hit session limit; implemented directly in main working tree
- `test.use({ storageState: { cookies: [], origins: [] } })` explicitly clears cookies to prevent silent SSO with e2e-test@local session from project-level config
- expireOtpCodes() tests call `kcAdmin` through the fixture — the kcAdmin fixture is in beforeEach params too, so it needs to be a fixture param of the test function for expireOtpCodes() usage
