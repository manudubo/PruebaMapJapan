# Phase 14: E2E Expansion + New User Parity — Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 6
**Analogs found:** 5 / 6 (1 composite with per-concern mapping; 1 interaction path has no test analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `frontend/src/pages/dashboard.ts` | component | request-response | same file (lines 175–386) | self (targeted insertion) |
| `tests/global-setup.ts` | config/setup | request-response | same file (lines 41–93) | self (duplicate + parameterize) |
| `tests/e2e/trip-edit-integration.spec.ts` | test | request-response | `tests/e2e/passkeys.spec.ts:27–38`, `auth.spec.ts:199–221` | role-match |
| `tests/e2e/new-user-trip-creation.spec.ts` | test (NEW) | request-response | composite — see per-concern map below | composite |
| `tests/.env.test.example` | config | — | same file (extend) | self |
| `tests/playwright.config.ts` | config | — | same file (reference only; planner decides inline vs. new project) | self |

---

## Pattern Assignments

### `frontend/src/pages/dashboard.ts` — add CTA button to `renderGrid()`

**Analog:** Same file, `renderGrid()` at lines 99–119 (empty-state branch) and `#new-trip-btn` wiring at lines 381–386.

**Insertion point** (`dashboard.ts:105–116` — current empty-state block):
```typescript
// Source: frontend/src/pages/dashboard.ts:105–116
if (trips.length === 0) {
  const empty = document.createElement('div');
  empty.className = 'trips-empty';
  const p1 = document.createElement('p');
  p1.textContent = "You don't have any trips saved yet.";
  const p2 = document.createElement('p');
  p2.textContent = 'Create your first itinerary with the button above!';
  empty.appendChild(p1);
  empty.appendChild(p2);
  grid.appendChild(empty);
  return;
}
```

**CTA button to add** (inside the `trips.length === 0` branch, before `return`):
```typescript
// Source: CONTEXT.md D-01 + RESEARCH Pattern 4
// id suggested by CONTEXT.md §Specific Details
const ctaBtn = document.createElement('button');
ctaBtn.id = 'empty-state-create-btn';
ctaBtn.className = 'btn btn-primary';
ctaBtn.textContent = 'Create your first trip';
ctaBtn.addEventListener('click', openCreateForm);
empty.appendChild(ctaBtn);
```

**`openCreateForm` reference** (`dashboard.ts:132`):
```typescript
// Source: frontend/src/pages/dashboard.ts:132–135
function openCreateForm(): void {
  const overlay = document.getElementById('create-trip-overlay');
  overlay?.removeAttribute('hidden');
}
```

No import needed — `openCreateForm` is defined in the same module.

**`#new-trip-btn` wiring pattern** (unchanged reference, `dashboard.ts:381–389`):
```typescript
// Source: frontend/src/pages/dashboard.ts:381–389 [VERIFIED]
const newTripBtn = document.getElementById('new-trip-btn');
if (newTripBtn) {
  if (authenticated) {
    newTripBtn.removeAttribute('hidden');
    newTripBtn.addEventListener('click', openCreateForm);
  } else {
    newTripBtn.setAttribute('hidden', '');
  }
}
```

The CTA button attaches its listener at element creation time in `renderGrid()`, not in `init()`. The toolbar `#new-trip-btn` wiring (above) is independent and stays unchanged.

---

### `tests/global-setup.ts` — add second `kcLogin()` for `new_user_test`

**Analog:** Same file, `kcLogin()` at lines 41–93.

**Existing `kcLogin()` pattern** (lines 41–93 — full function to duplicate and parameterize):
```typescript
// Source: tests/global-setup.ts:41–93
async function kcLogin(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`);

  const loginPromptBtn = page.locator('#auth-login-prompt-btn');
  if (await loginPromptBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await loginPromptBtn.click();
  }

  await page.waitForURL(/localhost:8080/, { timeout: 15_000 });

  // "Try Another Way" → Password — required for users with no passkeys
  const tryAnotherWay = page.getByRole('link', { name: /try another way/i });
  if (await tryAnotherWay.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await tryAnotherWay.click();
    const passwordOpt = page.getByRole('link', { name: /^password$/i });
    if (await passwordOpt.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await passwordOpt.click();
    }
  }

  const usernameField = page.locator('input[name="username"], #username');
  await usernameField.waitFor({ state: 'visible', timeout: 10_000 });
  await usernameField.fill(process.env.E2E_TEST_USERNAME!);

  const passwordField = page.locator('input[name="password"], #password');
  if (!(await passwordField.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await page.getByRole('button', { name: /sign in/i }).click();
    await passwordField.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await passwordField.fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.waitForURL(/dashboard\.html/, { timeout: 20_000 });

  await context.storageState({ path: STORAGE_STATE_PATH });

  const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
  fs.writeFileSync(SESSION_STORAGE_PATH, JSON.stringify(sessionEntries), 'utf-8');

  await browser.close();
}
```

**Parameterized version for `new_user_test`** — change three things:
1. Replace `process.env.E2E_TEST_USERNAME!` → `process.env.E2E_NEW_USER_USERNAME!`
2. Replace `process.env.E2E_TEST_PASSWORD!` → `process.env.E2E_NEW_USER_PASSWORD!`
3. Replace `STORAGE_STATE_PATH` → `NEW_USER_STORAGE_STATE_PATH` (`.auth/new-user.json`)
4. Replace `SESSION_STORAGE_PATH` → `NEW_USER_SESSION_STORAGE_PATH` (`.auth/new-user-session.json`)

**New path constants to add** (after line 15):
```typescript
// Source: tests/global-setup.ts:14–15 pattern
const NEW_USER_STORAGE_STATE_PATH = path.join(AUTH_DIR, 'new-user.json');
const NEW_USER_SESSION_STORAGE_PATH = path.join(AUTH_DIR, 'new-user-session.json');
```

**Freshness guard pattern** (lines 35–39 — apply same guard for new-user.json):
```typescript
// Source: tests/global-setup.ts:35–39
function isStorageStateFresh(): boolean {
  if (!fs.existsSync(STORAGE_STATE_PATH)) return false;
  const age = Date.now() - fs.statSync(STORAGE_STATE_PATH).mtimeMs;
  return age < MAX_AGE_MS;
}
```

Duplicate as `isNewUserStorageStateFresh()` checking `NEW_USER_STORAGE_STATE_PATH`.

**`globalSetup()` call site** (lines 112–118 — add parallel call):
```typescript
// Source: tests/global-setup.ts:112–118
if (!process.env.SKIP_REAL_AUTH) {
  if (!isStorageStateFresh()) {
    await kcLogin();
  } else {
    console.log('Reusing fresh storageState from .auth/user.json');
  }
  // ADD: same guard for new_user_test
  if (!isNewUserStorageStateFresh()) {
    await kcLoginNewUser();
  } else {
    console.log('Reusing fresh storageState from .auth/new-user.json');
  }
}
```

**"Update Profile" note:** `new_user_test` has `required_actions = []` and `first_name`/`last_name` already set (terraform/keycloak/main.tf:203–218). The Update Profile branch in the old `loginAndGetToken()` (trip-edit-integration.spec.ts:41–46) is NOT needed in `kcLoginNewUser()`. [VERIFIED: RESEARCH.md Pattern 1]

---

### `tests/e2e/trip-edit-integration.spec.ts` — remove ROPC, add storageState pattern

**Analog:** `tests/e2e/passkeys.spec.ts:5–38` and `tests/e2e/auth.spec.ts:199–221`.

**Delete entirely** (lines 22–66): the JSDoc comment at lines 22–26 and the `loginAndGetToken()` function at lines 27–66, including the ROPC call at lines 51–65.

**Serial mode to add** (top of file, line 1 pattern from `otp.spec.ts:5`):
```typescript
// Source: tests/e2e/otp.spec.ts:5
test.describe.configure({ mode: 'serial' });
```

**sessionStorage replay pattern** (from `passkeys.spec.ts:5–18`):
```typescript
// Source: tests/e2e/passkeys.spec.ts:5–18
const sessionEntries: [string, string][] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '../.auth/session.json'), 'utf-8')
    ) as [string, string][];
  } catch {
    return [];
  }
})();
```

**`addInitScript` in `beforeEach`** (from `auth.spec.ts:213–220`):
```typescript
// Source: tests/e2e/auth.spec.ts:213–220
// CRITICAL: addInitScript must be called before any page.goto() (Playwright bug #31108)
test.beforeEach(async ({ context }) => {
  if (sessionEntries.length) {
    await context.addInitScript((entries) => {
      for (const [k, v] of entries) {
        window.sessionStorage.setItem(k, v);
      }
    }, sessionEntries);
  }
});
```

**Token extraction — SUPERSEDES CONTEXT.md D-02's `page.evaluate(() => kc.token)`**

CONTEXT.md D-02 says to use `page.evaluate(() => kc.token)`. **Do not use this.** `keycloak` is an ES module export, never assigned to `window.kc`; this throws `ReferenceError: kc is not defined`. [VERIFIED: RESEARCH.md Pattern 2, frontend/src/auth/keycloak.ts:15–19]

**Correct token extraction** (capture from Authorization header on dashboard load):
```typescript
// Source: RESEARCH.md Pattern 2 / dashboard.ts:426 + keycloak.ts:98–123
// Use Promise.all so waitForRequest and goto race together
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

