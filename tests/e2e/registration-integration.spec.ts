import { expect, test } from './fixtures/kc-admin';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import crypto from 'node:crypto';

/**
 * Registration, end to end through the BUILT FRONTEND: real Keycloak 26.6.1 (registration-passkey
 * flow), real backend (e-mail verification gate, recovery), real Postgres and Mailpit. Nothing is
 * mocked except where a test says so (the "down" states block requests in the browser).
 *
 * Needs, besides Keycloak + Mailpit (keycloak-flow.sh):
 *   - the backend at E2E_API_URL with REQUIRE_VERIFIED_EMAIL=true, KEYCLOAK_RECOVERY_* and an SMTP
 *     sink pointing at the same Mailpit (scripts/ci/registration-stack.sh);
 *   - the frontend built with VITE_API_URL=<E2E_API_URL>/api and VITE_KEYCLOAK_URL=<KEYCLOAK_URL>
 *     and served by `vite preview` on http://localhost:5173/PruebaMapJapan/ (the registered redirect).
 * Runs when E2E_API_URL answers; fixme otherwise. CI_BACKEND=1 makes every precondition required.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const API_URL = process.env.E2E_API_URL ?? '';
const REQUIRE_BACKEND = process.env.CI_BACKEND === '1';

test.describe.configure({ mode: 'serial' });

const emailOf = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;

async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

async function withoutWebAuthn(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  });
}

/** Newest 6-digit code mailed to `email` whose subject matches (polls Mailpit; no sleeps). */
async function mailedCode(page: Page, email: string, subject: RegExp): Promise<string> {
  let code = '';
  await expect
    .poll(async () => {
      const res = await page.request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      const list = (await res.json()) as { messages?: Array<{ ID: string; Subject: string }> };
      const hit = list.messages?.find((m) => subject.test(m.Subject));
      if (!hit) return '';
      const msg = (await (await page.request.get(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json()) as { Text: string };
      code = msg.Text.match(/code is: (\d{6})/)?.[1] ?? '';
      return code;
    }, { message: `a code mailed to ${email}`, timeout: 20_000 })
    .toMatch(/^\d{6}$/);
  return code;
}

/** Landing → Sign up → registration form → passkey enrolment → back in the app. */
async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('');
  await page.locator('travel-nav').getByRole('button', { name: 'Sign up' }).click();
  await expect(page.locator('#kc-register-form')).toBeVisible();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('#kc-register-form [type="submit"]').click();
  await page.locator('#registerWebAuthn').click();
  await page.waitForURL(/\/PruebaMapJapan\/dashboard\.html/);
}

const verifyScreen = (page: Page) => ({
  heading: page.getByRole('heading', { name: 'Verify your email' }),
  digits: page.locator('.code-input-digit'),
  error: page.locator('#verify-email-error'),
  resend: page.locator('#verify-email-resend'),
});

test.describe('Registration through the built frontend (real Keycloak, backend, Postgres, Mailpit)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request, browserName }) => {
    test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
    const health = API_URL ? await request.get(`${API_URL}/api/health`, { timeout: 5000 }).catch(() => null) : null;
    const app = await request.get('http://localhost:5173/PruebaMapJapan/dashboard.html', { timeout: 5000 }).catch(() => null);
    const up = !!health?.ok() && !!app?.ok();
    test.fixme(!up && !REQUIRE_BACKEND, 'needs the backend (E2E_API_URL) and the built frontend on :5173 (scripts/ci/registration-stack.sh)');
    expect(health?.ok(), `backend at ${API_URL || '(E2E_API_URL unset)'}`).toBe(true);
    expect(app?.ok(), 'frontend preview on http://localhost:5173/PruebaMapJapan/').toBe(true);
    expect(await app!.text(), 'frontend must be built with the Keycloak URL (Sign up is hidden otherwise)').toContain('data-signup');
  });

  test('sign up with a passkey → first sign-in → verify screen → code from the mailbox → app unlocked', async ({ page, kcAdmin }) => {
    const email = emailOf('ui-signup');
    const cdp = await virtualAuthenticator(page);
    const statuses: Array<{ path: string; status: number }> = [];
    page.on('response', (r) => {
      if (r.url().startsWith(`${API_URL}/`)) statuses.push({ path: new URL(r.url()).pathname, status: r.status() });
    });
    try {
      await signUp(page, email);
      const v = verifyScreen(page);
      await expect(v.heading).toBeVisible();
      await expect(page.locator('#verify-email-body')).toContainText(email);
      await expect(v.digits).toHaveCount(6);
      // The screen asked for the code on its own; the resend button is on cooldown.
      await expect(v.resend).toBeDisabled();
      // The cooldown starts on click; the response lands a moment later, so poll for it.
      await expect
        .poll(() => statuses.filter((s) => s.path === '/api/auth/email-verify/request'))
        .toEqual([{ path: '/api/auth/email-verify/request', status: 201 }]);
      expect(await kcAdmin.credentialTypes(email)).toEqual(['webauthn-passwordless']);

      const code = await mailedCode(page, email, /confirm/i);
      await page.keyboard.type(code);
      await expect(v.heading).toBeHidden();
      await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
      expect(statuses.some((s) => s.path === '/api/auth/email-verify/confirm' && s.status === 200)).toBe(true);
      await expect.poll(() => statuses.some((s) => s.path === '/api/trips' && s.status === 200)).toBe(true);
      // The account already has the passkey it was created with: nothing to offer.
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      await cdp.detach().catch(() => {});
      await kcAdmin.deleteUser(email);
    }
  });

  test('unverified: API answers 403 email_not_verified and a reload shows the verify screen again (no second mail)', async ({ page, kcAdmin }) => {
    const email = emailOf('ui-unverified');
    const cdp = await virtualAuthenticator(page);
    try {
      // Count code requests from the very start, so the screen's own first request (sent a
      // moment after the heading shows) cannot be mistaken for one made by the reload.
      const requests: string[] = [];
      page.on('request', (r) => { if (r.url().includes('/email-verify/request')) requests.push(r.url()); });
      await signUp(page, email);
      const v = verifyScreen(page);
      await expect(v.heading).toBeVisible();
      await expect.poll(() => requests.length, 'the screen asks for the first code on its own').toBe(1);
      await expect(v.resend).toBeDisabled();

      await page.reload();
      await expect(v.heading).toBeVisible();
      // Reload within the cooldown: the screen does not request another code.
      await expect(v.resend).toBeDisabled();
      await page.waitForLoadState('networkidle');
      expect(requests, 'no second code requested while the first is pending').toHaveLength(1);
      const mails = await page.request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      expect(((await mails.json()) as { messages_count: number }).messages_count).toBe(1);
    } finally {
      await cdp.detach().catch(() => {});
      await kcAdmin.deleteUser(email);
    }
  });

  test('wrong codes, then the code is burned (429 max_attempts → "request a new code")', async ({ page, kcAdmin }) => {
    const email = emailOf('ui-wrong');
    const cdp = await virtualAuthenticator(page);
    try {
      await signUp(page, email);
      const v = verifyScreen(page);
      await expect(v.heading).toBeVisible();
      const real = await mailedCode(page, email, /confirm/i);
      const wrong = real === '000000' ? '111111' : '000000';

      // Each guess is awaited on the server's answer: the error text is identical, so it cannot
      // be the synchronisation point.
      const guess = async (code: string): Promise<number> => {
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/email-verify/confirm')),
          page.keyboard.type(code),
        ]);
        return res.status();
      };
      for (let i = 0; i < 5; i++) {
        expect(await guess(wrong)).toBe(400);
        await expect(v.error).toHaveText("That code isn't right. Check it and try again.");
        await expect(v.digits.first()).toBeFocused();
      }
      // 5 wrong guesses spent: even the right code is dead now.
      expect(await guess(real)).toBe(429);
      await expect(v.error).toHaveText('Too many attempts. Request a new code.');
      await expect(v.heading).toBeVisible();
    } finally {
      await cdp.detach().catch(() => {});
      await kcAdmin.deleteUser(email);
    }
  });

  test('passkey-only user without WebAuthn: theme link → recover.html → mailed code → new password → signs in, no passkey-enrolment loop', async ({ browser, kcAdmin }) => {
    const email = emailOf('ui-recover');
    const newPassword = `Recovered-${crypto.randomBytes(6).toString('hex')}`;
    const phone = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const old = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await withoutWebAuthn(old);
    try {
      // Phone: sign up, verify the address (so the passkey is theirs and survives recovery).
      const p = await phone.newPage();
      await virtualAuthenticator(p);
      await signUp(p, email);
      await expect(verifyScreen(p).heading).toBeVisible();
      await p.keyboard.type(await mailedCode(p, email, /confirm/i));
      await expect(p.locator('#dashboard-greeting')).toContainText('Hello');

      // Old browser: Keycloak's passkey step offers the recovery page.
      const page = await old.newPage();
      await page.goto('');
      await page.locator('travel-nav').getByRole('button', { name: 'Sign in' }).click();
      await page.locator('input[name="username"]').fill(email);
      await page.locator('#kc-login, [type="submit"]').first().click();
      const link = page.locator('#jp-passkey-recovery a, a#jp-passkey-recovery').first();
      await expect(link).toBeVisible();
      await link.click();
      await page.waitForURL(/\/PruebaMapJapan\/recover\.html/);
      await expect(page.getByLabel('Email address')).toHaveValue(email);

      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.locator('#recover-sent')).toContainText(email);
      await page.keyboard.type(await mailedCode(page, email, /recovery/i));
      await page.getByLabel('New password', { exact: true }).fill(newPassword);
      await page.getByLabel('Confirm new password').fill(newPassword);
      await page.getByRole('button', { name: 'Set new password' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your password is set');
      expect((await kcAdmin.credentialTypes(email)).sort()).toEqual(['password', 'webauthn-passwordless']);

      // Sign in with the new password; the pending passkey enrolment must be gone.
      const visited: string[] = [];
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) visited.push(f.url()); });
      await page.getByRole('button', { name: 'Sign in' }).last().click();
      await page.locator('input[name="username"]').fill(email);
      await page.locator('#kc-login, [type="submit"]').first().click();
      await page.locator('#try-another-way').click();
      await page.locator('#kc-select-credential-form button:not(:has-text("Passkey"))').click();
      await page.locator('input[name="password"]').fill(newPassword);
      await page.locator('#kc-login, [type="submit"]').first().click();
      await page.waitForURL(/\/PruebaMapJapan\/dashboard\.html/);
      await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
      expect(visited.filter((u) => /required-action|webauthn-register/i.test(u))).toEqual([]);
      await expect(page.getByRole('heading', { name: 'Verify your email' })).toHaveCount(0);
    } finally {
      await phone.close();
      await old.close();
      await kcAdmin.deleteUser(email);
    }
  });

  test('recover.html: an unknown address gets the same screen and no mail; a wrong code is one generic message', async ({ page }) => {
    const ghost = emailOf('ui-nobody');
    await page.goto('recover.html');
    await page.getByLabel('Email address').fill(ghost);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.locator('#recover-sent')).toContainText(ghost);
    await page.keyboard.type('123456');
    await page.getByLabel('New password', { exact: true }).fill('a-long-enough-password-1');
    await page.getByLabel('Confirm new password').fill('a-long-enough-password-1');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.locator('#recover-error')).toHaveText("That code isn't valid or has expired. Check it, or request a new one.");
    const mails = await page.request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${ghost}"`)}`);
    expect(((await mails.json()) as { messages_count: number }).messages_count).toBe(0);
  });

  test('down states: backend unreachable and Keycloak unreachable show a clear screen, not a blank page', async ({ page, kcAdmin }) => {
    const email = emailOf('ui-down');
    const cdp = await virtualAuthenticator(page);
    try {
      await signUp(page, email);
      await expect(verifyScreen(page).heading).toBeVisible();
      await mailedCode(page, email, /confirm/i);
      const v = verifyScreen(page);

      // Backend down while confirming: a network message, the screen stays usable.
      await page.route(`${API_URL}/**`, (route) => route.abort('connectionrefused'));
      await page.keyboard.type('123456');
      await expect(v.error).toHaveText("Couldn't reach the server. Check your connection and try again.");
      await page.unroute(`${API_URL}/**`);

      // Keycloak down on a fresh load: the existing "can't reach sign-in" state with Retry.
      await page.route(`${KEYCLOAK_URL}/**`, (route) => route.abort('connectionrefused'));
      await page.context().clearCookies();
      await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* ignore */ } });
      await page.goto('dashboard.html');
      await expect(page.getByRole('button', { name: /retry|try again/i })).toBeVisible();
    } finally {
      await cdp.detach().catch(() => {});
      await kcAdmin.deleteUser(email);
    }
  });

  // Exhausts the backend's in-memory per-IP limiter (10 recovery requests per hour), which every
  // other recovery test in the run shares: keep it last and opt in (it needs a backend restart to undo).
  test('rate limit: the 11th recovery request in an hour answers 429 and recover.html shows a countdown', async ({ page, request }) => {
    test.fixme(process.env.E2E_RATE_LIMIT !== '1', 'opt-in (E2E_RATE_LIMIT=1): it burns the per-IP recovery limit of the running backend');
    let limited = 0;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await request.post(`${API_URL}/api/auth/recovery/request`, { data: { email: emailOf('ui-flood') } });
      if (res.status() === 429) {
        limited = Number(res.headers()['retry-after']);
        expect(((await res.json()) as { retryAfter: number }).retryAfter).toBe(limited);
      } else {
        expect(res.status()).toBe(202);
      }
    }
    expect(limited, 'a 429 with Retry-After before the 12th request').toBeGreaterThan(0);
    await page.goto('recover.html');
    await page.getByLabel('Email address').fill(emailOf('ui-limited'));
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.locator('#recover-send')).toBeDisabled();
    await expect(page.locator('#recover-send')).toHaveText(/Send code in \d+s/);
    await expect(page.locator('#recover-email-error')).toContainText('Too many requests');
  });
});
