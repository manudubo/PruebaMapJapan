# Playwright E2E Stabilization — Stack Research

**Project:** TravelMap v3.1 E2E Stabilization
**Researched:** 2026-06-16
**Playwright version pinned:** `^1.60.0` (tests/package.json)
**Confidence:** HIGH — all APIs cited are present in Playwright 1.60.0; version-introduction claims for older milestones are not independently verified and are not load-bearing

---

## Overview

This document covers Playwright APIs and config changes that directly address the flakiness patterns found in the existing test suite. v3.1 is a stabilization milestone — no new tooling beyond what's needed to diagnose and fix the seven failing specs.

The test infrastructure is already well-built. The four failure modes to address are:

1. **Hard sleeps** (`waitForTimeout`) used as blunt synchronisation in passkeys.spec.ts
2. **`networkidle` load-state waits** with silent catch-fallback in global-setup.ts and session-management.spec.ts
3. **Single-shot Mailpit fetch** in `mailpit-helpers.ts` — throws immediately if inbox is empty (timing race)
4. **Trace captured only on retry** (`trace: 'on-first-retry'`, `retries: 0` locally) — means zero trace data on first local failure, the common case during triage

---

## Key APIs & Config

### Replace `waitForTimeout` with web-first assertions

Hard sleeps in the passkeys spec (lines 44, 79, 156 — `waitForTimeout(1000)` and `waitForTimeout(500)`) are the canonical flakiness source. They either wait too short on a slow machine or waste time on a fast one.

**Replace with:**
```ts
// Instead of: await page.waitForTimeout(1000)
// Wait for the specific condition you're actually depending on:
await expect(page.locator('#register-passkey-btn, [data-action="register-passkey"]').first())
  .toBeEnabled({ timeout: 15_000 });
// or for API responses:
await page.waitForResponse(resp => resp.url().includes('/account/credentials') && resp.status() === 200);
```

Playwright's web-first assertions (`expect(locator).toBeVisible()`, `.toBeEnabled()`, `.toHaveText()`) retry the assertion internally up to the configured `timeout`. They resolve the moment the condition is true, not after a fixed delay.

**Confidence:** HIGH.

### Replace `waitForLoadState('networkidle')` with DOM-observable signals

`networkidle` waits for 500ms with no in-flight requests. Keycloak login pages trigger auth-flow network activity continuously, so `networkidle` either times out or catches a gap between two requests and races ahead of a half-loaded page. The `catch(() => page.waitForLoadState('load'))` fallback in global-setup.ts and session-management.spec.ts confirms this — the fallback itself is a signal the primary wait is unstable.

**Replace with:**
```ts
// Wait for the visible DOM signal you actually care about:
await expect(page.locator('#username')).toBeVisible({ timeout: 15_000 });
// or after submit, wait for the redirect destination:
await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });
```

Playwright's documentation explicitly discourages `networkidle` for SPAs and auth-flow pages. `waitForURL` or web-first locator assertions on the post-action element are the recommended replacement.

**Where this applies in your codebase:**
- `global-setup.ts` — three `waitForLoadState('networkidle').catch(...)` calls during KC login
- `session-management.spec.ts` — multiple `waitForLoadState('networkidle')` calls in `loginViaBrowser()` and tests
- `idp-theme.spec.ts` — uses `waitForLoadState('domcontentloaded')` only (acceptable for a static load check)

**Confidence:** HIGH — documented Playwright guidance, confirmed by community-reported failures with identical pattern.

### Change `trace` mode to `retain-on-failure` for the triage phase

**Current config:**
```ts
use: {
  trace: 'on-first-retry', // only captures on retry — useless locally since retries: 0
}
```

`on-first-retry` only records trace on the first retry of a failing test. Since local retries are `0`, no trace is ever captured locally. This means every local failure requires a second `PWDEBUG=1` run to diagnose — wasteful during triage.

**Change to for triage duration:**
```ts
use: {
  trace: 'retain-on-failure', // records every run, keeps only on failure — works with retries: 0
}
```

`retain-on-failure` records a trace for every test run but discards it if the test passes. Unlike `on-first-retry`, it does not require `retries > 0` to trigger. This gives a trace.zip on every local failure with zero overhead on passing tests. Revert to `on-first-retry` after triage when the suite is green.

**Confidence:** HIGH — documented Playwright option, present in official trace viewer docs.

### Enable `retries: 1` locally during triage to detect flaky vs broken

**Current:**
```ts
retries: process.env.CI ? 2 : 0,
```