This replaces every `const token = await loginAndGetToken(page)` call site. Each test becomes:

```typescript
// Replace loginAndGetToken(page) at each call site:
// 1. addInitScript is in beforeEach (see above)
// 2. Navigate + capture token inline per test:
const [req] = await Promise.all([
  page.waitForRequest(r =>
    r.url().includes('/api/') && (r.headers()['authorization'] ?? '').startsWith('Bearer ')
  ),
  page.goto(`${FRONTEND_BASE}/dashboard.html`),
]);
const token = req.headers()['authorization'].slice('Bearer '.length);
const tripId = await createTrip(page, token);
```

**`createTrip()` helper** (lines 68–81 — keep unchanged):
```typescript
// Source: tests/e2e/trip-edit-integration.spec.ts:68–81
async function createTrip(page: Page, token: string): Promise<string> {
  const tripId: string = await page.evaluate(async (args) => {
    const [apiBase, tok] = args as [string, string];
    const resp = await fetch(`${apiBase}/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: 'Test trip', start_date: '2026-08-01', end_date: '2026-08-15' }),
    });
    const data = await resp.json();
    if (!data.data?.id) throw new Error(`Trip create failed: ${JSON.stringify(data)}`);
    return String(data.data.id);
  }, [API_BASE, token]);
  return tripId;
}
```

**Note on explicit `test.use({ storageState })`:** `playwright.config.ts:25` already applies `.auth/user.json` globally to the chromium project. An explicit `test.use()` override in the file is optional (planner's discretion). [VERIFIED: playwright.config.ts:25]

---

### `tests/e2e/new-user-trip-creation.spec.ts` — NEW FILE (composite pattern)

No single test file is a close enough analog — this spec is assembled from multiple per-concern patterns.

#### Concern A: File-level setup (serial mode + storageState override)

**Analogs:** `otp.spec.ts:5` (serial mode) + `passkeys.spec.ts:16–18` (storageState override)

```typescript
// Source: tests/e2e/otp.spec.ts:5 + passkeys.spec.ts:16–18
test.describe.configure({ mode: 'serial' });

