# Phase 9: Playwright Real Auth — Research

**Researched:** 2026-05-26
**Domain:** Playwright E2E, Keycloak OIDC, KC Admin REST API, CDP WebAuthn, Mailpit REST API
**Confidence:** HIGH (Playwright), MEDIUM (KC Admin patterns), MEDIUM (Mailpit response shape)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test user strategy (E2E-01)**
- D-01: `globalSetup.ts` logs in as a pre-seeded fixed test user (`e2e-test@local`) using OIDC PKCE via headless Chromium. Credentials stored as `E2E_TEST_USERNAME` and `E2E_TEST_PASSWORD` env vars in `tests/.env.test` (gitignored, `.env.test.example` committed). This user is pre-created in KC once (manual KC console or Terraform) and never deleted by the test suite.
- D-02: Stable password — no per-run credential rotation. `globalSetup` checks if `tests/.auth/user.json` exists and is unexpired before attempting re-login (reuse storageState when possible). The file is gitignored.
- D-03: `globalSetup` checks `process.env.SKIP_REAL_AUTH` first. If set (CI uses `SKIP_REAL_AUTH=true`), skip KC login entirely — no storageState is written. Real-auth test files guard themselves with `test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment')`.

**KC Admin fixtures (E2E-02)**
- D-04: `tests/fixtures/kc-admin.ts` exports a `kcAdmin` Playwright fixture (and plain helper functions) that calls the KC Admin API using client credentials grant against the `japan-trip-worker` service account (already configured in Phase 7, D-01 to D-03). Credentials: `KC_ADMIN_CLIENT_ID` and `KC_ADMIN_CLIENT_SECRET` from `tests/.env.test`.
- D-05: Fixture provides: `createUser()`, `deleteUser()`, `resetCredentials()`, `clearOtpCodes()` (via direct DB query or KC Admin). `clearOtpCodes` clears the `email_otp_codes` table rows for the test user before OTP tests run.

> **Planner note — fixture path ambiguity:** D-04 says `tests/fixtures/kc-admin.ts` but the canonical refs section points to `tests/e2e/fixtures/mockTrip.ts` as the pattern to follow. The existing codebase convention is `tests/e2e/fixtures/`. Use `tests/e2e/fixtures/kc-admin.ts` to match the established pattern. This is the recommended resolution.

**Existing mock tests migration (E2E-01)**
- D-06: Claude decides which auth.spec.ts tests to migrate to real-auth. The criterion: tests that assert authenticated UI behavior (trips grid visible after login, user info shown) benefit from a real session. Tests that assert unauthenticated behavior (login prompt visible, redirect to KC URL) do NOT need a real session and can stay mocked. Keep the same file (`auth.spec.ts`) — no separate project.
- D-07: No tagging (`@mocked`, `@real-auth`) on test cases. Mix is implicit. Developers understand that real-auth tests require KC running locally.

**CI strategy (E2E-01)**
- D-08: Real-auth tests are local-only for Phase 9. GitHub Actions CI workflow sets `SKIP_REAL_AUTH: true` in the `env:` block for the Playwright test step. CI continues running the existing mocked tests (no KC service container in GHA for this phase).
- D-09: `tests/.auth/user.json` and `tests/.env.test` are gitignored. A `tests/.env.test.example` file is committed with placeholder values documenting the required env vars.

**Chromium-passkeys project (E2E-03)**
- D-10: Add a `chromium-passkeys` Playwright project in `playwright.config.ts`. This project runs only passkey-specific spec files (e.g., `tests/e2e/passkeys.spec.ts`). It uses CDP `session.send('WebAuthn.enable', { enableUI: false })` + `session.send('WebAuthn.addVirtualAuthenticator', ...)` to register a software passkey without physical hardware.
  > **Planner note — typo in D-10:** `haUserVerification` in the CONTEXT.md decision is a typo. The correct CDP parameter name is `hasUserVerification`. All code must use `hasUserVerification`.
- D-11: Passkey tests require a clean-credential test user at the start. The `kc-admin` fixture `resetCredentials()` removes all passkeys for `e2e-test@local` in `beforeEach`. Tests: register passkey, login with passkey, delete passkey (last-credential guard).

**OTP test strategy (E2E-04)**
- D-12: OTP tests (`tests/e2e/otp.spec.ts`) use `test.describe.configure({ mode: 'serial' })` to prevent parallel Mailpit inbox interference. The `chromium-passkeys` project also implicitly serializes OTP tests if they share the same Playwright worker.
- D-13: A dedicated `otp-test@local` user is pre-seeded in KC for OTP tests. This user has: a verified email address (`otp-test@local`), no passkeys registered, and a password set. Separate from `e2e-test@local` to avoid session state pollution. Its credentials live in `tests/.env.test` as `E2E_OTP_USERNAME` / `E2E_OTP_PASSWORD`.
- D-14: OTP email fetch: `GET http://localhost:8025/api/v1/messages` returns all Mailpit messages. OTP tests call `DELETE /api/v1/messages` (purge) before triggering OTP request, then fetch and parse the latest message. Serial execution guarantees no interference from other tests.
- D-15: Mailpit REST base URL: `MAILPIT_URL` env var in `tests/.env.test`, default `http://localhost:8025`.

