---
phase: 17-otp-login-helper
verified: 2026-06-23T10:00:00Z
status: gaps_found
score: 6/7 must-haves verified
overrides_applied: 0
gaps:
  - truth: "otp.spec.ts tests 1-3 satisfy the auth-gated route contract — no structural mismatch between spec and backend"
    status: partial
    reason: "Test 2's error assertion `expect(errText).toMatch(/expir/)` will not match the backend response. When kcAdmin.expireOtpCodes() expires the OTP, `getLatestUnexpiredOtp()` returns null (auth.ts:151-153), so the backend returns `{ error: 'otp_not_found' }` with status 400. The string 'otp_not_found' does not contain 'expir'. Tests 1 and 3 are structurally correct."
    artifacts:
      - path: "tests/e2e/otp.spec.ts"
        issue: "Line 81: `expect(errText).toMatch(/expir/)` — backend returns { error: 'otp_not_found' } on the expired-code path (auth.ts:153), which does not match /expir/"
      - path: "backend/src/routes/auth.ts"
        issue: "Line 153: `{ error: 'otp_not_found' }` is returned when no unexpired OTP exists — regardless of whether the OTP was expired or never requested"
    missing:
      - "Update otp.spec.ts line 81 to match the actual backend error: either `expect(errText).toMatch(/otp_not_found/)` OR fix the backend to return a distinct 'otp_expired' error string when an expired OTP is submitted"
human_verification:
  - test: "Run otp.spec.ts and session-management.spec.ts against the full live stack after fixing test 2 assertion"
    expected: "All 4 OTP tests pass; session lifecycle tests pass — KC selector flow through 'Try Another Way' branch works against live KC 26"
    why_human: "Runtime reliability of loginViaKcForm selectors against live KC 26 cannot be verified statically"
---

# Phase 17: OTP + Login Helper Verification Report

**Phase Goal:** OTP specs pass against the actual route contract, and a single shared KC form-navigation helper replaces the four independent implementations so a KC flow change requires one fix
**Verified:** 2026-06-23T10:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `fetchLatestOtp()` uses a polling loop so SMTP delivery lag does not produce false failures | VERIFIED | `mailpit-helpers.ts` L20-34: `MAX_ATTEMPTS=20`, `DELAY_MS=500`, loop retries on empty inbox, throws descriptive error after 20x500ms |
| 2 | `otp.spec.ts` tests 1-3 satisfy the auth-gated route contract — no structural mismatch between spec and backend | PARTIAL | Tests 1 and 3 match backend. Test 2 assertion `expect(errText).toMatch(/expir/)` does not — backend returns `{ error: 'otp_not_found' }` (auth.ts:153) when no unexpired OTP exists, which does not contain 'expir'. See gap below. |
| 3 | `otp.spec.ts` test 4 drives the KC browser flow using the shared helper and preserves `#kc-passwd-update-form` not-visible assertion | VERIFIED | Lines 109-116: `loginViaKcForm` call + `waitForURL(/dashboard\.html/)` + `updatePasswordForm` `not.toBeVisible` assertion all present and wired |
| 4 | A single `loginViaKcForm(page, username, password)` fixture exists and is exported | VERIFIED | `tests/e2e/fixtures/kc-login-helper.ts` exports `loginViaKcForm`, uses `locator('a, button').filter()` for KC nav (not `getByRole`), ends at `waitForURL(/localhost:5173/)` |
| 5 | `loginViaKcForm` is used at all four former call sites — `global-setup.ts` x2, `session-management.spec.ts`, `otp.spec.ts` | VERIFIED | `global-setup.ts` lines 56+79; `session-management.spec.ts` 7 call sites (lines 54, 66, 93, 123, 143, 165, 187); `otp.spec.ts` lines 36+109 |
| 6 | `loginViaBrowser` is fully deleted — no duplicate KC nav implementations remain | VERIFIED | No matches for `loginViaBrowser` across all test files; `kc-login-helper.ts` is the sole KC form nav implementation |
| 7 | Backend contract verified: otp-request returns 201, otp-verify returns 200 on success, email derived from JWT, both routes auth-gated | VERIFIED | auth.ts:92 — `authRoute.use('*', authMiddleware, ensureUserProvisioned)`; auth.ts:131 — `return c.json(response, 201)`; auth.ts:148 — `const { code } = c.req.valid('json')` (email from `c.get('user').email` at line 102); auth.ts:175 — `return c.json(response, 200)` |