test.use({
  storageState: path.join(__dirname, '../.auth/new-user.json'),
});
```

#### Concern B: sessionStorage replay

**Analog:** `passkeys.spec.ts:5–14` (read new-user-session.json instead of session.json)

```typescript
// Source: tests/e2e/passkeys.spec.ts:5–14
const sessionEntries: [string, string][] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '../.auth/new-user-session.json'), 'utf-8')
    ) as [string, string][];
  } catch {
    return [];
  }
})();
```

`addInitScript` in `beforeAll` or `beforeEach` — same pattern as `auth.spec.ts:213–220` (see trip-edit-integration section above).

#### Concern C: Token extraction (beforeAll cleanup + test flow)

**No test analog.** Use RESEARCH Pattern 2 (token from Authorization header):

```typescript
// Source: RESEARCH.md Pattern 2 + Pattern 6
// In beforeAll({ page }):
const [req] = await Promise.all([
  page.waitForRequest(r =>
    r.url().includes('/api/') && (r.headers()['authorization'] ?? '').startsWith('Bearer ')
  ),
  page.goto(`${FRONTEND_BASE}/dashboard.html`),
]);
const token = req.headers()['authorization'].slice('Bearer '.length);
```

#### Concern D: beforeAll trip cleanup

**No test analog.** Use RESEARCH Pattern 6:

```typescript
// Source: RESEARCH.md Pattern 6
// Unconditional cleanup — handles leftover trips from prior crashed runs (Pitfall 4)
const resp = await page.request.get(`${API_BASE}/trips`, {
  headers: { Authorization: `Bearer ${token}` },
});
const data = await resp.json();
for (const trip of data.data ?? []) {
  await page.request.delete(`${API_BASE}/trips/${trip.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
```

#### Concern E: API helper (`createTrip`) shape

**Analog:** `trip-edit-integration.spec.ts:68–81` (copy exact signature and body; only the token source changes)

```typescript
// Source: tests/e2e/trip-edit-integration.spec.ts:68–81
async function createTrip(page: Page, token: string): Promise<string> {
  const tripId: string = await page.evaluate(async (args) => {
    const [apiBase, tok] = args as [string, string];
    const resp = await fetch(`${apiBase}/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: 'Test trip', start_date: '2026-08-01', end_date: '2026-08-15' }),
    });
    const data = await resp.json();
    if (!data.data?.id) throw new Error(`Trip create failed: ${JSON.stringify(data)}`);
    return String(data.data.id);
  }, [API_BASE, token]);
  return tripId;
}
```

#### Concern F: Nominatim mock + geocoder interaction

**No test analog — trip-edit-integration.spec.ts uses a Google Maps URL path, NOT Nominatim search.**

Use RESEARCH Pattern 3. Verified geocoder IDs:

| Form | Input | Button | Results container | Source |
|------|-------|--------|-------------------|--------|
| Destinations | `#dest-geocoder-input` | `#dest-geocoder-btn` | `#dest-geocoder-results` | destinations.ts:69–84 [VERIFIED] |
| Hotels | `#hotel-geocoder-input` | `#hotel-geocoder-btn` | `#hotel-geocoder-results` | hotels.ts:68–84 [VERIFIED] |
| Activities | `#act-geocoder-input` | `#act-geocoder-btn` | `#act-geocoder-results` | activities.ts:112–125 [VERIFIED] |

