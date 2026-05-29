# Architecture Patterns — v3.0 Integration Analysis

**Project:** TravelMap v3.0 Quality, Polish & DevX
**Researched:** 2026-05-28
**Scope:** How five v3.0 improvements integrate with the existing Hono + Vanilla TS MPA + Keycloak stack

---

## Existing Architecture Reference Points

Key surfaces that v3.0 touches:

| Surface | File | What it does |
|---------|------|--------------|
| Frontend entry points | `frontend/src/main.ts`, `frontend/src/pages/dashboard.ts`, `frontend/src/pages/tripDetail.ts`, `frontend/src/pages/trip-edit.ts`, `frontend/src/pages/profile.ts` | Each HTML page has its own TS entry — not a single bootstrap. Error handling must be added to each individually. |
| API client | `frontend/src/api/client.ts` — `request()` function | Throws raw `Error("API error 500: ...")` — no central UI handler exists |
| Backend error handler | `backend/src/index.ts` — `app.onError()` | Exists but returns generic "Internal server error" with no error taxonomy |
| Design tokens (frontend) | `frontend/src/styles/main.css` — `:root {}` and `[data-theme="dark"] {}` | JS writes `data-theme` attribute from `localStorage` via `theme.ts` line 32 |
| Design tokens (IDP) | `keycloak/themes/japan-trip/login/resources/css/login.css` | Uses `@media (prefers-color-scheme: dark)` — separate variable namespace (`--jp-*`), different origin (`localhost:8080`) |
| Docker Compose | `keycloak/docker-compose.yml` | postgres + keycloak + mailpit; healthchecks defined; no scripted startup sequence |
| Terraform | `terraform/keycloak/main.tf`, `flows.tf`, `mappers.tf` | 16 resources managed; `testuser` used in integration tests is NOT in Terraform |
| E2E global setup | `tests/global-setup.ts` | SKIP_REAL_AUTH guard; optional KC login; storageState + sessionStorage replay pattern |
| Playwright config | `tests/playwright.config.ts` | `testDir: './e2e'`; 4 projects: chromium (storageState), firefox, webkit, chromium-passkeys |

---

## Component Analysis by v3.0 Feature

### 1. Dev Environment Script

**Goal:** Single command to detect and start Docker Desktop, sequence postgres → keycloak → mailpit → wrangler dev → vite dev.

**What exists:**
- `keycloak/docker-compose.yml` has healthchecks on postgres (`pg_isready`) and keycloak (curl realm endpoint) and `depends_on: condition: service_healthy`
- `tests/global-setup.ts` already has a `waitForServer()` polling loop (fetch with retry) that knows the health endpoints

**What does NOT exist:**
- No startup script of any kind — each service is started manually in separate terminals
- No Docker Desktop detection logic
- No cross-platform script entry point

**Integration points:**

New components needed:
- `scripts/dev.mjs` — Node ESM script, cross-platform. Docker Desktop detection: run `docker info`; if daemon not running, open Docker Desktop app (OS-specific path via `process.platform`) and poll until `docker info` succeeds. Service startup sequence: `docker compose up -d` → poll postgres health → poll keycloak realm endpoint → spawn `wrangler dev` → spawn `vite dev`. The `waitForServer()` logic from `tests/global-setup.ts` can be extracted into `scripts/lib/wait-for-server.mjs` and shared.

Existing components modified:
- Root `package.json` — add `"dev": "node scripts/dev.mjs"` script
- `keycloak/docker-compose.yml` — no changes needed; healthcheck config is already correct

**Dependency:** Independent of all other v3.0 features. Can run in any phase.

---

### 2. Error Boundary Architecture

**Goal:** No native browser errors or unhandled rejections visible to users; centralized toast/banner presentation.

**What exists:**
- Backend `app.onError()` in `backend/src/index.ts` catches unhandled throws and returns `{ success: false, error: "Internal server error" }` — no error codes
- Frontend `request()` in `api/client.ts` throws `Error("API error ${status}: ${text}")` — raw string, no structured type
- `AuthGuard.ts` has a bespoke `_showError()` method with inline shadow DOM HTML — the only component with any error UI
- No toast/notification system exists anywhere in the frontend

