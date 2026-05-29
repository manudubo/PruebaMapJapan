# Phase 9: Playwright Real Auth — Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 8 new/modified files
**Analogs found:** 6 / 8 (2 have no strong in-repo analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/global-setup.ts` | test-infra / setup | request-response | `tests/global-setup.ts` (self) | self — extend existing |
| `tests/playwright.config.ts` | config | config | `tests/playwright.config.ts` (self) | self — extend existing |
| `tests/e2e/fixtures/kc-admin.ts` | fixture / utility | request-response | `tests/e2e/fixtures/mockTrip.ts` | path-convention only (see note) |
| `tests/e2e/passkeys.spec.ts` | test | event-driven (CDP) | `tests/e2e/idp-theme.spec.ts` | role-match (KC-skip pattern) |
| `tests/e2e/otp.spec.ts` | test | request-response (serial) | `tests/e2e/api.spec.ts` | role-match (availability-skip pattern) |
| `tests/e2e/auth.spec.ts` | test | request-response | `tests/e2e/auth.spec.ts` (self) | self — partial migration |
| `tests/.env.test.example` | config / doc | — | none | no analog |
| `.gitignore` | config | — | `.gitignore` (self) | self — line insertion |
| `.github/workflows/ci.yml` | CI config | — | `.github/workflows/ci.yml` (self) | self — line insertion |

**Path ambiguity resolution (CONTEXT.md D-04 vs RESEARCH.md):** CONTEXT.md D-04 says `tests/fixtures/kc-admin.ts`. RESEARCH.md recommends `tests/e2e/fixtures/kc-admin.ts` to match the established `mockTrip.ts` convention. Use `tests/e2e/fixtures/kc-admin.ts`.

---

## Pattern Assignments

### `tests/global-setup.ts` (test-infra/setup, request-response)

**Analog:** `tests/global-setup.ts` (self — extend existing file)

**Existing imports + signature** (lines 1-2):
```typescript
import { chromium, FullConfig } from '@playwright/test';
```
New additions required: `import * as fs from 'fs'; import * as path from 'path';`

**Existing server-wait block to keep intact** (lines 25-47):
```typescript
async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const shouldWaitForFrontend = process.env.WAIT_FOR_FRONTEND === 'true';
  const shouldWaitForBackend = process.env.WAIT_FOR_BACKEND === 'true';

  if (shouldWaitForFrontend) {
    await waitForServer(FRONTEND_URL, 'Frontend dev server');
  }
  if (shouldWaitForBackend) {
    await waitForServer(`${BACKEND_URL}/api/health`, 'Backend dev server');
  }

  return async () => {
    console.log('Global teardown complete');
  };
}
```

**OIDC login block (insert after server waits, before teardown return):**
```typescript
// From RESEARCH.md Pattern 1
const AUTH_DIR = path.join(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'user.json');
const SESSION_STORAGE_PATH = path.join(AUTH_DIR, 'session.json');
const MAX_AGE_MS = 50 * 60 * 1000;

function isStorageStateFresh(): boolean {
  if (!fs.existsSync(STORAGE_STATE_PATH)) return false;
  const age = Date.now() - fs.statSync(STORAGE_STATE_PATH).mtimeMs;
  return age < MAX_AGE_MS;
}