```typescript
// Source: RESEARCH.md Pattern 3 + geocoder.ts:2–4 (NominatimResult shape)
// Register before any navigation (Pitfall 3)
await page.route('**/nominatim.openstreetmap.org/search**', route =>
  route.fulfill({ json: [{ lat: '35.6762', lon: '139.6503', display_name: 'Tokyo, Japan' }] })
);

// Geocoder interaction (all 3 forms follow this pattern):
await page.fill('#dest-geocoder-input', 'Tokyo');
await page.click('#dest-geocoder-btn');
// waitFor prevents race condition (Pitfall 3)
await page.getByRole('button', { name: 'Tokyo, Japan' }).waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Tokyo, Japan' }).click();
// Hidden inputs #dest-lat / #dest-lng / #act-lat / #act-lng are now populated
```

**NominatimResult fields** (`frontend/src/modules/geocoder.ts:2–4` [VERIFIED]):
```typescript
// Use lat / lon (not lng) — these are the Nominatim API field names
{ lat: '35.6762', lon: '139.6503', display_name: 'Tokyo, Japan' }
```

#### Concern G: Map render assertions

**Analog:** `frontend/src/pages/tripDetail.ts:92–101` (CSS class source). No test analog.

```typescript
// Source: RESEARCH.md §Code Examples — Leaflet marker selectors
// tripDetail.ts:92–101 (numbered activity markers); :106–108 (hotel markers)
'.leaflet-container'     // map initialized — assert visible
'.leaflet-marker-pane'   // scope marker assertions here
'.custom-marker'         // outer DivIcon wrapper for all markers (activities + hotels)
'.numbered-marker'       // inner div for activity markers (inside .custom-marker)
'.hotel-marker'          // inner div for hotel markers (inside .custom-marker)
```

