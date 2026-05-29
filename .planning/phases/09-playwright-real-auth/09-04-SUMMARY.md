---
phase: 09-playwright-real-auth
plan: 04
status: complete
completed: 2026-05-28
---

# Plan 09-04 Summary — KC Admin Fixture (kc-admin.ts)

## What was done

Created `tests/e2e/fixtures/kc-admin.ts` with all 6 operations for per-test state reset:

- `createUser(username, password, email?)` — KC Admin API, creates enabled user with emailVerified=true
- `deleteUser(username)` — idempotent delete; no-op if user not found
- `resetCredentials(username)` — deletes webauthn-passwordless + webauthn credentials; leaves password intact
- `clearOtpCodes(username)` — DELETE FROM email_otp_codes via postgres client with try/finally cleanup
- `expireOtpCodes(username)` — UPDATE SET expires_at = NOW() - INTERVAL '1 minute' WHERE used_at IS NULL
- Playwright fixture `test` exported — tests import `{ test, expect }` from this file to use `kcAdmin` fixture

## Verification

All must_haves satisfied:
- All 6 functions exported ✓
- `client_credentials` grant in buildAdminClient() ✓
- `email_otp_codes` table targeted in clearOtpCodes/expireOtpCodes ✓
- `sql.end()` in finally block (both DB functions) ✓
- `export const test` Playwright fixture ✓
- No default export ✓

## Decisions / notes

- Agent worktree for Plan 04 was not found (session limit during spawn); work done directly in main working tree
- `buildAdminClient()` is internal (not exported) — each function creates a fresh client to avoid token expiry during long runs
- `deleteUser()` idempotent by design — safe for teardown afterAll patterns
- `expireOtpCodes()` uses `AND used_at IS NULL` to preserve already-consumed codes in audit log
