import { expect, test } from './fixtures/kc-admin';
import type { Page } from '@playwright/test';
import crypto from 'node:crypto';

/**
 * KC-01 / SEC-12 — browser-passkey authentication flow contract.
 *
 * Drives Keycloak directly (no frontend/backend needed): the app redirect URI is
 * stubbed with page.route, so the only thing under test is the realm's browser flow
 * as defined in terraform/keycloak/flows.tf.
 *
 * The negative tests guard the regression found in Phase 26: with REQUIRED
 * auth-username-form next to an ALTERNATIVE webauthn execution, Keycloak ignored the
 * webauthn step and issued an authorization code after the username form alone.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REDIRECT_URI = 'http://localhost:5173/PruebaMapJapan/dashboard.html';
const CODE_VERIFIER = 'phase26-idp-flow-negative-test-verifier-value-0000000';
const CODE_CHALLENGE = crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url');
const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;

function authUrl(extra = ''): string {
  return (
    `${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/auth` +
    '?client_id=japan-trip-frontend' +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    '&response_type=code&scope=openid&ui_locales=en' +
    `&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256` +
    extra
  );
}

/**
 * Record every request Keycloak sends to the app redirect URI. An entry with a `code`
 * query param means Keycloak considered the user authenticated. Uses the `request`
 * event (not page.route, which does not see the target of a 302) so it works whether
 * or not the frontend dev server is running.
 */
function trackAppRedirects(page: Page): URL[] {
  const hits: URL[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(REDIRECT_URI)) hits.push(new URL(request.url()));
  });
  return hits;
}

const issuedCode = (hits: URL[]) => hits.some((u) => u.searchParams.has('code'));

async function submitUsername(page: Page, username: string): Promise<void> {
  await page.goto(authUrl());
  const usernameField = page.locator('input[name="username"]');
  await expect(usernameField).toBeVisible();
  // The username step must not ask for a password — that is the passkey-forms shape.
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await usernameField.fill(username);
  await page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click();
  await page.waitForLoadState('domcontentloaded');
}

async function submitPassword(page: Page, password: string): Promise<void> {
  const passwordField = page.locator('input[name="password"]');
  await expect(passwordField).toBeVisible();
  await passwordField.fill(password);
  await page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click();
}

