# Phase 14: E2E Expansion + New User Parity — Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers:

1. **Empty-state dashboard CTA** — A visible "Create your first trip" button inside the empty-state container in `frontend/src/pages/dashboard.ts` (UX-03).
2. **ROPC removal** — `tests/e2e/trip-edit-integration.spec.ts` migrated from ROPC (`grant_type: password`) to storageState auth. `loginAndGetToken()` function deleted (UX-06).
3. **New-user E2E spec** — `tests/e2e/new-user-trip-creation.spec.ts` covering full flow: login → empty dashboard → create trip → add destination+hotel+day+activity (with geocoder) → verify map markers → verify search finds trip → edit → delete (UX-01, UX-02, UX-04, UX-05).
4. **Geocoder E2E coverage** — Verified via the new-user spec exercising all 3 forms. No separate additions to `geocoder.spec.ts` (UX-04).

**Out of scope:** Keycloak theme changes, geocoder.spec.ts additions beyond new-user spec coverage, test user password changes, CI real-auth infrastructure.

</domain>

<decisions>
## Implementation Decisions

### D-01: Empty-state CTA (UX-03)

- Add a `<button>` element inside the `.trips-empty` div in `dashboard.ts:renderGrid()` (currently lines 105–116).
- The button text: `"Create your first trip"`. Its `click` handler calls `openCreateForm()` (same function as `#new-trip-btn`).
- CSS: style using existing `--jp-*` tokens. The button can reuse existing button classes from `main.css`.
- The `#new-trip-btn` in the toolbar remains unchanged. Both buttons call the same `openCreateForm()`.
- The E2E spec must assert this button is visible when the user has no trips.

### D-02: ROPC Removal — trip-edit-integration.spec.ts (UX-06)

- **Target file:** `tests/e2e/trip-edit-integration.spec.ts`
- **Auth strategy:** Reuse `testuser` storageState from `.auth/user.json` (already set globally in `playwright.config.ts`). Add `addInitScript` (like `passkeys.spec.ts:31–35`) to restore sessionStorage from `.auth/session.json` so keycloak-js has its tokens.
- **Token for API calls:** After navigation to a page (needed to initialize keycloak-js), extract the access token via `page.evaluate(() => kc.token)` where `kc` is the keycloak-js instance on `window`. The planner may alternatively use `page.evaluate(() => { kc.updateToken(30); return kc.token; })` to ensure freshness.
- **`loginAndGetToken(page)` function:** Delete entirely. Replace each call site with the storageState+addInitScript setup and token extraction pattern.
- **`createTrip(page, token)` helper:** Keep the same signature; only the token source changes.
- **Test-level auth:** Each test in this file currently calls `loginAndGetToken(page)` at the top. This becomes: restore sessionStorage (once per test via `test.beforeEach` or inline), navigate to a page, get token.
- **`test.describe.configure({ mode: 'serial' })`:** Add this to the describe block to match the pattern in `otp.spec.ts` — prevents parallel execution that would conflict on shared testuser trips.

### D-03: New-user spec — new-user-trip-creation.spec.ts (UX-01, UX-02, UX-04, UX-05)

- **User:** `new_user_test` (Terraform resource at `terraform/keycloak/main.tf:204`). Username: `new_user_test`. Password from `var.new_user_test_password` Terraform variable.
- **StorageState:** Add a second `kcLogin()`-equivalent function to `tests/global-setup.ts` that logs in as `new_user_test` and saves storageState to `.auth/new-user.json` and sessionStorage to `.auth/new-user-session.json`. Runs in the same global setup alongside the existing testuser login.
- **Env vars to add to `.env.test.example`:** `E2E_NEW_USER_USERNAME=new_user_test` and `E2E_NEW_USER_PASSWORD=<password>`. The actual password from Terraform variables should be documented in SETUP.md (not hardcoded).
- **Playwright config:** Add a new named project (e.g., `new-user`) in `playwright.config.ts` with `storageState: '.auth/new-user.json'` OR the spec overrides storageState inline via `test.use({ storageState: '.auth/new-user.json' })`.
- **Trip cleanup:** `new_user_test` starts with no trips in KC but the DB is not reset between test runs. The spec must:
  - In `beforeAll`: call `DELETE /api/trips/:id` for each existing trip belonging to `new_user_test` (GET all trips, delete each)
  - In `afterAll`: delete the trip created during the test (if not already deleted in the test flow)
