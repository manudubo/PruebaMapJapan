import { expect, test } from './fixtures/kc-admin';
import type { CDPSession, Page } from '@playwright/test';
import crypto from 'node:crypto';

/**
 * KC-01 / SEC-12 — browser-passkey authentication flow contract.
 *
 * Drives Keycloak directly (no frontend/backend needed): requests to the app redirect
 * URI are only observed, so the thing under test is the realm's browser flow as defined
 * in terraform/keycloak/flows.tf.
 *
 * Before Phase 26, REQUIRED auth-username-form sat next to an ALTERNATIVE webauthn
 * execution; Keycloak ignored the webauthn step and issued an authorization code after
 * the username form alone — for any user, including one with no credentials, and it also
 * let a username-only visitor reach passkey registration (account takeover). The
 * negative tests below reproduce each of those paths and fail against the old flow.
 *
 * Tests that need throwaway users use the kcAdmin fixture and are fixme without
 * KC_ADMIN_CLIENT_ID/SECRET; the others only need a reachable Keycloak with the
 * Terraform-seeded e2e-test@local user. With CI_KEYCLOAK=1 every precondition is
 * required instead (scripts/ci/keycloak-flow.sh provides them).
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REDIRECT_URI = 'http://localhost:5173/PruebaMapJapan/dashboard.html';
const CODE_VERIFIER = 'phase26-idp-flow-negative-test-verifier-value-0000000';
const CODE_CHALLENGE = crypto.createHash('sha256').update(CODE_VERIFIER).digest('base64url');
const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;
/**
 * Set by .github/workflows/keycloak-flow.yml, which starts Keycloak and applies the realm.
 * There, a missing Keycloak or missing credentials is a broken job and must FAIL; locally
 * the same conditions only mark the test fixme (nothing to run against).
 */
const REQUIRE_KC = process.env.CI_KEYCLOAK === '1';
const SEEDED_USER = process.env.E2E_TEST_USERNAME ?? 'e2e-test@local';

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

/**
 * Submit the current Keycloak form (Enter in its visible text/password input) and wait
 * until Keycloak has answered the POST (success redirect or re-rendered form).
 * Waiting on the POST response keeps this deterministic across browsers — waiting on
 * load state alone returns immediately on the still-loaded current page, and in Firefox
 * a button click right after fill() was occasionally dropped (~1 in 30 runs).
 */
async function clickSubmit(page: Page): Promise<void> {
  const input = page.locator('input[name="password"]:visible, input[name="username"]:visible').last();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
    input.press('Enter'),
  ]);
}

async function submitUsername(page: Page, username: string, extra = ''): Promise<void> {
  await page.goto(authUrl(extra));
  const usernameField = page.locator('input[name="username"]');
  await expect(usernameField).toBeVisible();
  // The username step must not ask for a password — that is the passkey-forms shape.
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
  await usernameField.fill(username);
  await clickSubmit(page);
  await page.waitForLoadState('domcontentloaded');
}

async function submitPassword(page: Page, password: string): Promise<void> {
  const passwordField = page.locator('input[name="password"]');
  await expect(passwordField).toBeVisible();
  await passwordField.fill(password);
  await clickSubmit(page);
  await page.waitForLoadState('domcontentloaded');
}

/** Action URL of the form currently rendered by Keycloak. */
async function formAction(page: Page): Promise<string> {
  const action = await page.locator('form[action*="login-actions"]').first().getAttribute('action');
  expect(action, 'expected a Keycloak login-actions form').toBeTruthy();
  return action!;
}

const executionOf = (actionUrl: string) => new URL(actionUrl).searchParams.get('execution') ?? '';

/**
 * POST a hand-crafted form to a Keycloak action URL in the page's cookie context,
 * without following redirects. Returns true if Keycloak redirected to the app with a code.
 */
async function postYieldsCode(page: Page, url: string, form: Record<string, string>): Promise<boolean> {
  const response = await page.request.post(url, { form, maxRedirects: 0, failOnStatusCode: false });
  const location = response.headers()['location'] ?? '';
  return location.startsWith(REDIRECT_URI) && new URL(location).searchParams.has('code');
}