async function kcLogin(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/PruebaMapJapan/dashboard.html`);
  await page.getByLabel(/username|email/i).fill(process.env.E2E_TEST_USERNAME!);
  await page.getByLabel(/password/i).fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard\.html/);

  await context.storageState({ path: STORAGE_STATE_PATH });

  const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
  fs.writeFileSync(SESSION_STORAGE_PATH, JSON.stringify(sessionEntries), 'utf-8');

  await browser.close();
}

// Guard block — insert before teardown return:
if (!process.env.SKIP_REAL_AUTH) {
  if (!isStorageStateFresh()) {
    await kcLogin();
  }
}
```

**SKIP_REAL_AUTH guard pattern** (from CONTEXT.md D-03, applied at function entry):
```typescript
// Check SKIP_REAL_AUTH first — entire OIDC block is conditional on this
if (!process.env.SKIP_REAL_AUTH) {
  // ... kcLogin block ...
}
```

---

### `tests/playwright.config.ts` (config, extend existing)

**Analog:** `tests/playwright.config.ts` (self)

**Existing imports + top-level config to keep intact** (lines 1-19):
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: [ ['html'], ...(process.env.CI ? [['github'] as ['github']] : []) ],
  use: {
    baseURL: 'http://localhost:5173/PruebaMapJapan/',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
```

**storageState addition to `chromium` project** (modify lines 20-24):
```typescript
// storageState is conditional — only set if SKIP_REAL_AUTH is not set
// and the file exists (globalSetup creates it only when not skipped)
{
  name: 'chromium',
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
  },
},
```

**New `chromium-passkeys` project entry (add after existing projects, lines 20-33):**
```typescript
// From RESEARCH.md Pattern 5
{
  name: 'chromium-passkeys',
  use: { ...devices['Desktop Chrome'] },
  testMatch: ['**/passkeys.spec.ts'],
},
```

**`globalSetup` line to keep** (line 34):
```typescript
  globalSetup: './global-setup.ts',
```

---

### `tests/e2e/fixtures/kc-admin.ts` (fixture/utility, request-response)

**Analog:** `tests/e2e/fixtures/mockTrip.ts` — path convention only.

`mockTrip.ts` is a data export with no `test.extend` pattern, so it gives only the directory convention (`tests/e2e/fixtures/`) and the co-export convention (`export const X`, `export const Y`). The fixture export pattern has no in-repo analog — the planner must use RESEARCH.md Pattern 3 directly.

**Path convention from `mockTrip.ts`** (lines 1-71):
- File lives in `tests/e2e/fixtures/`
- Named exports only (`export const mockTrip = ...`)
- No default export
- No imports from Playwright in `mockTrip.ts`

**Fixture export pattern (no in-repo analog — use RESEARCH.md Pattern 3):**
```typescript
import KcAdminClient from '@keycloak/keycloak-admin-client';
import { test as base, expect } from '@playwright/test';

async function buildAdminClient(): Promise<KcAdminClient> {
  const client = new KcAdminClient({
    baseUrl: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
    realmName: process.env.KEYCLOAK_REALM ?? 'japan-trip',
  });
  await client.auth({
    grantType: 'client_credentials',
    clientId: process.env.KC_ADMIN_CLIENT_ID!,
    clientSecret: process.env.KC_ADMIN_CLIENT_SECRET!,
  });
  return client;
}

// Named helper functions (plain, not fixture-wrapped)
export async function resetCredentials(username: string): Promise<void> { ... }
export async function clearOtpCodes(username: string): Promise<void> { ... }
export async function createUser(...): Promise<void> { ... }
export async function deleteUser(username: string): Promise<void> { ... }

// Playwright fixture extending base test
export const test = base.extend<{
  kcAdmin: {
    resetCredentials: typeof resetCredentials;
    clearOtpCodes: typeof clearOtpCodes;
  };
}>({
  kcAdmin: async ({}, use) => {
    await use({ resetCredentials, clearOtpCodes });
  },
});
export { expect } from '@playwright/test';
```

**clearOtpCodes — direct DB pattern (no KC Admin API endpoint exists):**
```typescript
// From RESEARCH.md Pattern 7
import postgres from 'postgres';

export async function clearOtpCodes(username: string): Promise<void> {
  const sql = postgres(process.env.POSTGRES_URL!);
  await sql`
    DELETE FROM email_otp_codes
    WHERE user_id = (SELECT id FROM users WHERE email = ${username})
  `;
  await sql.end();
}
```

---

### `tests/e2e/passkeys.spec.ts` (test, event-driven via CDP)

**Analog:** `tests/e2e/idp-theme.spec.ts`

**KC-availability skip pattern** (idp-theme.spec.ts lines 14-19):
```typescript
test.beforeEach(async ({ request }) => {
  const response = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, {
    timeout: 5000,
  }).catch(() => null);

  test.skip(!response?.ok(), 'Keycloak is not running locally');
});
```

**Adapt to SKIP_REAL_AUTH for passkeys.spec.ts:**
```typescript
// Replace KC availability check with env var guard (D-03)
test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');

// storageState + sessionStorage replay (from RESEARCH.md Pattern 2)
const sessionEntries: [string, string][] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../.auth/session.json'), 'utf-8')
);
test.use({
  storageState: path.join(__dirname, '../.auth/user.json'),
});
test.beforeEach(async ({ context }) => {
  await context.addInitScript((entries) => {
    for (const [k, v] of entries) window.sessionStorage.setItem(k, v);
  }, sessionEntries);
});
```

**CDP Virtual Authenticator pattern (from RESEARCH.md Pattern 4):**
```typescript
// NOTE: correct param is hasUserVerification — D-10 in CONTEXT.md is a typo (haUserVerification)
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable', { enableUI: false });
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: false,
  },
});
// ... run UI flow ...
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
```

**Pitfall warning for CDP sessions (RESEARCH.md Pitfall 7):** `page.context().newCDPSession(page)` scopes to the specific page object. If navigation replaces the page (e.g., KC login redirect), the CDP session is on the old page. Obtain a fresh CDP session from the post-redirect page, not before it.

**beforeEach pattern (resetCredentials from kc-admin fixture):**
```typescript
// Using kc-admin fixture before each passkey test
import { test, expect } from './fixtures/kc-admin';

