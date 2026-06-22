# Phase 17: OTP + Login Helper — Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 5
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tests/e2e/fixtures/kc-login-helper.ts` | utility/fixture | request-response | `tests/global-setup.ts` kcLogin body (lines 49-104) | exact |
| `tests/e2e/fixtures/mailpit-helpers.ts` | utility/fixture | polling / I/O | `tests/global-setup.ts` waitForServer loop (lines 20-35) | role-match |
| `tests/e2e/otp.spec.ts` | test | request-response | `tests/e2e/public-sharing.spec.ts` getToken + bearer pattern | exact |
| `tests/global-setup.ts` | config/setup | request-response | self — kcLogin/kcLoginNewUser delegate to new helper | self-refactor |
| `tests/e2e/session-management.spec.ts` | test | request-response | `tests/global-setup.ts` kcLogin (lines 49-104) | role-match |

---

## Pattern Assignments

### `tests/e2e/fixtures/kc-login-helper.ts` (CREATE)

**Analog:** `tests/global-setup.ts` kcLogin, lines 49-104

**File structure (modeled on kc-admin.ts):**
```typescript
import { Page } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

export async function loginViaKcForm(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`);

  const loginPromptBtn = page.locator('#auth-login-prompt-btn');
  if (await loginPromptBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await loginPromptBtn.click();
  }

  await page.waitForURL(/localhost:8080/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));

  const tryAnotherWay = page.locator('a, button').filter({ hasText: /try another way/i });
  if (await tryAnotherWay.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
    await tryAnotherWay.first().click();
    await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));
    const passwordOpt = page.locator('a, button').filter({ hasText: /username and password|^password$/i });
    if (await passwordOpt.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await passwordOpt.first().click();
      await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));
    }
  }

  const usernameField = page.locator('#username, input[name="username"], input[autocomplete="username"]');
  await usernameField.first().waitFor({ state: 'visible', timeout: 10_000 });
  await usernameField.first().fill(username);

  const passwordField = page.locator('input[name="password"], #password');
  if (!(await passwordField.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await page.getByRole('button', { name: /sign in/i }).click();
    await passwordField.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await passwordField.fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.waitForURL(/localhost:5173/, { timeout: 20_000 });
  // BOUNDARY: helper ends here. Post-login steps belong to callers.
}
```

**Anti-pattern (from session-management.spec.ts:56):**
```typescript
// WRONG: getByRole misses aria-hidden KC links
const tryAnotherWay = page.getByRole('link', { name: /try another way/i });
```

---

### `tests/e2e/fixtures/mailpit-helpers.ts` (MODIFY)

**Analog:** `tests/global-setup.ts` waitForServer loop (lines 20-35)

**Unchanged** (keep mailpit-helpers.ts lines 1-17):
```typescript
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
interface MailpitMessage { ID: string; }
interface MailpitListResponse { messages: MailpitMessage[]; }
interface MailpitMessageBody { Text: string; }
export async function purgeInbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}
```

**Replace `fetchLatestOtp` entirely:**
```typescript
export async function fetchLatestOtp(): Promise<string> {
  const MAX_ATTEMPTS = 20;
  const DELAY_MS = 500;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const data = await res.json() as MailpitListResponse;
    if (data.messages?.length) {
      const msgId = data.messages[0].ID;
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msgId}`);
      const msg = await msgRes.json() as MailpitMessageBody;
      const match = msg.Text.match(/(\d{6})/);
      if (match) return match[1];
    }
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
  throw new Error(`fetchLatestOtp: no OTP found after ${MAX_ATTEMPTS} attempts (${MAX_ATTEMPTS * DELAY_MS}ms)`);
}
```

---

### `tests/e2e/otp.spec.ts` (MODIFY)

**Analog:** `tests/e2e/public-sharing.spec.ts` lines 27-36 (getToken) and lines 41-52 (beforeAll)

**CRITICAL — User identity:** `.auth/user.json` belongs to `e2e-test@local`. Must log in as `otp-test@local`.

**Import block (add):**
```typescript
import { loginViaKcForm } from './fixtures/kc-login-helper';
import type { Page } from '@playwright/test';
```

**Correct `beforeAll`:**
```typescript
let otpToken: string;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaKcForm(page, OTP_USERNAME, process.env.E2E_OTP_PASSWORD ?? '');
  otpToken = await getToken(page);
  await context.close();
});

