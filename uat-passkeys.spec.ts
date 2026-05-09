/**
 * UAT test for Phase 4 passkeys — uses Playwright's virtual WebAuthn authenticator
 * (Chrome DevTools Protocol) to simulate passkey registration and deletion
 * without requiring real biometric hardware.
 */
import { test, expect, chromium } from '@playwright/test';

const KC_URL = 'http://localhost:8080';
const FRONTEND_BASE = 'http://localhost:5173/PruebaMapJapan';
const TEST_USER = 'testpasskey';
const TEST_PASS = 'Test@pass123!';
const TEST_USER_ID = 'df44585c-fcc8-4eae-adf0-d3e679a4afe9';

test('UAT-1: Webauthn Register Passwordless required action is enabled', async () => {
  const resp = await fetch(
    `${KC_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=admin-cli&grant_type=password&username=admin&password=admin',
    }
  );
  const { access_token } = await resp.json() as { access_token: string };

  const actionsResp = await fetch(
    `${KC_URL}/admin/realms/japan-trip/authentication/required-actions`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  const actions = await actionsResp.json() as Array<{ alias: string; enabled: boolean }>;
  const webAuthnPasswordless = actions.find(a => a.alias === 'webauthn-register-passwordless');

  expect(webAuthnPasswordless).toBeDefined();
  expect(webAuthnPasswordless!.enabled).toBe(true);
  console.log('UAT-1 PASSED: webauthn-register-passwordless required action is enabled');
});

test('UAT-2 & UAT-3: register passkey via virtual authenticator, verify list, cancel and confirm delete', async () => {
  // ── Pre-test cleanup: delete any existing WebAuthn credentials ────────
  const adminTokenResp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=admin-cli&grant_type=password&username=admin&password=admin',
  });
  const { access_token: adminToken } = await adminTokenResp.json() as { access_token: string };
  const credsResp = await fetch(`${KC_URL}/admin/realms/japan-trip/users/${TEST_USER_ID}/credentials`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const creds = await credsResp.json() as Array<{ id: string; type: string }>;
  for (const cred of creds.filter(c => c.type === 'webauthn-passwordless')) {
    await fetch(`${KC_URL}/admin/realms/japan-trip/users/${TEST_USER_ID}/credentials/${cred.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log('Cleaned up passkey credential:', cred.id);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // ── Enable virtual WebAuthn authenticator via CDP ──────────────────────
  const cdp = await context.newCDPSession(page);
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
  console.log('Virtual authenticator ready:', authenticatorId);

  // ── Step 1: Navigate to landing page and trigger login ─────────────────
  await page.goto(`${FRONTEND_BASE}/`, { waitUntil: 'domcontentloaded' });
  // Wait for KC adapter to finish initialising before triggering login
  await page.waitForTimeout(2000);
  await page.click('#landing-login-btn');

  // ── Step 2: KC login form ──────────────────────────────────────────────
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  console.log('KC login page:', page.url());
  await page.fill('#username', TEST_USER);
  await page.fill('#password', TEST_PASS);
  await page.click('#kc-login');

  await page.waitForURL(/PruebaMapJapan/, { timeout: 20000 });
  // Wait for the dashboard KC adapter to complete the token exchange so the
  // session cookie and sessionStorage tokens are written before navigating away
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // ── Step 3: Navigate to profile page ───────────────────────────────────
  // KC session cookie is now set; check-sso will silently authenticate
  await page.goto(`${FRONTEND_BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body.ready', { timeout: 20000 });

  // ── UAT-2a: Verify passkey list initially shows "no passkeys" ─────────
  const list = page.locator('#passkey-list');
  await expect(list).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.getElementById('passkey-list');
    return el && !el.textContent?.includes('Cargando');
  }, { timeout: 5000 }).catch(() => {});

  const initialText = await list.textContent();
  expect(initialText).toContain('No tenés passkeys');

  // ── UAT-2b: Register a passkey ────────────────────────────────────────
  await page.click('#btn-add-passkey');

  // KC redirects to WebAuthn registration page
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  console.log('KC WebAuthn registration page:', page.url());

  // Click submit to trigger navigator.credentials.create(); virtual authenticator
  // intercepts automatically via automaticPresenceSimulation
  const registerBtn = page.locator('input[type="submit"], button[type="submit"]').first();
  await registerBtn.waitFor({ state: 'visible', timeout: 10000 });
  await registerBtn.click();

  // KC processes the credential and redirects back
  await page.waitForURL(/PruebaMapJapan/, { timeout: 30000 });
  console.log('Back at frontend after registration:', page.url());

  if (!page.url().includes('profile.html')) {
    await page.goto(`${FRONTEND_BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('body.ready', { timeout: 20000 });

  // ── UAT-2c: Passkey appears in list with Eliminar button ──────────────
  await page.waitForFunction(() => {
    const el = document.getElementById('passkey-list');
    if (!el) return false;
    return el.querySelector('.passkey-item') !== null || el.textContent?.includes('No se pudo');
  }, { timeout: 15000 }).catch(() => {});

  const passkeyItems = page.locator('.passkey-item');
  expect(await passkeyItems.count()).toBeGreaterThanOrEqual(1);

  const deleteBtn = passkeyItems.first().locator('[data-passkey-delete]');
  await expect(deleteBtn).toBeVisible();
  expect(await deleteBtn.getAttribute('data-credential-id')).toBeTruthy();
  console.log('UAT-2 PASSED: passkey registered, appears in list with data-credential-id and Eliminar button');

  // ── UAT-3a: Click Eliminar → overlay appears ──────────────────────────
  await deleteBtn.click();
  const overlay = page.locator('#passkey-delete-overlay');
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#passkey-delete-cancel')).toBeVisible();
  await expect(page.locator('#passkey-delete-confirm')).toBeVisible();

  // ── UAT-3b: Cancelar → overlay hides, passkey still in list ──────────
  await page.click('#passkey-delete-cancel');
  await expect(overlay).toBeHidden({ timeout: 5000 });
  expect(await passkeyItems.count()).toBeGreaterThanOrEqual(1);
  console.log('UAT-3a PASSED: Cancel closes overlay, passkey still present');

  // ── UAT-3c: Confirm delete → KC AIA delete_credential → passkey removed ─
  // KC 26 DELETE /account/credentials/{id} returns 405 for WebAuthn credentials;
  // the confirm button uses keycloak.login({ action: 'delete_credential:...' }) instead.
  await deleteBtn.click();
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await page.click('#passkey-delete-confirm');

  // Redirect to KC delete-credential confirmation page (delete-credential.ftl)
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  console.log('KC delete-credential page:', page.url());

  // #kc-accept = "Yes, delete" submit; #kc-decline = "Cancel"
  const kcAccept = page.locator('#kc-accept');
  await kcAccept.waitFor({ state: 'visible', timeout: 10000 });
  await kcAccept.click();

  // KC deletes the credential server-side and redirects back to profile.html
  await page.waitForURL(/PruebaMapJapan/, { timeout: 30000 });
  if (!page.url().includes('profile.html')) {
    await page.goto(`${FRONTEND_BASE}/profile.html`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('body.ready', { timeout: 20000 });

  await page.waitForFunction(() => {
    const el = document.getElementById('passkey-list');
    return el && el.textContent?.includes('No tenés passkeys');
  }, { timeout: 15000 });

  const afterText = await list.textContent();
  expect(afterText).toContain('No tenés passkeys');
  console.log('UAT-3b PASSED: Confirm delete removes passkey from list');

  await browser.close();
  console.log('\n✓ All UAT items passed');
});