test.beforeEach(async ({ kcAdmin }) => {
  await kcAdmin.resetCredentials(process.env.E2E_TEST_USERNAME ?? 'e2e-test@local');
});
```

---

### `tests/e2e/otp.spec.ts` (test, request-response serial)

**Analog:** `tests/e2e/api.spec.ts`

**Service-availability skip pattern** (api.spec.ts lines 7-16):
```typescript
async function isBackendRunning(): Promise<boolean> {
  try {
    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get('/api/health', { timeout: 3000 });
    await ctx.dispose();
    return res.status() < 500;
  } catch {
    return false;
  }
}
// Usage inside each test:
test.skip(!backendUp, 'Backend is not running — skipping API integration tests');
```

**Adapt to SKIP_REAL_AUTH + serial mode for otp.spec.ts:**
```typescript
import { test, expect } from '@playwright/test';

// Serial mode — mandatory; Mailpit is a single shared inbox
test.describe.configure({ mode: 'serial' });

// SKIP_REAL_AUTH guard at describe level
test.describe('OTP flow', () => {
  test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');
  // ...
});
```

**Mailpit purge + OTP fetch pattern (from RESEARCH.md Pattern 6):**
```typescript
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function purgeInbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

async function fetchLatestOtp(): Promise<string> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const data = await res.json() as { messages: Array<{ ID: string }> };
  if (!data.messages?.length) throw new Error('No messages in Mailpit');
  const msgId = data.messages[0].ID;
  const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msgId}`);
  const msg = await msgRes.json() as { Text: string };
  const match = msg.Text.match(/(\d{6})/);
  if (!match) throw new Error('No 6-digit OTP found in message');
  return match[1];
}
// NOTE: Response field names (ID, Text) are ASSUMED — Wave-0 spike required:
// curl http://localhost:8025/api/v1/messages | jq .
```

**Each OTP test pattern:**
```typescript
test('request OTP then verify code', async ({ page }) => {
  await purgeInbox();                       // clear before triggering
  // ... UI actions to request OTP ...
  const otp = await fetchLatestOtp();
  // ... fill OTP in UI, assert success ...
});
```

---

### `tests/e2e/auth.spec.ts` (test, partial migration)

**Analog:** `tests/e2e/auth.spec.ts` (self — keep existing mock tests, add real-auth section)

**Tests to KEEP mocked (per D-06 — unauthenticated behavior):**
- `'Login prompt is visible on dashboard when unauthenticated'` (lines 5-28) — uses `page.route('**/realms/**')` mock
- `'Auth guard redirects to Keycloak login'` (lines 67-91) — intercepts Keycloak requests
- `'Login prompt button triggers Keycloak redirect'` (lines 93-144) — intercepts navigation

**Existing mock pattern to preserve** (lines 6-9):
```typescript
await page.route('**/realms/**', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
});
```

**Tests to MIGRATE to real-auth (per D-06 — authenticated UI behavior):**
- `'Dashboard shows demo trips without login'` (lines 31-65) — currently mocked; can be real-auth if trips grid assertion benefits from real session
- `'Logout clears session storage'` (lines 146-191) — uses `page.evaluate` to set fake tokens; real-auth version would skip the fake-token step

**sessionStorage replay to add to migrated tests (from RESEARCH.md Pattern 2):**
```typescript
import * as fs from 'fs';
import * as path from 'path';

// At describe-block level for real-auth tests:
const sessionEntries: [string, string][] = !process.env.SKIP_REAL_AUTH
  ? JSON.parse(fs.readFileSync(path.join(__dirname, '../.auth/session.json'), 'utf-8'))
  : [];

test.use({
  storageState: process.env.SKIP_REAL_AUTH ? undefined : path.join(__dirname, '../.auth/user.json'),
});

test.beforeEach(async ({ context }) => {
  if (!process.env.SKIP_REAL_AUTH && sessionEntries.length) {
    await context.addInitScript((entries) => {
      for (const [k, v] of entries) window.sessionStorage.setItem(k, v);
    }, sessionEntries);
  }
});
```

