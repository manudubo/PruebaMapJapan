# Domain Pitfalls — v3.0 Quality, Polish & DevX

**Domain:** Brownfield full-stack MPA — Hono + Cloudflare Workers + Keycloak 26.6.1 + Vanilla TS
**Researched:** 2026-05-28
**Confidence:** MEDIUM-HIGH (stack-specific pitfalls grounded in existing codebase context + verified sources)

---

## 1. Dev Environment Script (Cross-Platform, Docker Desktop, Service Ordering)

### Pitfall 1.1: Windows Docker Desktop daemon detection is not portable

**What goes wrong:** The common detection idiom `docker info` exits 0 on macOS/Linux even when
the daemon is slow, but on Windows with Docker Desktop it exits non-zero when the WSL2 VM has not
fully initialised. A script that treats exit-code 0 as "ready" will race through and fail on
`docker compose up` with a cryptic socket error.

**Why on this codebase:** The project targets Windows + macOS/Linux developers (current env:
`win32`). The Docker Compose stack includes Postgres + Keycloak + Mailpit — three containers
that must start before the backend can connect. Any startup script that does not wait for each
healthcheck will produce connection-refused errors that look like backend bugs, not script bugs.

**Prevention:** Use `docker compose up -d` followed by explicit healthcheck polling rather than
relying on `docker info`. For Windows, use a retry loop before calling `docker info`. Keep one
bash entrypoint and let PowerShell call it — do not maintain two separate startup scripts.

**Detection:** Script exits 0 but backend errors on first API call. Postgres or Keycloak container
log shows "starting up" when the backend has already been started.

**Phase:** Dev environment script phase.

---

### Pitfall 1.2: Keycloak readiness race causes a wall of 401s until KC is fully up

**What goes wrong:** Keycloak 26 takes 15-30 seconds to reach its `/health/ready` endpoint after
the Docker healthcheck reports healthy. If the backend starts before the OIDC discovery endpoint
is reachable, every JWKS fetch in `backend/src/auth/keycloak.ts` fails and every authenticated
API request returns 401 until the backend process is restarted. The cache does not store failed
fetches (verified: the cache write at line 140 only executes when `getKeycloakJwks` fully
succeeds), so each request retries the fetch — but since KC is still coming up, all requests
during that window fail. From the developer's perspective, the backend "doesn't work" and the
symptom disappears only after KC is fully ready AND the backend is restarted.

**Why on this codebase:** The 1-hour JWKS cache stores successful fetches only. Before KC is
ready, each request to the backend triggers a fresh failed fetch, so the entire dev session
during the KC startup window produces 401 errors regardless of the access token being valid.
The startup script has no mechanism to block the backend until KC is actually ready.

**Prevention:** Startup script must poll `{KEYCLOAK_URL}/health/ready` (not the Docker healthcheck)
and block the backend start until it returns 200. With KC ready before the backend starts, the
first JWKS fetch succeeds and is cached for 1 hour.

**Detection:** All API requests return 401 immediately after dev stack startup. KC container log
shows successful startup. Restarting the backend process resolves the issue without touching KC.

**Phase:** Dev environment script phase.

---

### Pitfall 1.3: Interleaved output from parallel service starts hides the actual failing service

**What goes wrong:** Starting `tsx watch src/dev.ts` (backend), `vite dev` (frontend), and Docker
Compose in background processes causes their stdout/stderr to interleave. When Postgres or Keycloak
fails to start (e.g., port 5432 or 8080 already occupied), the error is buried in the noise and
the developer diagnoses the wrong service.

**Prevention:** Use `concurrently` with `--prefix "[{name}]"` or structured log prefixes. Fail
fast: if any service exits with non-zero within 10 seconds of start, abort the whole script.
Ensure Docker Compose output is tailed in a named prefix separate from the Node.js processes.

**Detection:** Developer restarts the frontend assuming it is the problem; actually Postgres port
5432 is occupied by a previous run that was not shut down cleanly.

**Phase:** Dev environment script phase.

---

## 2. OAuth/OIDC Security Audit (Existing Keycloak + SPA)

### Pitfall 2.1: Accidentally re-broadening JWT audience that was already tightened in v2.0 Phase 1

