/**
 * UAT test for Phase 4 passkeys — uses Playwright's virtual WebAuthn authenticator
 * (Chrome DevTools Protocol) to simulate passkey registration and deletion
 * without requiring real biometric hardware.
 */
import { test, expect, chromium } from '@playwright/test';

const KC_URL = 'http://localhost:8080';
const FRONTEND_BASE = 'http://localhost:5173/PruebaMapJapan';
// Master-realm admin of the local dev Keycloak (keycloak/docker-compose.yml bootstrap admin).
const KC_ADMIN_USER = process.env.KC_ADMIN_USER ?? 'admin';
const KC_ADMIN_PASS = process.env.KC_ADMIN_PASS ?? 'admin';
// Throwaway user created per test: the previously hardcoded user id existed only on one
// developer's Keycloak, so UAT-2/3 could never run against a Terraform-built realm.
let testUser = '';
const TEST_PASS = 'Uat#pass123!';
let testUserId = '';

async function adminToken(): Promise<string> {
  const resp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli',
      grant_type: 'password',
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASS,
    }),
  });
  expect(resp.ok, 'master admin token').toBe(true);
  return ((await resp.json()) as { access_token: string }).access_token;
}

test.beforeEach(async () => {
  testUser = `uat-passkey-${Date.now()}@local`;
  const resp = await fetch(`${KC_URL}/admin/realms/japan-trip/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await adminToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: testUser,
      email: testUser,
      emailVerified: true,
      enabled: true,
      // KC 26 user profile requires first/last name; without them login stops at VERIFY_PROFILE.
      firstName: 'UAT',
      lastName: 'Passkey',
      credentials: [{ type: 'password', value: TEST_PASS, temporary: false }],
    }),
  });
  expect(resp.status, 'create throwaway user').toBe(201);
  testUserId = resp.headers.get('location')!.split('/').pop()!;
});

test.afterEach(async () => {
  if (!testUserId) return;
  await fetch(`${KC_URL}/admin/realms/japan-trip/users/${testUserId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await adminToken()}` },
  });
});

test('UAT-1: Webauthn Register Passwordless required action is enabled', async () => {
  const access_token = await adminToken();

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
  // The throwaway user from beforeEach starts with a password and no passkeys.
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
  // The login button is revealed only after the KC adapter finished initialising
  await expect(page.locator('#landing-login-btn')).toBeVisible({ timeout: 15000 });
  await page.click('#landing-login-btn');

  // ── Step 2: KC login form ──────────────────────────────────────────────
  // 'commit': the click can start the KC navigation before the landing page's own load
  // event, and waiting for 'load' then intermittently timed out (1 in ~5 runs). fill()
  // below auto-waits for the form.
  await page.waitForURL(/localhost:8080/, { timeout: 15000, waitUntil: 'commit' });
  console.log('KC login page:', page.url());
  // browser-passkey is username-first (KC-01): username, then the password step.
  await page.fill('#username', testUser);
  await page.click('#kc-login');
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
  // The list shows "Loading passkeys…" until the account API answers (the old wait looked
  // for the pre-translation Spanish text, so it never waited and the check raced).
  await expect(list).toContainText("You don't have any passkeys", { timeout: 15000 });

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

  // ── UAT-2c: Passkey appears in list with a Delete button ──────────────
  const passkeyItems = page.locator('.passkey-item');
  await expect(passkeyItems).toHaveCount(1, { timeout: 15000 });

  const deleteBtn = passkeyItems.first().locator('[data-passkey-delete]');
  await expect(deleteBtn).toBeVisible();
  expect(await deleteBtn.getAttribute('data-credential-id')).toBeTruthy();
  console.log('UAT-2 PASSED: passkey registered, appears in list with data-credential-id and a Delete button');

  // ── UAT-3a: only passkey → overlay shows the last-credential guard ────
  // D-17/D-18: the only passkey cannot be deleted; Delete is hidden and the guard offers
  // registering another passkey instead.
  const overlay = page.locator('#passkey-delete-overlay');
  await deleteBtn.click();
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#passkey-delete-cancel')).toBeVisible();
  await expect(page.locator('#passkey-delete-confirm')).toBeHidden();
  await expect(overlay.locator('[data-passkey-guard]')).toBeVisible();

  // ── UAT-3b: Cancel → overlay hides, passkey still in list ─────────────
  await page.click('#passkey-delete-cancel');
  await expect(overlay).toBeHidden({ timeout: 5000 });
  await expect(passkeyItems).toHaveCount(1);
  console.log('UAT-3a PASSED: last passkey guarded, Cancel closes overlay, passkey still present');

  // ── Register a second passkey on a second (virtual) device ─────────────
  // KC excludes already-registered credentials, so swap in a fresh authenticator.
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
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
  // KC prompts for a device label and rejects a duplicate one (headless Playwright
  // dismisses prompts, so both registrations would get the same default label).
  page.once('dialog', (d) => void d.accept('UAT second device'));
  await page.click('#btn-add-passkey');
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  await registerBtn.waitFor({ state: 'visible', timeout: 10000 });
  await registerBtn.click();
  await page.waitForURL(/profile\.html/, { timeout: 30000 });
  await page.waitForSelector('body.ready', { timeout: 20000 });
  await expect(passkeyItems).toHaveCount(2, { timeout: 15000 });

  // ── UAT-3c: Confirm delete → KC AIA delete_credential → passkey removed ─
  // KC 26 DELETE /account/credentials/{id} returns 405 for WebAuthn credentials;
  // the confirm button uses keycloak.login({ action: 'delete_credential:...' }) instead.
  await passkeyItems.first().locator('[data-passkey-delete]').click();
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#passkey-delete-confirm')).toBeVisible();
  await page.click('#passkey-delete-confirm');

  // Redirect to KC delete-credential confirmation page (delete-credential.ftl)
  await page.waitForURL(/localhost:8080/, { timeout: 15000 });
  console.log('KC delete-credential page:', page.url());

  // #kc-accept = "Yes, delete" submit; #kc-decline = "Cancel"
  const kcAccept = page.locator('#kc-accept');
  await kcAccept.waitFor({ state: 'visible', timeout: 10000 });
  await kcAccept.click();

  // KC deletes the credential server-side and redirects back to profile.html
  await page.waitForURL(/profile\.html/, { timeout: 30000 });
  await page.waitForSelector('body.ready', { timeout: 20000 });
  await expect(passkeyItems).toHaveCount(1, { timeout: 15000 });
  console.log('UAT-3b PASSED: Confirm delete removes passkey from list');


  await browser.close();
  console.log('\n✓ All UAT items passed');
});
