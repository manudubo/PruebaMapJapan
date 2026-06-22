# Phase 17: OTP + Login Helper — Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix OTP spec tests to match the actual auth-gated backend contract, extract a single shared `loginViaKcForm` helper to replace 4 independent copy-pasted KC form implementations, and add polling to `fetchLatestOtp()` to handle SMTP delivery lag.

No new product features. Pure stabilization.

</domain>

<decisions>
## Implementation Decisions

### OTP Route Contract (OTP-01, OTP-02, OTP-03)

- **D-01:** The backend is correct - `/api/auth/otp-request` and `/api/auth/otp-verify` are auth-gated via `authMiddleware` at `backend/src/routes/auth.ts:92`. The OTP feature is **step-up auth** (logged-in user confirms email ownership), not a passwordless login flow.
- **D-02:** Tests 1-3 in `otp.spec.ts` must authenticate first. The pattern: load `.auth/user.json` storageState in `test.beforeAll` to get a browser context, navigate to dashboard to get a Bearer JWT (same pattern as `public-sharing.spec.ts` Phase 16 `getToken()`), then pass `Authorization: Bearer <token>` headers in the `request` API calls.
- **D-03:** Remove the `data: { email: OTP_USERNAME }` body field from tests 1-3 - the backend derives email from `c.get('user').email` (the JWT), not the request body. Sending it is harmless but misleading.
- **D-04:** `fetchLatestOtp()` uses a polling loop: 20 attempts x 500ms delay = 10s max wait. Hardcoded - no env var. Throws with a descriptive error if inbox is still empty after 20 attempts.
- **D-05:** OTP test 4 ("UPDATE_PASSWORD gate") drives the KC browser flow using the new shared `loginViaKcForm` helper (see SESSION-02 decisions below).

### Shared KC Login Helper (SESSION-02)

- **D-06:** New file: `tests/e2e/fixtures/kc-login-helper.ts`. Exports a single function `loginViaKcForm(page: Page, username: string, password: string): Promise<void>`.
- **D-07:** The helper covers the **full login flow**: navigate to `dashboard.html` -> click `#auth-login-prompt-btn` -> wait for KC URL -> handle "Try Another Way -> Password" bypass -> fill username + password -> click sign in -> wait for redirect back to `localhost:5173`. Callers do their own post-login assertions.
- **D-08:** Canonical template is `global-setup.ts` (`kcLogin` / `kcLoginNewUser`): use `page.locator('a, button').filter({ hasText: /try another way/i })` (survives aria-hidden KC links better than `getByRole`), and explicit `waitForLoadState('networkidle')` after each form step.
- **D-09:** The 4 call sites that must use the shared helper after extraction:
  1. `tests/global-setup.ts` `kcLogin()` - primary user login
  2. `tests/global-setup.ts` `kcLoginNewUser()` - new-user login
  3. `tests/e2e/session-management.spec.ts` `loginViaBrowser()` - inline function, replace with `loginViaKcForm`
  4. `tests/e2e/otp.spec.ts` test 4 - inline form navigation, replace with `loginViaKcForm`
- **D-10:** `loginViaKcForm` returns `void`. Callers own post-login assertions (`storageState` capture in global-setup, `#new-trip-btn` visibility in session-management, `dashboard.html` URL in otp test 4).

### Claude's Discretion

- Exact selector fallbacks for the two-step KC form (username-first then password appears) - use the global-setup pattern verbatim.
- Whether to add JSDoc to `loginViaKcForm` - keep to one line if anything.
- Whether `global-setup.ts` calls `loginViaKcForm` directly or keeps its internal functions and just delegates - either is fine as long as code duplication is eliminated.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### OTP implementation
- `backend/src/routes/auth.ts` - lines 90-92 (authRoute middleware), lines 94-130 (`/otp-request` route). Read to understand auth contract and how email is derived.
- `tests/e2e/otp.spec.ts` - current spec. All 4 tests need changes.
- `tests/e2e/fixtures/mailpit-helpers.ts` - `fetchLatestOtp()` needs the polling loop added.

### Login helper
- `tests/global-setup.ts` - `kcLogin()` (lines 49-105) and `kcLoginNewUser()` (lines 107-158) are the canonical template for `loginViaKcForm`. Two independent implementations to consolidate.
- `tests/e2e/session-management.spec.ts` - `loginViaBrowser()` (lines 44-83). Third independent implementation. The outer function and all call sites must be replaced.
- `tests/e2e/fixtures/kc-admin.ts` - existing fixture file for structural reference.

### Requirements
- `.planning/REQUIREMENTS.md` - OTP-01, OTP-02, OTP-03, SESSION-02 (the 4 requirements this phase satisfies).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public-sharing.spec.ts` `getToken(page)` (Phase 16) - intercepts a `Bearer` request during dashboard navigation to extract the JWT. Same pattern for `otp.spec.ts` `test.beforeAll`.
- `tests/e2e/fixtures/kc-admin.ts` - model for new `kc-login-helper.ts` file structure (named exports, TypeScript types).

### Established Patterns
- `page.locator('a, button').filter({ hasText: /pattern/i }).first()` - preferred KC DOM navigation pattern over `getByRole` (which can miss aria-hidden KC links).
- `waitForLoadState('networkidle').catch(() => waitForLoadState('load'))` - defensive KC page wait from global-setup.
- `browser.newContext({ storageState: path.join(__dirname, '../.auth/user.json') })` - established pattern for getting an authenticated context in specs.

### Integration Points
- `tests/global-setup.ts` imports `loginViaKcForm` from `fixtures/kc-login-helper.ts`, delegates from `kcLogin` / `kcLoginNewUser`.
- `session-management.spec.ts` replaces local `loginViaBrowser` with direct import of `loginViaKcForm`.
- `otp.spec.ts` test 4 replaces inline navigation code with `loginViaKcForm`.

</code_context>

<specifics>
## Specific Ideas

- The `getToken()` helper in `public-sharing.spec.ts` (Phase 16) is the exact pattern for OTP tests 1-3 auth injection. Planner should use that as the reference.
- KC email OTP login fallback for passkey-only users is intentionally deferred. Best-practice path: configure KC-native email OTP authenticator flow in the realm (Terraform HCL). The custom `/api/auth/otp-*` routes are for step-up auth only.

</specifics>

<deferred>
## Deferred Ideas

- **KC email OTP login fallback** - Passwordless login for users who only have a passkey and are on a non-WebAuthn device. Correct implementation: configure KC realm to offer "Email OTP" as a "Try Another Way" option (KC-native flow via Terraform HCL). Deferred to a future KC config phase.

</deferred>

---

*Phase: 17-otp-login-helper*
*Context gathered: 2026-06-22*