**What goes wrong:** v2.0 Phase 1 tightened JWT audience validation from accepting `account` to
requiring `japan-trip-api`. An audit phase risks reverting this — either by reading the wrong
Keycloak client config, or via a Terraform change that resets the `VALID_AUDIENCES` environment
variable. The result is a broader-than-intended audience that silently passes JWT verification
while weakening the security boundary between services.

**Why on this codebase:** `backend/src/middleware/auth.ts` validates against the `VALID_AUDIENCES`
env var. The Terraform state and the `.env` file are separate sources of truth. A Terraform apply
that overwrites env var configuration can silently add `account` back to the list without any
runtime error — everything continues to work, the security posture degrades invisibly.

**Prevention:** Audit must diff Terraform-managed audience settings against the documented
post-v2.0 state (`japan-trip-api`, `japan-trip-frontend`). Add an explicit test assertion: a
token whose audience is only `account` must be rejected with 401. This test must be present
before any audit change is merged.

**Detection:** No runtime error. Only detectable via JWT payload inspection or an auth penetration
test that presents an `account`-only token.

**Phase:** OAuth/OIDC audit phase.

---

### Pitfall 2.2: keycloak-js 26.2+ logout confirmation screen on session expiry

**What goes wrong:** When a user's Keycloak SSO session expires (not just the access token),
`keycloak.updateToken()` rejects with a falsy error and clears tokens from memory. When
`keycloak.logout()` is subsequently called without an `id_token_hint`, KC 26.2+ follows the
OIDC RP-Initiated Logout spec strictly — if a session is present and no `id_token_hint` is
supplied, it shows a "do you want to log out?" confirmation screen. The user sees an unexpected
Keycloak page instead of a clean redirect to login.

**Why on this codebase:** The frontend already sets `onTokenExpired` to call `refreshToken()`.
When the SSO session (not just the access token) has expired, `updateToken()` rejects, the catch
block fires, and the subsequent `keycloak.logout()` has no `id_token_hint`. This is a known issue
in `keycloak-js` tracked in issue #124 of the official keycloak-js repo.

**Prevention:** In the `onTokenExpired` catch handler, do not call `keycloak.logout()` as a
first resort. Attempt `keycloak.login({ prompt: 'none' })` to silently re-establish the session.
If that also fails, redirect to login with a user message — never call `keycloak.logout()` from
a token-expired handler unless the id_token is still available.

**Detection:** Long-idle sessions show a Keycloak logout confirmation page instead of a clean
login redirect.

**Phase:** OAuth/OIDC audit phase.

---

### Pitfall 2.3: `silent-check-sso.html` path breaks if Vite base URL is changed

**What goes wrong:** `silent-check-sso.html` is served from `public/` and must be accessible at
the exact path keycloak-js constructs: `{origin}{BASE_URL}silent-check-sso.html`. If
`vite.config.ts` `base` is changed (e.g., for a staging build) or if the file is moved, silent
SSO silently fails on all pages — keycloak-js reports `check-sso` returning `false` and users are
redirected to login on every page load.

**Why on this codebase:** The file exists and works at `/PruebaMapJapan/`. An audit that
recommends a `silentCheckSsoRedirectUri` option change, or any Vite config adjustment, can break
this path without a loud error.

**Prevention:** Do not touch `silentCheckSsoRedirectUri` without verifying the served URL is
reachable. Add an E2E assertion that
`http://localhost:5173/PruebaMapJapan/silent-check-sso.html` returns 200 before any auth test
runs.

**Detection:** All pages show the login button even when the user has an active KC session. No JS
errors in the console.

**Phase:** OAuth/OIDC audit phase / E2E expansion phase (add the assertion there).

---

## 3. Keycloak FreeMarker Theme (Live System)

### Pitfall 3.1: FreeMarker template cache is not invalidated by file edits — requires KC restart

**What goes wrong:** Keycloak caches FreeMarker templates and `messages_*.properties` files in
memory. Even in Docker Compose local dev, the default configuration caches themes unless explicitly
disabled. Editing a `.ftl` or `.properties` file has no effect until KC is restarted. Developers
make changes, see no effect, and waste time debugging what is actually a cache issue.