**sessionStorage replay (E2E-01)**
- D-16: Playwright bug #31108 — keycloak-js stores tokens in sessionStorage, which is not captured by `storageState` (only localStorage and cookies are). Workaround: after login in `globalSetup`, capture sessionStorage via `page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)))`, store alongside `user.json`. In each test that needs auth, inject via `context.addInitScript(({ entries }) => { entries.forEach(([k, v]) => sessionStorage.setItem(k, v)); }, { entries })`.
- D-17: The `addInitScript` approach injects session before first navigation. Tests that use `storageState` + `addInitScript` must call `page.goto()` AFTER the script is registered (which is the default Playwright flow — `addInitScript` runs before any navigation).

### Claude's Discretion

- How to determine if storageState is expired vs valid before attempting re-login (file age check or KC token introspection)
- Exact CDP VirtualAuthenticator `options` parameters for passkey tests (protocol, transport, haUserVerification, hasResidentKey)
- Whether to also delete `otp-test@local` OTP codes via KC Admin API or via direct DB query in `clearOtpCodes()` fixture
- Exact structure of `tests/.env.test.example` — document all required vars
- Whether `chromium-passkeys` project is added to the main `playwright.config.ts` or gets its own config file

### Deferred Ideas (OUT OF SCOPE)

- KC as a GitHub Actions service container — explicitly deferred to a future phase; CI stays with mocked tests for now
- OTP test per-recipient email filtering (parallel-safe approach) — deferred; serial is sufficient for now
- `test.describe.configure({ mode: 'serial' })` at the config level for the entire OTP suite — deferred; in-file serial config is sufficient
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| E2E-01 | Playwright global setup drives real OIDC login via headless Chromium, writes `tests/.auth/user.json` via `storageState`; sessionStorage replayed via `page.evaluate` + `context.addInitScript()` workaround for Playwright bug #31108; ROPC not used | storageState + addInitScript pattern verified in Context7; PKCE flow via headless browser documented |
| E2E-02 | Keycloak Admin API fixture helper (`tests/e2e/fixtures/kc-admin.ts`) — creates/deletes test users, resets credentials, clears OTP codes between test runs; uses client credentials grant against `japan-trip-worker` service account | `@keycloak/keycloak-admin-client` 26.6.2 API verified from source; credential endpoints confirmed |
| E2E-03 | Passkey E2E tests in dedicated `chromium-passkeys` Playwright project — CDP Virtual Authenticator API registers/asserts passkeys in headless Chromium; tests: register passkey, login with passkey, delete passkey (guard: last credential) | CDP WebAuthn commands verified with correct parameter names; testMatch pattern for project scoping confirmed |
| E2E-04 | OTP fallback E2E tests — Mailpit REST API (`GET /api/v1/messages`) reads delivered OTP code; tests: request OTP, verify OTP, expired OTP rejected, max-attempts lockout, UPDATE_PASSWORD flow gated by WebAuthn capability flag | Mailpit endpoint pattern confirmed; serial mode verified; exact response field names require Wave-0 spike |
</phase_requirements>

---

## Summary

Phase 9 adds a real-auth Playwright test layer on top of the existing mocked test suite. The three main tracks are independent: (1) OIDC globalSetup via headless Chromium + sessionStorage workaround, (2) KC Admin fixture for per-test state reset, and (3) CDP Virtual Authenticator for passkey E2E + Mailpit for OTP E2E.

The existing Playwright version in `tests/package.json` is `^1.48.0`. Playwright 1.60.0 is current. The `@playwright/test` package should be upgraded to at least 1.50+ for the `testMatch` property per-project support (was available from 1.10+), though the new native `BrowserContext.credentials` WebAuthn API (cross-browser, userland) is available in 1.60.0. Per D-10, the CDP path is locked for this phase — upgrade to current is still recommended for stability fixes.

The `@keycloak/keycloak-admin-client` at v26.6.2 matches the KC version in use and provides typed methods that cover all required `kc-admin.ts` operations without raw fetch. The `clearOtpCodes()` function is a special case: OTP codes live in the backend's `email_otp_codes` Drizzle/Postgres table, not in Keycloak — KC Admin API has no endpoint for them. Direct DB query is the correct path.

