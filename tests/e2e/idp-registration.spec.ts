import { expect, test } from './fixtures/kc-admin';
import type { APIRequestContext, BrowserContext, CDPSession, Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * REG-01..07 — self-registration on the japan-trip realm (terraform/keycloak/flows.tf,
 * registration-passkey) against a REAL Keycloak 26.6.1 + Mailpit, driven directly (the
 * app redirect URI is only observed, as in idp-flow.spec.ts).
 *
 * Keycloak part (runs in keycloak-flow.yml, CI_KEYCLOAK=1 makes every precondition
 * required):
 *   - the form asks for the e-mail (= username) and optional names, never a password;
 *   - the account must enrol a passkey before any authorization code is issued
 *     (virtual authenticator), and ends with exactly one credential: the passkey;
 *   - Keycloak sends NO verification link (the backend verifies with a 6-digit code)
 *     and the access token carries email_verified=false for the new account;
 *   - without WebAuthn the enrolment cannot finish: no code, the theme offers the
 *     e-mail recovery page, and the half-created account (no credential) can never
 *     sign in with its username alone;
 *   - a password smuggled into the registration POST is ignored;
 *   - duplicate e-mail: Keycloak's own "Email already exists." (documented enumeration);
 *   - registration disabled → the registration endpoint refuses.
 *
 * Backend part (e-mail code verification, recovery "password campaign"): needs the
 * backend from the backend work stream (POST /api/auth/email-verify/*,
 * /api/auth/recovery/*) running against this Keycloak and Mailpit. It runs when
 * E2E_API_URL points at it and is fixme otherwise; CI_BACKEND=1 makes it required.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'japan-trip';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const API_URL = process.env.E2E_API_URL ?? '';
const REDIRECT_URI = 'http://localhost:5173/PruebaMapJapan/dashboard.html';
const RECOVER_PAGE = 'http://localhost:5173/PruebaMapJapan/recover.html';
const REQUIRE_KC = process.env.CI_KEYCLOAK === '1';
const REQUIRE_BACKEND = process.env.CI_BACKEND === '1';
const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;
/** Master admin password FILE of the throwaway Keycloak (scripts/ci/keycloak-flow.sh). */
const MASTER_PW_FILE = process.env.KC_MASTER_ADMIN_PASSWORD_FILE ?? '';

// Toggling realm registration affects every request to the realm: keep this file serial.
test.describe.configure({ mode: 'serial' });

function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

function registrationUrl(challenge: string): string {
  return (
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/registrations` +
    '?client_id=japan-trip-frontend' +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    '&response_type=code&scope=openid&ui_locales=en' +
    `&code_challenge=${challenge}&code_challenge_method=S256`
  );
}

function authUrl(challenge: string): string {
  return registrationUrl(challenge).replace('/registrations?', '/auth?');
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;
}

/** Codes Keycloak sent to the app redirect URI (request event: sees 302 targets). */
function trackCodes(page: Page): string[] {
  const codes: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(REDIRECT_URI)) {
      const code = new URL(r.url()).searchParams.get('code');
      if (code) codes.push(code);
    }
  });
  return codes;
}

async function submitForm(page: Page, submit: string): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
    page.locator(submit).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
}

/** Fill and post the registration form (no password field may exist). */
async function fillRegistration(page: Page, email: string, extra: { first?: string; last?: string } = {}): Promise<void> {
  const form = page.locator('#kc-register-form');
  await expect(form).toBeVisible();
  await expect(page.locator('#kc-register-form input[type="password"]')).toHaveCount(0);
  await expect(page.locator('#kc-register-form input[name="username"]')).toHaveCount(0);
  await page.locator('input[name="email"]').fill(email);
  if (extra.first) await page.locator('input[name="firstName"]').fill(extra.first);
  if (extra.last) await page.locator('input[name="lastName"]').fill(extra.last);
  await submitForm(page, '#kc-register-form [type="submit"]');
}

async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
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
  return { cdp, authenticatorId };
}

async function withoutWebAuthn(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  });
}

async function exchangeCode(request: APIRequestContext, code: string, verifier: string): Promise<Record<string, unknown>> {
  const res = await request.post(`${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'authorization_code',
      client_id: 'japan-trip-frontend',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

function claims(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** Mailpit: number of messages addressed to `email`. */
async function mailCount(request: APIRequestContext, email: string): Promise<number> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

/** Mailpit: the 6-digit code in the latest message to `email` (polls, no sleeps). */
async function latestCode(request: APIRequestContext, email: string): Promise<string> {
  let code = '';
  await expect
    .poll(async () => {
      const res = await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
      const list = (await res.json()) as { messages: Array<{ ID: string }> };
      if (!list.messages?.length) return '';
      const msg = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${list.messages[0]!.ID}`)).json()) as { Text: string };
      code = msg.Text.match(/\b(\d{6})\b/)?.[1] ?? '';
      return code;
    }, { message: `a 6-digit code mailed to ${email}`, timeout: 20_000 })
    .toMatch(/^\d{6}$/);
  return code;
}

/** Master-realm admin token of the throwaway Keycloak, for realm toggles only. */
async function masterToken(request: APIRequestContext): Promise<string> {
  const password = fs.readFileSync(MASTER_PW_FILE, 'utf8');
  const res = await request.post(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    form: { grant_type: 'password', client_id: 'admin-cli', username: 'admin', password },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function setRegistrationAllowed(request: APIRequestContext, allowed: boolean): Promise<void> {
  const token = await masterToken(request);
  const res = await request.put(`${KEYCLOAK_URL}/admin/realms/${REALM}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { registrationAllowed: allowed },
  });
  expect(res.status()).toBe(204);
}

test.describe('Self-registration (REG-01..07)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request }) => {
    const realm = await request.get(`${KEYCLOAK_URL}/realms/${REALM}`, { timeout: 5000 }).catch(() => null);
    const mail = await request.get(`${MAILPIT_URL}/api/v1/messages?limit=1`, { timeout: 5000 }).catch(() => null);
    const up = !!realm?.ok() && !!mail?.ok() && HAS_ADMIN;
    test.fixme(!up && !REQUIRE_KC, 'needs Keycloak (realm japan-trip, registration on), Mailpit and KC_ADMIN_CLIENT_ID/SECRET; CI runs it in keycloak-flow.yml');
    expect(realm?.ok(), `realm ${REALM} at ${KEYCLOAK_URL}`).toBe(true);
    expect(mail?.ok(), `Mailpit at ${MAILPIT_URL}`).toBe(true);
    expect(HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET').toBe(true);
  });

  test.describe('Keycloak', () => {
    test('passkey sign-up: no password asked, passkey enrolled, no Keycloak mail, email_verified=false', async ({ page, request, kcAdmin, browserName }) => {
      test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
      const email = uniqueEmail('reg-passkey');
      const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
      const { verifier, challenge } = pkce();
      try {
        const codes = trackCodes(page);
        await page.goto(registrationUrl(challenge));
        await fillRegistration(page, email); // names are optional
        // The account exists now, but no code until the passkey is enrolled.
        expect(codes).toHaveLength(0);
        const register = page.locator('#registerWebAuthn');
        await expect(register).toBeVisible();
        await expect(page.locator('#jp-passkey-recovery-link')).toBeVisible();
        await register.click();
        await expect.poll(() => codes.length).toBe(1);

        expect(await kcAdmin.credentialTypes(email)).toEqual(['webauthn-passwordless']);
        const tokens = await exchangeCode(request, codes[0]!, verifier);
        const access = claims(tokens['access_token'] as string);
        expect(access['email']).toBe(email);
        expect(access['preferred_username']).toBe(email);
        // REG-02: the backend gates the API on this (plus its own verified flag).
        expect(access['email_verified']).toBe(false);
        // Keycloak's VERIFY_EMAIL link is off: nothing was mailed by Keycloak.
        expect(await mailCount(request, email)).toBe(0);
      } finally {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
        await kcAdmin.deleteUser(email);
      }
    });

    test('sign-up on a device without WebAuthn: no code, recovery link offered, the credential-less account cannot sign in', async ({ browser, kcAdmin }) => {
      const email = uniqueEmail('reg-nowebauthn');
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      await withoutWebAuthn(context);
      const page = await context.newPage();
      const { challenge } = pkce();
      try {
        const codes = trackCodes(page);
        await page.goto(registrationUrl(challenge));
        await fillRegistration(page, email, { first: 'No', last: 'WebAuthn' });
        await expect(page.locator('#registerWebAuthn')).toBeVisible();
        const link = page.locator('#jp-passkey-recovery-link');
        await expect(link).toBeVisible();
        await expect(page.locator('#jp-passkey-recovery')).toHaveClass(/jp-passkey-recovery--primary/);
        expect(await link.getAttribute('href')).toBe(RECOVER_PAGE);
        // Pressing "register" anyway cannot complete without WebAuthn.
        await page.locator('#registerWebAuthn').click();
        await expect(page.locator('#registerWebAuthn, #kc-error-message, .alert-error').first()).toBeVisible();
        expect(codes).toHaveLength(0);
        expect(await kcAdmin.credentialTypes(email)).toEqual([]);

        // KC-01 on the half-created account: a fresh sign-in with the username alone
        // must never issue a code, and offers neither a password nor enrolment.
        await context.clearCookies();
        const login = pkce();
        await page.goto(authUrl(login.challenge));
        await page.locator('input[name="username"]').fill(email);
        await submitForm(page, '#kc-login, [type="submit"]');
        expect(codes).toHaveLength(0);
        await expect(page.locator('input[name="password"]')).toHaveCount(0);
        await expect(page.locator('#registerWebAuthn')).toHaveCount(0);
        await expect(page.locator('#kc-error-message, .alert-error').first()).toContainText(/invalid username or password/i);
      } finally {
        await context.close();
        await kcAdmin.deleteUser(email);
      }
    });

    test('a password smuggled into the registration POST is ignored', async ({ page, kcAdmin }) => {
      const email = uniqueEmail('reg-smuggle');
      const { challenge } = pkce();
      try {
        await page.goto(registrationUrl(challenge));
        await expect(page.locator('#kc-register-form')).toBeVisible();
        await page.evaluate(() => {
          const form = document.getElementById('kc-register-form') as HTMLFormElement;
          for (const name of ['password', 'password-confirm']) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = 'Smuggled-Password-123!';
            form.appendChild(input);
          }
        });
        await fillRegistration(page, email);
        await expect(page.locator('#registerWebAuthn')).toBeVisible();
        expect(await kcAdmin.credentialTypes(email)).toEqual([]);
      } finally {
        await kcAdmin.deleteUser(email);
      }
    });

    test('duplicate e-mail: Keycloak refuses with its standard message (documented enumeration)', async ({ page, kcAdmin }) => {
      const email = uniqueEmail('reg-dup');
      await kcAdmin.createUser(email, 'Existing-User-Pw-1!');
      const { challenge } = pkce();
      try {
        const codes = trackCodes(page);
        await page.goto(registrationUrl(challenge));
        await fillRegistration(page, email.toUpperCase()); // case-insensitive
        await expect(page.locator('#kc-register-form')).toBeVisible();
        await expect(page.locator('#input-error-email, #kc-register-form .kc-feedback-text, .alert-error').first()).toContainText(/email already exists/i);
        expect(codes).toHaveLength(0);
        expect(await kcAdmin.credentialTypes(email)).toEqual(['password']); // untouched
      } finally {
        await kcAdmin.deleteUser(email);
      }
    });

    test('registration disabled: the registration endpoint and form refuse', async ({ page, request }) => {
      test.fixme(!MASTER_PW_FILE && !REQUIRE_KC, 'needs KC_MASTER_ADMIN_PASSWORD_FILE (throwaway Keycloak) to toggle the realm');
      expect(MASTER_PW_FILE, 'KC_MASTER_ADMIN_PASSWORD_FILE').not.toBe('');
      const { challenge } = pkce();
      // Load the form while open, then close registration: the pending form must not post.
      await page.goto(registrationUrl(challenge));
      await expect(page.locator('#kc-register-form')).toBeVisible();
      await setRegistrationAllowed(request, false);
      try {
        const email = uniqueEmail('reg-closed');
        await page.locator('input[name="email"]').fill(email);
        await submitForm(page, '#kc-register-form [type="submit"]');
        await expect(page.locator('#registerWebAuthn')).toHaveCount(0);
        await expect(page.locator('body')).toContainText(/registration not allowed/i);

        const fresh = await request.get(registrationUrl(pkce().challenge), { maxRedirects: 0 });
        expect(await fresh.text()).toMatch(/registration not allowed/i);
        expect(await fresh.text()).not.toContain('kc-register-form');
        // The login page no longer links to registration.
        await page.goto(authUrl(pkce().challenge));
        await expect(page.locator('a[href*="registration"]')).toHaveCount(0);
      } finally {
        await setRegistrationAllowed(request, true);
      }
    });
  });

  test.describe('with the backend (e-mail code + recovery)', () => {
    test.beforeEach(async ({ request }) => {
      const health = API_URL ? await request.get(`${API_URL}/api/health`, { timeout: 5000 }).catch(() => null) : null;
      const up = !!health?.ok();
      test.fixme(!up && !REQUIRE_BACKEND, 'needs the backend with /api/auth/email-verify and /api/auth/recovery (E2E_API_URL); keycloak-flow.yml runs Keycloak only');
      expect(up, `backend at ${API_URL || '(E2E_API_URL unset)'}`).toBe(true);
    });

    test('sign-up → API refuses (403 email_not_verified) → 6-digit code by e-mail → API unlocked', async ({ page, request, kcAdmin, browserName }) => {
      test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
      const email = uniqueEmail('reg-otp');
      const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
      const { verifier, challenge } = pkce();
      try {
        const codes = trackCodes(page);
        await page.goto(registrationUrl(challenge));
        await fillRegistration(page, email);
        await page.locator('#registerWebAuthn').click();
        await expect.poll(() => codes.length).toBe(1);
        const token = (await exchangeCode(request, codes[0]!, verifier))['access_token'] as string;
        const auth = { Authorization: `Bearer ${token}` };

        const me = await request.get(`${API_URL}/api/users/me`, { headers: auth });
        expect(me.ok()).toBe(true);
        expect(((await me.json()) as { data: { email_verified: boolean } }).data.email_verified).toBe(false);
        const trips = await request.get(`${API_URL}/api/trips`, { headers: auth });
        expect(trips.status()).toBe(403);
        expect(JSON.stringify(await trips.json())).toContain('email_not_verified');

        expect((await request.post(`${API_URL}/api/auth/email-verify/request`, { headers: auth })).ok()).toBe(true);
        const code = await latestCode(request, email);
        const confirm = await request.post(`${API_URL}/api/auth/email-verify/confirm`, { headers: auth, data: { code } });
        expect(confirm.ok(), await confirm.text()).toBe(true);
        // Single use.
        const replay = await request.post(`${API_URL}/api/auth/email-verify/confirm`, { headers: auth, data: { code } });
        expect(replay.ok()).toBe(false);

        expect((await request.get(`${API_URL}/api/trips`, { headers: auth })).ok()).toBe(true);
      } finally {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
        await kcAdmin.deleteUser(email);
      }
    });

    test('passkey-only user on a device without WebAuthn: recovery code → new password → signs in with it', async ({ browser, request, kcAdmin, browserName }) => {
      test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
      const email = uniqueEmail('reg-recover');
      const newPassword = `Recovered-${crypto.randomBytes(6).toString('hex')}`;
      const phone = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const old = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      await withoutWebAuthn(old);
      try {
        // Sign up with a passkey on a capable device.
        const p = await phone.newPage();
        const { cdp } = await addVirtualAuthenticator(p);
        const phoneCodes = trackCodes(p);
        await p.goto(registrationUrl(pkce().challenge));
        await fillRegistration(p, email);
        await p.locator('#registerWebAuthn').click();
        await expect.poll(() => phoneCodes.length).toBe(1);
        await cdp.detach();
        expect(await kcAdmin.credentialTypes(email)).toEqual(['webauthn-passwordless']);

        // Unknown and known addresses get the same answer (anti-enumeration).
        const unknown = await request.post(`${API_URL}/api/auth/recovery/request`, { data: { email: uniqueEmail('nobody') } });
        const known = await request.post(`${API_URL}/api/auth/recovery/request`, { data: { email } });
        expect(known.status()).toBe(202);
        expect(unknown.status()).toBe(202);
        expect(await unknown.text()).toBe(await known.text());

        const code = await latestCode(request, email);
        const confirm = await request.post(`${API_URL}/api/auth/recovery/confirm`, { data: { email, code, new_password: newPassword } });
        expect(confirm.ok(), await confirm.text()).toBe(true);
        expect((await kcAdmin.credentialTypes(email)).sort()).toEqual(['password', 'webauthn-passwordless']);

        // The old device: passkey step → "Try another way" → password.
        const page = await old.newPage();
        const codes = trackCodes(page);
        await page.goto(authUrl(pkce().challenge));
        await page.locator('input[name="username"]').fill(email);
        await submitForm(page, '#kc-login, [type="submit"]');
        await expect(page.locator('#jp-passkey-recovery')).toHaveClass(/jp-passkey-recovery--primary/);
        await submitForm(page, '#try-another-way');
        await submitForm(page, '#kc-select-credential-form button:not(:has-text("Passkey"))');
        await page.locator('input[name="password"]').fill(newPassword);
        await submitForm(page, '#kc-login, [type="submit"]');
        await expect.poll(() => codes.length).toBe(1);
      } finally {
        await phone.close();
        await old.close();
        await kcAdmin.deleteUser(email);
      }
    });
  });
});