**Why on this codebase:** The theme already has `es/en` FreeMarker variants. Iterating on design
consistency changes (new CSS tokens, Helvetica font, minimalist style) across multiple `.ftl`
macros requires fast feedback. Without cache-disabled mode locally, the feedback loop is broken.

**Prevention:** In the Docker Compose KC service environment block, add:
`KC_SPI_THEME_CACHE_THEMES=false`, `KC_SPI_THEME_CACHE_TEMPLATES=false`,
`KC_SPI_THEME_STATIC_MAX_AGE=-1`. These are officially documented KC development flags. The
startup script should set these automatically. On Railway (production), theme changes require a
full KC redeploy — document this in the runbook.

**Detection:** Theme file was edited, Docker Compose shows KC running, but the login page still
shows old styles. `docker compose restart keycloak` temporarily fixes it.

**Phase:** Keycloak theme / design consistency phase. The cache flags must be added before any
theme iteration work begins.

---

### Pitfall 3.2: Passkey campaign AIA templates are fragile — structural changes break enrollment flow

**What goes wrong:** The passkey campaign (Phase 8) uses Keycloak's Application-Initiated Action
(AIA) flow with custom FreeMarker to display the passkey enrollment prompt. If theme changes
rename or restructure the macros that the AIA flow renders — renaming template files, moving
`<#macro>` definitions, changing the `login.ftl` structure — the passkey enrollment page silently
renders the Keycloak default theme or breaks entirely.

**Why on this codebase:** The AIA passkey campaign is live and tested. Theme changes for design
consistency must not touch the macro structure of `login.ftl`, `login-passkey.ftl`, or the
AIA-related templates without verifying the passkey flow still works end-to-end. The passkey
Playwright spec (`passkeys.spec.ts`) is the verification gate.

**Prevention:** Any theme change must be followed by a run of `passkeys.spec.ts`. Do not
restructure macro inheritance chains without verifying the AIA flow renders correctly. Treat
the passkey AIA templates as the most fragile part of the theme.

**Detection:** Passkey enrollment prompt never appears after theme deployment. Keycloak logs show
template-not-found or render errors.

**Phase:** Keycloak theme / design consistency phase.

---

### Pitfall 3.3: `messages_*.properties` key collisions override built-in KC login strings

**What goes wrong:** Keycloak merges custom `messages_en.properties` with the built-in KC message
bundle at theme load time. If a custom key shadows a key used internally by Keycloak (e.g.,
`loginTitle`, `errorTitle`, `doLogIn`), the built-in strings change unexpectedly across all login
flows — including the OTP flow that has its own tested messages.

**Why on this codebase:** The existing theme has both `es` and `en` property files. Adding new
strings for the redesigned KC theme risks key naming collisions if the developer does not check
against the Keycloak 26 base message bundle.

**Prevention:** All new custom keys must use a project-specific prefix (e.g., `travelMap.*`) to
avoid clashing with KC built-ins. Before adding any key, verify it does not exist in the
Keycloak base theme messages at
`github.com/keycloak/keycloak/tree/main/themes/src/main/resources/theme/base/login/messages`.

**Detection:** OTP flow, error pages, or consent pages show unexpected English strings from the
custom bundle instead of Keycloak-translated versions.

**Phase:** Keycloak theme / design consistency phase.

---

## 4. Error Handling Retrofit (Vanilla TS MPA)

### Pitfall 4.1: Double-handling errors already caught by `api/client.ts`

**What goes wrong:** `frontend/src/api/client.ts` already throws `Error` on non-2xx and on
`success: false` envelopes. Adding error boundaries at the page level risks adding a second
`try/catch` around the same code path, which can either swallow the error silently (empty
`catch {}`) or display two separate error messages — one from the client throw and one from
the page handler catch.

**Why on this codebase:** The current pattern has page-level `try/catch` in `dashboard.ts` and
`tripDetail.ts` with bespoke error UI per page. A retrofit that wraps entire `DOMContentLoaded`
handlers in a single catch boundary catches auth errors, network errors, AND rendering bugs in
the same block — making error messages generic and hiding root causes.