**Primary recommendation:** Use `@keycloak/keycloak-admin-client` for all KC Admin calls in the fixture. For `clearOtpCodes`, execute SQL directly against the backend Postgres database via the `postgres` (or `pg`) npm client. Use a `tests/.env.test` entry for the database connection string.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OIDC PKCE login (globalSetup) | Test infra (headless Chromium) | KC (external) | Drives the browser through the real KC login form; no backend involvement |
| storageState + sessionStorage replay | Test infra (Playwright config/fixtures) | — | Client-side auth token storage; captured post-login, replayed via addInitScript |
| KC user/credential CRUD (E2E-02) | Test infra (kc-admin.ts fixture) | KC (external) | Uses KC Admin REST API; no frontend or backend change |
| OTP code cleanup (clearOtpCodes) | Test infra (kc-admin.ts fixture) | Backend DB | OTP codes live in Postgres `email_otp_codes`; must SQL-delete, KC has no such endpoint |
| CDP Virtual Authenticator (E2E-03) | Test infra (chromium-passkeys project) | Chromium CDP | CDP commands are Chromium-only; project scoping enforces correct browser |
| OTP email fetch (E2E-04) | Test infra (otp.spec.ts) | Mailpit (external) | Tests read from Mailpit REST; no frontend/backend change |
| SKIP_REAL_AUTH gate | Test infra (globalSetup + spec files) | CI (GHA env) | Guards all real-auth tests; CI sets env var to bypass |

---

## Standard Stack

### Core (test workspace additions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | 1.60.0 | E2E test runner | Already in use; upgrade from ^1.48.0 for bug fixes |
| `@keycloak/keycloak-admin-client` | 26.6.2 | KC Admin REST API client | Official KC library, version-matched to KC 26; typed API surface avoids raw fetch |
| `dotenv` | 16.x | Load `tests/.env.test` | Already in `tests/package.json` |

[VERIFIED: npm registry — `@keycloak/keycloak-admin-client@26.6.2`, `@playwright/test@1.60.0`]

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pg` or `postgres` | latest | Direct DB query for `clearOtpCodes()` | Needed only if backend doesn't expose a test-only cleanup endpoint |
| `mailpit-api` | 2.0.0 | Typed Mailpit REST client | Optional — reduces Mailpit response parsing boilerplate; zero dependencies |

[VERIFIED: npm registry — `mailpit-api@2.0.0`]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@keycloak/keycloak-admin-client` | Raw `fetch` to KC Admin | Library provides types and auth token refresh; raw fetch requires manual token management |
| CDP WebAuthn | `BrowserContext.credentials` (Playwright 1.60+) | Native API works cross-browser but requires upgrading; CDP is locked per D-10 |
| Direct DB for `clearOtpCodes` | KC Admin API | KC has no `email_otp_codes` endpoint — KC Admin path is not viable |
| Mailpit REST via fetch | `mailpit-api` npm package | npm package types save response parsing boilerplate; either works |

**Installation (tests workspace):**
```bash
npm install --prefix tests @keycloak/keycloak-admin-client@26.6.2
npm install --prefix tests @playwright/test@1.60.0
# Optional:
npm install --prefix tests mailpit-api
```

---

## Architecture Patterns

### System Architecture Diagram

```
globalSetup.ts
  │
  ├─ SKIP_REAL_AUTH=true? ──────────────────────────────► skip (CI path)
  │
  ├─ .auth/user.json exists + not expired? ────────────► reuse (fast path)
  │
  └─ headless Chromium ──► KC login form ──► PKCE callback
        │                        │
        │                  username/password
        │                  from .env.test
        │
        ├─ page.context().storageState({ path: '.auth/user.json' })
        └─ page.evaluate(sessionStorage) ──► .auth/session.json


spec files (real-auth)
  │
  ├─ test.skip(!!SKIP_REAL_AUTH)
  │
  ├─ context({ storageState: '.auth/user.json' })
  │         + addInitScript(sessionStorage entries)
  │
  └─ test body ──► page.goto() ──► authenticated UI


kc-admin fixture (beforeEach/afterEach)
  │
  ├─ KC token endpoint (client_credentials) ──► access_token
  │
  ├─ resetCredentials() ──► GET /admin/realms/{realm}/users?username=
  │                       └─ DELETE /admin/realms/{realm}/users/{id}/credentials/{credId}
  │
  └─ clearOtpCodes()   ──► SQL DELETE FROM email_otp_codes WHERE user_id = ?
                           (direct DB connection via pg/postgres)


chromium-passkeys project (E2E-03)
  │
  ├─ testMatch: ['**/passkeys.spec.ts']
  ├─ use: { ...devices['Desktop Chrome'] }
  │
  └─ test body:
       ├─ page.context().newCDPSession(page)
       ├─ cdp.send('WebAuthn.enable', { enableUI: false })
       ├─ cdp.send('WebAuthn.addVirtualAuthenticator', { options: {...} })
       │        authenticatorId returned
       ├─ [perform registration UI flow]
       ├─ [perform login UI flow]
       └─ cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })


otp.spec.ts (E2E-04, serial)
  │
  ├─ test.describe.configure({ mode: 'serial' })
  │
  └─ each test:
       ├─ DELETE http://localhost:8025/api/v1/messages  (purge inbox)
       ├─ [trigger OTP via app UI]
       ├─ GET  http://localhost:8025/api/v1/messages
       └─ parse /\d{6}/ from latest message body
```

