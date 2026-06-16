# Domain Pitfalls — v3.1 E2E Stabilization

**Domain:** Playwright E2E with Keycloak 26.6.1 OIDC PKCE + WebAuthn CDP + Mailpit OTP
**Researched:** 2026-06-16
**Confidence:** HIGH — grounded in actual codebase (passkeys.spec.ts, otp.spec.ts, session-management.spec.ts, global-setup.ts, kc-admin.ts, mailpit-helpers.ts)

---

## Overview

This project's E2E suite is unusual because it exercises three independent auth mechanisms
(PKCE OIDC, WebAuthn CDP, Email OTP) against a live Keycloak instance, then replays the
resulting auth state via a bespoke storageState + sessionStorage workaround for Playwright
bug #31108. Failures in these specs belong to one of four root causes:

1. **Stale or polluted auth state** — tokens expired, KC session contaminated across tests, or `addInitScript` called too late.
2. **CDP Virtual Authenticator lifecycle** — authenticator not removed between tests, rpId tied to browser origin not KC origin, or `automaticPresenceSimulation` interacting with conditional mediation.
3. **Mailpit timing and ordering** — inbox not purged, OTP fetched before delivery, or test execution order violating serial constraint.
4. **FreeMarker theme rendering assumptions** — assertions against computed styles that depend on KC's theme cache, selector specificity, or font loading state.

Each section below maps pitfalls to the spec files that are likely affected.

---

## Auth State Pitfalls

### AS-01: storageState captures KC auth-flow cookies; replaying them resumes the old login ceremony

**What goes wrong:** `context.storageState()` captures everything in the browser context —
including `AUTH_SESSION_ID`, `KC_AUTH_SESSION_HASH`, and `TAB_ID`. When these are
replayed in a test context the KC server sees an in-progress auth flow and may redirect
the user back into the login ceremony instead of serving the already-authenticated session.

**This codebase's mitigation:** `global-setup.ts` lines 92-96 do `page.reload()` before
calling `context.storageState()` to flush those auth-flow cookies. If this reload is
removed or skipped (e.g. during a "fast path" optimization), storageState breaks silently.

**Detection:** Tests that use `storageState: '.auth/user.json'` land on the KC login page
instead of the authenticated dashboard. Usually looks like a timeout waiting for
`dashboard.html` after page navigation.

**Prevention:** Keep the post-login reload in `global-setup.ts`. Never snapshot
storageState immediately after the PKCE redirect; always give the app a chance to
clear auth-flow-only cookies.

---

### AS-02: sessionStorage not replayed before first navigation (Playwright bug #31108)

**What goes wrong:** `keycloak-js` stores all tokens in `sessionStorage`, not cookies.
Playwright's `storageState` API restores cookies and `localStorage` only. `sessionStorage`
is tab-scoped and is not persisted. If a test navigates to a page before
`context.addInitScript()` runs, the page initializes keycloak-js with no tokens and
redirects to KC login.

**This codebase's mitigation:** Every real-auth `test.beforeEach` (passkeys.spec.ts:32,
auth.spec.ts:213) calls `context.addInitScript(entries, sessionEntries)` before any
`page.goto()`. The entries are read from `.auth/session.json` which is written by
`global-setup.ts`.

**The failure mode:** Any test that calls `page.goto()` at the describe level (outside
`beforeEach`) or in a helper called before `addInitScript` runs will fail because
sessionStorage is empty at navigation time.

**Detection:** Authenticated tests that land on KC login despite `storageState` being set;
`sessionEntries.length` is zero because `.auth/session.json` was not regenerated after KC
state changed.

**Prevention:**
- `addInitScript` must always precede the first `page.goto()` — no exceptions.
- Regenerate `.auth/session.json` whenever KC tokens are invalidated (realm reset, user
  password change, Keycloak restart).
- Add an assertion at test start: if `page.url()` contains `realms/japan-trip` after
  navigating to `dashboard.html`, sessionStorage replay failed.

