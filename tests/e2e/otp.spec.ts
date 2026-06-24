import { test, expect } from './fixtures/kc-admin';
import { purgeInbox, fetchLatestOtp } from './fixtures/mailpit-helpers';
import { loginViaKcForm } from './fixtures/kc-login-helper';
import type { Page } from '@playwright/test';

// Serial mode — mandatory; Mailpit inbox is shared, parallel runs cause interference (D-12)
test.describe.configure({ mode: 'serial' });

const OTP_USERNAME = process.env.E2E_OTP_USERNAME ?? 'otp-test@local';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8787';
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

async function getToken(page: Page): Promise<string> {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`),
  ]);
  return req.headers()['authorization'].slice('Bearer '.length);
}

test.describe('OTP fallback flow', () => {
  // Override project-level storageState — otp-test@local has no pre-built storageState
  test.use({ storageState: { cookies: [], origins: [] } });

  // Guard — skip all tests in this describe when KC is not available (D-03)
  test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');

  let otpToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginViaKcForm(page, OTP_USERNAME, process.env.E2E_OTP_PASSWORD ?? '');
    otpToken = await getToken(page);
    await context.close();
  });

  test.beforeEach(async ({ kcAdmin }) => {
    await kcAdmin.clearOtpCodes(OTP_USERNAME);
    await purgeInbox();
  });

  test('request OTP then verify code — happy path', async ({ request }) => {
    const requestRes = await request.post(`${BACKEND_URL}/api/auth/otp-request`, {
      headers: { Authorization: `Bearer ${otpToken}` },
    });
    expect(requestRes.status()).toBe(201);

    const otp = await fetchLatestOtp();
    expect(otp).toMatch(/^\d{6}$/);

    const verifyRes = await request.post(`${BACKEND_URL}/api/auth/otp-verify`, {
      headers: { Authorization: `Bearer ${otpToken}` },
      data: { code: otp },
    });
    expect(verifyRes.status()).toBe(200);
  });

  test('expired OTP is rejected', async ({ request, kcAdmin }) => {
    const requestRes = await request.post(`${BACKEND_URL}/api/auth/otp-request`, {
      headers: { Authorization: `Bearer ${otpToken}` },
    });
    expect(requestRes.status()).toBe(201);

    // Fetch the real OTP before expiring it — tests the real expiry-check code path
    const otp = await fetchLatestOtp();
    expect(otp).toMatch(/^\d{6}$/);

    await kcAdmin.expireOtpCodes(OTP_USERNAME);

    const verifyRes = await request.post(`${BACKEND_URL}/api/auth/otp-verify`, {
      headers: { Authorization: `Bearer ${otpToken}` },
      data: { code: otp },
    });
    expect([400, 401]).toContain(verifyRes.status());
    const body = await verifyRes.json() as { error?: string; message?: string };
    const errText = JSON.stringify(body).toLowerCase();
    expect(errText).toMatch(/otp_not_found/);
  });

  test('max-attempts lockout after 5 failed verifications', async ({ request }) => {
    await request.post(`${BACKEND_URL}/api/auth/otp-request`, {
      headers: { Authorization: `Bearer ${otpToken}` },
    });

    for (let i = 0; i < 5; i++) {
      const res = await request.post(`${BACKEND_URL}/api/auth/otp-verify`, {
        headers: { Authorization: `Bearer ${otpToken}` },
        data: { code: `00000${i}` },
      });
      expect([400, 429]).toContain(res.status());
    }

    // 6th attempt with the correct code — must be rejected (max attempts exceeded)
    const otp = await fetchLatestOtp();
    const lockedRes = await request.post(`${BACKEND_URL}/api/auth/otp-verify`, {
      headers: { Authorization: `Bearer ${otpToken}` },
      data: { code: otp },
    });
    expect([400, 429]).toContain(lockedRes.status());
  });

  test('UPDATE_PASSWORD gate — skipped on WebAuthn-capable devices', async ({ page }) => {
    // PASS-07: UPDATE_PASSWORD is NOT forced when WebAuthn is available.
    // Headless Chrome supports WebAuthn, so it must NOT be forced after OTP login.
    await loginViaKcForm(page, OTP_USERNAME, process.env.E2E_OTP_PASSWORD ?? '');
    await page.waitForURL(/dashboard\.html/, { timeout: 15_000 });
    await page.waitForTimeout(1000);

    expect(page.url()).toContain('dashboard.html');

    const updatePasswordForm = page.locator('#kc-passwd-update-form, [name="update_password"]');
    await expect(updatePasswordForm).not.toBeVisible({ timeout: 3000 });
  });
});
