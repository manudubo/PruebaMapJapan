# Phase 17: OTP + Login Helper — Research

**Researched:** 2026-06-22
**Domain:** Playwright E2E test stabilization — OTP auth contract alignment, shared KC login helper extraction
**Confidence:** HIGH (pure codebase verification; all findings from direct file reads)

---

## Summary

Phase 17 is a pure test-stabilization refactor with no product code changes. Two tracks: (1) align `otp.spec.ts` with the real auth-gated backend contract, and (2) extract a shared `loginViaKcForm` helper from four copy-pasted KC form-navigation implementations.

All canonical patterns already exist in the codebase. Two discrepancies exist between the spec and the route contract that D-01..D-10 do not fully address — both verified from direct file reads. They must appear in the plan as explicit fix tasks.

**Primary recommendation:** Create `kc-login-helper.ts` verbatim from the `kcLogin` body in `global-setup.ts`; fix the user identity mismatch (acquire JWT for otp-test@local, not e2e-test@local); fix the 201 vs 200 status assertion; then wire all 4 call sites.

---

## Critical Findings

### Finding 1: otp-request returns 201, not 200

**Source:** `backend/src/routes/auth.ts:131`

`return c.json(response, 201);`

Current `otp.spec.ts:27` asserts `expect(requestRes.status()).toBe(200)` — WRONG. Must become `.toBe(201)`. The otp-verify success path returns 200 (`auth.ts:175`) and stays correct.

### Finding 2: User identity mismatch — E2E_OTP_USERNAME != E2E_TEST_USERNAME

**Source:** `tests/.env.test`

```
E2E_TEST_USERNAME=e2e-test@local    # user whose storageState is in .auth/user.json
E2E_OTP_USERNAME=otp-test@local     # separate OTP test account
```

D-02 says load `.auth/user.json` to get a JWT, but that belongs to `e2e-test@local`. The `clearOtpCodes`/`expireOtpCodes` target `otp-test@local` and the backend stores OTPs under the JWT user's DB row.

**Required resolution:** Tests 1-3 must acquire a JWT for `otp-test@local`. In `test.beforeAll`, create a fresh browser context, call `loginViaKcForm(page, OTP_USERNAME, process.env.E2E_OTP_PASSWORD ?? '')`, then `getToken(page)`.

---

## Architecture Patterns

### Pattern 1: KC Form Navigation (verbatim from global-setup.ts:49-105)

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
}
```

### Pattern 2: JWT Extraction (from public-sharing.spec.ts:27-36)

```typescript
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

### Pattern 3: Mailpit Polling Loop

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

## Common Pitfalls

### Pitfall 1: User identity split (highest-risk)
`beforeEach` clears `otp-test@local` codes; if JWT is for `e2e-test@local` the backend creates OTPs for the wrong user. **Fix:** `loginViaKcForm(page, OTP_USERNAME, E2E_OTP_PASSWORD)` in `beforeAll`.

### Pitfall 2: otp-request asserts 200 but backend returns 201
After adding Bearer header the 401 is fixed, but `toBe(200)` still fails. **Fix:** Change to `.toBe(201)`.

### Pitfall 3: Post-login state must not move into loginViaKcForm
reload + storageState + sessionStorage write in `global-setup.ts:92-102` stays in callers. Helper ends at `waitForURL(/localhost:5173/)`.

### Pitfall 4: otp.spec.ts kcAdmin fixture chain must not break
Keep `import { test, expect } from './fixtures/kc-admin'`. Add `import { loginViaKcForm } from './fixtures/kc-login-helper'` separately.

### Anti-patterns to avoid
- `getByRole('link', { name: /try another way/i })` — misses aria-hidden KC links; use `locator('a, button').filter(...)`.
- Single-shot `fetchLatestOtp()` — replace entirely with polling loop.
- `data: { email: OTP_USERNAME }` in request body — backend ignores it; remove per D-03.

---

## Validation Architecture

| Req ID | Per-task check | Wave/phase gate |
|--------|---------------|-----------------|
| OTP-01 | `npm run typecheck` | `cd tests && npx playwright test e2e/otp.spec.ts --project=chromium` |
| OTP-02 | `npm run typecheck` | same |
| OTP-03 | `npm run typecheck` | same |
| SESSION-02 | `npm run typecheck` | full suite |

**Wave 0 dependency:** `tests/e2e/fixtures/kc-login-helper.ts` must exist before any call site is wired.

---

## Sources

- `backend/src/routes/auth.ts:92,131,175` — auth middleware gating; 201/200 return codes
- `tests/global-setup.ts:49-158` — canonical `kcLogin`/`kcLoginNewUser` template
- `tests/e2e/otp.spec.ts:1-99` — current spec with incorrect assertions
- `tests/e2e/fixtures/mailpit-helpers.ts` — single-shot `fetchLatestOtp()` to replace
- `tests/e2e/session-management.spec.ts:44-95` — `loginViaBrowser()` third implementation
- `tests/e2e/public-sharing.spec.ts:27-36` — `getToken()` pattern
- `tests/.env.test` — confirms E2E_OTP_USERNAME != E2E_TEST_USERNAME

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|-------|---------------|
| A1 | `otp-test@local` KC password = `Otp-Test-Password-1!` in live realm | LOW — `loginViaKcForm` fails if wrong |

**Research date:** 2026-06-22