---

### AS-03: 20-minute storageState freshness window vs. 30-minute KC idle timeout

**What goes wrong:** `global-setup.ts` line 16 sets `MAX_AGE_MS = 20 * 60 * 1000` to
reuse storageState if it is less than 20 minutes old. KC's idle session timeout is 30
minutes. A full test suite run on slow hardware can take longer than 10 minutes between
the global-setup login and the last test's execution, leaving only ~10 minutes of margin.
If any test is retried (CI uses 2 retries) or the suite is paused, the token window shrinks.

**Detection:** Late-running tests in the suite pass locally in a fast run but fail in CI
with `tokenExpired` or a silent KC login redirect.

**Prevention:** If suite duration exceeds 10 minutes in CI, reduce `MAX_AGE_MS` to 10
minutes or regenerate storageState mid-suite via a setup project. Alternatively, add a
per-test token refresh guard that checks `isTokenExpired(60)` before each navigation.

---

### AS-04: `otp.spec.ts` explicitly opts out of storageState but shares the KC realm

**What goes wrong:** `otp.spec.ts` line 14 uses `test.use({ storageState: { cookies: [],
origins: [] } })` to start with no auth. This is correct — `otp-test@local` has no
pre-built storageState. However, if a previous spec left a KC `KEYCLOAK_SESSION` cookie
for the `japan-trip` realm in the Playwright browser context (e.g. from a test that did
not clean up), that cookie may auto-restore an SSO session and bypass the unauthenticated
state that OTP tests require.

**This interaction is non-obvious because:** `test.use()` at the describe level overrides
the project's `storageState`, but it does not prevent KC cookies set during prior tests in
the same worker from persisting if the context is reused across specs.

**Detection:** OTP tests pass in isolation but fail when run after a real-auth test in the
same worker. The `otp-request` endpoint returns 200 but the subsequent page navigation
lands on the dashboard (already authenticated) instead of prompting for OTP entry.

**Prevention:** Add `browserContext.clearCookies()` in `beforeEach` for OTP tests, or
isolate OTP tests to a dedicated worker via `workers: 1` on the serial describe block.

---

### AS-05: `session-management.spec.ts` uses `logoutUser` in `beforeEach` but can inherit dirty KC state from a previous test crash

**What goes wrong:** `session-management.spec.ts` calls `logoutUser(TEST_USER)` in
`beforeEach` to guarantee a clean slate. If a prior test in the same serial sequence
crashed mid-flow — for example during the cross-tab logout test — the browser context may
still hold KC cookies that the Admin API logout did not clear from the Playwright context.

**Result:** The next test starts with a browser cookie jar that still has `KEYCLOAK_SESSION`
for the realm, causing `check-sso` to silently restore the session and skipping the login
prompt that the test expects.

**Prevention:** Add `await context.clearCookies()` at the end of each test's teardown in
session-management.spec.ts, or do it at the start of `beforeEach` after `logoutUser`.
Admin API logout removes the server-side session; the Playwright context must independently
drop the browser-side session cookie.

---

## WebAuthn CDP Pitfalls

### WA-01: Virtual Authenticator not removed on test failure, contaminating subsequent tests

**What goes wrong:** `passkeys.spec.ts` removes the authenticator at the end of each test
with `WebAuthn.removeVirtualAuthenticator`. If a test fails before reaching that line, the
authenticator remains active for the life of the browser context. The next test then
inherits an already-populated authenticator and may find unexpected credentials during
assertion-gathering or during registration, causing duplicate-credential conflicts in KC.

**This is especially dangerous for the "login with passkey" test** which creates a second
clean browser context — it correctly creates its own authenticator, but if the prior test's
authenticator leaked credentials into the first context, `WebAuthn.getCredentials` returns
more credentials than expected.