Zero local retries means a single random flake looks identical to a genuine failure. Set `retries: 1` temporarily during triage. A test that passes on retry is flaky; a test that fails twice with the same error is a real bug. This separates root causes without requiring multiple manual re-runs.

**Confidence:** HIGH — standard Playwright diagnostics pattern.

### `expect.poll` for asserting async conditions on external state

`expect.poll` converts a polling callback into a retrying assertion. It accepts `timeout` and `intervals` options.

```ts
// Asserting a condition (not extracting a value):
await expect.poll(async () => {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const data = await res.json();
  return data.messages?.length ?? 0;
}, {
  message: 'Expected at least one message in Mailpit inbox',
  timeout: 15_000,
  intervals: [500, 1000, 2000],
}).toBeGreaterThan(0);
```

The `intervals` array controls retry delays: first retry after 500ms, then 1000ms, then repeats at 2000ms until timeout. Omitting `intervals` defaults to Playwright's internal escalation schedule.

Note: `expect.poll` is for asserting a condition. When you need to extract a value (like an OTP code string) for use in a subsequent assertion, use a polling loop instead — see the Mailpit section below.

**Confidence:** HIGH — documented at playwright.dev/docs/test-assertions.

### `test.step` for trace readability in multi-step auth flows

`test.step` wraps a block of actions and creates a named group in the trace viewer. Without it, a 10-action KC login sequence appears as an undifferentiated list.

```ts
test('login with passkey via KC login form', async ({ page, browser }) => {
  const authId = await test.step('Register passkey', async () => {
    await page.goto(`${FRONTEND_URL}/PruebaMapJapan/profile.html`);
    // ... CDP setup, register button click ...
    return authenticatorId;
  });

  await test.step('Login with registered passkey in clean context', async () => {
    const cleanContext = await browser.newContext();
    // ... credential transfer, KC navigation ...
    await cleanContext.close();
  });
});
```

Each step label appears in the trace viewer Actions tab, making it clear which phase of the passkey flow produced the failure.

**Confidence:** HIGH.

### `page.waitForResponse` for confirming API calls in auth flows

After KC login completes, the app issues token exchange and API calls. Using `waitForResponse` rather than `waitForTimeout` anchors on actual network activity:

```ts
const [response] = await Promise.all([
  page.waitForResponse(resp =>
    resp.url().includes('/api/trips') && resp.status() === 200
  ),
  page.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`),
]);
```

Apply to session-management flows where the test needs to know the dashboard's API call has settled.

**Confidence:** HIGH.

---

## KC Auth Stability

### storageState lifecycle: age check is correct, but `.auth/` must not be cached in CI

The `isStorageStateFresh()` check in `global-setup.ts` uses a 20-minute MAX_AGE_MS against a 30-minute KC idle timeout. The pattern is correct. Since global-setup runs once before workers start, mid-run re-authentication can't happen.

**Risk:** If CI caches `.auth/` across pipeline runs, the stored tokens will be stale and KC will reject them silently. Ensure `.auth/` is excluded from CI cache keys and always regenerated fresh per run.

### Session isolation: `test.use({ storageState })` scoping

The otp.spec.ts correctly overrides to empty storageState (`{ cookies: [], origins: [] }`) to ensure an unauthenticated session. The passkeys.spec.ts correctly reads from `.auth/user.json`. The chromium-passkeys project intentionally omits storageState at the project level.

**Gotcha:** `test.describe` with `test.use({ storageState })` applies only to that describe block. Verify idp-theme.spec.ts and public-sharing.spec.ts do not implicitly inherit the chromium project's `storageState: '.auth/user.json'` when they shouldn't.

### idp-theme.spec.ts: most likely broken by inherited authenticated SSO session

This is the highest-priority triage hypothesis for idp-theme failures.

`playwright.config.ts` applies `storageState: '.auth/user.json'` to the chromium project. `global-setup.ts` reloads after login and saves state — this preserves `KEYCLOAK_IDENTITY` and `KEYCLOAK_SESSION` cookies for `localhost:8080`. `idp-theme.spec.ts` navigates directly to the raw KC authorization URL (`/realms/japan-trip/protocol/openid-connect/auth?...`) inside a chromium project test. If an active SSO session is present in the browser context (carried by those cookies), KC skips the login page entirely and redirects back to the app — so `#kc-header-wrapper` and `.jp-idp-exit` are never rendered, and both assertions fail.

**Verify:** Check `.auth/user.json` for `localhost:8080` cookies named `KEYCLOAK_IDENTITY` or `KEYCLOAK_SESSION`. If present, the theory is confirmed.

**Fix:** Add `test.use({ storageState: { cookies: [], origins: [] } })` inside the `idp-theme.spec.ts` describe block to run in a clean context with no KC cookies, forcing the login page to render.

