# Phase 15 Triage — Full Suite Run

**Date:** 2026-06-21
**Config:** Post-SETUP-02 (passkeys scoped to chromium-passkeys)
**Command:** `npx playwright test --trace retain-on-failure --retries 1 --reporter=list`
**Traces:** `tests/test-results/` (not committed)
**Summary:** 210 passed, 18 failed, 39 did not run (12.1 min)

> **Note:** A preliminary run before `npx playwright install` was done showed 139 failures
> because webkit binary was missing. The authoritative run below was done after running
> `npx playwright install` in `tests/`. Webkit now executes correctly.

## Failure Table

| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |
|------|-----------|-----------------|--------------|-----------------|
| accessibility.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| auth.spec.ts | chromium, firefox, webkit | Pass (unauthenticated tests) | N/A | N/A |
| auth.spec.ts (real-session) | firefox, webkit | Fail | config-bug | Phase 18 |
| city-pages.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| geocoder.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| idp-theme.spec.ts | chromium | Fail | unknown | Phase 18 |
| idp-theme.spec.ts | firefox, webkit | Pass | N/A | N/A |
| landing.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| new-user-trip-creation.spec.ts | chromium, firefox | Pass | N/A | N/A |
| new-user-trip-creation.spec.ts | webkit | Fail | missing-fixture | Phase 16 |
| otp.spec.ts | chromium, firefox, webkit | Fail | contract-mismatch | Phase 17 |
| passkeys.spec.ts | chromium-passkeys | Fail | missing-fixture | Phase 17 |
| passkeys.spec.ts | chromium / firefox / webkit | Skip(testIgnore) | N/A | N/A |
| public-sharing.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| pwa.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| search.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| session-management.spec.ts | chromium, firefox, webkit | Fail | contract-mismatch | Phase 18 |
| trip-edit-integration.spec.ts | chromium, firefox, webkit | Fail | missing-fixture | Phase 16 |
| trip-edit.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| trips.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |
| ui-consistency.spec.ts | chromium, firefox, webkit | Pass | N/A | N/A |

## Failure Detail

### otp.spec.ts [chromium, firefox, webkit] — contract-mismatch → Phase 17
`Expected status: 200, Received: 401` on `/api/auth/otp-request`.
Spec calls the route unauthenticated with `{email, code}` via bare `request` fixture — cannot
carry a Bearer JWT. Route is gated behind `authMiddleware` (`backend/src/routes/auth.ts:92`).
This is the known contract-mismatch from the stale v3.0 baseline. Resolution requires a product
decision: step-up auth (intentional) vs regression (make route public). Consistent across all
three browser projects (not auth-state dependent — uses `request` fixture directly).

### idp-theme.spec.ts [chromium only] — unknown → Phase 18
"login theme hides default header and renders app exit action". Fails only under chromium
(where storageState is configured). Passes under firefox/webkit (which do NOT have storageState
and thus see the actual KC login page). Strongly suggests the KC SSO session skip hypothesis:
storageState causes KC to bypass the login page entirely, so the theme cannot be tested.
RESEARCH.md candidates: SSO skip, PKCE `code_challenge=aaa...` rejection by KC 26,
`#kc-header-wrapper` missing in KC 26 template. Pre-emptive fixes: `test.use({ storageState:
{ cookies: [], origins: [] } })` and real PKCE S256 challenge pair.

### session-management.spec.ts [chromium, firefox, webkit] — contract-mismatch → Phase 18
"login creates a KC server-side session". The `loginViaBrowser()` helper in
`session-management.spec.ts:67` waits for `input[name="username"], #username` to be visible but
it never renders (or times out filling it). KC 26 with WebAuthn-first flow shows a different
form first — the helper assumes a username+password combined/two-step form that doesn't match
the actual KC flow shape. KC logs show repeated "REQUIRED and ALTERNATIVE elements at same
level" for `webauthn-authenticator-passwordless` — the flow is WebAuthn-first, not
password-first. Fix requires live KC walkthrough to determine the actual form sequence, then
extract a shared `loginViaKcForm()` helper. See RESEARCH.md §Structural Risk.