**Prevention:** Wrap `removeVirtualAuthenticator` in a `test.afterEach` teardown block
rather than at the end of the test body. Use a module-level variable to track the current
`authenticatorId` so teardown always has the ID even after a test failure.

```typescript
let cdpSession: CDPSession | null = null;
let authenticatorId: string | null = null;

test.afterEach(async () => {
  if (cdpSession && authenticatorId) {
    await cdpSession.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    authenticatorId = null;
  }
});
```

---

### WA-02: rpId mismatch — WebAuthn assertion is bound to the origin that generated the credential

**What goes wrong:** CDP Virtual Authenticator credentials are bound to the rpId active at
registration time. KC uses the PKCE redirect to navigate from `localhost:5173` to
`localhost:8080` (KC login) and back. The rpId configured in Terraform
(`webAuthnPolicyPasswordlessRpId`) must match the origin of the KC login page, not the
app's origin.

If tests register a passkey while the page is on `localhost:5173` (app) but KC's WebAuthn
ceremony runs from `localhost:8080`, the assertion will fail with `NotAllowedError` because
the credential's rpId does not match the requesting origin.

**Detection:** Passkey registration completes (CDP returns success) but subsequent login
assertion fails at the KC level; the browser DevTools show a `SecurityError` or
`NotAllowedError`.

**Prevention:** Verify that `webAuthnPolicyPasswordlessRpId` in Terraform is set to
`localhost` (not `localhost:8080`, not `localhost:5173` — rpId strips the port). Confirm
by checking `authenticatorSelection.rpId` in the KC WebAuthn challenge via network logs
during a failing run.

---

### WA-03: `automaticPresenceSimulation: false` requires explicit trigger; `true` races with conditional mediation

**What goes wrong:** `passkeys.spec.ts` uses `automaticPresenceSimulation: false` for all
three tests. This means CDP will not automatically respond to a WebAuthn assertion request —
the test must either click a UI button that triggers the assertion or switch to `true`.

For the "login with passkey" test, step 5 attempts to click a passkey button:
```typescript
await passkeyBtn.first().click({ timeout: 3000 });
```
This is wrapped in try/catch and swallows the error. If KC's conditional mediation UI
shows instead of an explicit button, no trigger fires and the test hangs waiting for
`dashboard.html` at step 6 (30-second timeout).

If `automaticPresenceSimulation` is switched to `true` to fix this, it may auto-assert
during the initial `page.goto()` before KC is ready, causing an assertion against the
wrong ceremony.

**Prevention:** Use `automaticPresenceSimulation: false` and add an explicit wait for KC
to reach its WebAuthn step before attempting the trigger. Detect the conditional mediation
UI with a selector for `[autocomplete="webauthn"]` on the username input, then enable
CDP auto-presence only for that window. Alternatively, configure the KC WebAuthn flow to
require an explicit "Use passkey" button click (disable conditional mediation in the realm).

---

### WA-04: `WebAuthn.enable` must be called on the specific CDP session for each page/context

**What goes wrong:** The "login with passkey" test creates two CDP sessions: `cdpAuth` on
the authenticated page and `cdpClean` on the clean page. `WebAuthn.enable` is called on
both, but if the context-level CDP session is used instead of the page-level session, the
virtual authenticator may not intercept WebAuthn calls on the new page.

`page.context().newCDPSession(page)` creates a session attached to the page's frame, not
the context. For the clean context, the test correctly calls
`cleanContext.newCDPSession(cleanPage)`. Swapping these (e.g. reusing `cdpAuth` for the
clean page) silently disables credential interception.

**Prevention:** Always associate the CDP session and authenticator with the specific page
being tested. Never reuse a CDP session across pages or contexts.

---

### WA-05: `kcAdmin.resetCredentials` removes WebAuthn credentials but leaves KC's required-action state