**What does NOT exist:**
- Error code taxonomy on the backend
- Central error UI component on the frontend
- `window.addEventListener('unhandledrejection')` global handler
- Per-page `try/catch` wrapping async init functions

**Integration points:**

New components needed:
- `frontend/src/modules/toast.ts` — exports `showToast(message: string, type: 'error' | 'warning' | 'info')`. Injects a `<div class="toast-container">` into document body on first call. Consumes `--danger`, `--success`, `--bg-secondary`, `--text-primary`, `--border-color` tokens from Phase 1.
- `frontend/src/modules/errorHandler.ts` — exports `initGlobalErrorHandler()`. Registers `window.onerror` and `window.onunhandledrejection`; calls `showToast()`. Must be called from each page entry point.

Existing components modified:
- `frontend/src/api/client.ts` — `request()` throws a typed `ApiError` object (with `status: number` and `code?: string`) instead of a plain `Error`. Downstream call sites updated to call `showToast(e.message, 'error')` in catch blocks.
- `frontend/src/pages/dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, `profile.ts` — each has an async init function; wrap with `try/catch` that calls `showToast`. These are the four pages with real authenticated data fetching.
- `frontend/src/auth/AuthGuard.ts` — `_showError()` can call `showToast()` for toasts in addition to its inline shadow DOM error card.
- `backend/src/index.ts` — `app.onError()` updated with error code taxonomy (e.g., `"code": "INTERNAL_ERROR"`).
- `backend/src/middleware/auth.ts` — returns structured error codes on 401 (e.g., `"code": "UNAUTHORIZED"`, `"code": "TOKEN_EXPIRED"`).

**Dependency:** Requires design tokens from Phase 1 (`--danger`, `--bg-secondary`, etc.) so the toast renders with correct colors. Design tokens land first; error handling is Phase 2.

---

### 3. Design Token / CSS Variable Architecture

**Goal:** Unified token set applied consistently across frontend pages AND Keycloak FreeMarker theme; light/dark consistent across all flows.

**What exists:**

Frontend tokens (`frontend/src/styles/main.css`):
- Full set in `:root {}`: `--bg-primary`, `--bg-secondary`, `--accent`, `--danger`, `--text-primary`, `--border-color`, `--radius: 0`, etc.
- Dark overrides in `[data-theme="dark"] {}` — applied by `theme.ts` writing `document.documentElement.setAttribute('data-theme', theme)` from `localStorage`.

Keycloak IDP theme (`keycloak/themes/japan-trip/login/resources/css/login.css`):
- Separate variable namespace: `--jp-bg`, `--jp-surface`, `--jp-accent`, `--jp-danger`, etc. — same semantic intent, different names.
- Dark mode via `@media (prefers-color-scheme: dark)` only — not linked to the app's `localStorage` preference.
- Hardcoded hex values appear inside `@media` blocks (e.g., `background: #000000`, `background: var(--jp-surface-dark)`) despite the variable declarations.

**The cross-origin theme constraint (critical architectural decision required):**

The frontend lives on `localhost:5173`; the KC login page on `localhost:8080`. The app's `data-theme` attribute (set from `localStorage`) cannot be pushed to the KC page — different origin. Four options:

| Option | Mechanism | Tradeoff |
|--------|-----------|----------|
| A — Both honor `prefers-color-scheme` | Frontend drops `localStorage` toggle | Users lose explicit theme override |
| B — Cookie signal | App writes cookie on KC domain | Not possible — frontend cannot write cookies for a different origin |
| C — URL param | App appends `&kc_theme=dark` to KC redirect URI; FreeMarker reads it and adds a body class | Works for that login session; requires FreeMarker template change |
| D — Accept divergence | Frontend stays JS/localStorage; KC stays media-query | Cleanest implementation; partial inconsistency documented |

**Recommendation for v3.0:** Option D — accept divergence and document it. Token name unification (`--jp-*` aligned to match semantic intent of `--*` frontend tokens) is still valuable for maintainability. The behavioral divergence on theme-toggle is a known limitation. Option C is a candidate for a future phase once the IDP FreeMarker templates are fully stable.

