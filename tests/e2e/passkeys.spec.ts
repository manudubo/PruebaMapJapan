import { test, expect } from './fixtures/kc-admin';
import type { BrowserContext } from '@playwright/test';
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

  // Cleanup registry — afterEach drains unconditionally so a mid-test failure cannot leave
  // a stale virtual authenticator for subsequent tests (PASS-01)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cdpCleanups: Array<{ cdp: any; authenticatorId: string; context?: BrowserContext }> = [];

  test.afterEach(async () => {
    for (const { cdp, authenticatorId, context } of cdpCleanups) {
      try {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      } catch { /* already removed or session closed */ }
      if (context) {
        try { await context.close(); } catch { /* already closed */ }
      }
    }
    cdpCleanups.length = 0;
  });

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
        automaticPresenceSimulation: true,
      },
    });
    cdpCleanups.push({ cdp, authenticatorId });

    const registerBtn = page.locator(
      '[data-action="register-passkey"], #register-passkey-btn, #btn-add-passkey, button:has-text("Add passkey"), button:has-text("Register passkey")'
    );
    await registerBtn.first().click();

    // KC redirects to passkey registration confirmation page before the WebAuthn ceremony
    const kcRegisterBtn = page.getByRole('button', { name: 'Register' });
    await kcRegisterBtn.waitFor({ state: 'visible', timeout: 15000 });
    await kcRegisterBtn.click();

    await page.waitForURL(/profile\.html/, { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');

    const credentialsList = page.locator(
      '[data-credential-type="webauthn"], .passkey-item, [data-testid="passkey-credential"]'
    );
    await expect(credentialsList.first()).toBeVisible({ timeout: 10000 });
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
        automaticPresenceSimulation: true,
      },
    });
    cdpCleanups.push({ cdp: cdpAuth, authenticatorId: authId });

    const registerBtn = page.locator(
      '[data-action="register-passkey"], #register-passkey-btn, #btn-add-passkey, button:has-text("Add passkey"), button:has-text("Register passkey")'
    );
    await registerBtn.first().click();

    // KC redirects to passkey registration confirmation page before the WebAuthn ceremony
    const kcRegisterBtnAuth = page.getByRole('button', { name: 'Register' });
    await kcRegisterBtnAuth.waitFor({ state: 'visible', timeout: 15000 });
    await kcRegisterBtnAuth.click();

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
        automaticPresenceSimulation: true,
      },
    });
    cdpCleanups.push({ cdp: cdpClean, authenticatorId: cleanAuthId, context: cleanContext });

    // Transfer the registered credential so the clean authenticator can respond to KC's assertion
    for (const cred of credentials) {
      await cdpClean.send('WebAuthn.addCredential', {
        authenticatorId: cleanAuthId,
        credential: cred,
      });
    }

    // Step 4: Clear leaked KC session cookies from the clean context.
    // browser.newContext() doesn't isolate localhost cookies in Chromium, so
    // the clean context inherits the main context's KEYCLOAK_SESSION — clearing
    // it here forces check-sso to return login_required (guest mode).
    await cleanContext.clearCookies();

    // Step 5: Navigate to dashboard — check-sso now fails → guest mode
    await cleanPage.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`);
    await cleanPage.waitForLoadState('networkidle');

    // Step 6: Guest-mode login prompt
    const loginPromptBtn = cleanPage.locator('#auth-login-prompt-btn');
    await loginPromptBtn.waitFor({ state: 'visible', timeout: 15000 });
    await loginPromptBtn.click();

    // Step 7: KC login form — session cleared, so KC shows it
    await cleanPage.waitForURL(/realms\/japan-trip/, { timeout: 15000 });

    // Step 8: Trigger passkey/passwordless option if present; CDP auto-asserts otherwise
    const passkeyBtn = cleanPage.locator(
      '[id*="passkey"], button:has-text("passkey"), button:has-text("Passkey"), a:has-text("Sign in without password")'
    );
    try {
      await passkeyBtn.first().click({ timeout: 3000 });
    } catch {
      // KC initiated WebAuthn assertion automatically via discoverable credential
    }

    // Step 9: After CDP auto-assertion, KC redirects back to app
    await cleanPage.waitForURL(/dashboard\.html/, { timeout: 30000 });
    await cleanPage.waitForLoadState('domcontentloaded');

    expect(cleanPage.url()).toContain('dashboard.html');

    await cleanContext.close();
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
        automaticPresenceSimulation: true,
      },
    });
    cdpCleanups.push({ cdp, authenticatorId });

    const registerBtn = page.locator(
      '[data-action="register-passkey"], #register-passkey-btn, #btn-add-passkey, button:has-text("Add passkey"), button:has-text("Register passkey")'
    );
    await registerBtn.first().click();

    // KC redirects to passkey registration confirmation page before the WebAuthn ceremony
    const kcRegisterBtnDel = page.getByRole('button', { name: 'Register' });
    await kcRegisterBtnDel.waitFor({ state: 'visible', timeout: 15000 });
    await kcRegisterBtnDel.click();

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
  });
});