function uniqueUser(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@local`;
}

// Satisfies the realm password policy: length(8) upperCase(1) digits(1) specialChars(1)
const THROWAWAY_PASSWORD = 'Idp-Flow-Test-1!';

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

/** Enrol a passkey for `username` (password login + application-initiated action). */
async function enrolPasskey(page: Page, hits: URL[], username: string, password: string): Promise<void> {
  await submitUsername(page, username, '&kc_action=webauthn-register-passwordless');
  await submitPassword(page, password);
  // The redirect to the app must have committed (app page, or an error page when no
  // frontend runs) before the caller navigates again; seeing the request is not enough,
  // the still-pending redirect would interrupt the caller's next page.goto().
  const leftKeycloak = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame() && !frame.url().startsWith(KEYCLOAK_URL),
  });
  await page.locator('#registerWebAuthn').click();
  await leftKeycloak;
  await expect.poll(() => issuedCode(hits)).toBe(true);
  await page.context().clearCookies(); // drop the SSO session, keep the authenticator
  hits.length = 0;
}

test.describe('Keycloak browser flow (KC-01 / SEC-12)', () => {
  // Empty storage state: the chromium project inherits an SSO cookie that would skip the form.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request }) => {
    const response = await request
      .get(`${KEYCLOAK_URL}/realms/japan-trip`, { timeout: 5000 })
      .catch(() => null);
    const up = !!response?.ok();
    test.fixme(!up && !REQUIRE_KC, 'needs Keycloak with the japan-trip realm (keycloak/README.md); CI runs it in keycloak-flow.yml');
    expect(up, `realm japan-trip not reachable at ${KEYCLOAK_URL}`).toBe(true);
  });

  test.describe('without admin credentials (seeded user)', () => {
    test('username alone never authenticates the seeded user', async ({ page }) => {
      const hits = trackAppRedirects(page);
      await submitUsername(page, SEEDED_USER);
      expect(issuedCode(hits)).toBe(false);
      expect(page.url()).toContain(KEYCLOAK_URL);
      await expect(page.locator('input[name="password"]')).toBeVisible();
    });

    test('unknown username is rejected', async ({ page }) => {
      const hits = trackAppRedirects(page);
      await submitUsername(page, uniqueUser('idp-flow-does-not-exist'));
      expect(issuedCode(hits)).toBe(false);
      expect(page.url()).toContain(KEYCLOAK_URL);
    });

    test('passkey registration is not reachable with a username only', async ({ page }) => {
      // Old flow: username → required action "register passkey" → attacker's passkey on the victim account.
      const hits = trackAppRedirects(page);
      await submitUsername(page, SEEDED_USER, '&kc_action=webauthn-register-passwordless');
      await expect(page.locator('#registerWebAuthn')).toHaveCount(0);
      expect(page.url()).not.toContain('required-action');
      await expect(page.locator('input[name="password"]')).toBeVisible();
      expect(issuedCode(hits)).toBe(false);
    });

    test('tampered password-step submissions do not skip the credential', async ({ page }) => {
      const hits = trackAppRedirects(page);
      await page.goto(authUrl());
      const usernameExecution = executionOf(await formAction(page));
      await page.locator('input[name="username"]').fill(SEEDED_USER);
      await clickSubmit(page);
      await page.waitForLoadState('domcontentloaded');
      const passwordAction = await formAction(page);
      const passwordExecution = executionOf(passwordAction);

      const attempts: Array<[string, Record<string, string>]> = [
        ['no password field', {}],
        ['empty password', { password: '' }],
        ['select password execution, no password', { authenticationExecution: passwordExecution }],
        ['select username execution, no password', { authenticationExecution: usernameExecution }],
        ['re-post username only', { username: SEEDED_USER }],
      ];
      for (const [label, form] of attempts) {
        expect(await postYieldsCode(page, passwordAction, form), label).toBe(false);
      }
      const usernameStepUrl = passwordAction.replace(/execution=[^&]*/, `execution=${usernameExecution}`);
      expect(await postYieldsCode(page, usernameStepUrl, { username: SEEDED_USER }), 'jump back to username step').toBe(false);
      expect(issuedCode(hits)).toBe(false);
    });

    test('password fallback works for the seeded user', async ({ page, kcAdmin }) => {
      const password = process.env.E2E_TEST_PASSWORD;
      test.fixme(!password && !REQUIRE_KC, 'needs E2E_TEST_PASSWORD (the Terraform e2e_test_password)');
      expect(password, 'E2E_TEST_PASSWORD').toBeTruthy();
      if (HAS_ADMIN) await kcAdmin.resetCredentials(SEEDED_USER); // drop any passkey from other specs
      const hits = trackAppRedirects(page);
      await submitUsername(page, SEEDED_USER);
      await submitPassword(page, password!);
      await expect.poll(() => issuedCode(hits)).toBe(true);
    });
  });

  test.describe('with throwaway users (admin credentials)', () => {
    test.beforeEach(() => {
      test.fixme(!HAS_ADMIN && !REQUIRE_KC, 'needs KC_ADMIN_CLIENT_ID/SECRET (a client with realm-management manage-users)');
      expect(HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET').toBe(true);
    });

    async function createThrowaway(
      kcAdmin: { createUser: (u: string, p: string | null) => Promise<void>; clearRequiredActions: (u: string) => Promise<void> },
      prefix: string,
      password: string | null,
    ): Promise<string> {
      const username = uniqueUser(prefix);
      await kcAdmin.createUser(username, password);
      await kcAdmin.clearRequiredActions(username); // drop default VERIFY_EMAIL
      return username;
    }

    test('password user: username alone and empty password never authenticate', async ({ page, kcAdmin }) => {
      const username = await createThrowaway(kcAdmin, 'idp-flow-pw', THROWAWAY_PASSWORD);
      try {
        const hits = trackAppRedirects(page);
        await submitUsername(page, username);
        expect(issuedCode(hits)).toBe(false);
        await expect(page.locator('input[name="password"]')).toBeVisible();
        await clickSubmit(page);
        await page.waitForLoadState('domcontentloaded');
        expect(issuedCode(hits)).toBe(false);
        expect(page.url()).toContain(KEYCLOAK_URL);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('password user: wrong password and another user’s password are rejected', async ({ page, kcAdmin }) => {
      const username = await createThrowaway(kcAdmin, 'idp-flow-wrongpw', THROWAWAY_PASSWORD);
      try {
        const hits = trackAppRedirects(page);
        await submitUsername(page, username);
        await submitPassword(page, 'Wrong-Password-1!');
        expect(issuedCode(hits)).toBe(false);
        await submitPassword(page, process.env.E2E_TEST_PASSWORD ?? 'Another-User-Pw-1!');
        expect(issuedCode(hits)).toBe(false);
        // The correct one still works in the same session afterwards.
        await submitPassword(page, THROWAWAY_PASSWORD);
        await expect.poll(() => issuedCode(hits)).toBe(true);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('user with no credential at all is rejected after the username step', async ({ page, kcAdmin }) => {
      const username = await createThrowaway(kcAdmin, 'idp-flow-nocred', null);
      try {
        const hits = trackAppRedirects(page);
        await submitUsername(page, username);
        expect(issuedCode(hits)).toBe(false);
        expect(page.url()).toContain(KEYCLOAK_URL);
        // Neither a password form nor a passkey registration prompt may be offered.
        await expect(page.locator('input[name="password"]')).toHaveCount(0);
        await expect(page.locator('#registerWebAuthn, #kc-form-webauthn')).toHaveCount(0);
        expect(page.url()).not.toMatch(/required-action/);
        await expect(page.locator('#kc-error-message')).toContainText(/invalid username or password/i);

        // Same through the passkey-registration entry point.
        await submitUsername(page, username, '&kc_action=webauthn-register-passwordless');
        await expect(page.locator('#registerWebAuthn')).toHaveCount(0);
        expect(issuedCode(hits)).toBe(false);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('disabled user is rejected even with the correct password', async ({ page, kcAdmin }) => {
      const username = await createThrowaway(kcAdmin, 'idp-flow-disabled', THROWAWAY_PASSWORD);
      await kcAdmin.setUserEnabled(username, false);
      try {
        const hits = trackAppRedirects(page);
        await submitUsername(page, username);
        if (await page.locator('input[name="password"]').count()) {
          await submitPassword(page, THROWAWAY_PASSWORD);
        }
        expect(issuedCode(hits)).toBe(false);
        expect(page.url()).toContain(KEYCLOAK_URL);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('password fallback works for a user without a passkey', async ({ page, kcAdmin }) => {
      const username = await createThrowaway(kcAdmin, 'idp-flow-fallback', THROWAWAY_PASSWORD);
      try {
        const hits = trackAppRedirects(page);
        await submitUsername(page, username);
        await submitPassword(page, THROWAWAY_PASSWORD);
        await expect.poll(() => issuedCode(hits)).toBe(true);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test.describe('passkey users (Chromium virtual authenticator)', () => {
      test.beforeEach(({ browserName }) => {
        // Not a defect to fix in the app: Playwright exposes WebAuthn virtual authenticators
        // only through Chromium's CDP. Firefox still runs every non-passkey case above.
        test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
      });

      test('passkey user gets the WebAuthn step and signs in with it', async ({ page, kcAdmin }) => {
        const username = await createThrowaway(kcAdmin, 'idp-flow-passkey', THROWAWAY_PASSWORD);
        const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
        try {
          const hits = trackAppRedirects(page);
          await enrolPasskey(page, hits, username, THROWAWAY_PASSWORD);

          await submitUsername(page, username);
          expect(issuedCode(hits)).toBe(false);
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

      test('passkey user cannot swap the WebAuthn step for a password or a forged assertion', async ({ page, kcAdmin }) => {
        const username = await createThrowaway(kcAdmin, 'idp-flow-swap', THROWAWAY_PASSWORD);
        const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
        try {
          const hits = trackAppRedirects(page);
          // Capture the Password Form execution id while the user still has no passkey.
          await submitUsername(page, username);
          const passwordExecution = executionOf(await formAction(page));
          await page.context().clearCookies();
          await enrolPasskey(page, hits, username, THROWAWAY_PASSWORD);

          await submitUsername(page, username);
          await expect(page.locator('#authenticateWebAuthnButton')).toBeVisible();
          const webauthnAction = await formAction(page);
          const attempts: Array<[string, string, Record<string, string>]> = [
            ['correct password posted to the WebAuthn step', webauthnAction, { password: THROWAWAY_PASSWORD }],
            ['select Password Form + correct password', webauthnAction, { authenticationExecution: passwordExecution, password: THROWAWAY_PASSWORD }],
            ['action execution=Password Form + correct password', webauthnAction.replace(/execution=[^&]*/, `execution=${passwordExecution}`), { password: THROWAWAY_PASSWORD }],
            ['forged assertion', webauthnAction, { clientDataJSON: 'e30', authenticatorData: 'AAAA', signature: 'AAAA', credentialId: 'AAAA', userHandle: 'AAAA' }],
            ['WebAuthn error (user cancelled)', webauthnAction, { error: 'NotAllowedError' }],
          ];
          for (const [label, url, form] of attempts) {
            expect(await postYieldsCode(page, url, form), label).toBe(false);
          }
          expect(issuedCode(hits)).toBe(false);
        } finally {
          await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
          await kcAdmin.deleteUser(username);
        }
      });

      test('WebAuthn without a matching credential on the device does not authenticate', async ({ page, kcAdmin }) => {
        const username = await createThrowaway(kcAdmin, 'idp-flow-lostkey', THROWAWAY_PASSWORD);
        const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
        try {
          const hits = trackAppRedirects(page);
          await enrolPasskey(page, hits, username, THROWAWAY_PASSWORD);
          await cdp.send('WebAuthn.clearCredentials', { authenticatorId }); // "lost device"

          await submitUsername(page, username);
          // No credential on the authenticator: navigator.credentials.get() rejects and
          // Keycloak's page posts the error back to the WebAuthn step. Wait for that POST
          // (the outcome) instead of sleeping.
          await Promise.all([
            page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
            page.locator('#authenticateWebAuthnButton').click(),
          ]);
          await page.waitForLoadState('domcontentloaded');
          expect(issuedCode(hits)).toBe(false);
          expect(page.url()).toContain(KEYCLOAK_URL);
        } finally {
          await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
          await kcAdmin.deleteUser(username);
        }
      });

      test('passkey-only user (no password) signs in with the passkey; username alone is rejected', async ({ page, kcAdmin }) => {
        const username = await createThrowaway(kcAdmin, 'idp-flow-pkonly', THROWAWAY_PASSWORD);
        const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
        try {
          const hits = trackAppRedirects(page);
          await enrolPasskey(page, hits, username, THROWAWAY_PASSWORD);
          await kcAdmin.removeCredentials(username, ['password']);

          await submitUsername(page, username);
          expect(issuedCode(hits)).toBe(false);
          await expect(page.locator('input[name="password"]')).toHaveCount(0);
          await page.locator('#authenticateWebAuthnButton').click();
          await expect.poll(() => issuedCode(hits)).toBe(true);
        } finally {
          await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
          await kcAdmin.deleteUser(username);
        }
      });
    });
  });
});
