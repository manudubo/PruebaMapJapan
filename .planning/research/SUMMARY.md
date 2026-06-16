# Research Summary — v3.1 E2E Stabilization

**Researched:** 2026-06-16
**Scope:** All 4 dimensions completed (Stack, Features, Architecture, Pitfalls). Findings are code-grounded (file:line cited) against actual spec files, routes, and config.

## Confirmed Root Causes (HIGH confidence — verified against current code)

1. **`passkeys.spec.ts` × the "×3" failures — test config bug.** `playwright.config.ts` has no `testMatch`/`testIgnore` scoping the chromium-only CDP Virtual Authenticator spec away from the `firefox`/`webkit` projects. `page.context().newCDPSession()` is Chromium-only, so this spec is guaranteed to fail under firefox/webkit independent of any real passkey bug. **This is almost certainly the entire "passkeys ×3" entry in the stale failure list.** Fix: scope the spec to chromium-only in the project config.

2. **`otp.spec.ts` (tests 1–3) — route contract mismatch, not flake.** `backend/src/routes/auth.ts:92` gates `/api/auth/otp-request` and `/otp-verify` behind `authMiddleware` (Bearer JWT). `OtpVerifySchema` (`backend/src/validation/schemas.ts:100-102`) only accepts `{code}`, no `email`. The spec calls these routes unauthenticated with `{email, code}` via Playwright's bare `request` fixture — structurally unable to carry a JWT (tokens live in browser `sessionStorage`). **This needs a product decision**: is OTP route auth-gating (step-up auth) intentional, or a regression from when the routes were originally public? Whichever way it's decided, the spec needs to match the real contract.

3. **`public-sharing.spec.ts` — missing data fixture, not an app bug.** Hardcoded UUIDs/trip-id/name in the spec don't exist in seed data. `public_slug` is `crypto.randomUUID()`-generated (`backend/src/db/schema.ts:57`); `seed.ts` creates the demo trip as `is_public: false`. The sharing route/feature itself is correct — the spec needs either a seed step of its own or updated fixture values. Also flagged: a negative assertion against a stale Spanish loading-placeholder string (pre-Phase 5 i18n), which can never catch a real stuck-loading regression.

## Structural Risk (MEDIUM-HIGH confidence)

4. **Shared fragile KC-form navigation, duplicated 4×.** The "Try Another Way → Password" Keycloak form-navigation logic is independently re-implemented in `global-setup.ts` (×2), `session-management.spec.ts`, and `otp.spec.ts` test 4. A single KC theme/flow change breaks all of them simultaneously, looking like unrelated failures across specs. `session-management.spec.ts` itself has a header comment acknowledging this flow shape needs restructuring. **Recommended fix:** extract one shared `loginViaKcForm()` helper; fixing it once likely resolves most of `session-management.spec.ts` and `otp.spec.ts` test 4 together.

## Unconfirmed — needs the live triage run

- **`idp-theme.spec.ts`**: code-level CSS/string assertions are currently consistent with theme source (`footer.ftl`, `login.css`, `theme.properties`). If it still fails in the fresh run, the cause is environmental, not a code drift — lowest-risk spec to triage, no auth dependency.
- **`passkeys.spec.ts`** (beyond the cross-browser config bug): no other contract drift found by static reading; any further failure mode is a hypothesis pending live run.
- Whether dev DB still has any seed data `public-sharing.spec.ts` could be pointed at — needs a direct DB check.
- Current KC realm browser-flow shape (WebAuthn-first vs password-first) — needs a live walkthrough before touching `loginViaKcForm()`.

## Suggested Fix Order

1. Fresh full-suite triage run (confirm which specs actually fail today — all of the above is static analysis, not a live run)
2. Passkeys `testMatch` scoping fix — mechanical, 1-line config change, unblocks accurate signal on the rest of that spec
3. Public-sharing fixture fix — fully independent, can run in parallel with anything else
4. OTP route-contract decision + alignment (spec or app, whichever direction is decided)
5. Extract shared `loginViaKcForm()` helper — de-risks session-management + otp test 4 together
6. idp-theme — likely needs no code fix; confirm via live run only

## Additional Stack Findings (from Stack + Pitfalls research)

**`idp-theme.spec.ts` — four candidates, none confirmed:**
- SSO session inherited from chromium project `storageState: '.auth/user.json'` — KC skips the login page (STACK: MEDIUM confidence)
- `code_challenge=aaa...` in `LOGIN_URL` is not a real S256 hash; KC 26 may reject at `/auth` endpoint before login page renders (PITFALLS: CRITICAL — TH-02)
- `#kc-header-wrapper` may not exist in KC 26's login template; `toBeHidden()` fails on absent element (PITFALLS: TH-04)
- `fontFamily` / `borderRadius` assertion fragility (PITFALLS: TH-03)

Pre-emptive fixes (low-risk, apply before triage): add `test.use({ storageState: { cookies: [], origins: [] } })` and generate a real PKCE S256 challenge pair for `LOGIN_URL`.

**Playwright config / pattern fixes:**
- `trace: 'retain-on-failure'` + `retries: 1` for triage phase (revert when suite is green)
- Replace `waitForTimeout(n)` in `passkeys.spec.ts:44,79,156` with `expect(locator).toBeEnabled({ timeout: 15_000 })` or `waitForResponse`
- Replace `waitForLoadState('networkidle')` + catch-fallback in `global-setup.ts` / `session-management.spec.ts` with `waitForURL(/pattern/)` or DOM signal assertions
- Add 500ms polling loop to `fetchLatestOtp()` — single-shot GET on Mailpit is racy by design
- Move `WebAuthn.removeVirtualAuthenticator` to `test.afterEach` (PITFALLS: WA-01 — test body failure leaves stale authenticator)

**Critical pitfalls for passkey fixes:**
- `kcAdmin.resetCredentials` deletes WebAuthn credentials but does NOT clear `webauthn-register-passwordless` required actions (WA-05) — passkey campaign flow hijacks the next test
- OTP brute-force lockout state survives `clearOtpCodes` — add `client.attackDetection.del({ id: user.id })` to `beforeEach` (OTP-03)
- KC theme cache: start KC with `KC_CACHE_THEMES=false` when diagnosing idp-theme (TH-01)

## Cross-Cutting Pattern

None of the 3 confirmed root causes are "flaky tests" in the retry-and-pray sense — they're a test-config bug, a contract mismatch, and a missing fixture. This matters for v3.1 scope: the milestone goal ("root-cause and fix each spec for real, document genuine environment-specific skips rather than force-fixing") is achievable here without inventing fake skips. Likely candidate for a genuine "accepted skip" only if the live triage surfaces a real CDP/WebAuthn environment limitation in `passkeys.spec.ts` beyond the config-scoping fix.

## Watch Out For

- Do not mock real-auth specs — passkeys, otp, session-management exist to catch real KC-flow regressions
- Do not use `test.skip` for locally-failing specs — use `test.fixme(condition, reason)` with documented context
- Do not silence flakiness with runner retries — `retries: 1` is diagnostic only; fix the root cause
- Do not rewrite passing specs — v3.1 is stabilization; changes to green specs introduce new risk
- No Playwright version upgrade — stay on `^1.60.0`
- `addInitScript` must always precede the first `page.goto()` — sessionStorage replay fails silently otherwise (Playwright bug #31108)
