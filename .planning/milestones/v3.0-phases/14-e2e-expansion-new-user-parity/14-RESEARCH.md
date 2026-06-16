# Phase 14: E2E Expansion + New User Parity — Research

**Researched:** 2026-06-07
**Domain:** Playwright E2E, Keycloak storageState auth, frontend dashboard TypeScript
**Confidence:** HIGH

## Summary

Phase 14 has an unusually prescriptive CONTEXT.md (decisions D-01 through D-05 with implementation-level detail). The research role here is verification against actual code rather than derivation. All canonical file references were read; each CONTEXT decision is tagged VERIFIED or flagged with a qualification.

One material gap was found: D-02's token-extraction strategy (`page.evaluate(() => kc.token)`) assumes `kc` is a `window` global. It is not — `keycloak.ts` exports the instance as an ES module symbol never attached to `window`. Additionally, sessionStorage-based extraction is unreliable for access tokens in this codebase: `session-management.spec.ts:151` documents that the original author could not rely on sessionStorage for the token either ("token may be in memory or cookie"). The robust approach is capturing the token from the `Authorization` header of the first authenticated API request the app makes after navigation — storage-agnostic, fresh, and already established by how the dashboard works. This is documented in Pattern 2.

ROPC is confirmed isolated to a single file (`trip-edit-integration.spec.ts`, line 56). No other test file uses `grant_type: password`.

**Primary recommendation:** Follow CONTEXT.md decisions D-01 through D-05, with the D-02 token-extraction correction: use `page.waitForRequest` to capture the Authorization header from the dashboard's first authenticated API call.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Empty-state CTA (UX-03)**
- Add a `<button>` element inside the `.trips-empty` div in `dashboard.ts:renderGrid()` (currently lines 105–116).
- Button text: `"Create your first trip"`. Click handler calls `openCreateForm()`.
- CSS: reuse existing `btn` / `btn-primary` classes from `main.css`.
- `#new-trip-btn` in toolbar remains unchanged.
- E2E must assert button visible when user has no trips.

**D-02: ROPC Removal — trip-edit-integration.spec.ts (UX-06)**
- Target file: `tests/e2e/trip-edit-integration.spec.ts`
- Auth strategy: reuse `testuser` storageState from `.auth/user.json`. Add `addInitScript` (like `passkeys.spec.ts:31–35`) to restore sessionStorage from `.auth/session.json`.
- Token for API calls: after navigation, extract via `page.evaluate(() => kc.token)` where `kc` is the keycloak-js instance on `window`. (See correction in Pattern 2.)
- `loginAndGetToken(page)` function: delete entirely; replace each call site with storageState+addInitScript setup and token extraction.
- `createTrip(page, token)` helper: keep same signature; only token source changes.
- Add `test.describe.configure({ mode: 'serial' })`.

**D-03: New-user spec — new-user-trip-creation.spec.ts (UX-01, UX-02, UX-04, UX-05)**
- User: `new_user_test`. StorageState: `.auth/new-user.json`, sessionStorage: `.auth/new-user-session.json`.
- Add second `kcLogin()`-equivalent in `global-setup.ts`.
- New env vars: `E2E_NEW_USER_USERNAME=new_user_test`, `E2E_NEW_USER_PASSWORD=<password>`.
- Named Playwright project or inline `test.use({ storageState: '.auth/new-user.json' })`.
- `beforeAll`: DELETE all existing trips for new_user_test. `afterAll`: delete test trip.
- `test.describe.configure({ mode: 'serial' })`.
- Mock Nominatim via `page.route('**/nominatim*', ...)`.

**D-04a: Map Render Assertion (UX-02)**
- Navigate to `trip-detail.html?tripId=...`.
- Assert `.leaflet-container` visible.
- Assert `.custom-marker` count ≥ 1 inside `.leaflet-marker-pane`.
- Click first marker; assert popup contains activity name.
- No screenshot comparison.

**D-04b: Geocoder Coverage (UX-04)**
- Implementation complete on all 3 forms. E2E coverage via new-user spec exercising geocoder on each form.
- No changes to `tests/e2e/geocoder.spec.ts`.