### Recommended Project Structure
```
tests/
├── .auth/                  # gitignored — created by globalSetup
│   ├── user.json           # storageState output
│   └── session.json        # sessionStorage keys (keycloak-js tokens)
├── .env.test               # gitignored — local secrets
├── .env.test.example       # committed — documents all required vars
├── e2e/
│   ├── fixtures/
│   │   ├── mockTrip.ts     # existing
│   │   └── kc-admin.ts     # new — KC Admin fixture + helpers
│   ├── auth.spec.ts        # existing — mocked tests stay + real-auth additions
│   ├── idp-theme.spec.ts   # existing
│   ├── passkeys.spec.ts    # new — chromium-passkeys project only
│   └── otp.spec.ts         # new — serial OTP tests
├── global-setup.ts         # extended — add OIDC login block
├── playwright.config.ts    # extended — add chromium-passkeys project, storageState
└── package.json            # add @keycloak/keycloak-admin-client
```

### Pattern 1: globalSetup OIDC Login with storageState + sessionStorage

```typescript
// Source: https://playwright.dev/docs/auth + Context7 /microsoft/playwright
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_DIR = path.join(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'user.json');
const SESSION_STORAGE_PATH = path.join(AUTH_DIR, 'session.json');
const MAX_AGE_MS = 50 * 60 * 1000; // 50 min (KC default token lifetime is 60 min)

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

  await page.goto(`${process.env.FRONTEND_URL}/PruebaMapJapan/dashboard.html`);
  // KC login form appears after PKCE redirect
  await page.getByLabel(/username|email/i).fill(process.env.E2E_TEST_USERNAME!);
  await page.getByLabel(/password/i).fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard\.html/);

  // Capture storageState (cookies + localStorage)
  await context.storageState({ path: STORAGE_STATE_PATH });

  // Capture sessionStorage (Playwright bug #31108 — keycloak-js tokens live here)
  const sessionEntries = await page.evaluate(
    () => Object.entries(sessionStorage)
  );
  fs.writeFileSync(SESSION_STORAGE_PATH, JSON.stringify(sessionEntries), 'utf-8');

  await browser.close();
}

// In globalSetup function body:
if (!process.env.SKIP_REAL_AUTH) {
  if (!isStorageStateFresh()) {
    await kcLogin();
  }
}
```

### Pattern 2: Replay sessionStorage in Tests

```typescript
// Source: Context7 /microsoft/playwright auth.md
import * as fs from 'fs';
import * as path from 'path';

// In test.beforeEach or test.use:
const sessionEntries: [string, string][] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../.auth/session.json'), 'utf-8')
);

test.use({
  storageState: path.join(__dirname, '../../.auth/user.json'),
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript((entries) => {
    for (const [k, v] of entries) {
      window.sessionStorage.setItem(k, v);
    }
  }, sessionEntries);
});
// page.goto() must be called AFTER addInitScript is registered — which is the normal flow.
```

### Pattern 3: KC Admin Fixture

```typescript
// Source: GitHub keycloak/keycloak — js/libs/keycloak-admin-client/test/users.spec.ts
import KcAdminClient from '@keycloak/keycloak-admin-client';
import { test as base } from '@playwright/test';

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

export async function resetCredentials(username: string): Promise<void> {
  const client = await buildAdminClient();
  const [user] = await client.users.find({ username, exact: true });
  if (!user?.id) throw new Error(`User not found: ${username}`);
  const credentials = await client.users.getCredentials({ id: user.id });
  for (const cred of credentials) {
    if (cred.type === 'webauthn-passwordless' || cred.type === 'webauthn') {
      await client.users.deleteCredential({ id: user.id, credentialId: cred.id! });
    }
  }
}

// Playwright fixture export pattern (matching tests/e2e/fixtures/mockTrip.ts convention):
export const test = base.extend<{ kcAdmin: { resetCredentials: typeof resetCredentials } }>({
  kcAdmin: async ({}, use) => {
    await use({ resetCredentials });
  },
});
export { expect } from '@playwright/test';
```

### Pattern 4: CDP Virtual Authenticator (Passkey Tests)

```typescript
// Source: Corbado blog (verified against CDP WebAuthn protocol spec)
// NOTE: correct param is hasUserVerification (not haUserVerification — D-10 typo)
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable', { enableUI: false });
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',        // simulates platform authenticator (Face ID / fingerprint)
    hasResidentKey: true,         // enables discoverable/resident credentials
    hasUserVerification: true,    // enables UV flag — KC WebAuthn policy requires this
    isUserVerified: true,         // auto-pass UV check; set false to test UV failure
    automaticPresenceSimulation: false, // manual control for registration UI flow
  },
});
// ... run registration/assertion UI flow ...
await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
```