**Score:** 6/7 truths verified (Truth 2 is partial — test 2 assertion mismatches backend)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/e2e/fixtures/kc-login-helper.ts` | Shared KC form login helper exporting `loginViaKcForm` | VERIFIED | 41 lines, substantive KC nav implementation, exported and imported by 3 consumers |
| `tests/e2e/fixtures/mailpit-helpers.ts` | Polling `fetchLatestOtp` with MAX_ATTEMPTS=20 | VERIFIED | Polling loop present, `MAX_ATTEMPTS=20`, `DELAY_MS=500`, descriptive timeout error |
| `tests/e2e/otp.spec.ts` | Fixed OTP spec — auth-gated, 201 status, code-only bodies, test 4 helper | STUB (test 2) | Tests 1/3/4 structurally correct; test 2 has mismatched error assertion at line 81 |
| `tests/global-setup.ts` | `kcLogin`/`kcLoginNewUser` delegate to `loginViaKcForm` | VERIFIED | Both functions delegate at lines 56, 79; post-login `storageState` and `browser.close()` preserved in both |
| `tests/e2e/session-management.spec.ts` | `loginViaBrowser` deleted; all sites use `loginViaKcForm` | VERIFIED | 7 `loginViaKcForm` call sites; `#new-trip-btn` assertion at each; `loginViaBrowser` absent |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/e2e/otp.spec.ts` | `tests/e2e/fixtures/kc-login-helper.ts` | `import { loginViaKcForm } from './fixtures/kc-login-helper'` | WIRED | Line 3; used at lines 36 and 109 |
| `tests/global-setup.ts` | `tests/e2e/fixtures/kc-login-helper.ts` | `import { loginViaKcForm } from './e2e/fixtures/kc-login-helper'` | WIRED | Line 5; used at lines 56 and 79 |
| `tests/e2e/session-management.spec.ts` | `tests/e2e/fixtures/kc-login-helper.ts` | `import { loginViaKcForm } from './fixtures/kc-login-helper'` | WIRED | Line 22; used at 7 call sites |
| `otp.spec.ts` tests 1-3 | `/api/auth/otp-request` + `/api/auth/otp-verify` | `Authorization: Bearer ${otpToken}` header | WIRED | 6 request calls all carry Bearer header; `otpToken` sourced from `beforeAll` via `loginViaKcForm` + `getToken` |

### Data-Flow Trace (Level 4)

Not applicable — all artifacts are E2E test files, not data-rendering components.

### Behavioral Spot-Checks

Step 7b: SKIPPED — E2E specs require a live Playwright stack (KC + backend + frontend).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| OTP-01 | 17-01-PLAN.md | `fetchLatestOtp()` uses polling loop with timeout | SATISFIED | `mailpit-helpers.ts` L20-34: 20x500ms loop |
| OTP-02 | 17-01-PLAN.md | Tests 1-3 inject Bearer JWT matching auth-gated route contract | PARTIAL | Bearer headers and 201/200 statuses correct; test 2 error assertion mismatches backend (see gap) |
| OTP-03 | 17-01-PLAN.md | Test 4 uses stable selectors and passes reliably | SATISFIED (structure) | Helper call wired; selectors match plan spec; runtime KC flow correctness needs live run |
| SESSION-02 | 17-01 + 17-02-PLAN.md | Single `loginViaKcForm` fixture at all 4 call sites — zero duplicate KC nav implementations | SATISFIED | 4 import sites confirmed; `loginViaBrowser` fully deleted; helper is sole KC nav implementation |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/e2e/otp.spec.ts` | 81 | `expect(errText).toMatch(/expir/)` — backend returns `otp_not_found`, not an expiry string | Blocker | Test 2 will fail against the real backend; phase goal "OTP specs pass" is not met |

### Human Verification Required

#### 1. Live stack E2E run after fixing test 2 assertion

**Test:** Run `npx playwright test tests/e2e/otp.spec.ts tests/e2e/session-management.spec.ts --project=chromium` against the full live stack (KC + backend + frontend)
**Expected:** All 4 OTP tests pass; all session lifecycle tests pass — KC selector flow through "Try Another Way" branch works against live KC 26
**Why human:** Runtime reliability of `loginViaKcForm` selectors against live KC 26 cannot be verified statically. Test 4's WebAuthn / UPDATE_PASSWORD gate behavior also requires a real browser with real KC response.

### Gaps Summary

One structural gap identified by reading `backend/src/routes/auth.ts` directly:

Test 2 ("expired OTP is rejected") asserts `expect(errText).toMatch(/expir/)`. When `kcAdmin.expireOtpCodes()` expires the OTP, `getLatestUnexpiredOtp()` (auth.ts:151) returns `null` — because the OTP is now expired. The backend then returns `{ error: 'otp_not_found' }` with status 400 (auth.ts:153-154). The string `otp_not_found` does not match `/expir/`, so this test will fail against the real backend.

**Fix options:**
1. Update the assertion: `expect(errText).toMatch(/otp_not_found/)` — aligns with actual backend behavior
2. Update the backend: return a distinct error like `{ error: 'otp_expired' }` when an OTP record exists but is expired — this requires changing `getLatestUnexpiredOtp` to also return expired records so the verify route can distinguish "never existed" from "expired"

The overall SESSION-02 goal (single helper, no duplicates) is fully achieved. The OTP-02/OTP-03 contract goals are partially achieved — 3 of 4 tests match the backend, but test 2's error-body assertion is wrong.

---

_Verified: 2026-06-23T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