**What goes wrong:** `passkeys.spec.ts` calls `kcAdmin.resetCredentials(E2E_USERNAME)` in
`beforeEach` to clear WebAuthn credentials from prior tests. This removes credential
records from KC's credential store. However, if the user has a `webauthn-register-passwordless`
required action queued (set by the passkey campaign), that required action is NOT cleared
by `resetCredentials` — only the stored credentials are deleted.

As a result, after credential reset the user's next KC login session triggers the required
action again, forcing the test into the passkey registration flow before it reaches the
test's assertion.

**Detection:** After `resetCredentials`, navigation to `profile.html` redirects to KC
instead of loading the profile — KC is demanding the required action be completed before
continuing.

**Prevention:** Extend `resetCredentials` in `kc-admin.ts` to also remove the
`webauthn-register-passwordless` required action from the user's KC profile:
```typescript
await client.users.update({ id: user.id }, {
  requiredActions: []
});
```
Or add this as a separate `clearRequiredActions(username)` helper called in beforeEach.

---

## OTP/Mailpit Pitfalls

### OTP-01: `fetchLatestOtp` fetches `messages[0]` — but Mailpit API returns newest-first only if sorted

**What goes wrong:** `mailpit-helpers.ts` fetches `/api/v1/messages` and takes
`data.messages[0]`. Mailpit's default message listing is newest-first, so `[0]` is
the most recent message. However, this ordering depends on Mailpit's internal sort —
if the API ever returns messages oldest-first or unsorted (e.g. after a version upgrade),
`messages[0]` becomes the oldest code in the inbox, which may be expired or from a
different test.

**Prevention:** Sort messages by `Created` timestamp descending before extracting `[0]`.
Or switch to Mailpit's search API with a recipient filter:
`GET /api/v1/search?query=to:otp-test@local&start=0&limit=1`

---

### OTP-02: `purgeInbox` deletes all messages, but the backend may buffer SMTP delivery

**What goes wrong:** `otp.spec.ts` calls `purgeInbox()` in `beforeEach`, then immediately
calls `otp-request` and then `fetchLatestOtp`. If the backend's SMTP delivery to Mailpit
is asynchronous and the inbox check happens before the email arrives, `fetchLatestOtp`
throws `No messages in Mailpit inbox`.

The current implementation has no retry or polling loop in `fetchLatestOtp`. One missed
delivery window = test failure.

**Prevention:** Add polling with a short interval to `fetchLatestOtp`:
```typescript
for (let i = 0; i < 10; i++) {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const data = await res.json();
  if (data.messages?.length) { /* extract OTP */ return otp; }
  await new Promise(r => setTimeout(r, 500));
}
throw new Error('OTP email never arrived');
```
500ms × 10 = 5 seconds max wait, which is cheap for a serial suite.

---

### OTP-03: The lockout test (5 failed verifications) leaves the account in a locked state for subsequent tests

**What goes wrong:** `otp.spec.ts` test 3 sends 5 wrong codes to trigger lockout. The OTP
table row is not deleted by the test — `beforeEach` calls `clearOtpCodes` which DELETEs
rows from `email_otp_codes`. But if the lockout is implemented as a separate counter
in the database or KC's brute-force protection triggers, that counter may persist beyond
the `clearOtpCodes` DELETE and affect test 4.

Test 4 (`UPDATE_PASSWORD gate`) logs in via KC username/password. If brute-force protection
is enabled on the KC realm and the OTP lockout triggered a temporary lockout on the user,
test 4 will fail at KC login with a "User temporarily disabled" error.

**Detection:** Test 4 fails with HTTP 401 or a KC error page mentioning temporary
lockout after test 3 runs.

**Prevention:** In `beforeEach`, also clear KC brute-force state for the user:
```typescript
await client.attackDetection.del({ id: user.id });
```
Or ensure KC's brute-force protection is disabled in the Terraform realm config for the
`otp-test@local` user specifically (or for the entire test realm).

---

### OTP-04: Serial mode prevents parallelism but does not prevent cross-spec inbox contamination