### Pattern 5: chromium-passkeys Project Config

```typescript
// In playwright.config.ts — add to projects array:
{
  name: 'chromium-passkeys',
  use: { ...devices['Desktop Chrome'] },
  testMatch: ['**/passkeys.spec.ts'],
},
```

No separate config file needed — `testMatch` per-project is the standard Playwright pattern.
[VERIFIED: Context7 /microsoft/playwright testMatch project documentation]

### Pattern 6: Mailpit OTP Fetch

```typescript
// Source: DEV.to kochan article (MEDIUM confidence — response shape [ASSUMED])
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function purgeInbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

async function fetchLatestOtp(): Promise<string> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const data = await res.json() as { messages: Array<{ ID: string }> };
  if (!data.messages?.length) throw new Error('No messages in Mailpit');
  const msgId = data.messages[0].ID;
  // Fetch full message body for OTP extraction
  const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msgId}`);
  const msg = await msgRes.json() as { Text: string };
  const match = msg.Text.match(/(\d{6})/);
  if (!match) throw new Error('No 6-digit OTP found in message');
  return match[1];
}
```

> **Wave-0 spike required:** Response field names (`messages[].ID`, `Text`) are [ASSUMED] based on community sources. Before implementing OTP parsing, run `curl http://localhost:8025/api/v1/messages | jq .` and `curl http://localhost:8025/api/v1/message/latest | jq .` to capture actual field names. Alternative: use `mailpit-api@2.0.0` npm package which provides typed responses.

### Pattern 7: clearOtpCodes via Direct DB

```typescript
// clearOtpCodes cannot use KC Admin API — email_otp_codes is a backend Postgres table (BACK-03)
// Use postgres/pg client with POSTGRES_URL from tests/.env.test

import postgres from 'postgres'; // or pg

async function clearOtpCodesForUser(username: string): Promise<void> {
  const sql = postgres(process.env.POSTGRES_URL!);
  // Join via users table to get user_id
  await sql`
    DELETE FROM email_otp_codes
    WHERE user_id = (SELECT id FROM users WHERE email = ${username})
  `;
  await sql.end();
}
```

[ASSUMED: DB client library choice (`postgres` vs `pg`) — either works; `postgres` (porsager) is leaner for one-off queries]

### Anti-Patterns to Avoid

- **ROPC (Resource Owner Password Credentials):** REQUIREMENTS.md explicitly forbids this. Always drive PKCE through the browser.
- **CDP WebAuthn in non-Chromium projects:** CDP commands only work in Chromium. The `chromium-passkeys` project scopes this correctly via `testMatch`.
- **Running OTP tests in parallel:** Mailpit is a single inbox. `test.describe.configure({ mode: 'serial' })` is mandatory in `otp.spec.ts`.
- **Committing `.auth/` or `.env.test`:** The root `.gitignore` must include `tests/.auth/` and `tests/.env.test`. Currently only `.env` and `.env.*.local` are gitignored — a gap that must be fixed in Wave 0.
- **Using password grant for KC Admin token:** The Phase 7 `japan-trip-worker` client uses client_credentials grant, not password grant. The fixture must match.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| KC Admin REST calls | Raw `fetch` with manual token refresh | `@keycloak/keycloak-admin-client` | Token expiry, typed responses, find-by-username, credential delete — all provided |
| Passkey simulation | Actual browser extension or hardware stub | CDP `WebAuthn.addVirtualAuthenticator` | CDP is the standard path; hardware would require physical device |
| storageState expiry check | Token introspection call to KC | File `mtime` check vs. `MAX_AGE_MS` | Simpler, no network dependency, sufficient for local dev |
| OTP email parsing | Custom SMTP listener | Mailpit REST API | Mailpit already running in docker-compose (INFRA-03); REST API avoids IMAP complexity |

---

## Runtime State Inventory

N/A — this phase is net-new test infrastructure. No rename/refactor/migration. No existing runtime state to migrate.

---

## Common Pitfalls

### Pitfall 1: CDP `haUserVerification` Typo
**What goes wrong:** D-10 in CONTEXT.md spells the parameter as `haUserVerification`. The CDP WebAuthn protocol requires `hasUserVerification`. Code using the typo silently no-ops UV — Keycloak's WebAuthn Passwordless policy requires UV=true, so registration will appear to succeed but KC will reject the credential.
**Why it happens:** Typo propagated from discussion into locked decision.
**How to avoid:** Always use `hasUserVerification: true` in `WebAuthn.addVirtualAuthenticator` options.
**Warning signs:** KC rejects passkey assertion with "User Verification required" or similar policy error.