**What needs to change regardless of the theme decision:**

The KC `login.css` uses hardcoded hex inside `@media` blocks rather than referencing its own `--jp-*` variables. This must be fixed regardless of the theme strategy — it is a maintainability defect.

FreeMarker templates not yet overridden by the japan-trip theme (they fall back to Keycloak default Patternfly CSS, which is visually inconsistent): the registration form, update-profile page, and passkey-campaign AIA pages. These need FreeMarker overrides or explicit confirmation that they inherit the login theme correctly.

New components needed:
- Potentially new `.ftl` files for registration and update-profile if KC's built-in templates do not inherit the `japan-trip` login theme automatically.

Existing components modified:
- `keycloak/themes/japan-trip/login/resources/css/login.css` — consolidate: eliminate hardcoded hex inside `@media` blocks; all values route through `--jp-*` variables; align variable names semantically to frontend counterparts.
- `keycloak/themes/japan-trip/account/resources/css/account.css` — audit and align on same basis.
- All five existing `.ftl` files (`login.ftl`, `error.ftl`, `login-otp.ftl`, `verify-email.ftl`, `footer.ftl`) — remove any inline styles; confirm all styling routes through `login.css`.
- `frontend/src/styles/main.css` — audit for any remaining hardcoded hex values that should reference tokens.

**Dependency:** Phase 1. Error handling (Phase 2) and E2E visual assertions (Phase 4) both depend on stable tokens.

---

### 4. Playwright E2E Test Architecture

**Goal:** New-user trip creation flow (auth → create trip → add destinations/days/activities → verify map markers); cover untested scenarios; fix ROPC in existing tests.

**What exists:**

Established patterns (from v2.0):
- `tests/global-setup.ts` — OIDC PKCE headless login; storageState + sessionStorage file save
- `tests/e2e/fixtures/kc-admin.ts` — KC admin API fixture (credential reset, user management)
- `tests/e2e/fixtures/mailpit-helpers.ts` — Mailpit REST API helpers for OTP
- All specs use `test.use({ storageState: '.auth/user.json' })` + `addInitScript` sessionStorage replay
- `SKIP_REAL_AUTH` env var gates all real-auth tests
- `tests/e2e/passkeys.spec.ts` — CDP Virtual Authenticator pattern (Chromium only via `chromium-passkeys` project)

Existing specs in `tests/e2e/`:
- `auth.spec.ts`, `passkeys.spec.ts`, `otp.spec.ts` — auth flows
- `trip-edit-integration.spec.ts` — USES ROPC password grant (lines 51-65); violates project constraint "PKCE only"
- `trip-edit.spec.ts`, `trips.spec.ts` — mocked, no real auth
- `city-pages.spec.ts`, `landing.spec.ts`, `search.spec.ts`, `pwa.spec.ts`, `accessibility.spec.ts`, `api.spec.ts`, `geocoder.spec.ts` — frontend/static behavior
- `public-sharing.spec.ts`, `ui-consistency.spec.ts`, `idp-theme.spec.ts` — visual/sharing tests

**What does NOT exist:**
- New-user registration E2E (no `register.spec.ts`)
- Full CRUD flow from authenticated user: create trip → add destination → add day → add activity → view on map
- `testuser` (hard-coded in `trip-edit-integration.spec.ts` as `Test1234!`) is not in Terraform — not reproducible on a fresh install
- No test for error UI (what happens when API returns 500 — does toast appear or browser alert?)
- No test for the passkey campaign post-login AIA trigger

**Integration points for new E2E tests:**

New files needed:
- `tests/e2e/new-user-trip-creation.spec.ts` — The critical CRUD + map flow. Uses PKCE storageState from global-setup, NOT ROPC. Structure:
  1. Restore storageState + addInitScript sessionStorage replay (established pattern)
  2. Navigate to dashboard — assert no login prompt
  3. Create trip via UI form
  4. Add destination via UI
  5. Add day and activity via UI
  6. Navigate to `trip.html?tripId=...`
  7. Assert map container is visible and has at least one marker element
  8. Teardown: delete the created trip via API (token from `getToken()` pattern)
  9. Guard: `test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available')`