**What goes wrong:** `test.describe.configure({ mode: 'serial' })` serializes tests within
the OTP describe block. But if another spec (not in that block) triggers a KC email — for
example a verify-email required action — that email lands in the Mailpit inbox and
`fetchLatestOtp` picks it up as the OTP.

**This can happen if:** Any other test creates a KC user (via `kcAdmin.createUser`) without
setting `emailVerified: true`, causing KC to send a verification email to Mailpit.

**Prevention:** Always set `emailVerified: true` in `kc-admin.ts:createUser` (already
done), and ensure no other spec triggers KC email flows during the same test run. The
`purgeInbox()` in `beforeEach` mitigates this, but only if it runs after any
cross-spec email has arrived. If the cross-spec email arrives during the OTP test, not
before it, `fetchLatestOtp` still picks up the wrong message.

---

## Theme Testing Pitfalls

### TH-01: KC theme cache means FTL changes are not reflected until KC restarts

**What goes wrong:** `idp-theme.spec.ts` navigates to the KC login URL and asserts computed
styles (`borderRadius: '0px'`, `fontFamily` contains `Inter`). These styles depend on the
`login.css` file being served by KC from its theme. KC caches theme files in memory —
after a change to `keycloak/themes/japan-trip/login/resources/css/login.css`, the old
CSS may still be served until KC is restarted.

**Detection:** Theme assertions fail with the wrong values even though the CSS file on disk
is correct. Adding `--cache-themes=false` to KC startup flags (local dev) fixes it.

**Prevention:** In the local dev environment, start KC with:
```
KC_CACHE_THEMES=false
```
or equivalent JVM flag `--spi-theme-static-max-age=-1`. Document this in the dev startup
script so theme tests always run against current FTL/CSS. Do not add this to production KC.

---

### TH-02: The `code_challenge` in `LOGIN_URL` is not a valid S256 challenge — KC 26 enforces PKCE strictly

**What goes wrong:** `idp-theme.spec.ts` hardcodes:
```
code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```
This is 43 characters of `a` — a syntactically valid Base64-URL string of the right length
but not a valid SHA-256 hash of any code verifier. In KC 25, PKCE challenges were validated
only at token exchange time. In KC 26 the enforcements are stricter.

If KC 26 rejects the invalid challenge at the `/auth` endpoint (before the login page
renders), the test lands on a KC error page instead of the login form, and all assertions
fail with "element not found" instead of theme-related errors.

**Detection:** The test gets a 400 response or KC error page for the PKCE auth request.
Check KC logs for `INVALID_CODE_CHALLENGE` or similar.

**Prevention:** Generate a real code verifier + challenge pair for the idp-theme test URL,
or use `page.goto` + `page.route` to intercept the KC redirect and inject a valid PKCE
challenge. Alternatively, configure the `japan-trip-frontend` client in KC to not require
PKCE for test-only theme verification (add a dedicated test-only client without PKCE).

---

### TH-03: Computed style assertions are browser-dependent — `fontFamily` includes fallback stack

**What goes wrong:** `idp-theme.spec.ts` asserts:
```typescript
expect(styles.fontFamily).toContain('Inter');
```
`getComputedStyle().fontFamily` returns the full font stack as defined in CSS, not the
rendered font. If the CSS defines `font-family: Inter, sans-serif`, the assertion passes.
But if KC's base theme (Keycloak's keycloak-v2 parent) prepends its own font family before
`Inter` in the cascade, `fontFamily` may return something like `RHSDs Display, Inter,
sans-serif` and the assertion still passes. If the theme is misconfigured and `Inter` is
absent from the stack, the assertion correctly fails — but `toContain('Inter')` does not
verify that `Inter` is the primary (first) font.

Separately: the `borderRadius: '0px'` assertion on `.jp-idp-exit` breaks if the browser
normalizes the value differently (e.g. `0px 0px 0px 0px` on some WebKit versions).