function uniqueUser(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@local`;
}

// Satisfies the realm password policy: length(8) upperCase(1) digits(1) specialChars(1)
const THROWAWAY_PASSWORD = 'Idp-Flow-Test-1!';

test.describe('Keycloak browser flow (KC-01 / SEC-12)', () => {
  // Empty storage state: the chromium project inherits an SSO cookie that would skip the form.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    const response = await request
      .get(`${KEYCLOAK_URL}/realms/japan-trip`, { timeout: 5000 })
      .catch(() => null);
    test.skip(!response?.ok(), 'Keycloak is not running locally');
  });

  test('username alone never authenticates an existing password user', async ({ page, kcAdmin }) => {
    test.skip(!HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET not set');
    const username = uniqueUser('idp-flow-pw');
    await kcAdmin.createUser(username, THROWAWAY_PASSWORD);
    await kcAdmin.clearRequiredActions(username); // drop default VERIFY_EMAIL
    try {
      const hits = trackAppRedirects(page);
      await submitUsername(page, username);

      // Still on Keycloak, now asking for the credential.
      expect(issuedCode(hits)).toBe(false);
      expect(page.url()).toContain(KEYCLOAK_URL);
      await expect(page.locator('input[name="password"]')).toBeVisible();

      // An empty password submission must not complete the flow either.
      await page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click();
      await page.waitForLoadState('domcontentloaded');
      expect(issuedCode(hits)).toBe(false);
      expect(page.url()).toContain(KEYCLOAK_URL);
    } finally {
      await kcAdmin.deleteUser(username);
    }
  });

  test('user with no credential at all is rejected after the username step', async ({ page, kcAdmin }) => {
    test.skip(!HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET not set');
    const username = uniqueUser('idp-flow-nocred');
    await kcAdmin.createUser(username, null);
    await kcAdmin.clearRequiredActions(username); // drop default VERIFY_EMAIL
    try {
      const hits = trackAppRedirects(page);
      await submitUsername(page, username);

      expect(issuedCode(hits)).toBe(false);
      expect(page.url()).toContain(KEYCLOAK_URL);
      // Neither a password form nor a passkey registration prompt may be offered:
      // registering a passkey after only a username would be an account takeover.
      await expect(page.locator('input[name="password"]')).toHaveCount(0);
      await expect(page.locator('#registerWebAuthn, #kc-form-webauthn')).toHaveCount(0);
      expect(page.url()).not.toMatch(/required-action|execution=webauthn-register/);
    } finally {
      await kcAdmin.deleteUser(username);
    }
  });

  test('unknown username is rejected', async ({ page }) => {
    const hits = trackAppRedirects(page);
    await submitUsername(page, uniqueUser('idp-flow-does-not-exist'));
    expect(issuedCode(hits)).toBe(false);
    expect(page.url()).toContain(KEYCLOAK_URL);
  });

  test('password fallback works for a user without a passkey', async ({ page, kcAdmin }) => {
    test.skip(!HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET not set');
    const username = uniqueUser('idp-flow-fallback');
    await kcAdmin.createUser(username, THROWAWAY_PASSWORD);
    await kcAdmin.clearRequiredActions(username); // drop default VERIFY_EMAIL
    try {
      const hits = trackAppRedirects(page);
      await submitUsername(page, username);
      await submitPassword(page, THROWAWAY_PASSWORD);
      await expect.poll(() => issuedCode(hits)).toBe(true);
    } finally {
      await kcAdmin.deleteUser(username);
    }
  });

  test('password fallback works for e2e-test@local', async ({ page, kcAdmin }) => {
    const username = process.env.E2E_TEST_USERNAME ?? 'e2e-test@local';
    const password = process.env.E2E_TEST_PASSWORD;
    test.skip(!password, 'E2E_TEST_PASSWORD not set');
    if (HAS_ADMIN) await kcAdmin.resetCredentials(username); // drop any passkey from other specs
    const hits = trackAppRedirects(page);
    await submitUsername(page, username);
    await submitPassword(page, password!);
    await expect.poll(() => issuedCode(hits)).toBe(true);
  });

  test('passkey user gets the WebAuthn step and signs in with it', async ({ page, browserName, kcAdmin }) => {
    test.skip(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
    test.skip(!HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET not set');
    const username = uniqueUser('idp-flow-passkey');
    await kcAdmin.createUser(username, THROWAWAY_PASSWORD);
    await kcAdmin.clearRequiredActions(username); // drop default VERIFY_EMAIL

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    try {
      const hits = trackAppRedirects(page);

      // 1. Enrol a passkey via application-initiated action after a password login.
      await page.goto(authUrl('&kc_action=webauthn-register-passwordless'));
      await page.locator('input[name="username"]').fill(username);
      await page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click();
      await submitPassword(page, THROWAWAY_PASSWORD);
      await page.locator('#registerWebAuthn').click();
      await expect.poll(() => issuedCode(hits)).toBe(true);

      // 2. Fresh login (drop the SSO cookie, keep the virtual authenticator).
      await page.context().clearCookies();
      hits.length = 0;
      await submitUsername(page, username);
      expect(issuedCode(hits)).toBe(false);
      // The passkey branch is taken: WebAuthn challenge, not the password form.
      const passkeyButton = page.locator('#authenticateWebAuthnButton');
      await expect(passkeyButton).toBeVisible();
      await expect(page.locator('input[name="password"]')).toHaveCount(0);
      await passkeyButton.click();
      await expect.poll(() => issuedCode(hits)).toBe(true);
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });
});