Assertion pattern:
```typescript
// Source: CONTEXT.md D-04a
await expect(page.locator('.leaflet-container')).toBeVisible();
const markers = page.locator('.leaflet-marker-pane .custom-marker');
await expect(markers).toHaveCount(/* expected count */);
// Click first marker and assert popup contains activity name:
await markers.first().click();
await expect(page.locator('.leaflet-popup-content')).toContainText('activity name here');
```

#### Concern H: Global search assertion

**Analog:** `frontend/src/pages/dashboard.ts:429` (`extendSearchIndexWithApiTrip` — called on trip create; confirms in-memory update). No test analog.

```typescript
// Source: CONTEXT.md D-05 + dashboard.ts:429
// SearchBar web component registered as <search-bar>
// No page reload needed — search index is updated in-memory on trip create
const searchBar = page.locator('search-bar');
await searchBar.locator('input').fill('trip name here');
// Assert trip appears in results
await expect(page.locator(':text("trip name here")')).toBeVisible();
```

---

### `tests/.env.test.example` — add new env vars

**Analog:** Same file (lines 1–13 — append to end).

**Current file content** (`tests/.env.test.example:1–13`):
```bash
# Source: tests/.env.test.example:1–13
E2E_TEST_USERNAME=e2e-test@local
E2E_TEST_PASSWORD=your-test-password
E2E_OTP_USERNAME=otp-test@local
E2E_OTP_PASSWORD=your-otp-test-password
KC_ADMIN_CLIENT_ID=japan-trip-worker
KC_ADMIN_CLIENT_SECRET=your-client-secret
MAILPIT_URL=http://localhost:8025
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
BACKEND_URL=http://localhost:8787
FRONTEND_URL=http://localhost:5173
POSTGRES_URL=postgres://user:pass@localhost:5432/japan_trip
```

**Lines to append** (CONTEXT.md D-03 + RESEARCH Code Examples):
```bash
# Source: CONTEXT.md D-03 §Specific Details
E2E_NEW_USER_USERNAME=new_user_test
E2E_NEW_USER_PASSWORD=<see SETUP.md for Terraform variable new_user_test_password>
```

---

### `tests/playwright.config.ts` — no change required (planner's discretion)

**Analog:** Same file (lines 20–41 — existing projects pattern).

The global chromium project already applies `.auth/user.json` via `storageState` at line 25. The new-user spec overrides this inline with `test.use({ storageState: '.auth/new-user.json' })` (see Concern A above) — no new named project is needed.

If the planner decides to add a named project (e.g., for CI filtering), copy the chromium-passkeys pattern:

```typescript
// Source: tests/playwright.config.ts:38–41
{
  name: 'chromium-passkeys',
  use: { ...devices['Desktop Chrome'] },
  testMatch: ['**/passkeys.spec.ts'],
},
```

