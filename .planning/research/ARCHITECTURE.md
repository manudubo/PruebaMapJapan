# Architecture Patterns — E2E Test Suite (v3.1 Stabilization)

**Domain:** Playwright E2E test architecture for OIDC/Keycloak-authenticated MPA
**Researched:** 2026-06-16
**Scope:** Structural analysis of test isolation, auth state management, WebAuthn CDP patterns, OTP serial mode, and triage taxonomy for the 7 known-failing specs

---

## Overview

The suite is a real-auth Playwright setup targeting a full stack: Hono backend (8787), Keycloak 26.6.1 (8080), Vite frontend (5173), Postgres, and Mailpit SMTP (8025). No mocking of auth or KC — every authenticated test drives the real OIDC PKCE flow.

```
playwright.config.ts
  └─ globalSetup: tests/global-setup.ts
       ├─ kcLogin()         → .auth/user.json + .auth/session.json       (e2e-test@local)
       └─ kcLoginNewUser()  → .auth/new-user.json + .auth/new-user-session.json (new_user_test)
            Freshness gate: MAX_AGE_MS = 20 min (stays under KC 30-min idle timeout)
            Skipped entirely when SKIP_REAL_AUTH is set

  projects:
    chromium            → storageState: .auth/user.json  (ALL specs inherit unless overridden)
    firefox / webkit    → no storageState (anonymous)
    chromium-passkeys   → testMatch: passkeys.spec.ts only; no project storageState
                          (passkeys.spec.ts re-declares .auth/user.json at test level)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `tests/global-setup.ts` | Headless OIDC PKCE login for 2 personas; writes `.auth/*.json` | Frontend (5173), Keycloak (8080) |
| `tests/e2e/fixtures/kc-admin.ts` | Keycloak Admin REST + direct Postgres for OTP table | KC Admin API, Postgres (direct) |
| `tests/e2e/fixtures/mailpit-helpers.ts` | Mailpit inbox read/purge for OTP extraction | Mailpit REST API (8025) |
| `idp-theme.spec.ts` | KC FreeMarker theme / CSS assertions; no auth, no app | Keycloak only (raw HTTP) |
| `otp.spec.ts` | Backend `/api/auth/otp-request` + `/api/auth/otp-verify` contract | Backend (8787), Postgres (via kcAdmin), Mailpit |
| `passkeys.spec.ts` | CDP WebAuthn Virtual Authenticator: register / login / last-cred guard | Frontend, Keycloak, kcAdmin |
| `public-sharing.spec.ts` | Backend public-route contract + guest-view frontend | Backend only — no KC, no auth |
| `session-management.spec.ts` | Full KC session lifecycle (login/logout/tabs/cross-ctx) | Frontend, Keycloak, kcAdmin |

### Key Architectural Constraints

- **`SKIP_REAL_AUTH`** guards every real-auth test. KC is not in CI; this flag prevents the suite from blocking the pipeline when KC is absent.
- **Playwright bug #31108**: `keycloak-js` stores tokens in `sessionStorage`, which `context.storageState()` does not capture. Workaround: dump sessionStorage after login in `global-setup.ts`, replay it via `context.addInitScript()` in `beforeEach` for any spec that needs KC tokens without re-driving the login UI.
- **KC flow complexity**: the `webauthn_passwordless` required execution is configured as a REQUIRED subflow, which causes KC to present "Try Another Way → Password" before the combined username/password form. Global setup and 3 specs each implement this navigation independently — a critical fragility source.

---

## Auth State Isolation

### storageState lifecycle

1. `global-setup.ts` runs **once per `npx playwright test` invocation** — not per-spec, not per-worker.
2. It freshness-gates on the `.auth/user.json` file mtime (20-minute window). If stale, `kcLogin()` drives headless Chromium through the real KC login UI and writes:
   - `.auth/user.json` — cookies + localStorage (KC SSO session cookie, KC state cookies)
   - `.auth/session.json` — sessionStorage dump (`keycloak-js` tokens, per Playwright bug #31108 workaround)
3. `playwright.config.ts` binds `.auth/user.json` at the **project level** for `chromium`. Every spec in that project inherits it unless it overrides with `test.use({ storageState: ... })`.

### Per-spec auth identity map

| Spec | Identity | How Set | Reason for Override |
|------|----------|---------|---------------------|
| `auth.spec.ts` (describe 1) | Anonymous | `page.route()` mocks KC | Unit-style tests; no real KC needed |
| `auth.spec.ts` (describe 2) | `e2e-test@local` | `.auth/user.json` (inherited) + `addInitScript` for sessionStorage | Tests real authenticated state |
| `trips.spec.ts`, `trip-edit.spec.ts`, etc. | `e2e-test@local` | `.auth/user.json` (inherited) | Standard authenticated CRUD |
| `new-user-trip-creation.spec.ts` | `new_user_test` | `test.use({ storageState: '.auth/new-user.json' })` | Dedicated new-user persona |
| `otp.spec.ts` | Anonymous | `test.use({ storageState: { cookies: [], origins: [] } })` | OTP flow starts unauthenticated |
| `passkeys.spec.ts` | `e2e-test@local` | `test.use({ storageState: '.auth/user.json' })` (explicit re-declaration) | `chromium-passkeys` project has no project-level storageState |
| `session-management.spec.ts` | `e2e-test@local` | Logs in fresh per-test via `loginViaBrowser()` | Tests session creation itself; storageState replay would defeat the test |
| `idp-theme.spec.ts` | None | No storageState (raw `request` fixture) | Theme assertions only; no app session |
| `public-sharing.spec.ts` | None | No storageState (raw `request` + `page`) | Public routes; no auth |

### kc-admin fixture: what it isolates and when

`kc-admin.ts` exposes a Playwright fixture (`kcAdmin`) that wraps Keycloak Admin REST calls and direct Postgres access. These reset operations are the primary mechanism for keeping KC server-side state clean across tests.

| Operation | What it isolates | Called in | Notes |
|-----------|-----------------|-----------|-------|
| `resetCredentials(username)` | Deletes all `webauthn` / `webauthn-passwordless` credentials; leaves password intact | `passkeys.spec.ts` `beforeEach` | Must run before CDP authenticator is created — ensures KC has no prior passkey to confuse assertion |
| `logoutUser(username)` | Kills all active KC server-side sessions for the user | `session-management.spec.ts` `beforeEach` | Guarantees a clean login-session baseline for each session-lifecycle test |
| `clearOtpCodes(username)` | `DELETE FROM email_otp_codes WHERE user_id = ...` | `otp.spec.ts` `beforeEach` | Prevents leftover codes from prior runs satisfying or poisoning the lockout counter |
| `expireOtpCodes(username)` | Back-dates `expires_at` for unused OTP codes | `otp.spec.ts` "expired OTP" test | Avoids requiring real time to pass; only way to test expiry without a test-only API |
| `createUser` / `deleteUser` | Creates/removes a full KC user | Not used in `beforeEach`/`afterEach` currently | Suitable for `beforeAll`/`afterAll` if fixture-user isolation is needed for new specs |

### Fixture teardown gap

The `kcAdmin` fixture has **no automatic teardown**: there is no `afterEach` / `afterAll` in the fixture definition (`kc-admin.ts:107-110` only calls `use(...)` with no teardown hook). This is acceptable for the current specs because each `beforeEach` resets to a known clean state regardless of what the prior test left. Adding teardown is only necessary if a new spec creates a resource that must be destroyed rather than overwritten (e.g., `createUser` in a `beforeAll` requires a matching `deleteUser` in `afterAll`).

### storageState reset: the 20-minute expiry risk

The most common silent failure mode for specs consuming `.auth/*.json` is a stale file:
- KC tokens inside `session.json` expire; the 30-second `isTokenExpired(30)` refresh guard in `keycloak-js` will try to refresh, but if there is no refresh token (post-silent-check-sso case, per PROJECT.md Key Decisions), `updateToken` throws.
- `global-setup.ts` uses a 20-minute freshness window as a conservative buffer, but this does not protect against a run that starts fresh and then stalls for >30 minutes before the specs that consume `.auth/*.json` execute.
- **Rule**: if passkeys or auth.spec.ts real-auth describe block fails with a timeout waiting for authenticated content, verify `.auth/user.json` mtime and inspect `.auth/session.json` for a valid `access_token` before diagnosing the spec.

---

## CDP WebAuthn Patterns

### Lifecycle: per-test, not per-suite

Every passkey test creates its own virtual authenticator in the test body and removes it at the end of the same test. This is the correct lifecycle.

**Why per-test is mandatory:** `kcAdmin.resetCredentials()` deletes WebAuthn credentials from the KC server before each test. If a per-suite authenticator were created in `beforeAll` and shared across tests, its client-side credential store would contain credentials registered in test 1 while KC's server-side store has been reset to empty — the CTAP2 assertion would succeed on the client but KC would reject it because the `credentialId` is no longer registered. Client/server credential stores must be reset in lockstep.

### Authenticator configuration

All three tests use identical options:
```
protocol: 'ctap2'
transport: 'internal'
hasResidentKey: true
hasUserVerification: true    // NOTE: correct spelling — not haUserVerification
isUserVerified: true
automaticPresenceSimulation: false
```

`automaticPresenceSimulation: false` is correct for flows where KC drives the assertion (registration button click → KC form → CDP responds); `true` would auto-assert on every CTAP request, which would interfere with flows where you want to control when assertion happens (e.g., to verify that KC correctly prompts before asserting).

### The login-with-passkey credential transfer pattern

`passkeys.spec.ts`'s "login with passkey" test demonstrates the only safe way to test cross-context passkey authentication:

1. Register in authenticated context (existing session, registered authenticator A).
2. Extract credential bytes from authenticator A via `WebAuthn.getCredentials`.
3. Create a **new clean browser context** (no cookies, no sessionStorage — forces KC redirect).
4. Create authenticator B in the new context.
5. Transfer credential bytes to B via `WebAuthn.addCredential`.
6. Navigate; KC challenges; authenticator B auto-asserts using the transferred bytes.

The clean context must have `WebAuthn.enable` called **before** navigation to the app page — the CDP domain must be enabled before the page loads for the authenticator to intercept the WebAuthn API calls.

### Context-scoped vs page-scoped CDP sessions

`page.context().newCDPSession(page)` is page-scoped. For the login test that opens a new context (`browser.newContext()`), a new CDP session against the new context's page (`cleanContext.newCDPSession(cleanPage)`) is required. A CDP session from context A cannot control WebAuthn in context B.

---

## OTP Serial Mode

### Why serial mode is mandatory

`otp.spec.ts` uses `test.describe.configure({ mode: 'serial' })`. This is not a performance choice — it is a correctness constraint.

The Mailpit inbox (`MAILPIT_URL/api/v1/messages`) is a **shared, ordered message queue** across all tests. `fetchLatestOtp()` reads `messages[0]` (the most recent message). If two OTP tests run in parallel:
- Test A sends an `otp-request` (Mailpit receives email A)
- Test B sends an `otp-request` (Mailpit receives email B)
- Test A calls `fetchLatestOtp()` and gets B's OTP
- Both tests fail with invalid OTP

Serial mode plus `purgeInbox()` in `beforeEach` creates a one-message inbox for every test: purge → send request → inbox has exactly one message → `fetchLatestOtp()` is deterministic.

### Why otp.spec.ts is the only Mailpit consumer (and why that must stay true)

Serial mode within a single `describe` block only serializes tests inside that block. If another spec file also sends OTP requests and reads Mailpit, the serial constraint breaks down entirely — `purgeInbox()` in spec B would delete the email spec A is waiting for.

**Extension rule**: any future test that touches the Mailpit inbox must either (a) be added to the existing serial `describe` block in `otp.spec.ts`, or (b) switch to a per-recipient isolation strategy: send OTP for a unique test-user, then query Mailpit's search-by-recipient API (`GET /api/v1/search?query=to:unique-user@local`) instead of reading `messages[0]`. Option (b) drops the serial constraint entirely and is the correct approach if OTP coverage expands to multiple test personas.

### Current OTP contract question (confirmed, unresolved)

Tests 1–3 in `otp.spec.ts` are **structurally guaranteed to fail** regardless of environment:
- `backend/src/routes/auth.ts` gates `/otp-request` and `/otp-verify` behind `authMiddleware` — requires a valid `Authorization: Bearer <JWT>`.
- The backend derives the target email from `c.get('user').email` (the JWT claim), not from a request body `email` field.
- `otp.spec.ts` uses Playwright's bare `request` fixture (no browser, no sessionStorage), sends `{ email: OTP_USERNAME, ... }` with no `Authorization` header, and expects 200 responses.
- The middleware short-circuits with 401 before any OTP logic runs.

This is a product/design question, not a test-configuration question. Two resolutions:
- **Resolution A (route is intentional step-up-auth)**: rewrite tests 1–3 to drive a real browser login first, extract the Bearer token, and supply it to the `request` calls. The `email` field in the request body becomes irrelevant (server reads from JWT).
- **Resolution B (route should be pre-auth)**: remove `authMiddleware` / `ensureUserProvisioned` from `/otp-request` and `/otp-verify`, restore `email` in the request body contract. Tests 1–3 work as written.

The triage phase must read `auth.test.ts` and any Phase 8/9 plan docs to determine which behavior was designed — do not assume either resolution without evidence.

Test 4 ("UPDATE_PASSWORD gate") is a separate failure class: it uses a real browser login via KC form, with the same "Try Another Way → Password" navigation fragility documented in the session-management section. It is not affected by the Bearer/email contract question.

---

## Triage Architecture

### Error taxonomy

| Category | Symptom Signature | How to Confirm | Owning Layer |
|----------|-------------------|---------------|--------------|
| **App bug** | Test assertion fails on a definite behavior (wrong HTTP status, wrong UI text), not timing; failure is deterministic | Check the backend route / frontend module against the spec assertion; confirm on multiple runs | Application code (`backend/`, `frontend/`) |
| **Test contract drift** | Test sends payload/headers the app now rejects before reaching the asserted logic | Trace the request through the backend middleware chain; compare spec inputs vs route contract | Test file itself; may require app change if contract intent is disputed |
| **Test timing / flakiness** | Failure non-deterministic; `waitForTimeout` substituted for real conditions; `toBeVisible` races | Re-run test 3×; check for hardcoded `waitForTimeout` calls; confirm with Playwright trace | Test file — replace with event-based waits (`waitForURL`, `waitForSelector`, `waitForLoadState`) |
| **KC state pollution** | Unexpected KC session active, unexpected credential present, OTP codes from prior run interfere | Check `beforeEach` reset coverage; verify `kcAdmin` operations complete before the test body | Fixture setup / `beforeEach` ordering |
| **Auth session expiry** | Timeout waiting for authenticated content; KC redirects to login unexpectedly | Inspect `.auth/user.json` mtime; check `.auth/session.json` for valid access_token; verify no refresh token present | `global-setup.ts` storageState freshness |
| **Environment / infrastructure** | Spec skips or throws on network connection to KC/backend; consistent across all runs in the same environment | Try `request.get(KEYCLOAK_URL/realms/...)` in isolation; check Docker Desktop / container health | Environment setup — not a code fix |

### Per-spec confirmed vs hypothetical status

| Spec | Status | Confirmed Root Cause |
|------|--------|---------------------|
| `idp-theme.spec.ts` | HYPOTHESIS (env/timing) | Code-level verification clean; no contract drift found. Fails only if KC unreachable or networkidle timing races. Confidence: MEDIUM |
| `otp.spec.ts` tests 1–3 | CONFIRMED (contract mismatch) | Bearer-JWT gate + email-from-JWT-claim vs spec's unauthenticated email-in-body. Confidence: HIGH |
| `otp.spec.ts` test 4 | HYPOTHESIS (shared nav fragility) | No code-level contradiction; shares "Try Another Way" navigation pattern fragility. Confidence: LOW |
| `passkeys.spec.ts` | HYPOTHESIS (storageState/kcAdmin auth) | No CDP or app contract drift found; failure would cascade from stale `.auth/*.json` or service-account secret mismatch. Confidence: LOW |
| `public-sharing.spec.ts` | CONFIRMED (missing data fixture) | Hardcoded UUIDs not produced by any seed/migration. Route contract is correct. Confidence: HIGH |
| `session-management.spec.ts` | HYPOTHESIS (shared nav fragility) | No code-level contract drift; `loginViaBrowser()` uses same fragile selector pattern as `global-setup.ts`. Confidence: LOW/MEDIUM |

### New vs modified artifacts required

| Artifact | Action | Why |
|----------|--------|-----|
| `tests/e2e/fixtures/login-helper.ts` | **CREATE NEW** | Extract shared `loginViaKcForm(page, username, password)` helper from 4 independent copies (global-setup ×2, session-management, otp test 4). One fix per KC flow/theme change instead of four. |
| `backend/src/db/seed.ts` (or new `tests/e2e/fixtures/trip-fixture.ts`) | **CREATE NEW or MODIFY** | `public-sharing.spec.ts` needs a deterministic public trip slug. Either seed creates a pinned public trip and exports its slug, or a `beforeAll` fixture creates a trip via API and captures the real generated slug. |
| `otp.spec.ts` tests 1–3 | **MODIFY** (after contract decision) | Either add Bearer token injection (Resolution A) or await backend contract change (Resolution B). |
| `backend/src/routes/auth.ts` | **MODIFY** (if Resolution B) | Remove `authMiddleware` / `ensureUserProvisioned` from OTP routes; add `email` field back to `OtpRequestSchema` / `OtpVerifySchema`. |
| `global-setup.ts` | **MODIFY** (if "Try Another Way" is the root cause) | Replace ad-hoc selectors with the shared `loginViaKcForm()` helper once it exists. |
| `session-management.spec.ts` | **MODIFY** (after helper is created) | Replace `loginViaBrowser()` with the shared helper. |

---

## Build Order

The specs are not five independent problems. Fixing in dependency order prevents diagnosing the same root cause multiple times under different spec names.

### Step 1: Verify the upstream chokepoint in isolation (blocks 3 specs)

Before triaging any spec that consumes `.auth/*.json`, verify `global-setup.ts` produces valid state in the current environment:
- Run `global-setup.ts` alone (or `npx playwright test --global-setup-only` if supported, otherwise run one passkeys test and inspect `.auth/user.json` + `.auth/session.json` after).
- Confirm `.auth/session.json` contains `access_token` and `refresh_token` (both present = valid KC session with offline access; `access_token` only = post-silent-check-sso case where refresh will fail).
- Confirm the "Try Another Way → Password" navigation completed successfully (check the mtime of the file vs when you ran the command — if it's old and was not regenerated, the freshness gate reused a stale file).

Depends on: running Docker environment. Blocks: `passkeys.spec.ts`, `auth.spec.ts` (real-auth describe), `new-user-trip-creation.spec.ts`.

### Step 2: Run the full fresh triage (all specs in parallel)

Mandated by PROJECT.md. Confirms which hypothesis specs actually fail and with what error message / trace. The fresh run also confirms whether the two CONFIRMED failures are the only deterministic issues or if hypotheses have also materialized.

Do not attempt individual fixes before this run — the stale failure list may not reflect current state.

### Step 3: Fix `public-sharing.spec.ts` (independent, highest-certainty)

No KC, no storageState, no kcAdmin dependency. Lowest risk, deterministic fix:
- **Option A (preferred)**: extend `backend/src/db/seed.ts` to insert a trip with a known slug (set `public_slug` explicitly in the insert, bypassing the random `defaultFn`), set `is_public: true`, and also insert a private trip with a known slug. Export both values as constants importable by the spec.
- **Option B**: add a `beforeAll` in `public-sharing.spec.ts` that calls the authenticated API to create a trip, captures the generated slug from the response, sets `is_public: true` via an update call, and stores it in a test-scoped variable. `afterAll` deletes the trip. This makes the spec fully self-contained without seeding.

Option A is simpler and eliminates the authenticated-API dependency in a spec that currently has none. Option B is more portable across DB states.

Artifact: **MODIFY** `seed.ts` (Option A) or **CREATE** trip fixture helper (Option B).

### Step 4: Resolve the OTP contract question (product decision, unblocks otp tests 1–3)

This is not a test fix — it is a design decision about whether `/otp-request`/`/otp-verify` are pre-auth or step-up-auth routes. Requires reading `auth.test.ts` and Phase 8/9 plan docs to determine original intent. Once decided:
- **Resolution A**: modify `otp.spec.ts` tests 1–3 to drive browser login and extract token.
- **Resolution B**: modify `backend/src/routes/auth.ts` to remove auth middleware from OTP routes.

This is independent of steps 1–3 and can be worked in parallel with step 3.

### Step 5: Extract `loginViaKcForm()` shared helper (unblocks session-management and otp test 4)

Once `global-setup.ts` is confirmed healthy (step 1) and the full triage run is complete (step 2), extract the shared login navigation into `tests/e2e/fixtures/login-helper.ts`. Update all four call sites:
- `global-setup.ts:kcLogin()` body
- `global-setup.ts:kcLoginNewUser()` body
- `session-management.spec.ts:loginViaBrowser()`
- `otp.spec.ts` test 4 inline login

This fix is multiplicative: if the "Try Another Way" selector is the root cause for session-management or otp test 4, this one extraction fixes both. It also protects all four against any future KC flow/theme change.

Artifact: **CREATE** `tests/e2e/fixtures/login-helper.ts`.

### Step 6: Individual spec fixes for remaining failures

After steps 1–5, any remaining failures are either:
- App bugs (discovered in fresh triage; fix in application code, add/update spec assertions)
- Genuine environment-specific issues to formally document as accepted skips

Tackle in order of certainty: confirmed bugs first, then investigate hypotheses with traces from step 2. `idp-theme.spec.ts` is the last to touch — if it passes in step 2, it needs no action; if it fails, the diagnosis is almost certainly environmental, not a code fix.

### Dependency graph summary

```
Step 1 (global-setup verification)
  └─ unblocks: passkeys.spec.ts diagnosis, auth.spec.ts real-auth diagnosis

Step 2 (fresh triage run)
  └─ confirms/refutes: idp-theme, passkeys, session-management, otp test 4 hypotheses

Step 3 (public-sharing data fixture) ← independent; run in parallel with steps 1-2
Step 4 (OTP contract decision)       ← independent; run in parallel with steps 1-2

Step 5 (loginViaKcForm helper)
  └─ requires: Step 2 complete (need triage output to know which selectors fail)
  └─ unblocks: session-management fix, otp test 4 fix

Step 6 (remaining individual fixes)
  └─ requires: all prior steps complete
```
