# E2E Failure-Pattern Research: Auth-Dependent Spec Categories

**Domain:** Playwright E2E suite stabilization for a Keycloak-backed (OIDC PKCE) full-stack app
**Researched:** 2026-06-15
**Confidence:** MEDIUM overall (HIGH for spec-grounded findings verified directly against repo code; MEDIUM/LOW for general Playwright/Keycloak ecosystem claims — flagged inline)

## Scope and Method

This is not a product-feature research doc — v3.1 is pure E2E stabilization, no new features. Per
the question and quality gate, this file inventories **common root causes of failure** for the 5
spec categories named in the milestone, tags each cause **[APP BUG | TEST BUG | ENV/TIMING]**, and
notes likelihood/complexity and infra dependencies. Findings are grounded by reading the actual spec
files, `global-setup.ts`, `playwright.config.ts`, and the fixtures (`kc-admin.ts`, `mailpit-helpers.ts`)
in this repo — not generic Playwright folklore. Spec-grounded findings are marked HIGH confidence;
general ecosystem patterns (used to fill gaps / sanity-check) are marked MEDIUM or LOW.

**Critical infra fact confirmed by reading `tests/playwright.config.ts`:** the `chromium`, `firefox`,
and `webkit` projects have no `testMatch`/`testIgnore`. Only the `chromium-passkeys` project scopes
explicitly to `passkeys.spec.ts` (via `testMatch: ['**/passkeys.spec.ts']`). This means
`passkeys.spec.ts` also runs under **all four projects**, including firefox and webkit.
`page.context().newCDPSession()` (used throughout `passkeys.spec.ts` for the WebAuthn Virtual
Authenticator) is a Chrome DevTools Protocol API — **Chromium-only**. Firefox and WebKit do not
implement CDP. Confidence: HIGH (read directly from config + spec file).

---

## Failure Landscape by Spec Category

### 1. Keycloak IDP-themed login page assertions (`idp-theme.spec.ts`)

**Expected behavior:** Custom FreeMarker KC theme hides the default KC header, renders a themed "exit"
action linking back to the app (not to KC's logout endpoint), and matches the app's `--jp-*` design
tokens (border-radius 0, Inter font).

**Common root causes:**

| Cause | Tag | Likelihood | Notes |
|---|---|---|---|
| Theme assertions drifted after a design-system change (Phase 10 unified `--jp-*` tokens across app + KC themes; any FreeMarker/CSS tweak since could break exact `toBe('0px')` / `toContain('Inter')` checks) | **TEST BUG** (stale assertion) or **APP BUG** (regressed theme) — must diff against current FreeMarker template to tell apart | Medium-High | Single most fragile pattern in the file: pixel/string-exact CSS assertions against a theme that has been actively iterated on across two prior phases. |
| KC not running / `beforeEach` skip silently masks failures | ENV | Low | Test already guards with `test.skip(!response?.ok())` — if this fires, the test reports as skipped, not failed, so it shouldn't appear in a "failing" list unless KC really is down during triage. |
| `code_challenge` value is a fixed dummy string (`'aaaa...'`, 43 chars) — if KC enforces stricter PKCE validation (e.g. rejects malformed/low-entropy challenges before reaching the login page) the redirect could 400 before the themed page ever renders | **APP/ENV boundary** — could be a KC version/config behavior change | Low-Medium | Phase 13 added "PKCE S256 enforced server-side" — worth confirming this dummy challenge still passes KC 26.6.1's format check (43-128 char unreserved charset) after that hardening pass. |
| Exit link href regex anchored to `/PruebaMapJapan/?$` — base path or routing changes silently break this | TEST BUG | Low | Static assertion, easy to verify directly against rendered HTML. |

**How to triage:** Load the LOGIN_URL manually in a browser, inspect `#kc-header-wrapper` and
`.jp-idp-exit`, diff actual computed styles against the assertions. This spec has no auth-state
dependency, so failures are almost certainly either a real theme regression or a stale assertion —
not flake.

---

### 2. Email OTP flows via Mailpit (`otp.spec.ts`)

**Expected behavior:** POST `/api/auth/otp-request` sends a 6-digit code via Mailpit SMTP; POST
`/api/auth/otp-verify` validates it; codes expire after 10 min; 5 failed attempts lock out; OTP-based
login does not force `UPDATE_PASSWORD` on WebAuthn-capable devices.

**Common root causes:**

| Cause | Tag | Likelihood | Notes |
|---|---|---|---|
| `fetchLatestOtp()` calls Mailpit's REST API immediately after the `otp-request` POST resolves with **no poll/retry loop** — if SMTP delivery to Mailpit has any async lag, the inbox-list call races the message landing | **ENV/TIMING** | Medium | Confirmed in `mailpit-helpers.ts:19-29` — single GET, no retry/backoff. Classic flake pattern even against a fast local relay; widens under parallel/CI load. Fix pattern: poll with backoff until `messages.length > 0` or a timeout elapses, not a single fetch. |
| `fetchLatestOtp()` always takes `data.messages[0]` (latest) — if `purgeInbox()` in `beforeEach` doesn't fully complete before a previous test's email is still arriving, a stale code could be picked up | **ENV/TIMING** | Low-Medium | Serial mode mitigates cross-test races but not the request→delivery lag within a single test. |
| The `UPDATE_PASSWORD gate` test fills `getByLabel(/username\|email/i)` then **directly** `getByLabel(/password/i)` with no "Try Another Way → Password" navigation step that `global-setup.ts` and `session-management.spec.ts` both perform to reach the combined form | **TEST BUG** | High | Internal inconsistency: two other login flows in this same codebase explicitly handle a WebAuthn-first KC flow that hides the password field until "Try Another Way" is clicked. This OTP test assumes the password field is immediately visible. If the realm's browser flow is WebAuthn-first (consistent with Phase 8's "passkey campaign"), this test times out waiting on `getByLabel(/password/i)` — a real test bug, not flake. |
| `clearOtpCodes()` / `expireOtpCodes()` query Postgres directly via `email_otp_codes` table — if a migration renamed columns/the table, or the `users.email` join changed, these silently affect 0 rows rather than erroring | **APP BUG (schema drift)** or **TEST BUG (stale query)** | Low | Worth a direct schema check during triage rather than trusting the helper. |
| Lockout test sends 5 bad codes then expects `[400, 429]`; if the backend's actual lockout status code changed outside that set, the assertion fails for a reason unrelated to lockout logic itself | TEST BUG (if status changed) | Low | Confirm actual returned status during triage. |
| Serial mode (`test.describe.configure({ mode: 'serial' })`) is documented as "mandatory" — if dropped, OTP tests interleave and race on the shared Mailpit inbox | ENV/TIMING (config regression) | Low (currently present) | Confirmed present in file — flag as a regression trip-wire, not a current failure. |

