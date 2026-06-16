# Architecture Patterns — E2E Test Suite Failure Analysis

**Domain:** Playwright E2E test architecture for OIDC/Keycloak-authenticated MPA
**Researched:** 2026-06-15
**Scope:** Root-cause hypotheses for 5 specs (idp-theme, otp, passkeys, public-sharing, session-management) ahead of v3.1 fresh triage run

## Summary verdict up front

Of the 5 specs, **2 have a confirmed, code-level root cause** (not infra flakiness), **1 has a confirmed data-fixture root cause**, and **2 are genuinely undetermined** pending the fresh triage run mandated by PROJECT.md. The suite is not five independent failures — there is one shared upstream chokepoint (`global-setup.ts`) and one shared fragile UI-navigation helper duplicated across three specs. Fix order should attack the chokepoint and the shared helper before touching individual specs.

## Recommended Architecture (as built)

```
playwright.config.ts
  └─ globalSetup: tests/global-setup.ts
       ├─ kcLogin()         → writes .auth/user.json + .auth/session.json       (testuser: e2e-test@local)
       └─ kcLoginNewUser()  → writes .auth/new-user.json + .auth/new-user-session.json (new_user_test)
       (freshness-gated: MAX_AGE_MS = 20 min; skipped entirely if SKIP_REAL_AUTH set)

  projects:
    chromium            → storageState: .auth/user.json (project-level, ALL specs in this project inherit it
                           unless they override with test.use())
    firefox / webkit     → no storageState (anonymous)
    chromium-passkeys    → testMatch: passkeys.spec.ts only, no project-level storageState
                           (passkeys.spec.ts sets its own test.use({storageState: '.auth/user.json'}))
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `tests/global-setup.ts` | Headless OIDC PKCE login for 2 personas (`testuser`, `new_user_test`); persists storageState + sessionStorage to `.auth/*.json` | Frontend (5173), Keycloak (8080) |
| `tests/e2e/fixtures/kc-admin.ts` | Keycloak Admin REST client (service account `japan-trip-worker`) + direct Postgres access for OTP table mutation | Keycloak Admin API, Postgres directly |
| `tests/e2e/fixtures/mailpit-helpers.ts` | Reads/purges the Mailpit SMTP test inbox for OTP codes | Mailpit REST API (8025) |
| `idp-theme.spec.ts` | Asserts on Keycloak FreeMarker theme + CSS output, no auth needed | Keycloak only (raw HTTP `request`, self-skips if KC unreachable) |
| `otp.spec.ts` | Drives backend `/api/auth/otp-request` + `/api/auth/otp-verify` directly via `request` fixture | Backend (8787), Postgres (via kcAdmin), Mailpit |
| `passkeys.spec.ts` | CDP WebAuthn Virtual Authenticator registration/login/delete-guard flows | Frontend, Keycloak, kcAdmin (credential reset) |
| `public-sharing.spec.ts` | Backend `/api/public/trips/:slug` contract tests + guest-view frontend tests | Backend only — no auth, no KC |
| `session-management.spec.ts` | Full KC session lifecycle (login/logout/multi-tab/multi-context) via real browser login | Frontend, Keycloak, kcAdmin (session introspection) |

### Data Flow — storageState lifecycle

1. `global-setup.ts` runs once per `npx playwright test` invocation (not per-spec, not per-worker).
2. It checks file mtime (`isStorageStateFresh()` / `isNewUserStorageStateFresh()`) against a 20-minute window — chosen to stay under KC's 30-minute idle timeout (`tests/global-setup.ts:16`).
3. If stale, `kcLogin()` drives a real headless Chromium browser through the actual KC login UI (including the "Try Another Way → Password" detour) and writes `.auth/user.json` (cookies + localStorage) and `.auth/session.json` (sessionStorage dump, since `keycloak-js` stores tokens in sessionStorage which Playwright's native `storageState()` cannot capture — Playwright bug #31108, documented in `tests/global-setup.ts:100-102`).
4. `playwright.config.ts:25` binds `.auth/user.json` at the **project level** for `chromium` — every spec running under that project inherits it unless it calls `test.use({ storageState: ... })` to override (otp.spec.ts does this deliberately at `otp.spec.ts:13` to run unauthenticated).
5. Specs that need the sessionStorage tokens replay them manually via `context.addInitScript()` in a `beforeEach` (passkeys.spec.ts:31-38, session-management does NOT need this because it logs in fresh via the browser each test).

## Per-spec dependency map and failure hypotheses

### idp-theme.spec.ts — confirmed-consistent with current code; likely environment/timing if failing

**Depends on:** Live Keycloak only (raw `request.get`), no app, no DB, no fixtures.

**Verification performed:** Checked all three hard assertions against current theme source, not just element existence:
- `#kc-header-wrapper` hidden — confirmed in `keycloak/themes/japan-trip/login/resources/css/login.css:281` (`display: none !important` on `#kc-header-wrapper`).
- `.jp-idp-exit` text "Return", `href` matching `/PruebaMapJapan/?$`, not pointing at the logout endpoint — confirmed in `keycloak/themes/japan-trip/login/footer.ftl:4`, driven by `theme.properties` `appUrl=http://localhost:5173/PruebaMapJapan/`.
- `border-radius: 0px` and `font-family` containing `Inter` — confirmed: `--jp-font` resolves to `'Inter', ...` (`login.css:23`), and `border-radius` defaults to the browser-initial `0px` for an anchor element (no override needed, no conflicting rule found).

**Verdict:** The spec's assertions are not stale relative to current theme code. If this spec fails in the fresh triage run, the cause is environmental — most likely KC not running/reachable on `localhost:8080` (the spec has a `beforeEach` skip guard for that), a PKCE `code_challenge` format the KC server rejects at the `/auth` endpoint before rendering the form, or `networkidle` timing flakiness on the WebAuthn conditional-UI script (the same class of timing issue `global-setup.ts:63` documents and works around elsewhere in the suite). **Confidence: MEDIUM** — code-level check is clean (HIGH), but no live run was performed, so an environment-specific cause is a hypothesis, not a confirmed finding.

### otp.spec.ts — CONFIRMED contract mismatch (tests 1–3); separate hypothesis for test 4

**Depends on:** `fixtures/kc-admin.ts` (`clearOtpCodes`, `expireOtpCodes` — direct Postgres `DELETE`/`UPDATE` against `email_otp_codes`), `fixtures/mailpit-helpers.ts` (`purgeInbox`, `fetchLatestOtp`), backend `/api/auth/otp-request` + `/api/auth/otp-verify`, `otp-test@local` KC user (Terraform-provisioned, `terraform/keycloak/main.tf:171-184`). Explicitly overrides storageState to empty (`otp.spec.ts:13`) and forces serial mode for Mailpit inbox isolation (`otp.spec.ts:5`).

**CONFIRMED root cause (tests 1, 2, 3 — request/verify/lockout):**
The backend route contract has drifted from what the spec assumes.
- `backend/src/routes/auth.ts:92`: `authRoute.use('*', authMiddleware, ensureUserProvisioned)` — both `/otp-request` and `/otp-verify` require a valid `Authorization: Bearer <JWT>` header.
- `backend/src/middleware/auth.ts:23-25`: with no/invalid Bearer header, the middleware short-circuits with `401 { success: false, error: 'Missing or invalid Authorization header' }` before any OTP logic runs.
- `backend/src/routes/auth.ts:96,140`: handlers derive the email from `c.get('user').email` (the verified JWT claim) — there is **no `email` field in the request body contract at all**.
- `backend/src/validation/schemas.ts:100-102`: `OtpVerifySchema = z.object({ code: ... })` — confirms `email` is not part of the verify payload.
- `otp.spec.ts:24,32,39,50,60,65,73` calls `request.post(...)` (Playwright's bare API-request fixture, not a browser `page`) with `{ email: OTP_USERNAME, ... }` bodies and **no Authorization header at all** — and structurally cannot supply one, since the OIDC tokens live in `sessionStorage` inside a browser context (per the documented Playwright bug #31108 workaround used everywhere else in this suite), which the `request` fixture has no access to.

Every one of tests 1–3 will hit the `authMiddleware` 401 short-circuit before reaching the assertions the spec expects (200, then 400/401 with "expir" in the body, then 429 lockout codes). This is structurally guaranteed to fail, not flaky — confirmed independently by `backend/src/routes/auth.test.ts`'s "auth gate" describe block, which exists specifically to assert these routes require auth.

**This is a genuine app-vs-test contract question, not a pre-judged "test is wrong":** an OTP *fallback* login mechanism that requires the caller to already hold a valid JWT is conceptually unusual (OTP is normally used precisely when the user is *not* yet authenticated, e.g., to satisfy a step-up/MFA requirement or post-primary-auth check). Two equally valid resolutions exist and the roadmap should decide which: (a) the route was intentionally redesigned for a step-up-auth use case and `otp.spec.ts` needs a full rewrite to drive a real browser through primary login first, then call the OTP endpoints with a token; or (b) the route's auth-gating is itself the bug/regression and OTP should work pre-authentication as the spec assumes. Check `auth.test.ts`'s test names/comments and any phase-8/9 plan docs for which behavior was intended before deciding.

**Test 4 ("UPDATE_PASSWORD gate") — separate failure mode, not yet confirmed:**
This test drives a real browser login via the KC form (`otp.spec.ts:82-91`) — same UI path family as `session-management.spec.ts`'s `loginViaBrowser()` and `global-setup.ts`'s `kcLogin()`. It depends on the KC "Try Another Way" / two-step username-password navigation resolving correctly and on the `UPDATE_PASSWORD` required-action *not* firing for WebAuthn-capable headless Chrome. **Confidence: LOW/hypothesis** — no code-level contradiction found, but it shares the fragile login-navigation pattern flagged below, so a failure here may cascade from the same root cause as session-management rather than being OTP-specific.

### passkeys.spec.ts — dependency map clear; failure mode is a hypothesis pending live run

**Depends on:** `fixtures/kc-admin.ts` (`resetCredentials` — deletes any `webauthn`/`webauthn-passwordless` credentials before each test, `kc-admin.ts:40-51`), `.auth/user.json` + `.auth/session.json` from global-setup (replayed via `context.addInitScript`, `passkeys.spec.ts:31-38`), CDP `WebAuthn.*` domain (Virtual Authenticator), `e2e-test@local` KC user, `terraform/keycloak/flows.tf`'s `webauthn_passwordless` REQUIRED execution.

Three tests share one fragile precondition: a valid, fresh `.auth/user.json`/`.auth/session.json` pair from `global-setup.kcLogin()`, **plus** a successful `resetCredentials()` call against the KC Admin API (which itself depends on the `japan-trip-worker` service-account client secret matching what's in `.env.test`/Terraform output). If either the storageState is stale/invalid (e.g., KC issued no refresh token post-silent-check-sso, a bug already found and fixed once per PROJECT.md's Key Decisions table) or the service-account auth fails, all three tests fail together with unrelated-looking symptoms (timeout waiting for `#register-passkey-btn`, or KC redirecting to its own login instead of accepting the replayed session). **No code-level contract drift found** — this is a hypothesis, not a confirmed root cause. **Confidence: LOW** pending live run.

The `chromium-passkeys` project (`playwright.config.ts:36-40`) does **not** inherit the project-level `storageState: '.auth/user.json'` that the `chromium` project has — `passkeys.spec.ts` re-declares it explicitly at the test level (`passkeys.spec.ts:16-18`), so this is intentional and consistent, not a bug.

### public-sharing.spec.ts — CONFIRMED data-fixture problem, route contract is fine

**Depends on:** Backend only — no KC, no global-setup storageState, no kcAdmin. Two hardcoded UUIDs: `PUBLIC_SLUG = '4dd5492e-2111-4b38-bc45-47848d27af42'` and `PRIVATE_SLUG = 'e3214d9f-e5a3-47b6-8441-fb167041b4fa'` (`public-sharing.spec.ts:4-5`), plus `PUBLIC_TRIP_ID = '1'`.

**CONFIRMED root cause:** these UUIDs are not produced by anything in the repo.
- `backend/src/db/schema.ts:57`: `public_slug: uuid('public_slug').$defaultFn(() => crypto.randomUUID())` — every trip gets a **randomly generated** slug on insert; there is no mechanism to pin it to a specific value.
- `backend/src/db/seed.ts:590`: the only seed script creates the "Japan 2026" demo trip with `is_public: false` — the opposite of what `PUBLIC_SLUG` requires, and its slug is whatever `crypto.randomUUID()` produced at seed time, not the hardcoded value.
- No migration, fixture, or `kcAdmin`-equivalent helper creates trips with these specific slugs anywhere in the codebase (`grep` for both UUIDs across all `.ts` files returns only `public-sharing.spec.ts` itself).

The route contract (`backend/src/routes/public.ts`) is correct and matches the spec's expectations exactly: 400 for invalid slug format, 404 for a private/nonexistent trip, 200 + `{success, data}` for a public trip. **This is purely a missing-fixture problem**, not an app bug and not a flaky-infra problem. It will fail deterministically in any environment unless a developer manually inserted matching rows into a local Postgres instance at some point (which is the most likely explanation for why it ever passed before — environment-specific manual DB state, exactly the kind of failure PROJECT.md asks to flag as "genuinely environment-specific"). **Confidence: HIGH.**

### session-management.spec.ts — shared fragile pattern; failure mode is a hypothesis

**Depends on:** `fixtures/kc-admin.ts` (`logoutUser`, `getUserSessions`), real browser login via its own `loginViaBrowser()` helper (does **not** use global-setup's storageState — logs in fresh every test), `e2e-test@local`, serial mode (`session-management.spec.ts:95`) because tests mutate shared KC session state for the same user.

`loginViaBrowser()` (`session-management.spec.ts:44-83`) duplicates the exact same "Try Another Way → Password" / two-step-vs-combined-form detection logic that `global-setup.ts`'s `kcLogin()`/`kcLoginNewUser()` and `otp.spec.ts` test 4 also implement independently, three times, with slightly different selectors (`getByRole('link', ...)` vs `page.locator('a, button').filter(...)`). This is the single most fragile shared surface in the suite: if KC's authentication flow or theme changes how the WebAuthn-first subflow is presented (e.g., a Terraform `flows.tf` change to the `webauthn_passwordless` execution requirement, or a KC version bump altering "Try Another Way" markup), **all three implementations break simultaneously** but would show up as three "unrelated" spec failures in a triage run. **No code-level contract drift found against current `flows.tf`** — this is a hypothesis about a shared brittle pattern, not a confirmed bug. **Confidence: LOW** on root cause, **MEDIUM-HIGH** on "this pattern is a structural risk regardless of current pass/fail state."

## Patterns to Follow

### Pattern 1: Project-level storageState with per-spec override
**What:** Bind a default authenticated storageState at the Playwright `project` level; specs needing a different identity or anonymous state call `test.use({ storageState: ... })` to override.
**When:** Default to authenticated, override for the minority of anonymous/different-persona specs.
**Example:** `playwright.config.ts:25` (project default) vs `otp.spec.ts:13` (override to empty) vs `passkeys.spec.ts:16-18` / `new-user-trip-creation.spec.ts:8` (override to a specific persona file).

### Pattern 2: sessionStorage replay via addInitScript
**What:** Because `keycloak-js` v26 stores tokens in `sessionStorage` (not captured by Playwright's native `storageState()`), dump it manually post-login and replay it pre-navigation with `context.addInitScript()`.
**When:** Any spec that needs an authenticated `keycloak-js` token without re-driving the KC login UI.
**Why it must run before `page.goto()`:** `addInitScript` only affects scripts that run on subsequent navigations; calling it after `goto()` is a no-op for the already-loaded page.

## Anti-Patterns Present in the Suite

### Anti-Pattern 1: Hardcoded environment-specific data IDs in spec files
**What:** `public-sharing.spec.ts` hardcodes two UUIDs that must exist in a specific local Postgres state with specific `is_public` values.
**Why bad:** No CI or fresh-clone environment can ever satisfy this without out-of-band manual DB work; the test is non-portable and silently depends on developer-machine history.
**Instead:** Either (a) extend `seed.ts` to deterministically create a public + a private trip and export their generated slugs for the spec to read, or (b) have the spec create its own fixture trip via the authenticated API in a `beforeAll`/`beforeEach` and capture the real generated slug, cleaning up after itself.

### Anti-Pattern 2: Triplicated fragile UI-navigation logic
**What:** The "Try Another Way → Password" / two-step-form detection logic is implemented independently in `global-setup.ts` (×2), `session-management.spec.ts`, and `otp.spec.ts` test 4 — four near-identical but not-quite-identical copies.
**Why bad:** A single KC theme/flow change requires four coordinated fixes; divergent selector strategies (`getByRole` vs `locator(...).filter(...)`) mean some copies may break while others don't, producing confusing partial-failure patterns that look like unrelated bugs.
**Instead:** Extract a single shared `loginViaKcForm(page, username, password)` helper into `tests/e2e/fixtures/` and have all four call sites use it. This turns "fix N specs" into "fix one fixture" for any future KC flow/theme change.

### Anti-Pattern 3: API-level test using a fixture that cannot carry the auth mechanism it needs
**What:** `otp.spec.ts` uses Playwright's bare `request` fixture (no browser, no cookies/sessionStorage) to call routes that the backend now gates behind a Bearer JWT sourced from `sessionStorage`.
**Why bad:** Structurally impossible to fix by changing only the test's request payload — the JWT simply isn't reachable from that fixture type.
**Instead:** Either switch to a `page`-based flow that logs in for real and extracts the token before making the `request` calls (mirroring `session-management`'s approach), or — if the route is meant to be pre-auth — remove the `authMiddleware` gate from `/otp-request`/`/otp-verify` and restore an `email`-in-body contract.

## Scalability Considerations

| Concern | Current (single dev machine) | If KC moves to CI (deferred per PROJECT.md) |
|---------|------------------------------|----------------------------------------------|
| storageState freshness window | 20 min, regenerated per `npx playwright test` invocation | Must regenerate every CI run; no persistence across runs — `MAX_AGE_MS` check becomes moot, `kcLogin()` always executes |
| Mailpit inbox isolation | Serial mode + manual purge in `beforeEach` | Same approach scales fine; inbox is ephemeral per CI run |
| KC realm state (credentials, OTP codes, sessions) | Reset via `kcAdmin` fixture before each test | Same fixtures work — but `terraform apply` must run before tests in CI, adding pipeline time |
| Hardcoded data IDs (public-sharing) | Breaks unless manually seeded | Will deterministically fail in CI from day one unless fixed first — this should be fixed regardless of CI timeline |

## Suggested Triage / Fix Order

The specs are not five independent problems. Ordering below accounts for shared dependencies so a single fix can resolve or de-risk multiple specs at once.

1. **Run the fresh full-suite triage first** (already mandated by PROJECT.md) — confirms which of the 2 "undetermined" hypotheses (idp-theme, passkeys) and the 1 partial hypothesis (session-management, otp test 4) actually fail, and with what error, before spending fix effort on hypotheses.

2. **Verify `global-setup.ts` produces valid storageState in the current environment, in isolation, before triaging anything downstream of it.** It is the upstream chokepoint: `passkeys.spec.ts` and the real-auth half of `auth.spec.ts` and `new-user-trip-creation.spec.ts` all consume its output directly. If `kcLogin()`/`kcLoginNewUser()` itself is silently producing a stale/invalid `.auth/*.json` (e.g., due to KC flow changes affecting the "Try Another Way" detour), every spec that reads those files will show failures that look spec-specific but aren't. Cheapest check: run `global-setup.ts` alone and inspect `.auth/user.json`/`.auth/session.json` timestamps and content, then run one passkeys test against it.

3. **Decide the OTP route contract question** (app bug vs. intentional step-up-auth redesign vs. test needs full rewrite) — this is a product decision, not a test-fix, and blocks any code change to `otp.spec.ts` tests 1–3. This is independent of the global-setup chokepoint and can be triaged in parallel with step 2.

4. **Fix `public-sharing.spec.ts`'s data dependency** — independent of every other spec (no KC, no storageState dependency). Lowest-risk, highest-certainty fix in the batch: extend `seed.ts` or add a `beforeAll` fixture-trip creation step, then read the real generated slug instead of hardcoding it. Can be done in parallel with steps 2–3.

5. **Extract the shared `loginViaKcForm()` helper** (Anti-Pattern 2) once `global-setup.ts` is confirmed healthy — this de-risks `session-management.spec.ts` and `otp.spec.ts` test 4 together, and reduces future-maintenance surface for any KC flow/theme change. Doing this *before* triaging session-management individually avoids fixing the same navigation bug three separate times if it turns out to be the shared root cause.

6. **idp-theme.spec.ts** — lowest priority to actively "fix" since code-level verification found no contract drift; if the triage run shows it failing, the fix is almost certainly environmental (KC reachability, timing) rather than a code change. If it passes in the fresh run, no action needed.

## Sources

- `tests/global-setup.ts` (full read) — HIGH confidence, primary source
- `tests/playwright.config.ts` (full read) — HIGH confidence, primary source
- `tests/e2e/idp-theme.spec.ts`, `otp.spec.ts`, `passkeys.spec.ts`, `public-sharing.spec.ts`, `session-management.spec.ts`, `auth.spec.ts`, `trips.spec.ts` (full reads) — HIGH confidence, primary source
- `tests/e2e/fixtures/kc-admin.ts`, `mailpit-helpers.ts` (full reads) — HIGH confidence, primary source
- `backend/src/routes/auth.ts`, `public.ts`, `middleware/auth.ts`, `validation/schemas.ts`, `db/schema.ts`, `db/seed.ts` (relevant sections read) — HIGH confidence, primary source
- `terraform/keycloak/main.tf`, `flows.tf` (relevant sections read) — HIGH confidence, primary source
- `keycloak/themes/japan-trip/login/footer.ftl`, `resources/css/login.css` (relevant sections read) — HIGH confidence, primary source
- `git log` on the 5 spec files — confirms none touched since phase 03/09 commits (pre-v3.0), corroborating PROJECT.md's "stale failure list" note — HIGH confidence
- `.planning/PROJECT.md` — HIGH confidence, primary source for milestone scope and prior known-failure list
- No live test run was performed in this research session (no servers/KC instance started) — all failure hypotheses for idp-theme, passkeys, and session-management/otp-test-4 are pending the mandated fresh triage run, not independently verified by execution.
