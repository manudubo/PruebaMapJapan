import { test, expect } from './fixtures/kc-admin';
import * as fs from 'fs';
import * as path from 'path';

// sessionStorage replay for Playwright bug #31108 — keycloak-js stores tokens here
const sessionEntries: [string, string][] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '../.auth/session.json'), 'utf-8')
    ) as [string, string][];
  } catch {
    return [];
  }
})();

test.use({
  storageState: path.join(__dirname, '../.auth/user.json'),
});

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const E2E_USERNAME = process.env.E2E_TEST_USERNAME ?? 'e2e-test@local';

test.describe('Passkey flows', () => {
  // Guard — skip all tests in this describe when KC is not available (D-03)
  test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');

  test.beforeEach(async ({ context, kcAdmin }) => {
    // Reset credentials before each test — ensures clean state (D-11)
    await kcAdmin.resetCredentials(E2E_USERNAME);

    // Inject sessionStorage tokens before any navigation (D-17: addInitScript before goto)
    if (sessionEntries.length) {
      await context.addInitScript((entries) => {
        for (const [k, v] of entries) {
          window.sessionStorage.setItem(k, v);
        }
      }, sessionEntries);
    }
  });

  test('register passkey via CDP Virtual Authenticator', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/PruebaMapJapan/profile.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true, // CRITICAL: correct spelling (not haUserVerification)
        isUserVerified: true,
        automaticPresenceSimulation: false,
      },
    });

    const registerBtn = page.locator(
      '[data-action="register-passkey"], #register-passkey-btn, #btn-add-passkey, button:has-text("Add passkey"), button:has-text("Register passkey")'
    );
    await registerBtn.first().click();

    await page.waitForURL(/profile\.html/, { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');

    const credentialsList = page.locator(
      '[data-credential-type="webauthn"], .passkey-item, [data-testid="passkey-credential"]'
    );
    await expect(credentialsList.first()).toBeVisible({ timeout: 10000 });

    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  });

  test('login with passkey via KC login form', async ({ page, browser }) => {
    // Step 1: Register a passkey in the authenticated session
    await page.goto(`${FRONTEND_URL}/PruebaMapJapan/profile.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const cdpAuth = await page.context().newCDPSession(page);
    await cdpAuth.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId: authId } = await cdpAuth.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: false,
      },
    });

    const registerBtn = page.locator(
      '[data-action="register-passkey"], #register-passkey-btn, #btn-add-passkey, button:has-text("Add passkey"), button:has-text("Register passkey")'
    );
    await registerBtn.first().click();
    await page.waitForURL(/profile\.html/, { timeout: 30000 });

    // Step 2: Capture the registered credential from the authenticated authenticator
    const { credentials } = await cdpAuth.send('WebAuthn.getCredentials', { authenticatorId: authId });

    // Step 3: Create a clean browser context — no storageState, no addInitScript
    // A new context with no configuration guarantees KC redirects to login.
    const cleanContext = await browser.newContext();
    const cleanPage = await cleanContext.newPage();

    const cdpClean = await cleanContext.newCDPSession(cleanPage);
    await cdpClean.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId: cleanAuthId } = await cdpClean.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: false,
      },
    });

    // Transfer the registered credential so the clean authenticator can respond to KC's assertion
    for (const cred of credentials) {
      await cdpClean.send('WebAuthn.addCredential', {
        authenticatorId: cleanAuthId,
        credential: cred,
      });
    }

    // Step 4: Navigate to dashboard — no tokens, KC redirects to login
    await cleanPage.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`);
    await cleanPage.waitForURL(/realms\/japan-trip/, { timeout: 15000 });

    // Step 5: Trigger passkey/passwordless option if present; CDP auto-asserts otherwise
    const passkeyBtn = cleanPage.locator(
      '[id*="passkey"], button:has-text("passkey"), button:has-text("Passkey"), a:has-text("Sign in without password")'
    );
    try {
      await passkeyBtn.first().click({ timeout: 3000 });
    } catch {
      // KC initiated WebAuthn assertion automatically via discoverable credential
    }

    // Step 6: After CDP auto-assertion, KC redirects back to app
    await cleanPage.waitForURL(/dashboard\.html/, { timeout: 30000 });
    await cleanPage.waitForLoadState('domcontentloaded');

    expect(cleanPage.url()).toContain('dashboard.html');

    await cleanContext.close();
    await cdpAuth.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authId });
  });

  test('delete passkey is blocked when it is the last credential', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/PruebaMapJapan/profile.html`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

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

    const registerBtn = page.locator(
      '[data-action="register-passkey"], #register-passkey-btn, #btn-add-passkey, button:has-text("Add passkey"), button:has-text("Register passkey")'
    );
    await registerBtn.first().click();
    await page.waitForURL(/profile\.html/, { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');

    // Try to delete the only passkey — last-credential guard (PASS-06) must block this
    const deleteBtn = page.locator(
      '[data-action="delete-passkey"], .delete-passkey-btn, button:has-text("Delete")'
    );
    await deleteBtn.first().click();

    const guardMsg = page.locator(
      '[data-testid="last-credential-error"], .last-credential-warning, .error-message, [role="alert"], [data-passkey-guard]'
    );
    await expect(guardMsg.first()).toBeVisible({ timeout: 5000 });

    // Passkey must still be listed (not deleted)
    const credentialsList = page.locator('[data-credential-type="webauthn"], .passkey-item');
    await expect(credentialsList.first()).toBeVisible({ timeout: 5000 });

    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  });
});