**How to triage:** Run `otp.spec.ts` alone, serially, with a screenshot/DOM dump on the
UPDATE_PASSWORD test to see whether the password field is hidden behind a "Try Another Way" link.
That single check likely explains most of this category's failures.

---

### 3. WebAuthn/passkey flows via Playwright CDP (`passkeys.spec.ts`)

**Expected behavior:** Register a passkey via CDP Virtual Authenticator on `profile.html`; log in via
KC's passwordless/discoverable-credential flow using a transferred credential; last-credential
deletion is blocked by a guard.

**Common root causes:**

| Cause | Tag | Likelihood | Notes |
|---|---|---|---|
| **Spec runs under `firefox` and `webkit` projects** (no `testIgnore` scoping them out) and calls `page.context().newCDPSession(page)`, a Chromium-only API | **TEST BUG (infra/config)** | **Very High** | Highest-value finding in this research. `chromium-passkeys` correctly scopes via `testMatch`, but the default `chromium`, `firefox`, `webkit` projects have no exclusion, so this file also runs there. CDP session creation throws on firefox/webkit, producing failures that look like "passkeys broken" but are actually a test-config gap. Fix: add `testIgnore: ['**/passkeys.spec.ts']` to `firefox`/`webkit` (and arguably plain `chromium`, since `chromium-passkeys` already covers Chromium). This alone likely explains a large share of the milestone's "passkeys ×3" failure count — 3 tests × 3 incompatible/duplicate projects = many failures from one root cause. |
| `hasUserVerification`/`isUserVerified` flags on `WebAuthn.addVirtualAuthenticator` must match what KC's WebAuthn policy requires (e.g. `userVerification: required`) — a mismatch causes KC to reject the assertion/registration, often with a generic/silent error | **APP/ENV config coupling** | Medium | Inline comment already flags "CRITICAL: correct spelling," implying this broke once before from a typo. KC WebAuthn-policy ↔ CDP-flag mismatches are a known general source of cryptic failures (MEDIUM confidence, general pattern, not verified fresh this session). |
| Locators use multiple fallback selectors (e.g. `[data-action="register-passkey"], #register-passkey-btn, button:has-text("Register passkey")`) — if current markup matches none of the three, the test times out with a vague "element not found" rather than a clear failure | TEST BUG (selector drift) or APP BUG (markup regression) — ambiguous without checking current `profile.html` | Medium | Multi-selector fallbacks suggest past breakage from markup churn; check current `profile.html`/`profile.ts` directly during triage. |
| All passkey tests consume `.auth/user.json` + `.auth/session.json` produced by `global-setup.ts`'s `kcLogin()` (20-min freshness window) — if that login fails or goes stale, every passkey test starts unauthenticated and the registration flow never begins | **ENV/TIMING (shared fixture staleness)** | Medium | Direct dependency on `global-setup.ts` succeeding; a slow run or a KC flow change that breaks `kcLogin()`'s navigation cascades into every spec consuming `.auth/user.json`, not just passkeys. |
| `login with passkey via KC login form` test transfers a CDP-captured credential to a new context/authenticator, then relies on KC auto-asserting via discoverable credential OR a fallback button click — if KC requires explicit UI interaction before invoking `navigator.credentials.get()` (conditional-UI behavior varies by KC version), auto-assertion may never fire, and the fallback locator may not match current theme markup | **APP/ENV (KC version behavior)** or **TEST BUG (selector drift)** | Medium | Most complex test in the suite — multi-context, multi-CDP-session, two fallback paths. High inherent fragility independent of any real passkey bug. |
| `delete passkey is blocked when last credential` test's guard-message locator includes a broad `[role="alert"]` fallback — Phase 11 added a centralized `toast.ts`; any unrelated toast rendered with `role="alert"` during this flow could make the assertion pass even if the specific last-credential guard text never appeared | **TEST BUG (over-broad assertion masking real bugs)** | Low-Medium | This locator risks a false-green, not just a false-red — worth tightening during the fix, since it currently could hide a regressed guard. |