### Pitfall 2: sessionStorage Not in storageState
**What goes wrong:** Tests navigate to an authenticated route and see the login prompt — even though `storageState` is set. keycloak-js stores its tokens in `sessionStorage`, not `localStorage` or cookies.
**Why it happens:** Playwright bug #31108 — `storageState` only captures `localStorage` and cookies.
**How to avoid:** globalSetup must write `.auth/session.json` and all real-auth tests must call `context.addInitScript` before `page.goto()`.
**Warning signs:** `page.goto('/dashboard.html')` shows login prompt despite storageState being applied.

### Pitfall 3: `.auth/` Directory Not Gitignored
**What goes wrong:** `tests/.auth/user.json` contains a live JWT. If committed, tokens leak in git history.
**Why it happens:** Root `.gitignore` currently covers `tests/test-results/` and `tests/playwright-report/` but NOT `tests/.auth/`.
**How to avoid:** Add `tests/.auth/` and `tests/.env.test` to root `.gitignore` in Wave 0.
**Warning signs:** `git status` shows `tests/.auth/user.json` as untracked.

### Pitfall 4: addInitScript Must Fire Before First Navigation
**What goes wrong:** sessionStorage is empty when the page loads — KC-js sees no tokens and treats user as unauthenticated.
**Why it happens:** `addInitScript` is registered too late (after `page.goto()` has already been called).
**How to avoid:** Always call `context.addInitScript(...)` before any `page.goto()`. This is the natural Playwright flow when addInitScript is called in `beforeEach`.
**Warning signs:** Tests intermittently see login prompt or unauthenticated state.

### Pitfall 5: `clearOtpCodes` via KC Admin API
**What goes wrong:** Attempts to call KC Admin `/credentials` endpoints to clear OTP codes fail — KC has no such endpoint.
**Why it happens:** Confusion between KC credentials (passwords, WebAuthn) and the app's custom `email_otp_codes` Drizzle table in Postgres (BACK-03).
**How to avoid:** `clearOtpCodes()` must connect to Postgres directly and `DELETE FROM email_otp_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)`.
**Warning signs:** `clearOtpCodes` returns 404 or "credential type not found".

### Pitfall 6: OTP Tests Failing Due to Stale Inbox
**What goes wrong:** OTP test fetches a code from a previous test run — expired code is sent, KC rejects it with "invalid OTP".
**Why it happens:** Mailpit inbox not purged before triggering the OTP request.
**How to avoid:** Always call `DELETE /api/v1/messages` before the UI action that triggers OTP send.
**Warning signs:** OTP verify step fails with "OTP invalid or expired" despite correct code shown.

### Pitfall 7: CDP Session Scoped to Page, Not Context
**What goes wrong:** Virtual authenticator disappears mid-test when a new page is opened (e.g., after KC redirect).
**Why it happens:** `page.context().newCDPSession(page)` scopes the CDP session to the specific page object. If navigation replaces the page, the CDP session is on the old page.
**How to avoid:** Obtain the CDP session from the context-level, or re-attach after navigation if the test drives a full redirect flow. Alternatively, use `browser.newContext()` and get CDP session from the resulting page after any redirect settles.
**Warning signs:** `WebAuthn.addVirtualAuthenticator` call succeeds but subsequent registration fails with "no authenticator found".

---

## Code Examples

See Pattern 1–7 above for all verified code. Supplementary reference:

### KC Admin Token Endpoint (client_credentials)
```
POST {KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={KC_ADMIN_CLIENT_ID}
&client_secret={KC_ADMIN_CLIENT_SECRET}
```

Response: `{ "access_token": "...", "expires_in": 300, ... }`