**Prevention:** Distinguish error categories at the catch site before adding any boundary:
auth errors (redirect), network errors (show retry UI), API not-found errors (show inline message).
Retrofit one page at a time. Verify each error scenario with a Playwright test that asserts the
specific error message text, not just that no exception was thrown.

**Detection:** An API 404 for a non-existent trip shows a generic "Something went wrong" instead
of "Trip not found." A token expiry silently redirects without a user-visible message.

**Phase:** Error handling phase.

---

### Pitfall 4.2: `connectedCallback` async errors in Web Components produce undetectable silent failures

**What goes wrong:** `Navbar.ts` and `SearchBar.ts` use the pattern
`initKeycloak().then(...).catch(...)` inside `connectedCallback`. If a `.then()` step throws
synchronously (e.g., a DOM query returns null), the error does not propagate to the `.catch()` —
it becomes an unhandled rejection. Additionally, `window.addEventListener('unhandledrejection')`
does NOT reliably catch rejections from within Web Component promise chains in all browsers
because Shadow DOM creates a separate scope.

**Why on this codebase:** CONVENTIONS.md confirms Web Components use `.catch(() => { ... })`
rather than `try/catch`. The error handling retrofit must extend to Shadow DOM components. A
Navbar that silently fails to initialize does not show any error to the user.

**Prevention:** Convert Web Component async init logic to `async/await` with explicit `try/catch`
inside `connectedCallback`. Emit a custom event (`this.dispatchEvent(new CustomEvent('component-error'))`)
that the page can listen to and surface as visible UI. Do not rely on the global unhandledrejection
handler for Shadow DOM errors.

**Detection:** Navbar shows blank or stuck state when Keycloak is unavailable. No visible error.
Console shows an unhandled rejection only in Chromium DevTools, not in Firefox or Safari.

**Phase:** Error handling phase.

---

### Pitfall 4.3: Adding error UI containers to existing HTML breaks layout — must follow design system

**What goes wrong:** Adding error message containers (`<div class="error-banner">`) to existing
page HTML that was designed without them can break the CSS grid or flex layout — an error banner
inserted before `.trips-grid` pushes content down unexpectedly, or a `display: none` element
that becomes `display: block` disrupts the existing flow.

**Why on this codebase:** `frontend/src/styles/main.css` has hardcoded layout rules per page
container. There is no existing generic `.error-state` component in the design system. Adding
one while simultaneously applying design consistency means two changes at once with no clear
boundary — error UI will look inconsistent until both phases are complete.

**Prevention:** Define error UI components (`.error-banner`, `.error-inline`) in the CSS design
system first during the design consistency phase. Then retrofit error handling to use those
components. Never implement ad-hoc inline error containers per page — they will diverge visually.

**Phase:** Error handling phase. This phase should follow the design system / CSS tokens phase,
not precede it.

---

## 5. Playwright E2E Test Expansion

### Pitfall 5.1: New parallel specs that share `storageState` cause session invalidation races

**What goes wrong:** The existing test suite uses `globalSetup` + `storageState` to replay an
authenticated session. New tests that call any API endpoint that modifies auth state (logout, OTP
verify, passkey registration) running in parallel with auth-dependent tests will invalidate the
shared storageState mid-run, producing random 401 errors that are not reproducible in isolation.

**Why on this codebase:** `otp.spec.ts` already uses `test.describe.configure({ mode: 'serial' })`
specifically because Mailpit inbox contamination makes parallel execution incorrect. The same
principle applies to any test that touches KC session state. The CRITICAL v3.0 requirement —
full trip creation flow E2E — involves authenticated API calls for create/update/delete. Adding
this spec without configuring its isolation model will cause random failures under
`fullyParallel: true`.

**Prevention:** Any new spec file that creates, mutates, or deletes real data must either:
(a) use a dedicated test user provisioned exclusively for that spec, or (b) run in `serial` mode
with cleanup in `afterEach`. Never share a storageState file between a spec that mutates data
and specs that only read.

**Detection:** Tests pass in isolation (`npx playwright test trips.spec.ts`) but fail randomly in
the full suite. Failures occur on auth-related assertions, not on the specific operation being
tested.