- **Spec mode:** `test.describe.configure({ mode: 'serial' })` — the flow is sequential by nature.
- **Nominatim geocoder:** The spec uses geocoder on all 3 forms (destinations, hotels, activities). Use `page.route('**/nominatim*', ...)` to mock Nominatim responses so the spec is not network-dependent. Return a minimal valid response (name, lat, lon) for each geocoder call.

### D-04a: Map Render Assertion (UX-02)

- After creating a trip with at least one activity, navigate to `trip-detail.html?tripId=...`.
- Assert `.leaflet-container` is visible (confirms map initialized).
- Assert `.custom-marker` or `.numbered-marker` count matches expected (at least 1 activity marker).
- Click the first marker and assert popup text contains the activity name (confirms correct marker data).
- Do NOT use screenshot comparison.
- Note: Leaflet renders markers as DOM elements inside `.leaflet-marker-pane`; the markers use the `custom-marker` CSS class (from `tripDetail.ts:98`).

### D-04b: Geocoder Coverage (UX-04)

- Implementation is already complete on all 3 forms: `destinations.ts`, `hotels.ts`, `activities.ts`.
- E2E coverage for UX-04 is satisfied by the new-user spec exercising the geocoder on each form as part of the creation flow.
- No changes to `tests/e2e/geocoder.spec.ts`.

### D-05: Global Search Assertion (UX-02)

- After creating a trip, the dashboard adds it to the search index via `extendSearchIndexWithApiTrip()` (`dashboard.ts:429`).
- The spec should: type the trip name into the `<search-bar>` component and assert the trip appears in search results (without page reload, confirming the search index was updated in-memory).
- The `SearchBar` web component is registered as `<search-bar>` (`src/components/SearchBar.ts`). Use `page.getByRole` or the appropriate selector.

### Claude's Discretion