- `tests/e2e/fixtures/trip-helpers.ts` — helper functions `createTestTrip(token)` and `deleteTestTrip(tripId, token)` via direct API calls, so tests start from a clean state

Existing components modified:
- `tests/e2e/trip-edit-integration.spec.ts` — remove the `loginAndGetToken()` function that uses ROPC. Replace with storageState replay (same pattern as `auth.spec.ts` real-session tests). This is a mandatory fix — PROJECT.md prohibits ROPC.
- `tests/global-setup.ts` — no structural changes needed; existing PKCE pattern supports new specs.
- `tests/playwright.config.ts` — no changes needed unless a new project is required for new-user tests (it is not; `chromium` project with storageState covers them).

**Terraform dependency:** A Terraform-managed user is needed for new-user E2E — currently `testuser` is unmanaged. This user must exist in Terraform before the new spec is reliable.

**Dependency:** Requires error handling (Phase 2) to exist so tests can assert "toast appears on API error, not native browser alert." Requires Terraform expansion (Phase 3) for reproducible test user seeding. E2E expansion is Phase 4 (last).

---

### 5. Terraform Expansion

**Goal:** All KC test users, clients, and remaining resources managed as IaC; nothing requires manual KC console work.

**What is currently managed by Terraform (16 resources):**

| Resource | File |
|----------|------|
| `keycloak_realm.japan_trip` | main.tf |
| `keycloak_openid_client.japan_trip_frontend` | main.tf |
| `keycloak_openid_client.japan_trip_api` | main.tf |
| `keycloak_openid_client.japan_trip_worker` | main.tf |
| `keycloak_openid_client_service_account_role.worker_manage_users` | main.tf |
| `keycloak_required_action.verify_email` | main.tf |
| `keycloak_user.e2e_test_user` (`e2e-test@local`) | main.tf |
| `keycloak_user.otp_test_user` (`otp-test@local`) | main.tf |
| `keycloak_authentication_flow.browser_passkey` | flows.tf |
| `keycloak_authentication_execution` (cookie, username, webauthn) | flows.tf |
| `keycloak_authentication_subflow` (passkey-forms, password-forms) | flows.tf |
| `keycloak_required_action.webauthn_register_passwordless` | flows.tf |
| 6x protocol mappers (username, full name, avatar_url, preferences, email, email_verified) | mappers.tf |

**What is NOT in Terraform but should be:**

| Gap | Current state | Risk |
|-----|--------------|-------|
| `testuser` / `Test1234!` | Created manually; hard-coded in `trip-edit-integration.spec.ts` | Not reproducible on fresh install; violates IaC goal |
| `new-user-test@local` | Does not exist | Needed for v3.0 new-user E2E flow; must be seeded |
| Required action: `UPDATE_PASSWORD` | Not managed | If KC enables as default in a future version, existing users get unexpected flows |
| Required action: `CONFIGURE_TOTP` | Not managed | Same drift risk |

**CRITICAL constraint — do NOT touch:**
`web_authn_passwordless_policy.relying_party_id = "localhost"` in `terraform/keycloak/main.tf` — changing this value invalidates all existing passkey registrations. No migration path exists. This is explicitly flagged in PROJECT.md. Terraform expansion is strictly additive.

**Integration points:**

New Terraform resources needed:
- `keycloak_user.trip_edit_test_user` in `main.tf` — replaces hard-coded `testuser`. Credentials via variable (`var.trip_edit_test_password`). `email_verified = true`.
- `keycloak_user.new_user_test` in `main.tf` — for new-user E2E. `email_verified = true` (simplest; email verification flow can be tested separately if needed).
- `keycloak_required_action.update_password` in `flows.tf` — `default_action = false`; prevents drift.
- `keycloak_required_action.configure_totp` in `flows.tf` — same pattern.

