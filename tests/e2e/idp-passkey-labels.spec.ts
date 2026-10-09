import { expect, test, type CDPSession, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { clearRequiredActions, createUser, deleteUser, getUserCredentialLabels } from './fixtures/kc-admin';

/**
 * Owner report 2026-10-09 (real phone), against a REAL Keycloak 26.6.1 and Chromium's CDP
 * virtual authenticator (the same setup as idp-theme.spec.ts / idp-passkey-first.spec.ts):
 *
 *   1. "If I try to register two passkeys on the same device I cannot": the label only carried
 *      the day, so the second one collided ("Device already exists with the same name").
 *   2. The proactive "add a passkey" (kc_action=webauthn-register-passwordless, signed in) offered
 *      "Can't use a passkey on this device? Get a code by email".
 *
 * Needs the worker client (KC_ADMIN_CLIENT_ID / KC_ADMIN_CLIENT_SECRET) to read the stored
 * labels; fixme otherwise. Page x flow table of the recovery link: docs/design/PASSKEY-FIRST-LOGIN.md.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'japan-trip';
const APP = 'http://localhost:5173/PruebaMapJapan/';
const REDIRECT_URI = `${APP}dashboard.html`;
const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;
const REQUIRE_KC = process.env.CI_KEYCLOAK === '1';
const AIA = '&kc_action=webauthn-register-passwordless';

const loginUrl = (extra = '') =>
  `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth` +
  `?client_id=japan-trip-frontend&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  '&response_type=code&scope=openid&ui_locales=en' +
  `&code_challenge=${crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('base64url')}&code_challenge_method=S256${extra}`;

const THE_SAME_MINUTE = new Date(2026, 9, 9, 14, 41, 0);
const LABEL_BASE = /^[A-Za-z][A-Za-z ]+ on [A-Za-z]+ \(2026-10-09 14:41/;

test.describe('passkey labels and the recovery link, live', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let email: string;
  let password: string;
  let cdp: CDPSession;
  let current: string | undefined;

  test.beforeEach(async ({ page, request, browserName }) => {
    const realm = await request.get(`${KEYCLOAK_URL}/realms/${REALM}`, { timeout: 5000 }).catch(() => null);
    test.fixme(!realm?.ok() && !REQUIRE_KC, 'needs Keycloak (realm japan-trip); CI runs it in keycloak-flow.yml');
    test.fixme(!HAS_ADMIN && !REQUIRE_KC, 'needs the worker client (KC_ADMIN_CLIENT_ID / KC_ADMIN_CLIENT_SECRET) to read credentials');
    test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
    email = `labels-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;
    password = `${crypto.randomBytes(12).toString('base64url')}Aa1!`;
    await createUser(email, password);
    // Keycloak gives a new user the realm's default required action (create a passkey): the
    // tests start from an account that is signed in for something else, as the profile page does.
    if (!test.info().title.includes('required action')) await clearRequiredActions(email);
    // every registration below happens "at 14:41": the same minute, however long the test takes
    await page.clock.setFixedTime(THE_SAME_MINUTE);
    cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    current = undefined;
  });

  test.afterEach(async () => {
    if (current) await cdp?.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: current }).catch(() => {});
    if (email) await deleteUser(email);
  });

  /** A new "phone": the previous virtual authenticator goes away, so the next registration is a different device. */
  async function newDevice(): Promise<void> {
    if (current) await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: current });
    current = (
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
      })
    ).authenticatorId;
  }

  /** Password sign-in with the "add a passkey" action attached, up to the registration page. */
  async function openRegistration(page: Page): Promise<void> {
    await page.goto(loginUrl(AIA));
    if (await page.locator('#username').isVisible().catch(() => false)) {
      await page.locator('#username').fill(email);
      await page.locator('#kc-login').click();
      await page.locator('input[name="password"]').fill(password);
      await page.locator('#kc-login').click();
    }
    await expect(page.locator('#registerWebAuthn')).toBeVisible();
  }

  /** Press register; the redirect to the app (not running here) is the proof that Keycloak accepted the passkey. */
  async function registerAndLeave(page: Page): Promise<void> {
    const toApp = page.waitForEvent('request', (request) => request.url().startsWith(APP));
    await page.locator('#registerWebAuthn').click();
    await toApp;
    await expect.poll(() => page.url().startsWith(KEYCLOAK_URL), { message: 'the failed navigation to the app has settled' }).toBe(false);
  }

  /**
   * What the page posts when the browser refuses the authenticator (an already registered one,
   * when the realm's WebAuthn policy avoids the same authenticator twice) or the person cancels:
   * the error field, exactly as webauthnRegister.js fills it.
   */
  async function browserSays(page: Page, error: string): Promise<void> {
    await page.evaluate((value) => {
      (document.getElementById('error') as HTMLInputElement).value = value;
      (document.getElementById('register') as HTMLFormElement).requestSubmit();
    }, error);
    await expect(page.locator('#kc-try-again')).toBeVisible();
  }

  const labels = () => getUserCredentialLabels(email, 'webauthn-passwordless');

  test('two passkeys from the same browser in the same minute are stored under two different labels', async ({ page }) => {
    await newDevice();
    await openRegistration(page);
    await registerAndLeave(page);

    await newDevice(); // the owner's case: another passkey, same device and browser, same day
    await openRegistration(page);
    await registerAndLeave(page);

    const stored = await labels();
    expect(stored).toHaveLength(2);
    expect(new Set(stored).size, `labels ${JSON.stringify(stored)}`).toBe(2);
    for (const label of stored) expect(label).toMatch(LABEL_BASE);
    // Keycloak lists them by priority, not by age
    expect(stored.filter((label) => /14:41\)$/.test(label))).toHaveLength(1);
    expect(stored.filter((label) => /14:41 #2\)$/.test(label))).toHaveLength(1);
  });

  test('a collision the page could not foresee: friendly error, and "Try again" makes a NEW label that is accepted', async ({ page }) => {
    await newDevice();
    await openRegistration(page);
    await registerAndLeave(page);
    const [first] = await labels();

    // A second phone whose browser has no memory of the first label (cleared site data, another
    // profile, private window): it builds the very same label, and Keycloak refuses it.
    await newDevice();
    await openRegistration(page);
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#register')).toHaveAttribute('data-retry', 'false');
    await page.locator('#registerWebAuthn').click();

    await expect(page.locator('h1')).toHaveText('Passkey Error');
    await expect(page.locator('#jp-passkey-error')).toHaveAttribute('data-error-kind', 'name');
    await expect(page.locator('#jp-passkey-error-text')).toContainText('already has the same name');
    await expect(page.locator('.jp-alert')).not.toContainText('Device already exists');
    await expect(page.locator('#jp-error-original')).toContainText('Device already exists with the same name');
    expect(await labels()).toEqual([first]); // nothing half-saved

    await page.locator('#kc-try-again').click();
    await expect(page.locator('#register')).toHaveAttribute('data-retry', 'true');
    await registerAndLeave(page);

    const stored = await labels();
    expect(stored).toHaveLength(2);
    expect(new Set(stored).size).toBe(2);
    expect(stored.find((label) => label !== first)).toMatch(/\(2026-10-09 14:41 #[a-z2-9]{2}\)$/);
  });

  test('the browser refuses an authenticator that is already registered: plain-language explanation, no raw browser message', async ({ page }) => {
    await newDevice();
    await openRegistration(page);
    await registerAndLeave(page);

    await openRegistration(page);
    await browserSays(page, 'InvalidStateError: The user attempted to register an authenticator that contains one of the credentials already registered with the relying party.');

    await expect(page.locator('h1')).toHaveText('Passkey Error');
    await expect(page.locator('#jp-passkey-error')).toHaveAttribute('data-error-kind', 'duplicate');
    await expect(page.locator('#jp-passkey-error-text')).toHaveText(
      'This device already has a passkey for this account. You can use it to sign in, or add one from another device or password manager.',
    );
    await expect(page.locator('.jp-alert')).not.toContainText('InvalidStateError');
    await expect(page.locator('#jp-error-details')).toBeVisible(); // the original stays available to support
    expect(await labels()).toHaveLength(1);
  });

  test('proactive registration (signed in, kc_action): no "get a code by email", on the page and on its error page; the way back stays', async ({ page }) => {
    await newDevice();
    await openRegistration(page);
    await expect(page.locator('#cancelWebAuthnAIA')).toBeVisible(); // it is an app-initiated action
    await expect(page.locator('#jp-passkey-recovery')).toHaveCount(0);
    await expect(page.locator('#jp-passkey-recovery-link')).toHaveCount(0);
    await expect(page.locator('a.jp-idp-exit')).toHaveText('Back to Japan Trip');
    await expect(page.locator('body')).not.toContainText('code by email');

    await openRegistration(page);
    await browserSays(page, 'NotAllowedError: The operation either timed out or was not allowed.');
    await expect(page.locator('#jp-passkey-recovery')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('code by email');
    await expect(page.locator('#cancelWebAuthnAIA')).toBeVisible();
    await expect(page.locator('a.jp-idp-exit')).toHaveText('Back to Japan Trip');
  });

  test('enrolment that is NOT app-initiated (required action after sign-in) keeps the recovery link', async ({ page }) => {
    await page.goto(loginUrl());
    await page.locator('#username').fill(email);
    await page.locator('#kc-login').click();
    await page.locator('input[name="password"]').fill(password);
    await page.locator('#kc-login').click();
    // the realm's default required action sends a user without a passkey to the enrolment page
    await expect(page.locator('#registerWebAuthn')).toBeVisible();
    await expect(page.locator('#cancelWebAuthnAIA')).toHaveCount(0);
    await expect(page.locator('#jp-passkey-recovery-link')).toBeVisible();
    await expect(page.locator('a.jp-idp-exit')).toHaveText('Back to Japan Trip');
  });
});