**How to triage:** Fix the project-scoping issue first (cheap, mechanical, high-confidence win).
Re-run only under `chromium-passkeys` to isolate genuine WebAuthn/KC-flow issues from
browser-incompatibility noise. Only then debug remaining Chromium-specific failures.

---

### 4. Public link/sharing flows (`public-sharing.spec.ts`)

**Expected behavior:** Public trips are readable without auth via `?slug=`; private trips 404 even
with a known slug; invalid slugs 400; guest view hides owner-only controls (edit link, copy-link
button); unauthenticated `?tripId=` access shows an access-denied message.

**Common root causes:**

| Cause | Tag | Likelihood | Notes |
|---|---|---|---|
| Hardcoded UUIDs (`PUBLIC_SLUG`, `PRIVATE_SLUG`) and `PUBLIC_TRIP_ID = '1'` with an exact-match assertion `body.data.name === 'Japan 2026'` — the spec has **no setup/seed step of its own**; it assumes specific rows already exist in whatever DB the run points at | **ENV (stale fixture/seed data)** | **High** | Strongest "stale data" candidate in the whole milestone. Any DB reseed, migration, or renamed trip between v3.0 and now breaks this deterministically, unrelated to actual app correctness. No `beforeAll` creates/restores this fixture — it's an implicit, undocumented dependency on dev-seed state. |
| `isBackendRunning()` health check only verifies status `< 500` — a backend that's up but returns unexpected 4xx for `/api/health` (e.g. if it became auth-gated post security-hardening) could cause `test.skip()` to fire when the backend is actually fine, masking real failures as "skipped" | TEST BUG (weak health check) | Low | Confirm `/api/health` is still public/unauthenticated post Phase 13 audit. |
| Guest-view test asserts `#trip-title` `!= 'Cargando viaje…'` (Spanish loading placeholder) — Phase 5 translated all UI strings to English, so this **negative** assertion can never meaningfully fail (it'll never equal a now-nonexistent Spanish string), masking a potential timing bug where the title never actually loads | **TEST BUG (weakened assertion post-i18n)** | Medium | Quietly dangerous: the assertion can't fail the way it was designed to. Should assert positively (title is non-empty and not the *current*-locale loading text) to actually catch a stuck-loading state. |
| `?tripId=` access-denied test asserts `text.toContain('access')` against `#main-content` — broad substring match; if error UI (Phase 11's centralized `toast.ts`) moved this message to a toast outside `#main-content`, or reworded it without the substring "access," this fails for a UI-restructuring reason unrelated to whether access control itself is correct | **TEST BUG (selector/copy drift)** or **APP BUG (access-denied UI removed)** — ambiguous without checking current DOM | Medium | Check current rendered DOM for this state directly during triage. |

**How to triage:** First confirm the seed data exists with those exact IDs/slugs/names in the current
dev DB (e.g. `SELECT id, name, share_slug, is_public FROM trips WHERE id = 1`). If it doesn't, this
entire category is a stale-fixture problem — fixable by reseeding deterministically (a `beforeAll` or
global-setup step) or updating the hardcoded values to match current seed data, not an app bug.

---

### 5. Session / token-refresh management (`session-management.spec.ts`)

**Expected behavior:** Login creates a KC server session; logout destroys it and clears app
`sessionStorage`; closing a tab does not kill the server session; opening a new tab in the same
browser context restores auth via silent check-sso; a new browser context (no KC cookie) requires
re-login; logout in one tab propagates to other tabs on next navigation.

**Common root causes:**

| Cause | Tag | Likelihood | Notes |
|---|---|---|---|
| The file's own header comment states the browser-passkey flow schedules a `webauthn-register-passwordless` required action for users with no passkeys, and that `loginViaBrowser()` navigates via "Try Another Way" → Password to reach the combined form — explicitly flagged as needing restructuring "Phase 13" (not done per the comment) | **APP/KC-CONFIG (acknowledged, deferred)** | High | Clearest pre-existing, self-documented root cause in this entire research scope. If the realm's browser flow changed again since this comment was written (Phase 13's security audit, or any later passkey-flow tweak), `loginViaBrowser()`'s selector-chasing logic could silently stop matching — and **every test in this file** depends on `loginViaBrowser()` succeeding, so one KC flow change cascades into 6+ failures here alone. |
| `loginViaBrowser()` uses soft `.isVisible({timeout}).catch(() => false)` checks at each branch point — avoids hard failures on the "wrong" branch, but a genuinely broken KC flow degrades into a confusing downstream timeout on `#new-trip-btn` rather than a clear "could not find login form" error | TEST BUG (poor failure diagnostics, not necessarily wrong logic) | Medium | Keep the resilience but add an explicit assertion/log at each branch to make triage faster. |
| Every test calls `kcAdmin.logoutUser(TEST_USER)` (admin REST API) in `beforeEach`, then re-logs-in via the **browser** UI — two different code paths must both work and stay in sync; `logoutUser()` silently no-ops if the user isn't found (`kc-admin.ts:73-78`), so admin-client auth/permission drift (Terraform-managed worker client) could leave stale sessions without any error surfacing | **ENV (admin-client auth/permission drift)** or **APP BUG** | Low-Medium | Confirm `TEST_USER` resolves correctly given current Terraform-managed test users. |
| `mode: 'serial'` is required (tests mutate shared KC session state) — same risk class as OTP: dropping serial mode makes every test order-dependent flake | ENV/TIMING (config regression risk) | Low (currently present) | Confirmed present at time of research. |
| Repeated `page.waitForLoadState('networkidle')` calls to "settle" auth state — `networkidle` is a known-flaky wait condition when background polling exists; this app's weather/news widgets (`widgets.ts`) fetch external APIs on load and could keep the network "busy," delaying or destabilizing this wait | **ENV/TIMING** | Medium | General Playwright anti-pattern (MEDIUM confidence, well-documented community guidance against `networkidle` for SPA/iframe-heavy auth flows); this app's own background widgets make it a worse-than-average signal here. |
| `keycloak-js getToken()` previously had a bug where `updateToken(30)` threw when KC issued a token with no refresh token (e.g. post silent-check-sso) — already fixed per PROJECT.md decision log via an `isTokenExpired(30)` guard. A regression reintroducing unconditional refresh would break "new tab restores auth" / "cross-tab logout" tests with a thrown exception during check-sso | **APP BUG (regression of known-fixed issue)** | Low (already fixed; worth a regression check) | `frontend/src/auth/keycloak.ts` shows as locally modified per git status at session start — worth re-verifying the `isTokenExpired(30)` guard is still intact before assuming this is fine. |
| Cross-tab logout test depends on real propagation timing — KC server-side session destruction is immediate, but the app only updates on next navigation/check-sso in Tab B; caching (cache-control on the check-sso iframe, back/forward cache) could interfere intermittently | ENV/TIMING | Low-Medium | General SPA/BFCache caution (MEDIUM confidence, no direct repo evidence) — flagged as a known class of cross-tab E2E flake. |

**How to triage:** This file is the highest-leverage one to fix first within its category — nearly
every test funnels through the single `loginViaBrowser()` helper, so fixing that one helper to match
the *current* KC realm browser-flow shape likely resolves most failures in this file at once. Manually
walk the KC login flow in a real browser first to confirm what `loginViaBrowser()` should expect today.

---

## Cross-Cutting Patterns (apply to multiple categories)

| Pattern | Affects | Tag | Notes |
|---|---|---|---|
| **Shared `globalSetup` storageState dependency** | passkeys directly; any other spec consuming `.auth/user.json` indirectly | ENV/TIMING + cascading | If `kcLogin()` in `global-setup.ts` fails or its 20-min freshness window lapses mid-run, downstream specs fail for a reason unrelated to their own logic. Triage order matters: confirm `global-setup.ts` succeeds cleanly before trusting any spec-level failure as "real." |
| **Inconsistent KC-login-DOM handling across specs** | otp (UPDATE_PASSWORD test), session-management, global-setup | TEST BUG (inconsistency) | Two different "reach the password field" strategies coexist: the robust one (`global-setup.ts`, `session-management.spec.ts` — handles "Try Another Way" branching) and the naive one (`otp.spec.ts`'s UPDATE_PASSWORD test — assumes fields are immediately visible). This divergence means a single KC login-flow config change requires fixing logic in 3 separate places, and the naive one is a ticking time bomb. |
| **CDP/browser-engine scoping gap** | passkeys (confirmed) | TEST BUG (config) | See Section 3 — single highest-confidence, highest-leverage fix in this entire research. |
| **`SKIP_REAL_AUTH` guard coverage is inconsistent** | otp, passkeys, session-management explicitly `test.skip` on this env var; idp-theme and public-sharing instead self-skip via live health-check probes | Design choice, not inherently a bug, but a triage risk | Two different "is the environment ready" strategies coexist. During triage, a failing run should be checked against which strategy applies — a spec using the live-probe pattern that fails with connection errors (rather than skipping) suggests the probe itself may be misconfigured (wrong port/URL), not that the feature broke. |
| **Hardcoded local URLs/ports throughout** (`localhost:8080`, `:5173`, `:8787`, `:8025`) | all 5 categories | ENV | Standard for local-first E2E; not a defect, but port drift (another service occupying one of these) breaks everything indiscriminately and could be mistaken for a wave of unrelated app bugs. Worth one pre-triage step: confirm all 4 services (KC, backend, frontend, Mailpit) are listening on expected ports before triaging individual spec failures. |

---

## How to Distinguish App Bug vs. Test Bug vs. Environment/Timing (Triage Heuristic)

Use this decision sequence per failing spec, derived from the patterns above:

1. **Is the failure a connection error / timeout before any meaningful assertion runs?**
   Check ENV first: are KC, backend, frontend, Mailpit all up on expected ports? Is `global-setup.ts`'s
   storageState fresh (under 20 min old) and did `kcLogin()` succeed? This explains a disproportionate
   number of "failures" with one root cause.

2. **Does the failing spec run under a browser project incompatible with an API it calls**
   (CDP on firefox/webkit being the concrete case here)? TEST BUG (config) — fix project scoping,
   not app code.

3. **Is the assertion a hardcoded data value (UUID, name string, exact CSS value)?**
   Check whether that data/theme still exists/matches in the current environment. If not, it's
   ENV (stale fixture) or TEST BUG (stale assertion) depending on whether the underlying *intent*
   still holds — not an app bug.

4. **Does the spec's own helper function assume a KC login-flow shape that the codebase has already
   documented as different/changing** (the session-management.spec.ts header comment is a direct
   admission of this)? APP/KC-CONFIG, but already known — confirm whether it's gotten worse, not
   whether it exists.

5. **Only after 1–4 are ruled out**, treat the remaining failure as a candidate real app bug and debug
   the actual feature behavior (does the last-credential guard actually block deletion; does logout
   actually destroy the KC session server-side; etc).

This ordering matters because a large fraction of the named failing specs in this milestone
(idp-theme, otp, passkeys ×3, public-sharing, session-management) already have at least one
identifiable non-app-bug explanation visible directly in the code. The fresh triage run should expect
to close several of these as test/config/fixture fixes rather than product regressions, and should
budget the deepest debugging time for `passkeys.spec.ts` (login-with-passkey test, most complex
multi-context/multi-CDP flow) and `session-management.spec.ts` (`loginViaBrowser()`, most
acknowledged complexity) specifically.

## MVP Definition (Stabilization Framing)

### Fix First (mechanical, high-confidence, low-risk)
- [ ] `playwright.config.ts`: scope `passkeys.spec.ts` out of `chromium`/`firefox`/`webkit` projects (or into `chromium-passkeys` exclusively) — eliminates a CDP-incompatibility failure class entirely.
- [ ] `public-sharing.spec.ts`: verify/reseed the hardcoded fixture trip (`PUBLIC_SLUG`, `PRIVATE_SLUG`, `PUBLIC_TRIP_ID`, `'Japan 2026'`) against current dev DB state.
- [ ] `otp.spec.ts`: align the UPDATE_PASSWORD-gate test's login navigation with the "Try Another Way → Password" pattern already used by `global-setup.ts`/`session-management.spec.ts`.

### Fix After Verifying Current KC Flow Shape (requires manual walkthrough)
- [ ] `session-management.spec.ts`: re-validate `loginViaBrowser()` against the current realm browser-flow (acknowledged as pending restructuring in the file's own comment).
- [ ] `passkeys.spec.ts`: re-validate the "login with passkey" multi-context CDP flow against current KC WebAuthn policy/UI once browser-scoping noise is removed.

### Tighten After Green (correctness of the tests themselves, not blocking)
- [ ] `otp.spec.ts`: add poll/retry to `fetchLatestOtp()` instead of single-shot fetch.
- [ ] `public-sharing.spec.ts`: replace the stale Spanish-placeholder negative assertion with a positive, locale-correct one.
- [ ] `passkeys.spec.ts`: narrow the `[role="alert"]` fallback in the last-credential-guard locator to avoid false-positive matches against unrelated toasts.

## Feature/Failure Dependency Map

```
global-setup.ts (kcLogin / kcLoginNewUser)
    └──produces──> .auth/user.json, .auth/session.json
                       └──required by──> passkeys.spec.ts (test.use storageState)
                       └──indirectly required by──> any spec relying on default `chromium` project storageState

playwright.config.ts project scoping
    └──currently missing testIgnore──> passkeys.spec.ts runs under firefox/webkit
                                            └──fails──> page.context().newCDPSession() (Chromium-only API)

loginViaBrowser() (session-management.spec.ts)
    └──depends on──> current KC realm browser-flow shape (WebAuthn-first vs password-first)
                       └──same dependency, divergent implementation──> otp.spec.ts UPDATE_PASSWORD test (TEST BUG: naive variant)
                       └──same dependency, robust implementation──> global-setup.ts kcLogin()

public-sharing.spec.ts assertions
    └──depends on──> dev DB seed state (trip id=1 "Japan 2026", specific share slugs)
                       └──no test-owned setup step──> ENV/stale-fixture risk is structural, not incidental

otp.spec.ts Mailpit assertions
    └──depends on──> Mailpit REST API + SMTP delivery timing
                       └──no retry/poll──> ENV/TIMING race is structural, not incidental
```

## Sources

- Direct repository inspection (HIGH confidence, primary source for all spec-grounded claims):
  `tests/playwright.config.ts`, `tests/global-setup.ts`, `tests/e2e/idp-theme.spec.ts`,
  `tests/e2e/otp.spec.ts`, `tests/e2e/passkeys.spec.ts`, `tests/e2e/public-sharing.spec.ts`,
  `tests/e2e/session-management.spec.ts`, `tests/e2e/fixtures/kc-admin.ts`,
  `tests/e2e/fixtures/mailpit-helpers.ts`, `.planning/PROJECT.md`
- General Playwright/Keycloak ecosystem patterns (MEDIUM/LOW confidence, used only to corroborate or
  fill gaps, not to override repo evidence): CDP browser-engine scoping (Chromium-only, well-known
  Playwright/CDP architecture fact), `networkidle` flakiness in SPA/iframe-heavy auth flows (common
  community guidance), Mailpit/SMTP delivery-race patterns in OTP E2E testing, KC WebAuthn policy
  (`userVerification`) coupling to CDP virtual-authenticator flags. These are training-data-level
  claims, not freshly re-verified against current Playwright/Keycloak docs in this session — spot
  check if triage results don't match expectations.

---
*Failure-pattern research for: E2E Stabilization (v3.1 milestone)*
*Researched: 2026-06-15*