Existing components modified:
- `terraform/keycloak/variables.tf` — add `trip_edit_test_password` and `new_user_test_password` variables.
- `tests/e2e/trip-edit-integration.spec.ts` — update credentials to read from env vars pointing at the Terraform-managed user (after ROPC removal).
- `tests/.env.test.example` — add new user credential env var examples.

**Dependency:** Terraform expansion is independent of design tokens and error handling. It can run in parallel with Phase 1. It must complete before Phase 4 (E2E) to provide reproducible test users.

---

## Suggested Build Order

### Phase 1: Design Tokens + IDP Theme Alignment

**Rationale:** Tokens are consumed by the error toast UI (Phase 2). Stable IDP CSS is required before E2E visual assertions (Phase 4). Landing first minimizes rework.

**Artifacts consumed by later phases:**
- `--danger`, `--success`, `--bg-secondary`, `--text-primary`, `--border-color` — consumed by `toast.ts` in Phase 2
- Stable `login.css` — consumed by `idp-theme.spec.ts` and new visual assertions in Phase 4

**What lands:**
- `keycloak/themes/japan-trip/login/resources/css/login.css` refactored: no hardcoded hex inside `@media` blocks; all dark values route through `--jp-*` variables
- `keycloak/themes/japan-trip/account/resources/css/account.css` aligned on the same basis
- All 5 `.ftl` templates audited; inline styles removed
- `frontend/src/styles/main.css` audited for hardcoded hex
- Decision documented: theme-toggle divergence across KC origin accepted as known limitation

**No new files. Modifications only.**

---

### Phase 2: Error Handling (depends on Phase 1 tokens)

**Rationale:** All page entry points need error handling before new-user E2E tests can assert "no native browser errors." Must come before Phase 4.

**Artifacts consumed by later phases:**
- `toast.ts` — Phase 4 E2E tests assert toast appears on error conditions (not native browser alert or unhandled rejection)