async function getToken(page: Page): Promise<string> {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  return req.headers()['authorization'].slice('Bearer '.length);
}
```

**Auth-gated request pattern (tests 1-3):**
```typescript
const requestRes = await request.post(`${BACKEND_URL}/api/auth/otp-request`, {
  headers: { Authorization: `Bearer ${otpToken}` },
  // No data.email — backend derives from JWT (auth.ts:102)
});
expect(requestRes.status()).toBe(201);  // backend returns 201 (auth.ts:131), not 200
```

**otp-verify stays 200 (auth.ts:175):**
```typescript
expect(verifyRes.status()).toBe(200);
```

**Test 4 replacement:**
```typescript
// Replace inline KC navigation with:
await loginViaKcForm(page, OTP_USERNAME, process.env.E2E_OTP_PASSWORD ?? '');
expect(page.url()).toContain('dashboard.html');
```

---

### `tests/global-setup.ts` (MODIFY — self-refactor)

**Import to add:**
```typescript
import { loginViaKcForm } from './e2e/fixtures/kc-login-helper';
```

**`kcLogin` (lines 49-104):** Keep lines 50-53 (mkdirSync, launch, newContext, newPage) and lines 92-104 (reload, storageState, sessionStorage, close). Replace lines 55-90 with:
```typescript
await loginViaKcForm(page, process.env.E2E_TEST_USERNAME!, process.env.E2E_TEST_PASSWORD!);
```

**`kcLoginNewUser` (lines 107-157):** Keep lines 108-112 (mkdirSync, launch, newContext, newPage) and lines 148-157 (reload, storageState, sessionEntries, close). Replace lines 113-146 with:
```typescript
await loginViaKcForm(page, process.env.E2E_NEW_USER_USERNAME!, process.env.E2E_NEW_USER_PASSWORD!);
```

---

### `tests/e2e/session-management.spec.ts` (MODIFY)

**Import to add:**
```typescript
import { loginViaKcForm } from './fixtures/kc-login-helper';
```

**Delete** `loginViaBrowser` function (lines 44-83).

**Replace all call sites:**
```typescript
// BEFORE:
await loginViaBrowser(page, TEST_USER, TEST_PASS);
// AFTER:
await loginViaKcForm(page, TEST_USER, TEST_PASS);
```

**Post-login assertion stays in caller (line 82):**
```typescript
await expect(page.locator('#new-trip-btn')).toBeVisible({ timeout: 20_000 });
```

---

## Wave Ordering Constraint

**Wave 0 (must complete first):** `tests/e2e/fixtures/kc-login-helper.ts`
All 4 call sites import from this file; must exist and typecheck before any call site is wired.

**Wave 1 (parallel, after Wave 0):**
- `tests/e2e/fixtures/mailpit-helpers.ts` — independent
- `tests/global-setup.ts` — imports loginViaKcForm
- `tests/e2e/session-management.spec.ts` — imports loginViaKcForm
- `tests/e2e/otp.spec.ts` — imports loginViaKcForm (also uses mailpit-helpers)

---

## Metadata

**Status codes verified:** otp-request returns 201 (auth.ts:131), otp-verify returns 200 (auth.ts:175)
**User identity verified:** E2E_OTP_USERNAME=otp-test@local != E2E_TEST_USERNAME=e2e-test@local (tests/.env.test)
**Pattern extraction date:** 2026-06-22
