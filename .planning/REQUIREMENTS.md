# Requirements: v3.1 E2E Stabilization

**Milestone goal:** Get the full Playwright E2E suite green. Pure stabilization — no new product features.

---

## Suite Setup & Config

- [ ] **SETUP-01**: A fresh full-suite E2E triage run with `trace: 'retain-on-failure'` and `retries: 1` produces an authoritative, current failure list against `main`
- [ ] **SETUP-02**: `passkeys.spec.ts` is scoped to Chromium-only projects in `playwright.config.ts` (`testIgnore` on `chromium`, `firefox`, `webkit` projects) so CDP-only tests do not spuriously fail on non-Chromium runners

## Passkeys

- [ ] **PASS-01**: `WebAuthn.removeVirtualAuthenticator` is called in `test.afterEach` (not in the test body) so a mid-test failure does not leave a stale authenticator for subsequent tests
- [ ] **PASS-02**: `kcAdmin.resetCredentials` clears `webauthn-register-passwordless` required actions in addition to credential records, so the passkey campaign flow cannot hijack the next test
- [ ] **PASS-03**: `passkeys.spec.ts` passes reliably under the `chromium-passkeys` project after the above fixes (no unexplained residual failure)

## OTP

- [ ] **OTP-01**: `fetchLatestOtp()` uses a polling loop with a timeout (not a single-shot GET) so SMTP delivery lag between `otp-request` 200 and Mailpit message delivery does not cause false failures
- [ ] **OTP-02**: `otp.spec.ts` tests 1–3 drive browser-based login first and inject a Bearer JWT into `request` calls, matching the auth-gated route contract (`backend/src/routes/auth.ts:92`)
- [ ] **OTP-03**: `otp.spec.ts` test 4 (OTP via KC form) uses stable selectors for the current KC browser-flow shape and passes reliably

## Public Sharing

- [ ] **SHARE-01**: `public-sharing.spec.ts` has a deterministic data fixture (seed extension or `beforeAll`) that creates the required public and private trips — no hardcoded UUIDs or IDs that depend on pre-existing runtime state
- [ ] **SHARE-02**: The stale negative assertion against `'Cargando viaje…'` (Spanish loading placeholder removed in Phase 5) is replaced with a locale-correct positive assertion or removed

## IDP Theme

- [ ] **THEME-01**: `idp-theme.spec.ts` runs with an empty `storageState` so no inherited KC SSO session prevents the login page from rendering
- [ ] **THEME-02**: `idp-theme.spec.ts` uses a valid PKCE S256 `code_challenge` in `LOGIN_URL` (not the current `aaa…` placeholder), so KC 26 does not reject the auth request before the login page renders
- [ ] **THEME-03**: All DOM and CSS assertions in `idp-theme.spec.ts` match the current KC 26 login/account template structure (no references to removed or renamed elements)

## Session Management

- [ ] **SESSION-01**: `session-management.spec.ts` `loginViaBrowser()` uses stable selectors matching the current KC browser-flow shape (including the "Try Another Way → Password" branch)
- [ ] **SESSION-02**: A shared `loginViaKcForm(page, username, password)` fixture is extracted from the four independent KC form-navigation implementations (`global-setup.ts` ×2, `session-management.spec.ts`, `otp.spec.ts`), so a KC flow change requires one fix

## Documentation

- [ ] **DOC-01**: Any spec that is genuinely environment-specific (e.g., requires prod Keycloak config unavailable locally) is marked `test.fixme(condition, reason)` with an explicit rationale — no silently skipped or unexplained failures
- [ ] **DOC-02**: v3.1 closes with zero unexplained test failures — every outcome is either green, root-caused and fixed, or explicitly documented as an accepted deferral

---

## Future Requirements (deferred, unscoped)

- OTP brute-force lockout: add `client.attackDetection.del({ id: user.id })` to `beforeEach` in `otp.spec.ts` to prevent lockout state from prior runs affecting subsequent tests (OTP-03 from PITFALLS.md)
- Real-auth E2E in CI: Keycloak in CI environment; `SKIP_REAL_AUTH` guard removed from pipeline
- Per-recipient Mailpit isolation: switch `fetchLatestOtp()` to `GET /api/v1/search?query=to:unique-user@local` so the serial test constraint can be relaxed if OTP coverage expands to multiple personas

## Out of Scope

- New product features — v3.1 is stabilization only
- Playwright version upgrade — stay on `^1.60.0`
- Rewriting currently-passing specs — changes to green specs introduce new risk
- Mocking KC auth in real-auth specs — these specs exist to catch real KC-flow regressions

---

## Traceability

_(Filled by roadmapper)_

| REQ-ID | Phase |
|--------|-------|
| SETUP-01 | — |
| SETUP-02 | — |
| PASS-01 | — |
| PASS-02 | — |
| PASS-03 | — |
| OTP-01 | — |
| OTP-02 | — |
| OTP-03 | — |
| SHARE-01 | — |
| SHARE-02 | — |
| THEME-01 | — |
| THEME-02 | — |
| THEME-03 | — |
| SESSION-01 | — |
| SESSION-02 | — |
| DOC-01 | — |
| DOC-02 | — |