### `addInitScript` must precede `page.goto` — already correct in passkeys.spec.ts

The sessionStorage replay via `context.addInitScript` in `passkeys.spec.ts` `beforeEach` is the documented workaround for Playwright bug #31108 (storageState does not save sessionStorage). The bug remains open as of 1.60.

**Risk:** `addInitScript` runs for every navigation in the context, including KC-hosted pages. KC's own JavaScript may write to `sessionStorage` after your init script. KC's keys are prefixed by realm/client, so collision is unlikely, but confirm if passkey tests fail with stale-token errors post-init.

### `storageState` with `indexedDB: true`

If any auth state moves to IndexedDB in a future keycloak-js version, `context.storageState({ path, indexedDB: true })` captures it. Not needed now but available in 1.60.

---

## WebAuthn Stability

### Existing CDP setup is correct — timing race is the primary concern

The virtual authenticator pattern in passkeys.spec.ts is well-structured:

- `WebAuthn.enable({ enableUI: false })` — disables browser WebAuthn UI, forces CDP path
- `protocol: 'ctap2'`, `transport: 'internal'` — correct for passkeys
- `hasUserVerification: true`, `isUserVerified: true` — correct spelling (comment confirms the typo trap)
- `automaticPresenceSimulation: false` — manual mode: KC must initiate the WebAuthn ceremony; CDP responds when KC calls `navigator.credentials.create()`
- Cleanup via `removeVirtualAuthenticator` in test body (not afterEach) — fragile if test throws

### Two candidate fixes for the `waitForTimeout` — trace before committing

The `waitForTimeout(1000)` calls on passkeys.spec.ts lines 44, 79, and 156 are trying to solve a timing problem, but there are two different problems it could be masking. **Capture a trace first to identify which one before choosing a fix.**

**Candidate A — KC's WebAuthn JavaScript not yet listening (timing issue):**
If the trace shows the button click succeeds but then `navigator.credentials.create()` is never called (test hangs until 30s timeout), the click fired before KC's WebAuthn event listeners were registered. The fix is to wait for a DOM signal that KC's JS has settled before clicking:
```ts
// Wait for a KC DOM signal that WebAuthn JS is ready, then click:
await expect(page.locator('#register-passkey-btn, [data-action="register-passkey"]').first())
  .toBeEnabled({ timeout: 15_000 });
await registerBtn.first().click();
```

**Candidate B — `automaticPresenceSimulation: false` requires explicit trigger (presence issue):**
The CDP spec for `automaticPresenceSimulation: false` means the authenticator will not auto-assert — it waits for KC to call `create()` and then responds. If the button click works correctly but KC's flow expects a different sequence (e.g., conditional UI), the virtual authenticator never gets the trigger. The fix is to set `automaticPresenceSimulation: true` before the triggering action:
```ts
await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
  authenticatorId,
  enabled: true,
});
await registerBtn.first().click();
// Optionally reset after the ceremony completes
await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
```

The trace will show whether `create()` is called (Candidate A) or called but not auto-responded-to (Candidate B). Start with the trace; apply the matching fix.

### Teardown gap: `removeVirtualAuthenticator` in test body

If a test assertion throws before reaching `removeVirtualAuthenticator`, the authenticator persists for the next test in the same worker. Because `beforeEach` calls `resetCredentials`, this may cause CDP state to mismatch KC state.

**Fix:** Move cleanup to `afterEach`:
```ts
let authenticatorId: string | undefined;

test.afterEach(async ({ page }) => {
  if (authenticatorId) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
      .catch(() => {}); // already removed or CDP disconnected — ignore
    authenticatorId = undefined;
  }
});
```

### CDP is Chromium-only

The `chromium-passkeys` project in playwright.config.ts correctly restricts passkeys.spec.ts to Chromium only. Firefox/WebKit do not support CDP WebAuthn emulation. This is correct and must stay.

---

## OTP/Mailpit Stability

### Current implementation: single fetch, no retry, throws immediately on empty inbox

`fetchLatestOtp()` in `mailpit-helpers.ts`:
```ts
const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
const data = await res.json();
if (!data.messages?.length) throw new Error('No messages in Mailpit inbox');
```

If the OTP email hasn't arrived when `fetchLatestOtp()` is called, this throws immediately. The happy-path OTP test calls `request.post('/api/auth/otp-request')`, gets a 200, then immediately calls `fetchLatestOtp()`. The time between the backend confirming the OTP was generated and Mailpit delivering the email (SMTP → Mailpit receive loop) is non-deterministic. On a loaded CI host, this is the most likely cause of OTP spec failures.