**Prevention:** Assert `fontFamily.startsWith('Inter')` or use `toMatch(/^["']?Inter/i)`.
For borderRadius, assert `borderRadius === '0px' || borderRadius === '0px 0px 0px 0px'`.

---

### TH-04: `#kc-header-wrapper` visibility depends on the KC version's base template

**What goes wrong:** `idp-theme.spec.ts` asserts:
```typescript
await expect(keycloakHeader).toBeHidden();
```
`#kc-header-wrapper` is a div in KC's standard base login template. In KC 25 this element
exists and can be hidden via CSS or FTL override. In KC 26 the template structure changed —
the element may no longer exist, changing from "hidden" to "not attached", which is a
different assertion outcome.

`toBeHidden()` in Playwright passes for both `display:none` and `visibility:hidden` but
fails if the element is simply absent from the DOM. `not.toBeVisible()` would pass in both
cases. This spec was written against KC 25 and upgraded to 26.6.1.

**Detection:** Test fails with "locator.toBeHidden: Element is not in DOM" or a similar
timeout on the locator.

**Prevention:** Replace `await expect(keycloakHeader).toBeHidden()` with
`await expect(keycloakHeader).not.toBeVisible()`. This handles both "hidden by CSS" and
"not in DOM" states correctly.

---

## Triage Misdiagnosis Pitfalls

### TD-01: "Works locally, fails in CI" is almost always env state, not test code

**Pattern:** A test passes in a local `npx playwright test` run but fails in GitHub Actions.

**Most likely causes in this stack:**
1. `SKIP_REAL_AUTH=true` in CI — all real-auth specs are skipped, not failing. If a spec
   is being reported as failing in CI, confirm it is not guarded by the skip. The stale
   failure list (idp-theme, otp, passkeys, session-management) may contain specs that are
   SKIPPED in CI, meaning they were never green in CI even though they pass locally.
2. Missing `.env.test` in CI — `otp.spec.ts` calls `postgres(process.env.POSTGRES_URL!)`.
   If `POSTGRES_URL` is not in the CI env, the connection throws immediately in `beforeEach`.
3. KC not running — `idp-theme.spec.ts` uses a `beforeEach` guard that calls
   `request.get(KC_URL, { timeout: 5000 })` and calls `test.skip()` if it fails. If KC
   is not in CI, this test is skipped, not failed. Verify the CI run artifacts to
   distinguish "skipped" from "failed".

**Triage protocol:** Before treating a spec as broken, run `npx playwright test <spec>
--reporter=list` locally with `SKIP_REAL_AUTH=true` set to reproduce the CI environment.

---

### TD-02: A failing test that passes on retry is a race condition, not a flake to suppress

**Pattern:** A test fails on first run but passes on CI retry. The standard response is
to increase `retries` in the config. This hides the root cause.

**In this stack, races are almost always:**
1. OTP email delivery timing (OTP-02 above)
2. `addInitScript` called after a concurrent `page.goto()` from a shared helper
3. KC session propagation delay — `getUserSessions` called immediately after `loginViaBrowser`
   before the session is written to KC's database

**Prevention:** Treat a test that needs retries as a bug to fix, not a configuration knob
to turn. The CI `retries: 2` setting is a safety net for genuine environment instability
(network flaps), not an acceptable fix for races.

---

### TD-03: Distinguishing "test is wrong" from "app is wrong" for auth redirects

**Pattern:** A passkey or session test fails with an unexpected URL (lands on KC login
instead of dashboard). This could be:
- App bug: `keycloak-js` not initializing correctly
- Test bug: sessionStorage not replayed (`AS-02`)
- State bug: credentials not cleaned between tests (`WA-01`, `WA-05`)
- Env bug: KC session expired during suite run (`AS-03`)

