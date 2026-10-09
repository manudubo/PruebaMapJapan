import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createUser, deleteUser, getUserCredentialLabels } from './fixtures/kc-admin';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const CODE_VERIFIER = 'phase16-playwright-idp-theme-test-verifier-value-48c';
const CODE_CHALLENGE = crypto
  .createHash('sha256')
  .update(CODE_VERIFIER)
  .digest('base64url');

const AUTH_BASE =
  `${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/auth` +
  '?client_id=japan-trip-frontend' +
  '&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2FPruebaMapJapan%2Fdashboard.html' +
  '&response_type=code' +
  '&scope=openid' +
  '&ui_locales=en' +
  `&code_challenge=${CODE_CHALLENGE}` +
  '&code_challenge_method=S256';
const LOGIN_URL = AUTH_BASE;
const REGISTER_URL = AUTH_BASE.replace('/auth?', '/registrations?');

test.describe('Keycloak theme', () => {
  // Override project-level storageState — chromium project inherits '.auth/user.json'
  // which contains a KC SSO session cookie. KC skips the login page for authenticated
  // users. Empty storageState forces KC to always render the login page.
  // This is a no-op on firefox and webkit (they have no project storageState).
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request }) => {
    const response = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, {
      timeout: 5000,
    }).catch(() => null);

    test.fixme(!response?.ok(), 'requires Keycloak on :8080 (not started in CI); run locally per SETUP.md');
  });

  test('login screen: brand, one card, e-mail field ready for passkeys, way back to the app', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.waitForLoadState('domcontentloaded');

    // Keycloak's own header is gone; the brand above the card replaces it.
    await expect(page.locator('#kc-header-wrapper')).toHaveText('Japan Trip');
    await expect(page.locator('main.jp-card')).toHaveCount(1);
    await expect(page.locator('.jp-card .jp-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');

    const username = page.locator('#username');
    await expect(username).toHaveAttribute('autocomplete', /^username( webauthn)?$/);
    await expect(page.getByRole('button', { name: /^sign in$/i })).toHaveCount(1); // "Sign in with a passkey" is a second, secondary button
    expect((await page.locator('#kc-login').boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const exitAction = page.locator('.jp-idp-exit');
    await expect(exitAction).toBeVisible();
    await expect(exitAction).toContainText('Back to');
    // the client's Base URL, never a theme default (production once linked to localhost)
    await expect(exitAction).toHaveAttribute('href', /\/PruebaMapJapan\/?$/);
    await expect(exitAction).not.toHaveAttribute('href', /protocol\/openid-connect\/logout/);

    const styles = await exitAction.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        borderRadius: computed.borderRadius,
        fontFamily: computed.fontFamily,
      };
    });

    expect(styles.borderRadius).toBe('0px');
    expect(styles.fontFamily).toContain('Inter');
  });

  test('dark colour scheme follows prefers-color-scheme with the app palette', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await page.goto(LOGIN_URL);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('main.jp-card')!).backgroundColor)).toBe('rgb(28, 28, 30)');
    } finally {
      await context.close();
    }
  });

  test('phone width: no horizontal scroll, 16px gutters', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 740 }, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      for (const url of [LOGIN_URL, REGISTER_URL]) {
        await page.goto(url);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
        expect((await page.locator('main.jp-card').boundingBox())!.x).toBeGreaterThanOrEqual(16);
      }
    } finally {
      await context.close();
    }
  });

  test('Keycloak error pages speak plain language, with one action and the raw message folded away', async ({ page }) => {
    await page.goto(LOGIN_URL.replace('redirect_uri=http', 'redirect_uri=https%3A%2F%2Fevil.example%2F&x=http'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("We couldn't start the sign-in");
    await expect(page.locator('#kc-error-message')).toBeVisible();
    await expect(page.locator('.jp-alert')).toHaveCount(0);
    await expect(page.locator('#jp-error-action')).toHaveAttribute('href', /\/PruebaMapJapan\/?$/); // the client's Base URL
    await expect(page.locator('#jp-error-original')).toBeHidden(); // inside a closed <details>
    expect(await page.locator('main').innerText()).not.toContain('Invalid parameter');
  });

  test('a lost sign-in session says the link has expired and sends the person back to the app (restarting would loop)', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.context().clearCookies();
    await page.locator('#username').fill('traveler@example.test');
    await page.locator('#kc-login').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link has expired');
    await expect(page.locator('#jp-error-action')).toHaveText('Back to Japan Trip');
    await expect(page.locator('#jp-error-action')).toHaveAttribute('href', /\/PruebaMapJapan\/?$/);
    await expect(page.locator('.jp-idp-exit')).toHaveCount(0);
  });

  test('sign-up switched off: "Sign-up is closed right now"', async ({ page, request }) => {
    const pw = process.env['KC_ADMIN_PASSWORD'] ?? (process.env['KC_MASTER_ADMIN_PASSWORD_FILE'] ? fs.readFileSync(process.env['KC_MASTER_ADMIN_PASSWORD_FILE'], 'utf8').trim() : '');
    test.fixme(!pw, 'needs the master admin password (KC_ADMIN_PASSWORD or KC_MASTER_ADMIN_PASSWORD_FILE) to switch registration off and on');
    const token = ((await (await request.post(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, { form: { client_id: 'admin-cli', grant_type: 'password', username: 'admin', password: pw } })).json()) as { access_token: string }).access_token;
    const headers = { authorization: `Bearer ${token}` };
    const realmUrl = `${KEYCLOAK_URL}/admin/realms/japan-trip`;
    const realm = (await (await request.get(realmUrl, { headers })).json()) as { registrationAllowed: boolean };
    try {
      await request.put(realmUrl, { headers, data: { registrationAllowed: false } });
      await page.goto(REGISTER_URL);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign-up is closed right now');
      await expect(page.locator('#jp-error-action')).toHaveText('Sign in');
    } finally {
      await request.put(realmUrl, { headers, data: { registrationAllowed: realm.registrationAllowed } });
    }
  });

  test.describe('passkey enrolment names the passkey after the device', () => {
    const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;

    test('no label question; the stored label is "<browser> on <system> (YYYY-MM-DD)"', async ({ page }) => {
      test.fixme(!HAS_ADMIN, 'needs the worker client (KC_ADMIN_CLIENT_ID / KC_ADMIN_CLIENT_SECRET) to read credentials');
      const email = `theme-label-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;
      const password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
      await createUser(email, password);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.enable', { enableUI: false });
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      });
      const prompts: string[] = [];
      page.on('dialog', (d) => {
        prompts.push(d.message());
        void d.dismiss();
      });
      try {
        await page.goto(`${LOGIN_URL}&kc_action=webauthn-register-passwordless`);
        await page.locator('#username').fill(email);
        await page.locator('#kc-login').click();
        await page.locator('input[name="password"]').fill(password);
        await page.locator('#kc-login').click();
        await expect(page.locator('#registerWebAuthn')).toBeVisible();
        await expect(page.locator('main input[type="text"]')).toHaveCount(0);
        const leftKeycloak = page.waitForEvent('framenavigated', {
          predicate: (frame) => frame === page.mainFrame() && !frame.url().startsWith(KEYCLOAK_URL),
        });
        await page.locator('#registerWebAuthn').click();
        await leftKeycloak;
        expect(prompts, 'the user is never asked for a label').toEqual([]);
        const labels = await getUserCredentialLabels(email, 'webauthn-passwordless');
        expect(labels).toHaveLength(1);
        expect(labels[0]).toMatch(/^[A-Za-z][A-Za-z ]+ on [A-Za-z]+ \(\d{4}-\d{2}-\d{2}\)$/);
        expect(labels[0]).not.toMatch(/Default Label/i);
      } finally {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
        await deleteUser(email);
      }
    });
  });
});