Adapted for new-user:
```typescript
{
  name: 'new-user',
  use: {
    ...devices['Desktop Chrome'],
    storageState: '.auth/new-user.json',
  },
  testMatch: ['**/new-user-trip-creation.spec.ts'],
},
```

RESEARCH.md recommendation (Open Question 2): inline `test.use()` is simpler and sufficient unless CI filtering by project name is needed.

---

## Shared Patterns

### sessionStorage replay (addInitScript)

**Source:** `tests/e2e/passkeys.spec.ts:27–38`, `tests/e2e/auth.spec.ts:213–220`
**Apply to:** `trip-edit-integration.spec.ts` (beforeEach), `new-user-trip-creation.spec.ts` (beforeAll or beforeEach)

```typescript
// Source: tests/e2e/passkeys.spec.ts:31–38
// CRITICAL: must be called before any page.goto() (RESEARCH Pitfall 2)
await context.addInitScript((entries) => {
  for (const [k, v] of entries) {
    window.sessionStorage.setItem(k, v);
  }
}, sessionEntries);
```

### Token extraction via Authorization header

**Source:** RESEARCH.md Pattern 2 (grounded in `dashboard.ts:426`, `keycloak.ts:98–123`)
**Apply to:** `trip-edit-integration.spec.ts` (every test, replaces `loginAndGetToken`), `new-user-trip-creation.spec.ts` (beforeAll + test flow)

**IMPORTANT:** CONTEXT.md D-02 specifies `page.evaluate(() => kc.token)` — this is SUPERSEDED. The `keycloak` instance is an ES module export never attached to `window`; this call throws `ReferenceError`. Always use the header-capture pattern below:

```typescript
// Source: RESEARCH.md Pattern 2
const [req] = await Promise.all([
  page.waitForRequest(r =>
    r.url().includes('/api/') &&
    (r.headers()['authorization'] ?? '').startsWith('Bearer ')
  ),
  page.goto(`${FRONTEND_BASE}/dashboard.html`),
]);
const token = req.headers()['authorization'].slice('Bearer '.length);
```

### Serial mode declaration

**Source:** `tests/e2e/otp.spec.ts:5`
**Apply to:** `trip-edit-integration.spec.ts` (add), `new-user-trip-creation.spec.ts` (new file)

```typescript
// Source: tests/e2e/otp.spec.ts:5
test.describe.configure({ mode: 'serial' });
```

### API DELETE via page.request

**Source:** CONTEXT.md D-03 + RESEARCH Pattern 6 (no existing test analog)
**Apply to:** `new-user-trip-creation.spec.ts` beforeAll / afterAll

```typescript
// Source: RESEARCH.md Pattern 6
await page.request.delete(`${API_BASE}/trips/${trip.id}`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Nominatim `page.route()` mock + geocoder search-select interaction | test utility | request-response | `trip-edit-integration.spec.ts` fills geocoder input with a Google Maps URL (different code path); no spec exercises the Nominatim search-then-select flow. Use RESEARCH Pattern 3. |
| Leaflet marker assertions | test assertion | — | No existing test asserts Leaflet DOM state. Use RESEARCH §Code Examples (marker selectors) + CONTEXT D-04a. |
| Global search assertion post-create | test assertion | — | No test exercises in-memory search index update. Use CONTEXT D-05. |
| `beforeAll` trip cleanup (GET all + DELETE each) | test setup | CRUD | No existing spec cleans up API resources in `beforeAll`. Use RESEARCH Pattern 6. |

---

## Metadata

**Analog search scope:** `tests/e2e/`, `tests/global-setup.ts`, `tests/playwright.config.ts`, `frontend/src/pages/dashboard.ts`, `frontend/src/pages/trip-edit/activities.ts`
**Files scanned:** 9 (global-setup.ts, trip-edit-integration.spec.ts, passkeys.spec.ts, otp.spec.ts, auth.spec.ts:195–240, playwright.config.ts, dashboard.ts:99–160, activities.ts:80–160, .env.test.example)
**Pattern extraction date:** 2026-06-08