**Triage order:**
1. Is `SKIP_REAL_AUTH` set? If yes, this test should not run — check your env.
2. Is `.auth/session.json` fresh (< 20 min)? If no, delete it and re-run.
3. Does the test pass in isolation (`npx playwright test passkeys.spec.ts`)? If yes, it's
   a cross-test state pollution issue (prioritize `AS-02`, `WA-01`, `WA-05`).
4. Does the test fail consistently in isolation? Then it is either an app bug or a
   misconfigured env (check KC logs for the error during the failing run).

---

### TD-04: `public-sharing.spec.ts` uses hardcoded slugs that will break if DB is reset

**What goes wrong:**
```typescript
const PUBLIC_SLUG = '4dd5492e-2111-4b38-bc45-47848d27af42';
const PRIVATE_SLUG = 'e3214d9f-e5a3-47b6-8441-fb167041b4fa';
```
These UUIDs are the slugs of trip ID 1 and trip ID 2 in the local development database.
If the database is dropped and recreated (e.g. Docker volume removed, migrations re-run,
or `testuser`'s trips deleted and re-created), the slugs change.

The spec also uses `const PUBLIC_TRIP_ID = '1'` — numeric ID that presupposes a specific
insertion order in the `trips` table.

**Detection:** Public-sharing tests fail with 404 or unexpected data even though the
backend route is correct.

**Prevention:** Replace hardcoded slugs with a `beforeAll` that looks up the slug via the
KC-authenticated API: `GET /api/trips` → find trip by name → extract slug. Or seed the
trips with deterministic slugs via a fixture script that is idempotent.

---

## Prevention Matrix

| Pitfall | Affects Specs | Phase to Fix | Severity |
|---------|---------------|--------------|----------|
| AS-01: auth-flow cookies in storageState | Any real-auth spec after env reset | Phase 1 triage | High |
| AS-02: sessionStorage not replayed before goto | passkeys, auth, session-management | Phase 1 triage | Critical |
| AS-03: 20-min token window vs. long suite | All real-auth specs in CI | Phase 2 | Medium |
| AS-04: OTP spec inherits KC SSO cookie from prior test | otp | Phase 1 triage | High |
| AS-05: session-management dirty context after crash | session-management | Phase 1 triage | Medium |
| WA-01: CDP authenticator not removed on failure | passkeys all 3 | Phase 1 triage | Critical |
| WA-02: rpId mismatch between app and KC origins | passkeys (login) | Phase 1 triage | High |
| WA-03: presence simulation vs. conditional mediation | passkeys (login) | Phase 1 triage | High |
| WA-04: CDP session wrong page/context binding | passkeys (login) | Phase 1 triage | Medium |
| WA-05: resetCredentials leaves required actions | passkeys all 3 | Phase 1 triage | Critical |
| OTP-01: Mailpit sort order assumption | otp | Phase 1 triage | Medium |
| OTP-02: No retry on email delivery | otp (happy path) | Phase 1 triage | High |
| OTP-03: Lockout leaves brute-force state | otp (all after lockout) | Phase 1 triage | High |
| OTP-04: Cross-spec inbox contamination | otp | Phase 2 | Low |
| TH-01: KC theme cache not cleared | idp-theme | Phase 1 env setup | High |
| TH-02: Invalid PKCE challenge rejected by KC 26 | idp-theme | Phase 1 triage | Critical |
| TH-03: fontFamily / borderRadius assertion fragility | idp-theme | Phase 1 triage | Medium |
| TH-04: #kc-header-wrapper absent in KC 26 | idp-theme | Phase 1 triage | High |
| TD-01: CI env != local env | All failing specs | Phase 0 triage setup | High |
| TD-02: Retries masking races | otp, passkeys | Phase 1 | Medium |
| TD-03: App vs. test vs. env misdiagnosis | passkeys, session-management | Phase 0 triage | High |
| TD-04: Hardcoded DB slugs | public-sharing | Phase 1 triage | Medium |