**Fix — add polling to `fetchLatestOtp`:**
```ts
export async function fetchLatestOtp(timeout = 15_000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const data = await res.json() as MailpitListResponse;
    if (data.messages?.length) {
      const msgId = data.messages[0].ID;
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msgId}`);
      const msg = await msgRes.json() as MailpitMessageBody;
      const match = msg.Text.match(/(\d{6})/);
      if (match) return match[1];
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`No OTP found in Mailpit inbox within ${timeout}ms`);
}
```

This is a self-contained polling loop with 500ms intervals. No new dependency. No change to call sites — `fetchLatestOtp()` still returns `Promise<string>`.

**Why not `expect.poll` here:** `expect.poll` returns an assertion, not a value. Since `fetchLatestOtp` must return the OTP string for use in the next `expect(otp).toMatch(...)` assertion, a polling loop is the correct pattern. `expect.poll` would be right if the goal were asserting the inbox eventually has a message; for extracting the code, use the loop.

### `purgeInbox` called in `beforeEach` — correct

Each OTP test calls `purgeInbox()` before running. This ensures `messages[0]` is always the email generated by the current test. Keep this pattern. Protected against parallel interference by `mode: 'serial'`.

### `clearOtpCodes` for DB-level cleanup

`kcAdmin.clearOtpCodes` in `beforeEach` deletes rows from `email_otp_codes`. This prevents a test from picking up a previously generated but unused OTP. Correct approach; no change needed.

---

## What NOT To Add

The following are explicitly out of scope for v3.1:

**No new test reporters.** HTML + GitHub reporters cover local triage and CI. Allure, Extent, or custom reporters add maintenance cost without helping diagnose auth flows — the trace viewer is the right tool.

**No visual regression testing.** `idp-theme.spec.ts` checks CSS computed styles programmatically. Do not replace with screenshot diffing (Percy, Applitools, etc.) for a stabilization milestone.

**No Playwright component testing (`@playwright/experimental-ct-web`).** The frontend is a Vanilla TS MPA. Component testing has no purchase here.

**No test sharding.** The suite does not warrant `--shard` on a single local dev machine.

**No `expect.soft` as a workaround.** Soft assertions collect multiple failures per test; they do not fix flakiness and should not be used to make genuinely failing assertions appear to pass.

**No `test.fixme` or `test.skip` for convenience.** Any spec that genuinely cannot be fixed in this milestone must be documented with an explicit reason (a `DEFERRED.md` entry). Silent `.skip()` is not acceptable.

**No API mocking for specs that require real auth.** The passkeys, OTP, and session-management specs test real KC flows. Adding `page.route()` mocks for KC endpoints would invalidate the test intent.

**No Playwright version upgrade.** Stay on `^1.60.0`. Breaking API changes mid-stabilization would compound scope.

---

## Sources

- [Playwright Best Practices — playwright.dev](https://playwright.dev/docs/best-practices)
- [Playwright Trace Viewer — playwright.dev](https://playwright.dev/docs/trace-viewer)
- [Playwright Test Assertions (expect.poll) — playwright.dev](https://playwright.dev/docs/test-assertions)
- [Playwright Issue #31108: sessionStorage not saved by storageState](https://github.com/microsoft/playwright/issues/31108)
- [Playwright Issue #38682: Save sessionStorage in storageState request](https://github.com/microsoft/playwright/issues/38682)
- [networkidle flakiness — WebCrawlerAPI Glossary](https://webcrawlerapi.com/glossary/playwright/how-to-fix-playwright-networkidle-misuse)
- [Playwright 1.60 release — Currents.dev](https://currents.dev/posts/pw-1.60.0)
- [Testing Authentication with Playwright — Currents.dev](https://currents.dev/posts/testing-authentication-with-playwright-the-complete-guide)
- [Passkeys E2E Testing via WebAuthn Virtual Authenticator — Corbado](https://www.corbado.com/blog/passkeys-e2e-playwright-testing-webauthn-virtual-authenticator)
- [WebAuthn E2E Testing with Mailpit — DEV Community (Kochan)](https://dev.to/kochan/testing-webauthn-in-ci-e2e-automation-with-virtual-authenticators-and-mailpit-part-2-4j4i)
- [Email verification testing in Playwright with Mailpit — DEV Community (ZeroDrop)](https://dev.to/zerodrop/how-to-test-email-verification-flows-in-playwright-mailpit-mailhog-and-a-no-setup-alternative-2444)
- [retain-on-failure trace mode discussion — GitHub #29531](https://github.com/microsoft/playwright/issues/29531)