- Exact CSS styling for the empty-state CTA button (planner/executor choose consistent styling matching existing buttons in `main.css`)
- Whether to add `new_user_test` storageState as a named Playwright project or as an inline `test.use()` override in the spec
- How to structure the `beforeAll` cleanup in the new-user spec (sequential DELETE calls vs. batch)
- Exact Nominatim mock response shape (planner should check `frontend/src/modules/geocoder.ts` for the expected response fields)
- Whether `trip-edit-integration.spec.ts` needs `test.use({ storageState: '.auth/user.json' })` explicitly or if the global config already handles it

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Dashboard Empty State
- `frontend/src/pages/dashboard.ts:99–119` — `renderGrid()` function with current empty-state at lines 105–116
- `frontend/src/pages/dashboard.ts:132` — `openCreateForm()` function (the CTA button's click handler)
- `frontend/src/pages/dashboard.ts:175, 381–385` — how `#new-trip-btn` is wired to `openCreateForm()` (reference pattern for CTA button)

### E2E Auth Infrastructure
- `tests/global-setup.ts` — existing `kcLogin()` function (lines 41–93); storageState paths `STORAGE_STATE_PATH` and `SESSION_STORAGE_PATH`
- `tests/e2e/passkeys.spec.ts:9–35` — reference pattern for `addInitScript` restoring sessionStorage
- `tests/playwright.config.ts:25` — global `storageState: '.auth/user.json'` setting
- `tests/.env.test.example` — env var definitions to extend for new_user_test credentials

### ROPC Target File
- `tests/e2e/trip-edit-integration.spec.ts` — `loginAndGetToken()` (lines 27–66, ROPC at lines 51–61); `createTrip()` (lines 68–81); all 5 tests (lines 86–end)

### New-User Spec Infrastructure
- `tests/e2e/auth.spec.ts:200–220` — `addInitScript` + `storageState` inline override pattern
- `terraform/keycloak/main.tf:203–218` — `new_user_test` KC user resource (username, password variable)

### Trip Detail Map
- `frontend/src/pages/tripDetail.ts:77–200` — map initialization; `custom-marker` class at line 98; `.numbered-marker` at line 92

### Geocoder
- `frontend/src/modules/geocoder.ts` — Nominatim API call shape (for mock setup in spec)
- `frontend/src/pages/trip-edit/destinations.ts` — geocoder on destinations form (`#dest-geocoder-input`)
- `frontend/src/pages/trip-edit/hotels.ts` — geocoder on hotels form (`#hotel-geocoder-input`)
- `frontend/src/pages/trip-edit/activities.ts` — geocoder on activities form (`#act-geocoder-input`)

### Requirements
- `.planning/REQUIREMENTS.md` §User Experience (UX-01 through UX-06)
- `.planning/ROADMAP.md` §Phase 14 — success criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `global-setup.ts:kcLogin()` — duplicate and parameterize for `new_user_test`; only `E2E_TEST_USERNAME/PASSWORD` env vars and output paths need to differ
- `passkeys.spec.ts` — exact pattern for storageState + addInitScript that `trip-edit-integration.spec.ts` should follow
- `openCreateForm()` in dashboard.ts — the empty-state CTA button calls this directly

### Established Patterns
- E2E serial mode: `test.describe.configure({ mode: 'serial' })` in otp.spec.ts and passkeys.spec.ts
- Inline storageState override: `test.use({ storageState: { cookies: [], origins: [] } })` in otp.spec.ts:12–13
- API cleanup: `page.request.delete(url, { headers: { Authorization: ... } })` — use this in beforeAll/afterAll for trip cleanup

### Integration Points
- `tests/global-setup.ts`: Add second storageState setup for `new_user_test` → saves to `.auth/new-user.json` and `.auth/new-user-session.json`
- `tests/e2e/trip-edit-integration.spec.ts`: Replace `loginAndGetToken()` with storageState pattern; add `addInitScript`; delete ROPC code
- `frontend/src/pages/dashboard.ts:renderGrid()`: Add button element inside `trips.length === 0` branch

</code_context>

<specifics>
## Specific Details

- `new_user_test` KC username: `new_user_test`; email: `new_user_test@local`; password: from Terraform var `new_user_test_password`
- `.auth/` paths for new user: `tests/.auth/new-user.json` (storageState) and `tests/.auth/new-user-session.json` (sessionStorage)
- Empty-state CTA button: `id="empty-state-create-btn"` (suggested); calls `openCreateForm()` on click
- Nominatim mock URL pattern: `**/nominatim.openstreetmap.org/search**` — return `[{ lat: "35.6762", lon: "139.6503", display_name: "Tokyo, Japan" }]`
- Leaflet marker selector for assertion: `.custom-marker` (activity) and `.hotel-marker` (hotel) inside `.leaflet-marker-pane`
- Map container selector: `#map` or `.leaflet-container`

</specifics>

<deferred>
## Deferred Ideas

- Extending `geocoder.spec.ts` with standalone destination/activity tests — deferred to post-Phase 14; covered by new-user spec
- Using `trip_edit_test_user` for trip-edit-integration isolation — deferred; testuser storageState reuse is sufficient
- CI real-auth infrastructure for new-user spec — deferred to post-v3.0 (existing `SKIP_REAL_AUTH` guard applies)

</deferred>

---

*Phase: 14-e2e-expansion-new-user-parity*
*Context gathered: 2026-06-07*