### trip-edit-integration.spec.ts [chromium, firefox, webkit] — missing-fixture → Phase 16
"P2-V1: trip-edit page loads; metadata form pre-fills from API @integration". Times out at 90 s
waiting for `page.waitForRequest(url includes /api/ AND Authorization: Bearer)`. The trip-edit
page does not currently make an authenticated API request on load — the fetch behavior doesn't
exist yet. "@integration" tag and "P2-V1" label indicate this test was pre-written for Phase 16
(trip edit API integration). Fails consistently across all three browser projects including
chromium with storageState — confirming this is missing implementation, not an auth issue.

### auth.spec.ts — real-session [firefox, webkit] — config-bug → Phase 18
"authenticated dashboard does not show login prompt" / "authenticated dashboard renders trips
grid". The dashboard shows `#dashboard-login-prompt` as visible (expected hidden) and
`#trips-grid` as hidden (expected visible). Firefox and webkit do NOT have
`storageState: '.auth/user.json'` configured — they run without KC auth cookies and land in
the unauthenticated state. The "real session" auth tests are structurally unable to pass
under firefox/webkit until storageState is added to those project configs OR these tests are
scoped to chromium-only via `test.use({ browserName: 'chromium' })`.

### new-user-trip-creation.spec.ts [webkit only] — missing-fixture → Phase 16
"NU-01: full trip creation flow — empty dashboard to delete". `beforeAll` timeout: creates a
browser context from `tests/.auth/new-user.json` then calls `getToken()` which waits for an
API request with Bearer auth. The new-user fixture either doesn't exist for webkit or the
`beforeAll` fails to authenticate because webkit also lacks storageState at the project level
(context is created manually with `.auth/new-user.json` but the auth flow fails). Passes
under chromium and firefox. Root cause: webkit handles the Keycloak redirect differently
or `new-user.json` doesn't exist. Note: this spec uses a manual context, not the project
storageState, so the project-level config-bug above doesn't fully explain it.

### passkeys.spec.ts [chromium-passkeys] — missing-fixture → Phase 17
All 3 passkey tests timeout at 30 s waiting for:
`[data-action="register-passkey"], #register-passkey-btn, button:has-text("Register passkey")`
The register passkey button doesn't exist or doesn't match any of these selectors on the
profile page. This is a newly surfaced failure — SETUP-02 removed the config-bug (false
firefox/webkit failures) and exposed the underlying UI implementation gap. The passkey
registration button is not yet rendered on the profile page.

## Notes

### SETUP-02 confirmed — passkeys.spec.ts NOT in firefox/webkit failures
passkeys.spec.ts does not appear as Fail under firefox or webkit. SETUP-02 is working correctly.

### BASELINE DISCREPANCY: public-sharing.spec.ts PASSES (all projects)
Stale v3.0 baseline listed public-sharing.spec.ts as Fail (missing-fixture). This run shows
it PASSES under chromium, firefox, AND webkit. Either the fixture was added in v3.0 work or
the seed data now satisfies the spec. Treat as GREEN for Phase 16 planning.

### idp-theme.spec.ts passes under firefox and webkit
This is diagnostic: if the KC theme test only fails when storageState is active (chromium),
the issue is KC skipping the login page for pre-authenticated users. The theme itself is
probably correct; the test needs a different approach to load the KC login page.

### 39 did not run
Consistent across both runs. These are tests with `test.skip()` / `test.fixme()` guards or
tests whose `beforeAll` fails cascading to abort remaining tests in the same file.

### env prerequisite for future runs
1. `cd tests && npx playwright install` — run once per machine to install webkit/firefox/chrome
2. `Remove-Item tests\.auth\user.json` (or `rm tests/.auth/user.json`) — delete before each
   triage run to ensure global-setup creates fresh KC auth. Stale auth causes spurious failures
   in session-management and trip-edit-integration.
