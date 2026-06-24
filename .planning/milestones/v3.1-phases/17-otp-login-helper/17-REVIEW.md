---
phase: 17-otp-login-helper
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - tests/e2e/fixtures/kc-login-helper.ts
  - tests/e2e/fixtures/mailpit-helpers.ts
  - tests/e2e/otp.spec.ts
  - tests/global-setup.ts
  - tests/e2e/session-management.spec.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Five test files reviewed: the extracted `loginViaKcForm` helper, the Mailpit OTP helper, the OTP spec, global setup, and the session-management spec. No security or correctness issues were found. One warning targets a flaky OTP extraction pattern in a reusable helper. Three info items address dead code, a hardcoded KC host, and near-duplicate setup functions.

## Warnings

### WR-01: OTP regex matches first 6-digit run, not the OTP specifically

**File:** `tests/e2e/fixtures/mailpit-helpers.ts:29`
**Issue:** `/(\d{6})/` grabs the first 6-consecutive-digit sequence in the message body. If the email template includes a 6-digit confirmation number, tracking ID, or year (e.g. "202601") before the OTP code, this helper silently returns the wrong value and the test fails non-deterministically. This is a reusable helper — its correctness depends on caller context not encoded in it.
**Fix:** Anchor the regex to the expected label in the email body. For example, if the email template contains "Your code is: 123456":
```typescript
const match = msg.Text.match(/(?:code|OTP)[^\d]*(\d{6})/i);
```
Or capture the last 6-digit group if the OTP always appears at the end:
```typescript
const match = msg.Text.match(/(\d{6})\D*$/);
```
Confirm against the actual email template and encode the anchor in the regex.

## Info

### IN-01: Dead code in `logout clears app sessionStorage tokens` test

**File:** `tests/e2e/session-management.spec.ts:97-115`
**Issue:** `tokensBefore` is computed (evaluate + filter over sessionStorage), the comment says "Verify tokens are stored before logout," but no assertion is made against it. Line 115 silences the unused-variable error with `void tokensBefore`. The post-login authenticated-state check is already covered by `#new-trip-btn` visibility above. This dead block misleads future readers into thinking a pre-logout token count assertion is being made.
**Fix:** Delete lines 97-101 and 115 entirely. The test's actual assertions (login prompt visible, `#new-trip-btn` hidden) are not weakened by this removal.

### IN-02: KC hostname hardcoded in `loginViaKcForm`

**File:** `tests/e2e/fixtures/kc-login-helper.ts:14`
**Issue:** `waitForURL(/localhost:8080/)` is a literal regex. All other KC host references in the test suite read from `process.env.KEYCLOAK_URL`. If the KC port changes (e.g. in CI it runs on 8081), this wait will time out and the error will not mention the real cause.
**Fix:**
```typescript
const kcHost = new URL(process.env.KEYCLOAK_URL ?? 'http://localhost:8080').host;
await page.waitForURL(new RegExp(kcHost), { timeout: 15_000, waitUntil: 'commit' });
```

### IN-03: Near-duplicate login setup functions in `global-setup.ts`

**File:** `tests/global-setup.ts:50-91`
**Issue:** `kcLogin` and `kcLoginNewUser` are identical in structure (launch → new context → loginViaKcForm → reload → storageState → sessionStorage → close). The only difference is which env vars and output paths are used. Likewise `isStorageStateFresh` and `isNewUserStorageStateFresh` duplicate the same two-line freshness check.
**Fix:** Extract a generic helper:
```typescript
async function captureStorageState(
  username: string,
  password: string,
  storagePath: string,
  sessionPath: string,
): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaKcForm(page, username, password);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));
  await context.storageState({ path: storagePath });
  const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
  fs.writeFileSync(sessionPath, JSON.stringify(sessionEntries), 'utf-8');
  await browser.close();
}

function isStateFresh(p: string): boolean {
  if (!fs.existsSync(p)) return false;
  return Date.now() - fs.statSync(p).mtimeMs < MAX_AGE_MS;
}
```

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