**Phase:** E2E expansion phase.

---

### Pitfall 5.2: Stale `storageState` files committed to the repo cause mysterious CI failures

**What goes wrong:** If the auth storageState output file (e.g., `auth-state.json`) is committed
to the repo, it contains a session token with a KC-configured expiry (currently 300 seconds for
access tokens per realm config). After expiry, all E2E tests using that state file fail with 401
or Keycloak redirect — with no clear error message about the stale file being the cause.

**Why on this codebase:** `tests/global-setup.ts` generates this file at runtime. If the file
path is not in `.gitignore` and a developer commits it, CI will use the stale committed state
instead of regenerating fresh auth.

**Prevention:** Add `tests/*.json` and `tests/auth-state*.json` to `.gitignore`. Regenerate state
in `globalSetup` on every run. Never commit storageState files.

**Detection:** CI fails with auth errors immediately on a fresh checkout. Running locally with
fresh state passes. `git log -- tests/*.json` reveals a committed state file.

**Phase:** E2E expansion phase.

---

### Pitfall 5.3: New `page.goto()` calls outside the existing auth fixture break the `addInitScript` workaround

**What goes wrong:** The existing E2E suite uses a custom `addInitScript` workaround to handle
`sessionStorage` replay of Keycloak tokens (documented in PROJECT.md as Playwright bug #31108).
This workaround depends on the script being injected before `DOMContentLoaded`. New tests that
call `page.goto()` directly — outside the fixture that handles this injection — or that use
`waitUntil: 'networkidle'` can race the script injection, causing keycloak-js to initialize
before the stored token is injected.

**Prevention:** Any new `page.goto()` in auth-dependent tests must go through the existing auth
fixture. Do not implement custom navigation outside the fixture without understanding the
injection timing requirements. Use `waitUntil: 'commit'` as the earliest safe signal.

**Detection:** Auth-dependent tests work on first run but fail on retry. Playwright trace shows
keycloak-js initializing (console log visible) before the init script fires.

**Phase:** E2E expansion phase.

---

### Pitfall 5.4: Existing loose assertions mask regressions — must fix before adding new coverage

**What goes wrong:** TESTING.md documents that several existing assertions use
`expect(typeof x).toBe('boolean')` or always-true patterns — these never catch regressions.
When adding new E2E coverage for the trip creation flow (CRITICAL v3.0 requirement), developers
may assume "all tests pass = features work" when the existing passing tests are vacuous assertions.
New coverage built adjacent to vacuous tests may also adopt the same loose pattern.

**Prevention:** Before adding any new E2E coverage, audit and fix the existing loose assertions
in `trips.spec.ts` and `auth.spec.ts`. Replace `expect(typeof x).toBe('boolean')` with the
actual expected value. New tests must assert observable DOM state or specific response values,
not truthy booleans.

**Phase:** E2E expansion phase. Prerequisite: fix existing assertions before adding new coverage,
otherwise the phase produces a false sense of coverage completeness.

---

### Pitfall 5.5: "New user feature parity" E2E covers only the API rendering path, not the static ITINERARY path

**What goes wrong:** There are two trip rendering paths in the codebase: the legacy path
(`main.ts` + `map.ts` using the static `ITINERARY` object, for the Japan demo city pages) and the
user path (`tripDetail.ts` + `tripAdapter.ts`, converting API responses to `CityData`). The
CRITICAL v3.0 requirement — new users can build any trip with full demo capabilities — runs
entirely through the API/adapter path. However, the search module (`search.ts`) populates its
index from BOTH sources: it indexes static ITINERARY entries at mount time, then extends the
index with user API trips via a separate call. If the E2E test for "full trip creation flow"
does not verify that a newly created trip appears in search results, that integration is untested.
Similarly, if the Leaflet map initialization for user trips diverges from the static city pages,
the "parity" claim is incomplete.

**Why on this codebase:** `modules/search.ts` explicitly imports `ITINERARY` and also accepts
dynamic API trips via `buildSearchIndex` extension. A new E2E spec that only verifies map rendering
and activity display will miss the search integration. Additionally, `widgets.ts` uses `ITINERARY`
for weather/news — this does NOT apply to user-created trips, so those widgets will not appear on
user trip pages. This is correct behavior, but if the design assumes parity includes widgets, the
test must explicitly verify the absence of widgets on user trip pages rather than treating it as
a failure.

**Prevention:** The E2E spec for "new user feature parity" must explicitly cover:
(1) newly created trip appears in search results after creation,
(2) map renders with correct markers via the adapter path (not the ITINERARY path),
(3) weather/news widgets are intentionally absent on user trip pages.
Treat the two rendering paths as distinct code paths requiring distinct assertions.

**Detection:** A new user creates a trip and can view the map, but searching for the trip name in
the search bar returns no results. The bug is in the search index extension not being called after
trip creation, not in the map rendering.

**Phase:** E2E expansion phase / new user feature parity phase.

---

## 6. CSS Design System Retrofit

### Pitfall 6.1: CSS token rename misses Shadow DOM component styles inlined as TS template literals

**What goes wrong:** `Navbar.ts` and `SearchBar.ts` inline all styles as template literals inside
their `render()` method. Standard IDE refactoring tools (rename symbol) and CSS preprocessors
do not scan TypeScript string literals for CSS custom property references. A token rename from
`--color-bg` to `--surface-bg` applied via find-replace on `.css` files will miss every reference
inside `.ts` component files — those components silently fall back to `initial` (usually
transparent or browser default).

**Why on this codebase:** CONVENTIONS.md confirms: "All styles inlined in `render()` via template
literal using CSS custom properties for theming." There are at least 2 Web Components doing this.
The token names are embedded in TS string literals, not in any `.css` file that a CSS linter
would scan.

**Prevention:** Before renaming any token, use ripgrep across all file types:
`rg "var\(--old-token-name" --type ts --type css`. Because component styles are in string
literals, this is the only reliable detection method. Maintain a token manifest listing every
token and where it is consumed, including `.ts` files.

**Detection:** After a token rename, a Web Component renders with incorrect background or text
color. Chrome DevTools show `--new-token-name: initial` inside the Shadow root while the host
document correctly uses the new token value.

**Phase:** Design system / design consistency phase.

---

### Pitfall 6.2: `[data-theme]` attribute selector does not pierce Shadow DOM — breaks theme toggle

**What goes wrong:** The existing theme module sets `data-theme` on `document.documentElement`.
Global CSS rules like `[data-theme="dark"] { --color-bg: #111; }` do not pierce Shadow DOM —
elements inside a Shadow root do not respond to attribute selectors on the outer document. If
the design consistency work adds `[data-theme]` rule variants inside a Shadow root template
(e.g., `:host([data-theme="dark"]) { ... }`), those rules will never match because the attribute
is on `<html>`, not on the Shadow host.

**Why on this codebase:** CONVENTIONS.md states the correct pattern: components use CSS custom
properties for theming, not attribute selectors. But a developer implementing design consistency
changes inside Web Components may instinctively reach for `[data-theme]` selectors and produce
a theme toggle that works on the main document but not inside Navbar or SearchBar.

**Prevention:** Shadow DOM components must only consume custom properties — never use `[data-theme]`
attribute selectors internally. Custom properties inherit through the shadow boundary; attribute
selectors do not. Any theme variant inside a Shadow root must be implemented as a different custom
property value, not as a selector variant.

**Detection:** Light/dark toggle works on the main page body but Navbar or SearchBar does not
update. DevTools show Shadow root styles not responding to `data-theme` attribute change on
`<html>`.

**Phase:** Design system / design consistency phase; theme consistency phase.

---

### Pitfall 6.3: 12 HTML entry points without shared layout — visual drift is easy to miss

**What goes wrong:** The project has 12 HTML entry points each maintained individually. If design
system changes require adding or modifying `<link>` tags, font declarations, or class names in
each HTML file manually, it is easy to miss 1-2 files — leaving those pages with the old aesthetic.
There is no shared template or layout partial.

**Why on this codebase:** `frontend/vite.config.ts` has 12 separate `input` entries. CSS changes
that live in `main.css` (imported via `main.ts`) cascade to all pages correctly. Changes that
require per-file HTML edits do not.

**Prevention:** All shared design system changes — font face declarations, root token overrides,
global class changes — must live in `main.css` (imported via the shared entry point), never in
per-page `<style>` or additional `<link>` tags. After any global CSS change, run a visual smoke
test across all 12 pages.

**Phase:** Design system / design consistency phase.

---

## 7. Terraform Keycloak (Existing Managed Realm)

### Pitfall 7.1: Terraform drift on `webAuthnPolicyPasswordlessRpId` is catastrophic and irreversible

**What goes wrong:** PROJECT.md documents this as a known critical constraint:
`webAuthnPolicyPasswordlessRpId` must be set to the Railway prod hostname before any production
passkey registration. If a Terraform expansion plan changes the realm resource and Terraform
resets this field — due to drift detection or a resource import with a missing attribute — any
passkeys registered under the old rpId become permanently unusable. There is no migration path:
affected credentials must be deleted and re-registered.

**Why on this codebase:** The realm is already managed via Terraform with 16 resources. Adding new
resources (test users, additional clients) requires a `terraform apply` that plans ALL resources.
If `webAuthnPolicyPasswordlessRpId` is not explicitly set in HCL with the correct value, Terraform
may produce a diff that resets it to the provider default.

**Prevention:** Explicitly set `webAuthnPolicyPasswordlessRpId` in the `keycloak_realm` resource
HCL — do not leave it as a provider default. Add a `lifecycle { prevent_destroy = true }` to
the realm resource. Before any `terraform apply` that targets new resources, run `terraform plan`
and verify the realm resource shows "No changes." This verification step is mandatory.

**Detection:** After `terraform apply`, passkey-registered users cannot authenticate. Keycloak
logs show rpId mismatch or WebAuthn origin error. No automated alert — must be caught by running
`passkeys.spec.ts` after every Terraform apply.

**Phase:** Terraform expansion phase. First step: verify `rpId` is pinned in HCL before adding
any other resources.

---

### Pitfall 7.2: KC provider perpetual drift causes spurious plan churn that hides real changes

**What goes wrong:** The `terraform-provider-keycloak` has a known issue (tracked in provider
issue #1096) where attributes like `extra_config` and `default_default_client_scopes` on the
`keycloak_realm` and `keycloak_openid_client` resources are added by Keycloak after creation and
detected as drift on every subsequent `terraform plan` — even immediately after a successful
`terraform apply`. This creates perpetual "changes to apply" in CI drift detection, making it
impossible to distinguish real drift from provider noise.

**Why on this codebase:** 16 KC resources are already imported. Adding new resources requires
`terraform apply` — which will also attempt to reconcile drift on existing resources and may
modify live realm settings unexpectedly while "fixing" provider noise.

**Prevention:** Use `lifecycle { ignore_changes = [extra_config, default_default_client_scopes] }`
on affected resources. After any `terraform apply`, immediately run `terraform plan` and confirm
zero changes before merging. Consult the provider changelog for KC 26.x-specific drift-prone
attributes.

**Detection:** `terraform plan` always shows changes even immediately after `terraform apply`.
Review the diff carefully to identify whether changes are real or provider noise before applying.

**Phase:** Terraform expansion phase.

---

### Pitfall 7.3: Wrong import ID format creates duplicate KC resources on next apply

**What goes wrong:** `terraform import keycloak_openid_client.my_client {realm}/{clientId}` uses
the Keycloak client ID string (e.g., `japan-trip-api`), not the UUID. Other KC resources use
UUIDs. Importing with the wrong format may succeed with a malformed state entry that then causes
Terraform to create a second resource on the next `apply` — a duplicate client in Keycloak can
cause JWKS endpoint confusion or token validation failures.

**Prevention:** Before importing any KC resource, read the provider documentation for the exact
ID format (realm-scoped string vs UUID). After importing, run `terraform state show <resource>`
and verify the imported state matches the live KC object before running `apply`. Never run `apply`
immediately after `import` without a plan review step.

**Detection:** Keycloak admin console shows duplicate clients or required actions after `apply`.
`terraform plan` shows "create" for a resource that should already exist.

**Phase:** Terraform expansion phase.

---

## Phase-Specific Warnings Summary

| Phase | Pitfall | Severity |
|-------|---------|----------|
| Dev environment script | 1.2 — KC startup race causes 401 wall until KC ready and backend restarted | HIGH |
| Dev environment script | 1.1 — Windows Docker daemon detection not portable | HIGH |
| Dev environment script | 1.3 — interleaved output hides failing service | MEDIUM |
| OAuth/OIDC audit | 2.1 — JWT audience regression after audit changes | HIGH |
| OAuth/OIDC audit | 2.2 — keycloak-js 26.2+ logout confirmation on session expiry | HIGH |
| OAuth/OIDC audit | 2.3 — silent-check-sso.html breaks if Vite base changes | MEDIUM |
| Keycloak theme | 3.1 — FreeMarker cache blocks iteration; add disable flags first | HIGH |
| Keycloak theme | 3.2 — passkey AIA templates are fragile; run passkeys.spec.ts after every change | CRITICAL |
| Keycloak theme | 3.3 — messages_*.properties key collisions override built-in strings | MEDIUM |
| Error handling | 4.1 — double-handling errors already caught by api/client.ts | HIGH |
| Error handling | 4.2 — connectedCallback async errors undetectable in Shadow DOM | HIGH |
| Error handling | 4.3 — error UI containers must follow design system; phase ordering matters | MEDIUM |
| E2E expansion | 5.1 — parallel specs sharing storageState cause auth races | HIGH |
| E2E expansion | 5.4 — existing loose assertions mask regressions; fix before adding new coverage | HIGH |
| E2E expansion | 5.5 — new user parity E2E must cover search index extension and dual rendering paths | HIGH |
| E2E expansion | 5.2 — stale storageState committed to repo breaks CI | MEDIUM |
| E2E expansion | 5.3 — addInitScript workaround breaks with raw page.goto() | MEDIUM |
| Design system | 6.1 — token rename misses Shadow DOM TS template literals | HIGH |
| Design system | 6.2 — [data-theme] selector does not pierce Shadow DOM | HIGH |
| Design system | 6.3 — 12 HTML entry points drift if changes are per-file | MEDIUM |
| Terraform | 7.1 — webAuthnPolicyPasswordlessRpId drift is CATASTROPHIC and irreversible | CRITICAL |
| Terraform | 7.2 — perpetual drift churn hides real changes | HIGH |
| Terraform | 7.3 — wrong import ID format creates duplicate KC resources | MEDIUM |

---

## Sources

- [keycloak-js logout id_token_hint issue #124](https://github.com/keycloak/keycloak-js/issues/124) — HIGH confidence (official repo issue, KC 26.2+)
- [Keycloak FreeMarker cache discussion #8628](https://github.com/keycloak/keycloak/discussions/8628) — HIGH confidence (official repo)
- [Keycloak gzip cache invalidation issue #19675](https://github.com/keycloak/keycloak/issues/19675) — HIGH confidence (official repo)
- [Terraform KC provider drift issue #1096](https://github.com/keycloak/terraform-provider-keycloak/issues/1096) — HIGH confidence (official repo)
- [Playwright auth documentation](https://playwright.dev/docs/auth) — HIGH confidence (official docs)
- [Playwright global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown) — HIGH confidence (official docs)
- [CSS custom properties in Shadow DOM — web.dev](https://web.dev/articles/custom-properties-web-components) — HIGH confidence (authoritative)
- [Shadow roots and inheritance — CSS-Tricks](https://css-tricks.com/shadow-roots-and-inheritance/) — MEDIUM confidence
- [Keycloak securing apps — OIDC layers](https://www.keycloak.org/securing-apps/oidc-layers) — MEDIUM confidence (official docs)
- Codebase: ARCHITECTURE.md, CONCERNS.md, CONVENTIONS.md, TESTING.md, PROJECT.md (this repo) — HIGH confidence (primary source)
- Codebase: `backend/src/auth/keycloak.ts` lines 99-142 — JWKS cache write-on-success only, verified — HIGH confidence
- Codebase: `frontend/src/modules/search.ts`, `frontend/src/modules/map.ts` — dual rendering paths, verified — HIGH confidence