[CITED: https://www.keycloak.org/docs-api/latest/rest-api/index.html — Auth section]

### KC Admin User Lookup + Credential Delete (raw REST, for reference)
```
GET  {KEYCLOAK_URL}/admin/realms/{realm}/users?username={email}&exact=true
     Authorization: Bearer {access_token}

GET  {KEYCLOAK_URL}/admin/realms/{realm}/users/{userId}/credentials
     Authorization: Bearer {access_token}
     → returns [{id, type, credentialData, ...}]
     → credentialType for passkeys: "webauthn-passwordless" or "webauthn"

DELETE {KEYCLOAK_URL}/admin/realms/{realm}/users/{userId}/credentials/{credentialId}
       Authorization: Bearer {access_token}
```

[CITED: keycloak/keycloak GitHub — users.spec.ts confirms getCredentials/deleteCredential method names]

### `.env.test.example` Required Variables
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

[CITED: CONTEXT.md `<specifics>` block — all vars listed there; POSTGRES_URL added for clearOtpCodes]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CDP `WebAuthn.addVirtualAuthenticator` | `BrowserContext.credentials` (context7-backed, cross-browser) | Playwright 1.60.0 (inferred — docs in HEAD) | Native API works in FF + WebKit; CDP still valid for Chromium-only |
| Manual `fs.writeFileSync` for sessionStorage | Same (still manual) | Playwright bug #31108 open (as of 2026-05) | No native support — workaround is the only option |
| `storageState` captures localStorage + cookies | Same | Unchanged | IndexedDB capture added in 1.51 via `indexedDB: true` option |

**Deprecated/outdated:**
- ROPC password grant in tests: REQUIREMENTS.md forbids it; always use PKCE + storageState.
- `page.context().newCDPSession(page)` in non-Chromium: CDP commands are no-ops in Firefox/WebKit. Scope to `chromium-passkeys` project only.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Mailpit response fields are `{ messages: [{ ID: string, ... }] }` and single message has `{ Text: string }` | Code Examples / Pattern 6 | OTP parsing code silently returns `undefined`; tests fail at assertion |
| A2 | keycloak-js stores tokens under keys like `kc_token`, `kc_refreshToken` in sessionStorage | Pattern 1 (sessionStorage capture) | Low — D-16 captures all keys via `Object.entries(sessionStorage)`, not by key name; no risk |
| A3 | `postgres` (porsager) is available on the machine or easily installable via npm for `clearOtpCodes` | Pattern 7 | Can substitute `pg` — low risk |
| A4 | KC credential type for WebAuthn passwordless is `"webauthn-passwordless"` | Pattern 3 (resetCredentials) | resetCredentials may not filter the right credentials; test setup leaves stale passkeys |
| A5 | `BrowserContext.credentials` native API was introduced in Playwright 1.60.0 | State of the Art | LOW — version exact is unverified; it appears in current HEAD docs |

---

## Open Questions (RESOLVED)

1. **Mailpit exact response shape**
   - What we know: Mailpit has `GET /api/v1/messages` and `GET /api/v1/message/{id}` endpoints; community shows fields named `ID`, `Text`, `Subject`
   - What's unclear: exact casing (`ID` vs `id`), whether list response wraps in `{ messages: [...] }` or returns the array directly, whether `Text` vs `Body.Text`
   - RESOLVED: Plan 01 Task 2 includes a Wave-0 Mailpit spike (`curl http://localhost:8025/api/v1/messages | jq .`) that captures the actual field names at execution time and records them in `tests/e2e/helpers/mailpit.ts`. OTP parsing in Plan 07 reads from that helper.

2. **KC WebAuthn credential type name**
   - What we know: KC has separate "webauthn" (MFA) and "webauthn-passwordless" policies
   - What's unclear: exact `type` value returned by `getCredentials()` for passwordless passkeys registered via `webauthn-register-passwordless` action
   - RESOLVED: Plan 04 handles both `"webauthn"` and `"webauthn-passwordless"` credential type strings in `resetCredentials()` — credentials matching either type are deleted, making the exact value irrelevant at the plan level.

3. **storageState token expiry detection**
   - What we know: KC default access token lifetime is 5 minutes; refresh token lifetime is longer; file mtime check is simpler than introspection
   - What's unclear: Whether KC refresh tokens are stored in storageState cookies or only in sessionStorage
   - RESOLVED: Plan 03 uses `MAX_AGE_MS = 50 * 60 * 1000` (50 min) as the file age threshold. This is safe for KC's default 5-min access token + 60-min session lifetime. If the session is expired, globalSetup re-runs the OIDC login flow transparently.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Keycloak | E2E-01, E2E-02, E2E-03 | [ASSUMED: local] | 26.x | `SKIP_REAL_AUTH=true` bypasses all real-auth tests |
| Mailpit | E2E-04 | [ASSUMED: local via docker-compose] | 1.29+ | Serial OTP tests require Mailpit; no fallback — skip with `SKIP_REAL_AUTH` |
| Postgres | `clearOtpCodes()` | [ASSUMED: local via docker-compose] | 15+ | Required for OTP code cleanup — no fallback if unavailable |
| Node 22 | tests workspace | [VERIFIED: CI uses Node 22 per `.github/workflows`] | 22.x | None needed |
| Docker / docker-compose | KC + Mailpit + Postgres | [ASSUMED: local] | — | Tests requiring services fail without it |

**Missing dependencies with no fallback:**
- Postgres connectivity for `clearOtpCodes()` — plan must include `POSTGRES_URL` env var in `.env.test.example`

**Missing dependencies with fallback:**
- KC / Mailpit not running locally → `SKIP_REAL_AUTH=true` skips all real-auth tests; mocked tests continue to pass

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.60.0 (upgrade from ^1.48.0) |
| Config file | `tests/playwright.config.ts` |
| Quick run command | `npx playwright test --project chromium --grep @real-auth` (or specific file) |
| Full suite command | `npx playwright test` (from `tests/` directory) |

> Note: D-07 forbids tags; per-file quick runs are the intended fast-feedback path.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E2E-01 | globalSetup writes `.auth/user.json` + `session.json` | integration (setup) | `npx playwright test global-setup.ts` | ❌ Wave 0 extends existing |
| E2E-01 | Real session visible on dashboard after login | e2e | `npx playwright test auth.spec.ts` | ✅ (partial — real-auth section to add) |
| E2E-02 | `kcAdmin.resetCredentials` removes passkey credentials | integration | `npx playwright test passkeys.spec.ts -x` (uses fixture) | ❌ Wave 0 |
| E2E-03 | Register passkey via CDP Virtual Authenticator | e2e | `npx playwright test --project chromium-passkeys passkeys.spec.ts` | ❌ Wave 0 |
| E2E-03 | Login with passkey | e2e | `npx playwright test --project chromium-passkeys passkeys.spec.ts` | ❌ Wave 0 |
| E2E-03 | Delete passkey respects last-credential guard | e2e | `npx playwright test --project chromium-passkeys passkeys.spec.ts` | ❌ Wave 0 |
| E2E-04 | OTP request → Mailpit fetch → verify | e2e (serial) | `npx playwright test otp.spec.ts` | ❌ Wave 0 |
| E2E-04 | Expired OTP rejected | e2e (serial) | `npx playwright test otp.spec.ts` | ❌ Wave 0 |
| E2E-04 | Max-attempts lockout | e2e (serial) | `npx playwright test otp.spec.ts` | ❌ Wave 0 |
| E2E-04 | UPDATE_PASSWORD gated by WebAuthn capability | e2e (serial) | `npx playwright test otp.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test --project chromium <relevant-spec-file> -x` (from `tests/` dir)
- **Per wave merge:** `npx playwright test --project chromium` (all chromium tests)
- **Phase gate:** Full suite `npx playwright test` green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/e2e/fixtures/kc-admin.ts` — KC Admin fixture; covers E2E-02
- [ ] `tests/e2e/passkeys.spec.ts` — stub test file; covers E2E-03
- [ ] `tests/e2e/otp.spec.ts` — stub test file with serial config; covers E2E-04
- [ ] `tests/.auth/.gitkeep` + update root `.gitignore` with `tests/.auth/` and `tests/.env.test`
- [ ] `tests/.env.test.example` — all required vars with placeholders
- [ ] `npm install @keycloak/keycloak-admin-client@26.6.2 --prefix tests`
- [ ] `npm install @playwright/test@1.60.0 --prefix tests` (upgrade from ^1.48.0)
- [ ] Mailpit response shape spike: `curl http://localhost:8025/api/v1/messages | jq .` — captures actual field names

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | storageState files must be gitignored; use env vars for credentials |
| V3 Session Management | yes | `.auth/user.json` contains live session tokens; file permissions + gitignore |
| V4 Access Control | no | Tests verify AC behavior but don't implement it |
| V5 Input Validation | no | Test code does not validate user input |
| V6 Cryptography | no | No hand-rolled crypto in tests; KC Admin client handles token signing |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `.auth/user.json` committed with live JWT | Information Disclosure | Add `tests/.auth/` to root `.gitignore` (currently missing — Wave 0) |
| `tests/.env.test` committed with client secret | Information Disclosure | Add `tests/.env.test` to root `.gitignore`; only `.env.test.example` committed |
| KC Admin client secret in CI env | Information Disclosure | For Phase 9, not needed — `SKIP_REAL_AUTH=true` in CI; secret stays local-only |
| OTP code intercepted from shared Mailpit inbox | Information Disclosure | Mailpit is local-only (docker-compose); not exposed externally |

---

## Sources

### Primary (HIGH confidence)
- Context7 `/microsoft/playwright` — storageState, addInitScript, test.extend, testMatch, serial mode, CDP WebAuthn
- GitHub `keycloak/keycloak/js/libs/keycloak-admin-client/test/users.spec.ts` — `getCredentials`, `deleteCredential`, `create`, `del`, `auth` API surface
- `npm view @playwright/test version` → 1.60.0 [VERIFIED]
- `npm view @keycloak/keycloak-admin-client version` → 26.6.2 [VERIFIED]
- `npm view mailpit-api version` → 2.0.0 [VERIFIED]

### Secondary (MEDIUM confidence)
- Corbado blog (corbado.com) — CDP `WebAuthn.addVirtualAuthenticator` options verified against multiple sources
- DEV.to kochan article — Mailpit REST API endpoint patterns, OTP parsing pattern
- GitHub issues #31108, #38682 — sessionStorage not captured by storageState; status open as of 2026-05

### Tertiary (LOW confidence)
- Mailpit JSON response shape (`messages[].ID`, message `Text` field) — community sources only; Wave-0 spike required
- KC credential type string `"webauthn-passwordless"` — plausible from KC docs structure; needs dev verification

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry verified for all packages
- Playwright patterns: HIGH — Context7 primary source; official docs structure confirmed
- KC Admin API: HIGH — GitHub source code for exact method names; endpoint patterns from official docs
- Mailpit response shape: MEDIUM — endpoint existence confirmed; field names LOW/ASSUMED
- Architecture: HIGH — derived from locked decisions in CONTEXT.md + verified Playwright patterns

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (stable tooling; Playwright releases frequently but APIs are stable)