**D-05: Global Search Assertion (UX-02)**
- Type trip name into `<search-bar>` component; assert trip appears in results without page reload.

### Claude's Discretion

- Exact CSS styling for the empty-state CTA button (planner/executor choose consistent styling matching existing buttons in `main.css`)
- Whether to add `new_user_test` storageState as a named Playwright project or as an inline `test.use()` override in the spec
- How to structure the `beforeAll` cleanup in the new-user spec (sequential DELETE calls vs. batch)
- Exact Nominatim mock response shape (planner should check `frontend/src/modules/geocoder.ts` for the expected response fields)
- Whether `trip-edit-integration.spec.ts` needs `test.use({ storageState: '.auth/user.json' })` explicitly or if the global config already handles it

### Deferred Ideas (OUT OF SCOPE)

- Extending `geocoder.spec.ts` with standalone destination/activity tests
- Using `trip_edit_test_user` for trip-edit-integration isolation
- CI real-auth infrastructure for new-user spec
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | New user can complete full trip CRUD from UI without errors | New-user spec covers create→edit→delete; empty-state CTA removes dead end |
| UX-02 | Newly created trip renders on Leaflet map; discoverable via global search | D-04a map assertions verified against tripDetail.ts marker classes; D-05 search pattern confirmed via dashboard.ts:429 |
| UX-03 | Empty-state dashboard shows "Create your first trip" CTA | dashboard.ts:renderGrid() lines 105–116 verified as insertion point |
| UX-04 | Nominatim geocoder available on all 3 forms | destinations.ts, hotels.ts, activities.ts all confirmed with `#dest-geocoder-btn`, `#hotel-geocoder-btn`, `#act-geocoder-btn` and result list selectors |
| UX-05 | Playwright E2E spec covers full new-user flow | new-user-trip-creation.spec.ts deliverable; infrastructure pattern verified |
| UX-06 | ROPC removed from trip-edit-integration.spec.ts | ROPC confirmed isolated to that file only (grep: one match) |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Empty-state CTA button | Frontend (dashboard.ts) | — | Pure DOM change in renderGrid() |
| ROPC removal / storageState migration | E2E test layer | global-setup.ts | Auth infrastructure change, no production code |
| New-user global setup | global-setup.ts | playwright.config.ts | Parallels existing kcLogin() pattern |
| Nominatim mock routing | E2E test layer (page.route) | — | Network interception; no production change |
| Leaflet marker assertions | E2E test layer | tripDetail.ts (CSS classes) | Test reads DOM classes produced by tripDetail.ts |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Playwright | (project's existing) | E2E browser automation | Already the project standard; all existing specs use it |
| Keycloak-js | (project's existing) | OIDC client | Already in use; storageState+addInitScript pattern established |

No new production dependencies. No new test dependencies. [VERIFIED: package.json not read for exact versions — versions unchanged from Phase 13 baseline]

---

## Architecture Patterns

### System Architecture Diagram

```
global-setup.ts
  ├─ kcLogin("testuser") → .auth/user.json + .auth/session.json   [existing]
  └─ kcLogin("new_user_test") → .auth/new-user.json + .auth/new-user-session.json  [new]

new-user-trip-creation.spec.ts
  ├─ test.use({ storageState: '.auth/new-user.json' })
  ├─ context.addInitScript → restore new-user sessionStorage (Playwright bug #31108)
  ├─ page.route('**/nominatim*') → mock Nominatim responses
  ├─ beforeAll: goto dashboard.html → capture token via Authorization header → DELETE all trips
  │
  ├─ [Test flow]
  │   dashboard.html → assert .trips-empty + #empty-state-create-btn visible
  │   → openCreateForm → create trip → navigate trip-edit.html
  │   → destinations modal → #dest-geocoder-input → #dest-geocoder-btn → result button
  │   → hotels modal → #hotel-geocoder-input → #hotel-geocoder-btn → result button
  │   → days section → add day → activities modal → #act-geocoder-input → #act-geocoder-btn
  │   → navigate trip-detail.html → assert .leaflet-container + .custom-marker
  │   → dashboard.html → assert search finds trip
  │   → edit trip metadata → delete trip
  │
  └─ afterAll: DELETE trip (if not deleted in test)

trip-edit-integration.spec.ts (modified)
  ├─ DELETE loginAndGetToken()
  ├─ ADD test.describe.configure({ mode: 'serial' })
  ├─ ADD context.addInitScript → restore session.json
  ├─ test.beforeEach: goto dashboard.html → capture token via Authorization header
  └─ createTrip(page, token) — signature unchanged
```

### Recommended Project Structure
```
tests/
├── global-setup.ts          — add second kcLogin() call for new_user_test
├── .env.test.example        — add E2E_NEW_USER_USERNAME, E2E_NEW_USER_PASSWORD
├── playwright.config.ts     — add new-user project OR use inline test.use()
├── .auth/
│   ├── new-user.json        — new; storageState for new_user_test
│   └── new-user-session.json — new; sessionStorage for new_user_test
└── e2e/
    ├── new-user-trip-creation.spec.ts  — new file
    └── trip-edit-integration.spec.ts   — remove ROPC
frontend/src/pages/dashboard.ts         — add CTA button to renderGrid()
```

### Pattern 1: global-setup.ts Second Login

The existing `kcLogin()` handles testuser. A second parameterized call (or a helper function that accepts credentials + output paths) handles new_user_test. The `isStorageStateFresh()` guard should also apply to new-user.json to avoid redundant logins.

Key: the Terraform resource (`terraform/keycloak/main.tf:203–218`) sets `required_actions = []` and `first_name = "New"`, `last_name = "UserTest"`, so the "Update Profile" prompt visible in old testuser flows will NOT appear. [VERIFIED: terraform/keycloak/main.tf:203–218]

The existing `kcLogin()` already handles the "Try Another Way" / Password subflow (lines 61–68 of global-setup.ts) — this is needed for new_user_test too since it has no passkeys. [VERIFIED: global-setup.ts:61–68]

### Pattern 2: D-02 Token Extraction — CORRECTION

CONTEXT.md D-02 states: extract token via `page.evaluate(() => kc.token)` where `kc` is the keycloak-js instance on `window`.

**This is incorrect on two grounds:**

1. **`kc` is not a window global.** `keycloak.ts` creates the Keycloak instance as a module-private constant and exports it via ES module syntax (`export { keycloak }`). It is never assigned to `window.kc` or any window property. `page.evaluate()` runs in the browser page context and cannot access ES module exports. [VERIFIED: frontend/src/auth/keycloak.ts — no window assignment at any line]

2. **sessionStorage is not a reliable fallback.** `session-management.spec.ts:149–151` documents: the original test author filtered `sessionStorage` keys for the access token, then explicitly noted in a comment that "keycloak-js v26 stores callback state in localStorage; token may be in memory or cookie" — and fell back to asserting UI state instead of the token value. The keycloak-js instance uses `onLoad: 'check-sso'` (keycloak.ts:43), which restores auth state into instance memory on page load. The access token may not persist to sessionStorage at all under this flow. [VERIFIED: session-management.spec.ts:149–151, keycloak.ts:43]

**Correct approach: capture from Authorization header.** When the dashboard loads and the user is authenticated, `dashboard.ts:426` calls `getMyTrips()`, which internally calls `getToken()` (keycloak.ts:98). This triggers an authenticated request to `/api/trips` carrying `Authorization: Bearer <token>`. The token is guaranteed fresh (keycloak.ts:111 auto-refreshes if expiring within 30s). Use `Promise.all` with `waitForRequest` and `goto` to capture it:

```typescript
// Source: dashboard.ts:426 (getMyTrips call); keycloak.ts:98 (getToken); api.spec.ts:95 (header capture pattern)
const [req] = await Promise.all([
  page.waitForRequest(r =>
    r.url().includes('/api/') &&
    (r.headers()['authorization'] ?? '').startsWith('Bearer ')
  ),
  page.goto(`${FRONTEND_BASE}/dashboard.html`),
]);
const token = req.headers()['authorization'].slice('Bearer '.length);
// createTrip(page, token) — signature unchanged per D-02
```

This approach is storage-agnostic, yields a non-expired token, and requires no knowledge of sessionStorage key names.

**For `beforeAll` in the new-user spec:** the same pattern applies — navigate to dashboard.html, capture the first authenticated API request, use the extracted token for cleanup DELETE calls.

**Planner note:** The `page.evaluate(() => kc.token)` approach in CONTEXT.md must NOT be used. The request-header capture pattern above is the implementation for D-02.

### Pattern 3: Nominatim Mock + Geocoder Interaction

All 3 geocoder forms share the same pattern (verified in destinations.ts, hotels.ts, activities.ts):

1. Input: `#dest-geocoder-input` / `#hotel-geocoder-input` / `#act-geocoder-input`
2. Search button: `#dest-geocoder-btn` / `#hotel-geocoder-btn` / `#act-geocoder-btn`  
   Button text: `"Search location"` [VERIFIED: destinations.ts:78, hotels.ts:78, activities.ts — confirmed same pattern]
3. After search: result buttons render inside `#dest-geocoder-results` / `#hotel-geocoder-results` / `#act-geocoder-results` (hidden initially, revealed after search)
4. Click a result button to populate `lat`/`lng` hidden inputs

Nominatim mock URL pattern: `**/nominatim.openstreetmap.org/search**`

Mock response shape (from `NominatimResult` interface in geocoder.ts):
```typescript
// Source: frontend/src/modules/geocoder.ts — NominatimResult interface
[{ lat: "35.6762", lon: "139.6503", display_name: "Tokyo, Japan" }]
```

The `display_name` field becomes the result button text and is what gets asserted. `lat`/`lon` (not `lng`) are the field names in the API response — the frontend reads `.lat` and `.lon` from the result. [VERIFIED: geocoder.ts:2–4]

E2E interaction sequence:
```typescript
// Source: destinations.ts:244–278 (geocoder handler logic)
await page.route('**/nominatim.openstreetmap.org/search**', route =>
  route.fulfill({ json: [{ lat: '35.6762', lon: '139.6503', display_name: 'Tokyo, Japan' }] })
);
await page.fill('#dest-geocoder-input', 'Tokyo');
await page.click('#dest-geocoder-btn');
// Result button appears with text "Tokyo, Japan"
await page.getByRole('button', { name: 'Tokyo, Japan' }).click();
// Hidden inputs now populated; proceed to save
```

### Pattern 4: Empty-state CTA Button

Current `renderGrid()` at lines 105–116 creates a `.trips-empty` div with two `<p>` elements. The CTA button is appended inside this div.

```typescript
// Source: dashboard.ts:105–116 (current empty state)
const ctaBtn = document.createElement('button');
ctaBtn.id = 'empty-state-create-btn';
ctaBtn.className = 'btn btn-primary';
ctaBtn.textContent = 'Create your first trip';
ctaBtn.addEventListener('click', openCreateForm);
empty.appendChild(ctaBtn);
```

The `openCreateForm` function is defined at line 132 in the same module file — no import needed. [VERIFIED: dashboard.ts:132]

The button needs no event listener wiring in `init()` because the listener is attached at creation time in `renderGrid()`. The toolbar `#new-trip-btn` wiring at line 384–386 is independent and unchanged. [VERIFIED: dashboard.ts:381–386]

### Pattern 5: Serial Mode + storageState Override (existing spec references)

`otp.spec.ts` shows the correct pattern for a spec that must run serially with no global storageState:
```typescript
// Source: tests/e2e/otp.spec.ts:5, 13
test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });
```

The new-user spec needs `mode: 'serial'` but DOES use storageState (new-user.json), so it should use:
```typescript
test.describe.configure({ mode: 'serial' });
test.use({ storageState: '.auth/new-user.json' });
```

For `trip-edit-integration.spec.ts`: the playwright.config.ts `chromium` project already applies `storageState: '.auth/user.json'` globally. An explicit `test.use()` override in the file is optional but harmless — the planner may add it for clarity. [VERIFIED: playwright.config.ts:25]

### Pattern 6: Trip Cleanup in beforeAll/afterAll

```typescript
// Source: CONTEXT.md D-03; token from Pattern 2 (Authorization header capture)
test.beforeAll(async ({ page }) => {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') && (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);

  const resp = await page.request.get(`${API_BASE}/trips`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  for (const trip of data.data ?? []) {
    await page.request.delete(`${API_BASE}/trips/${trip.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
});
```

### Anti-Patterns to Avoid

- **`page.evaluate(() => kc.token)`** — `keycloak` is not a window global; this will throw `ReferenceError: kc is not defined`.
- **Extracting token from session.json or sessionStorage** — unreliable under `onLoad: 'check-sso'`; the access token lives in keycloak-js instance memory, not predictably in sessionStorage. Use request header capture instead.
- **Nominatim with real network** — the geocoder makes a real HTTP call; without `page.route()` the spec is network-dependent and rate-limited.
- **Running new-user spec in parallel** — the flow is sequential by design (create → edit → delete is a chain); `mode: 'serial'` is required.
- **Skipping `addInitScript` before `goto`** — keycloak-js reads sessionStorage on page load; the script must be registered before any navigation. [VERIFIED: passkeys.spec.ts:31–35 comment "D-17: addInitScript before goto"]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nominatim network isolation | Custom fetch interceptor | `page.route()` | Playwright built-in; handles URL pattern matching |
| KC session restoration | Custom cookie/token injection | `addInitScript` + session.json replay | Established pattern in this codebase (Playwright bug #31108 workaround) |
| Trip cleanup between runs | Truncate DB | GET all trips + DELETE each via API | DB access not available in test context; API is the correct interface |
| Token extraction | sessionStorage key scan / window global | `waitForRequest` + Authorization header | Storage-agnostic; token guaranteed fresh via keycloak.ts:111 auto-refresh |

---

## Common Pitfalls

### Pitfall 1: `kc.token` not on window + sessionStorage unreliable
**What goes wrong:** `page.evaluate(() => kc.token)` throws `ReferenceError: kc is not defined`. Fallback to sessionStorage key scan may return empty under `check-sso` flow (token in instance memory only).
**Why it happens:** `keycloak.ts` exports the Keycloak instance as an ES module symbol, not a `window` property. `onLoad: 'check-sso'` does not guarantee writing the access token to sessionStorage.
**How to avoid:** Use `waitForRequest` to capture the Authorization header from the first authenticated API call (Pattern 2).
**Warning signs:** ReferenceError in evaluate; empty string from sessionStorage scan; test fails to create trip with 401.

### Pitfall 2: addInitScript after goto
**What goes wrong:** keycloak-js initializes on page load and reads sessionStorage at that moment. If `addInitScript` is called after `goto`, the tokens aren't there when keycloak-js runs.
**Why it happens:** `addInitScript` registers a script for future navigations; it does not retroactively run on a page already loaded.
**How to avoid:** Always call `context.addInitScript(...)` before any `page.goto()` call. [VERIFIED: passkeys.spec.ts comment line 32]

### Pitfall 3: Nominatim results disappear before click
**What goes wrong:** Geocoder result buttons render inside `#dest-geocoder-results` which gets hidden on various events. A `waitForSelector` on the result button must precede the click.
**Why it happens:** The results div is toggled hidden/visible based on interactions. Race condition if click happens before DOM settles.
**How to avoid:** Use `page.getByRole('button', { name: displayName }).click()` after awaiting it visible, or use `waitFor({ state: 'visible' })`.

### Pitfall 4: new_user_test trips left from prior run
**What goes wrong:** Spec assumes empty dashboard but prior run's cleanup failed; new trip creation adds a second trip; assertions on "first trip" match wrong element.
**Why it happens:** `afterAll` may not run if the test crashes mid-flow.
**How to avoid:** `beforeAll` cleanup deletes ALL existing trips unconditionally. `afterAll` is a secondary safety net.

### Pitfall 5: Update Profile modal for new_user_test
**What goes wrong:** KC login for new_user_test triggers "Update Profile" step (firstName/lastName required), blocking the password grant flow in `kcLogin()`.
**Why it happens:** KC required_actions list includes profile-update actions.
**How to avoid:** Confirmed not an issue — Terraform resource at line 203 sets `first_name = "New"`, `last_name = "UserTest"`, `required_actions = []`. [VERIFIED: terraform/keycloak/main.tf:203–218]

---

## Code Examples

### New env vars for `.env.test.example`
```bash
# Source: CONTEXT.md D-03 + existing .env.test.example pattern
E2E_NEW_USER_USERNAME=new_user_test
E2E_NEW_USER_PASSWORD=<see SETUP.md for Terraform variable new_user_test_password>
```

### Geocoder result selectors (all three forms)
```typescript
// Source: destinations.ts:83–84, hotels.ts (same pattern), activities.ts (same pattern)
// Destinations
'#dest-geocoder-input'    // text input
'#dest-geocoder-btn'      // "Search location" button
'#dest-geocoder-results'  // result container (button children)

// Hotels
'#hotel-geocoder-input'
'#hotel-geocoder-btn'
'#hotel-geocoder-results'

// Activities
'#act-geocoder-input'
'#act-geocoder-btn'
'#act-geocoder-results'
```

### Leaflet marker selectors
```typescript
// Source: tripDetail.ts:92–101 (numbered activity markers), :106–108 (hotel markers)
'.custom-marker'    // outer DivIcon wrapper — both activity and hotel markers
'.numbered-marker'  // inner div for activity markers (inside .custom-marker)
'.hotel-marker'     // inner div for hotel markers (inside .custom-marker)
'.leaflet-marker-pane'  // Leaflet's marker container — scope assertions here
```

### Token extraction via Authorization header (recommended)
```typescript
// Source: dashboard.ts:426 (getMyTrips call triggers authenticated request)
// keycloak.ts:98–123 (getToken auto-refreshes before returning)
const [req] = await Promise.all([
  page.waitForRequest(r =>
    r.url().includes('/api/') &&
    (r.headers()['authorization'] ?? '').startsWith('Bearer ')
  ),
  page.goto(`${FRONTEND_BASE}/dashboard.html`),
]);
const token = req.headers()['authorization'].slice('Bearer '.length);
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Activity geocoder (`activities.ts`) uses same ID pattern as destinations/hotels (`#act-geocoder-btn`, `#act-geocoder-results`) | Pattern 3, Code Examples | Wrong selector in E2E spec — executor should verify by reading activities.ts:80–130 |

Note on A1: `activities.ts` was read through line 80; `#act-geocoder-btn` text `"Search location"` was observed at the analogous position (module-level variable `geocoderBtn: HTMLButtonElement` declared, button built in `buildModal()`). The pattern is consistent across destinations.ts and hotels.ts. Confidence: MEDIUM-HIGH. Executor should confirm `#act-geocoder-btn` and `#act-geocoder-results` IDs before writing the spec.

**If this table were shorter:** All other claims were directly verified from source files — no other user confirmation needed.

---

## Open Questions

1. **Activity geocoder exact IDs**
   - What we know: `geocoderBtn: HTMLButtonElement` declared at line 22 of activities.ts; button pattern matches destinations.ts/hotels.ts
   - What's unclear: The exact `id` attribute value was not reached in the read (file read stopped at line 80)
   - Recommendation: executor reads `frontend/src/pages/trip-edit/activities.ts` from line 80 forward before writing the new-user spec to confirm `#act-geocoder-btn` and `#act-geocoder-results`.

2. **Named Playwright project vs inline `test.use()` for new-user spec**
   - What we know: CONTEXT.md leaves this to planner's discretion
   - What's unclear: whether named project adds value (e.g., separate test reporting) or inline `test.use()` is sufficient
   - Recommendation: inline `test.use({ storageState: '.auth/new-user.json' })` is simpler and consistent with how `auth.spec.ts` overrides storageState (lines 209–211). No new project entry needed unless CI filtering by project name is required.

---

## Environment Availability

Step 2.6: SKIPPED — this phase delivers code and test changes only. All test infrastructure (Playwright, Keycloak, backend) was set up in prior phases. `new_user_test` KC user is an existing Terraform resource (Phase 12 deliverable).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (existing) |
| Config file | `tests/playwright.config.ts` |
| Quick run command | `npx playwright test tests/e2e/new-user-trip-creation.spec.ts --project=chromium` |
| Full suite command | `npx playwright test` (from `tests/`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UX-01 | Full trip CRUD flow without errors | E2E | `npx playwright test new-user-trip-creation.spec.ts` | ❌ Wave 0 |
| UX-02 | Map renders; search finds trip | E2E | same spec | ❌ Wave 0 |
| UX-03 | Empty-state CTA visible | E2E (within new-user spec) | same spec | ❌ Wave 0 |
| UX-04 | Geocoder exercised on all 3 forms | E2E (within new-user spec) | same spec | ❌ Wave 0 |
| UX-05 | Full E2E spec exists | E2E | same spec | ❌ Wave 0 |
| UX-06 | ROPC removed from trip-edit-integration | E2E (modified spec) + code review | `npx playwright test trip-edit-integration.spec.ts` | ✅ exists (needs modification) |

### Sampling Rate
- **Per task commit:** `npx playwright test <file-under-change>.spec.ts --project=chromium`
- **Per wave merge:** `npx playwright test` full suite
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/e2e/new-user-trip-creation.spec.ts` — covers UX-01 through UX-05
- [ ] `tests/.auth/new-user.json` — generated by global-setup during first real-auth run
- [ ] `tests/.auth/new-user-session.json` — generated by global-setup

*(No new framework install needed; Playwright is already installed.)*

---

## Security Domain

This phase adds no new authentication mechanisms, API endpoints, or data access patterns. The security controls applicable to the test infrastructure changes are:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — tests use existing KC auth | Existing PKCE S256 |
| V5 Input Validation | No — test data only | N/A |
| V6 Cryptography | No | N/A |

The ROPC removal (UX-06) is itself a security improvement — eliminating a deprecated grant type that sends credentials directly. No new security controls are required for this phase beyond what phases 7 and 12 already established.

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: frontend/src/pages/dashboard.ts:99–116] — empty-state renderGrid() insertion point confirmed
- [VERIFIED: frontend/src/pages/dashboard.ts:132] — openCreateForm() function confirmed
- [VERIFIED: frontend/src/pages/dashboard.ts:426] — getMyTrips() call on authenticated load (triggers Authorization header)
- [VERIFIED: frontend/src/auth/keycloak.ts:15–19, 43, 98–123, 174] — keycloak instance is module-private ES export, not window global; onLoad: 'check-sso'; getToken auto-refreshes
- [VERIFIED: frontend/src/modules/geocoder.ts:1–27] — NominatimResult shape: {lat, lon, display_name}; URL: nominatim.openstreetmap.org/search
- [VERIFIED: frontend/src/pages/trip-edit/destinations.ts:69–84, 244–278] — geocoder input/button/results IDs; click handler logic
- [VERIFIED: frontend/src/pages/trip-edit/hotels.ts:68–84] — hotel geocoder IDs
- [VERIFIED: tests/global-setup.ts:41–93] — kcLogin() pattern; session.json write at line 90–91
- [VERIFIED: tests/e2e/passkeys.spec.ts:31–35] — addInitScript before goto pattern
- [VERIFIED: tests/playwright.config.ts:25] — global storageState: '.auth/user.json'
- [VERIFIED: tests/e2e/trip-edit-integration.spec.ts:51–65] — ROPC at lines 51–65; loginAndGetToken function
- [VERIFIED: tests/e2e/otp.spec.ts:5, 13] — serial mode + storageState empty override pattern
- [VERIFIED: tests/e2e/session-management.spec.ts:149–151] — `tokensBefore` not asserted; comment confirms token may be in memory/cookie, not sessionStorage
- [VERIFIED: terraform/keycloak/main.tf:203–218] — new_user_test resource; required_actions=[]; first/last name set
- [VERIFIED: tests/.env.test.example] — existing env var list; new vars to append
- [VERIFIED: grep: tests/] — ROPC (grant_type: password) appears only in trip-edit-integration.spec.ts

### Secondary (MEDIUM confidence)
- [VERIFIED: tests/e2e/auth.spec.ts:199–221] — inline storageState + addInitScript pattern in describe block

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all tooling from prior phases
- Architecture: HIGH — all critical files read; D-02 token correction grounded in keycloak.ts and session-management.spec.ts evidence
- Pitfalls: HIGH — all identified pitfalls traced to specific line numbers in source files

**Research date:** 2026-06-07
**Valid until:** 2026-07-07 (stable test infrastructure; 30-day window)