**What lands:**
- `frontend/src/modules/toast.ts` (NEW) — central toast notification component
- `frontend/src/modules/errorHandler.ts` (NEW) — global `unhandledrejection` handler
- `frontend/src/pages/dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, `profile.ts` — each wraps async init in try/catch calling `showToast`
- `frontend/src/api/client.ts` — typed `ApiError` instead of plain `Error`
- `backend/src/index.ts` — error code taxonomy in `onError`
- `backend/src/middleware/auth.ts` — structured error codes on 401

---

### Phase 3: Terraform Expansion + Dev Script (parallel tracks; independent of Phases 1 and 2)

**Rationale:** These two tracks share no dependencies with each other or with the token/error work. Running them in parallel with Phase 1 or as a dedicated phase both work. They must complete before Phase 4.

**Terraform track — artifacts consumed by Phase 4:**
- `keycloak_user.trip_edit_test_user` — used by the updated `trip-edit-integration.spec.ts` after ROPC removal
- `keycloak_user.new_user_test` — used by `new-user-trip-creation.spec.ts`

**Dev script track — artifacts consumed by Phase 4:**
- Scripted single-command startup is a prerequisite for reliably running E2E tests locally in one step

**What lands:**
- `scripts/dev.mjs` (NEW) — Docker Desktop detection, sequenced service startup, health polling
- `scripts/lib/wait-for-server.mjs` (NEW) — extracted from `global-setup.ts`, shared
- `terraform/keycloak/main.tf` — new test user resources
- `terraform/keycloak/variables.tf` — new password variables
- `tests/.env.test.example` — updated with new credential vars

---

### Phase 4: E2E Expansion + New-User Trip Creation (depends on Phases 2 and 3)

**Consumes from Phase 1:** stable IDP CSS for visual assertions
**Consumes from Phase 2:** `toast.ts` exists so tests can assert toast appears on error (not native alert)
**Consumes from Phase 3:** Terraform-managed test users exist; dev script makes setup reproducible

**What lands:**
- `tests/e2e/new-user-trip-creation.spec.ts` (NEW) — full CRUD + map flow
- `tests/e2e/fixtures/trip-helpers.ts` (NEW) — `createTestTrip` / `deleteTestTrip` helpers
- `tests/e2e/trip-edit-integration.spec.ts` — ROPC removed; storageState pattern used instead
- `tests/global-setup.ts` — no structural changes; may need new user credentials wired

---

## Component Inventory: New vs Modified

### New Components

| Component | File | Phase |
|-----------|------|-------|
| Toast notification module | `frontend/src/modules/toast.ts` | 2 |
| Global error handler | `frontend/src/modules/errorHandler.ts` | 2 |
| Dev startup script | `scripts/dev.mjs` | 3 |
| Wait-for-server helper | `scripts/lib/wait-for-server.mjs` | 3 |
| Trip-creation E2E spec | `tests/e2e/new-user-trip-creation.spec.ts` | 4 |
| Trip API helpers fixture | `tests/e2e/fixtures/trip-helpers.ts` | 4 |

### Modified Components

| Component | File | Change | Phase |
|-----------|------|--------|-------|
| KC login CSS | `keycloak/themes/japan-trip/login/resources/css/login.css` | Token consolidation; no hardcoded hex | 1 |
| KC account CSS | `keycloak/themes/japan-trip/account/resources/css/account.css` | Token alignment | 1 |
| KC FreeMarker templates (5) | `keycloak/themes/japan-trip/login/*.ftl` | Remove inline styles | 1 |
| Frontend main CSS | `frontend/src/styles/main.css` | Hardcoded hex audit | 1 |
| API client | `frontend/src/api/client.ts` | Typed ApiError, structured throws | 2 |
| Backend error handler | `backend/src/index.ts` | Error code taxonomy in onError | 2 |
| Auth middleware | `backend/src/middleware/auth.ts` | Structured error codes on 401 | 2 |
| Dashboard page | `frontend/src/pages/dashboard.ts` | Wrap async init in try/catch + toast | 2 |
| Trip detail page | `frontend/src/pages/tripDetail.ts` | Wrap async init in try/catch + toast | 2 |
| Trip edit page | `frontend/src/pages/trip-edit.ts` | Wrap async init in try/catch + toast | 2 |
| Profile page | `frontend/src/pages/profile.ts` | Wrap async init in try/catch + toast | 2 |
| Terraform main.tf | `terraform/keycloak/main.tf` | New test user resources | 3 |
| Terraform variables.tf | `terraform/keycloak/variables.tf` | New password variables | 3 |
| E2E env example | `tests/.env.test.example` | New user credential vars | 3 |
| Trip edit integration spec | `tests/e2e/trip-edit-integration.spec.ts` | Remove ROPC; use storageState | 4 |

---

## Critical Constraints the Roadmap Must Honor

**1. Multiple frontend entry points — no single bootstrap.**
`main.ts` is the legacy city-page entry. `dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, and `profile.ts` are separate Vite entry points. Error handling (`initGlobalErrorHandler()` call and per-page try/catch) must be applied individually to all four authenticated page entries. A single `main.ts` change is insufficient.

**2. `webAuthnPolicyPasswordlessRpId = "localhost"` must not be touched.**
The Terraform expansion in Phase 3 is strictly additive: new users and required actions only. The realm's `web_authn_passwordless_policy` block must not be modified. Changing `relying_party_id` invalidates all existing passkey registrations with no migration path (PROJECT.md explicit constraint).

**3. ROPC in `trip-edit-integration.spec.ts` is a mandatory fix, not a suggestion.**
The `loginAndGetToken()` function (lines 51-65) uses resource owner password grant. PROJECT.md prohibits ROPC. This must be removed in Phase 4 before the spec is used as a model for new tests or left in the codebase.

**4. Theme-toggle divergence across KC origin is architectural, not a bug.**
The frontend uses `localStorage` + `data-theme` attribute. KC login uses `@media (prefers-color-scheme: dark)`. These cannot be unified without cross-origin constraints or behavioral tradeoffs. v3.0 documents the divergence. Option C (URL param) is a future-phase candidate.

**5. SKIP_REAL_AUTH stays in CI for all new real-auth tests.**
Every new spec that requires live Keycloak must include `test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment')`. CI E2E coverage without KC is a post-v3.0 concern.