---

### `tests/.env.test.example` (config/doc — no analog)

No in-repo analog. Plain key=value template file. All required vars from CONTEXT.md `<specifics>` block + RESEARCH.md:

```
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

---

### `.gitignore` (config — line insertion)

**Analog:** `.gitignore` (self)

**Insertion point — Testing section** (lines 21-26):
```
# Testing
coverage/
test-results/
tests/test-results/
tests/playwright-report/
```

**Add after line 26 (`tests/playwright-report/`):**
```
tests/.auth/
tests/.env.test
```

Rationale (RESEARCH.md Pitfall 3): `tests/.auth/user.json` contains a live JWT. `tests/.env.test` contains KC client secret. Neither is currently gitignored.

---

### `.github/workflows/ci.yml` (CI config — line insertion)

**Analog:** `.github/workflows/ci.yml` (self)

**Insertion point — `Run E2E tests` step** (lines 65-67):
```yaml
      - name: Run E2E tests (chromium only)
        run: npx playwright test --project=chromium
        working-directory: tests
```

**Add `env:` block to that step:**
```yaml
      - name: Run E2E tests (chromium only)
        run: npx playwright test --project=chromium
        working-directory: tests
        env:
          SKIP_REAL_AUTH: 'true'
```

---

## Shared Patterns

### SKIP_REAL_AUTH guard
**Source:** CONTEXT.md D-03, RESEARCH.md Architecture Patterns
**Apply to:** `global-setup.ts`, `passkeys.spec.ts`, `otp.spec.ts`, real-auth section of `auth.spec.ts`

Two forms:
1. At globalSetup level — wrap entire OIDC login block: `if (!process.env.SKIP_REAL_AUTH) { ... }`
2. At spec level — skip individual tests: `test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment')`

### sessionStorage replay workaround (Playwright bug #31108)
**Source:** CONTEXT.md D-16, D-17; RESEARCH.md Pattern 2
**Apply to:** `passkeys.spec.ts`, `auth.spec.ts` (real-auth section)

`addInitScript` MUST be registered before `page.goto()`. It already runs before first navigation by default in Playwright's lifecycle — call it in `beforeEach`, not after `goto`.

```typescript
test.beforeEach(async ({ context }) => {
  await context.addInitScript((entries) => {
    for (const [k, v] of entries) window.sessionStorage.setItem(k, v);
  }, sessionEntries);
});
// page.goto() is called inside the test body — this is correct ordering.
```

### page.route mock pattern (keep for unauthenticated tests)
**Source:** `tests/e2e/auth.spec.ts` lines 6-9
**Apply to:** Mock-mode tests in `auth.spec.ts` that remain mocked

```typescript
await page.route('**/realms/**', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
});
```

### KC-availability conditional skip
**Source:** `tests/e2e/idp-theme.spec.ts` lines 14-19 (request-based), adapted to env-var form for Phase 9
**Apply to:** `passkeys.spec.ts`, `otp.spec.ts`

Original (request-based):
```typescript
test.beforeEach(async ({ request }) => {
  const response = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, { timeout: 5000 }).catch(() => null);
  test.skip(!response?.ok(), 'Keycloak is not running locally');
});
```
Phase 9 form (env-var based per D-03):
```typescript
test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');
```

### CDP session scoping caution
**Source:** RESEARCH.md Pitfall 7
**Apply to:** `passkeys.spec.ts` only

CDP sessions are scoped to the specific page object at creation time. When KC login redirects create a new page navigation, the CDP session is on the pre-redirect page. Always re-acquire the CDP session from the settled page after redirects, not from a page object obtained before navigation.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/.env.test.example` | config/doc | — | No env template files exist in repo |
| `tests/e2e/fixtures/kc-admin.ts` (fixture export pattern) | fixture | request-response | `mockTrip.ts` only gives directory + named-export convention; `test.extend` pattern has no in-repo analog — use RESEARCH.md Pattern 3 |

---

## Metadata

**Analog search scope:** `tests/` directory (all `.spec.ts`, `global-setup.ts`, `playwright.config.ts`, fixtures), `.gitignore`, `.github/workflows/ci.yml`
**Files scanned:** 16 (14 spec files + global-setup.ts + playwright.config.ts + mockTrip.ts + ci.yml + .gitignore)
**Pattern extraction date:** 2026-05-26
