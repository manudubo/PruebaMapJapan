import { test, expect, type Page, type Request } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import {
  mockAccountCredentials,
  mockAuthFlows,
  WEBAUTHN_SUPPORTED,
  WEBAUTHN_UNSUPPORTED,
} from './fixtures/mockAuthFlows';

/**
 * @qa-noauth: sign-up entry points, email verification screen, new-user passkey onboarding and
 * account recovery (recover.html), against fake Keycloak / API fixtures.
 *
 * The build under test needs a Keycloak URL, otherwise "Sign up" is (correctly) not rendered:
 *   VITE_API_URL=http://localhost:8787/api VITE_KEYCLOAK_URL=http://localhost:8080 npm run build
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test registration-ui --project=chromium
 */

const CODE = '123456';
const LOGGED_OUT = { cookies: [], origins: [] };

const isKeycloakNavigation = (path: string) => (r: Request) =>
  r.isNavigationRequest() && r.frame() === r.frame().page().mainFrame() && r.url().includes(path);

/** The verification screen's pieces. */
const verify = (page: Page) => ({
  heading: page.getByRole('heading', { name: 'Verify your email' }),
  digits: page.locator('.code-input-digit'),
  error: page.locator('#verify-email-error'),
  status: page.locator('#verify-email-status'),
  resend: page.locator('#verify-email-resend'),
  submit: page.locator('#verify-email-submit'),
  other: page.locator('#verify-email-other-account'),
});

async function signedInDashboard(
  page: Page,
  opts: {
    verified?: boolean;
    asNew?: boolean;
    webauthn?: 'supported' | 'unsupported';
    passkeys?: number;
    passwords?: number;
    me?: Record<string, unknown>;
    flows?: Parameters<typeof mockAuthFlows>[1];
  } = {},
) {
  const verification = { verified: opts.verified ?? true };
  await page.addInitScript(opts.webauthn === 'unsupported' ? WEBAUTHN_UNSUPPORTED : WEBAUTHN_SUPPORTED);
  await mockKeycloakLoggedIn(page);
  await mockAccountCredentials(page, { passkeys: opts.passkeys ?? 0, passwords: opts.passwords ?? 1 });
  const api = await mockApi(page, {
    trips: [],
    verification,
    me: { onboarding: { is_new: opts.asNew ?? false }, ...opts.me },
  });
  const flows = await mockAuthFlows(page, { code: CODE, verification, ...opts.flows });
  return { verification, api, flows };
}

// ---------------------------------------------------------------------------
// Sign up entry points
// ---------------------------------------------------------------------------

test.describe('@qa-noauth sign-up entry points', () => {
  test.use({ storageState: LOGGED_OUT });

  test('landing: Sign up and Sign in sit side by side in the navbar', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('');
    const nav = page.locator('travel-nav');
    await expect(nav.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('Sign up goes to the registration endpoint with a registered redirect_uri and no query string', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('');
    const nav = page.locator('travel-nav');
    const registration = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/registrations'));
    await nav.getByRole('button', { name: 'Sign up' }).click();
    const url = new URL((await registration).url());
    const redirectUri = new URL(url.searchParams.get('redirect_uri')!);
    expect(redirectUri.search, 'redirect_uri must not carry a query string').toBe('');
    expect(redirectUri.hash).toBe('');
    expect(redirectUri.pathname).toMatch(/\/PruebaMapJapan\/(dashboard|profile|index)\.html$/);
    await expect(page.locator('#mock-kc')).toBeVisible();
  });

  test('Sign up from a page with a query string still sends a clean redirect_uri', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedOut(page);
    await page.goto('trip.html?tripId=1');
    const registration = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/registrations'));
    await page.getByRole('button', { name: 'Sign up' }).first().click();
    const redirectUri = new URL(new URL((await registration).url()).searchParams.get('redirect_uri')!);
    expect(redirectUri.search).toBe('');
    expect(redirectUri.pathname).toBe('/PruebaMapJapan/dashboard.html');
  });

  test('dashboard prompt offers Sign up and Sign in, plus the recovery link', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedOut(page);
    await page.goto('dashboard.html');
    await expect(page.locator('#auth-signup-prompt-btn')).toBeVisible();
    await expect(page.locator('#auth-login-prompt-btn')).toBeVisible();
    await expect(page.getByRole('link', { name: /Recover your account/ })).toHaveAttribute('href', 'recover.html');
  });
});

// ---------------------------------------------------------------------------
// Email verification screen
// ---------------------------------------------------------------------------

test.describe('@qa-noauth email verification screen', () => {
  test.use({ storageState: LOGGED_OUT });

  test('happy path: 403 from the API -> screen -> code -> dashboard loads', async ({ page }) => {
    const { flows } = await signedInDashboard(page, { verified: false, asNew: true, webauthn: 'unsupported', passwords: 1 });
    await page.goto('dashboard.html');
    const v = verify(page);
    await expect(v.heading).toBeVisible();
    await expect(page.locator('#verify-email-body')).toContainText('test@example.com');
    await expect(v.digits).toHaveCount(6);
    await expect(v.digits.first()).toBeFocused();
    await expect(v.digits.first()).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(v.digits.first()).toHaveAttribute('inputmode', 'numeric');
    await expect.poll(() => flows.filter((c) => c.path === '/auth/email-verify/request').length).toBe(1);

    await page.keyboard.type(CODE);
    await expect(v.heading).toBeHidden();
    await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
    expect(flows.filter((c) => c.path === '/auth/email-verify/confirm')).toHaveLength(1);
    expect(flows.find((c) => c.path === '/auth/email-verify/confirm')!.body).toEqual({ code: CODE });
  });

  test('the email_verified=false flag alone also shows the screen', async ({ page }) => {
    await signedInDashboard(page, { verified: true, me: { email_verified: false } });
    await page.goto('dashboard.html');
    await expect(verify(page).heading).toBeVisible();
  });

  test('a code pasted with spaces and dashes is accepted', async ({ page }) => {
    const { flows } = await signedInDashboard(page, { verified: false });
    await page.goto('dashboard.html');
    const v = verify(page);
    await expect(v.heading).toBeVisible();
    await v.digits.first().evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData('text', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, '123 - 456');
    await expect(v.heading).toBeHidden();
    expect(flows.find((c) => c.path === '/auth/email-verify/confirm')!.body).toEqual({ code: CODE });
  });

  test('wrong code: announced error with attempts left, boxes cleared, then the right code works', async ({ page }) => {
    await signedInDashboard(page, { verified: false });
    await page.goto('dashboard.html');
    const v = verify(page);
    await expect(v.digits.first()).toBeFocused();
    await page.keyboard.type('000000');
    await expect(v.error).toHaveText("That code isn't right. Attempts left: 4.");
    await expect(v.error).toHaveAttribute('role', 'alert');
    await expect(v.digits.first()).toBeFocused();
    await expect(v.digits.first()).toHaveValue('');
    await expect(v.digits.first()).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.type(CODE);
    await expect(v.heading).toBeHidden();
  });

  test('expired code: says so and Resend is offered', async ({ page }) => {
    await signedInDashboard(page, {
      verified: false,
      flows: { verifyConfirm: () => ({ status: 410, body: { success: false, code: 'code_expired' } }) },
    });
    await page.goto('dashboard.html');
    await expect(verify(page).digits.first()).toBeFocused();
    await page.keyboard.type(CODE);
    await expect(verify(page).error).toHaveText('That code has expired. Request a new one.');
  });

  test('429 on confirm shows the wait', async ({ page }) => {
    await signedInDashboard(page, {
      verified: false,
      flows: { verifyConfirm: () => ({ status: 429, body: { code: 'rate_limited', retryAfter: 40 } }) },
    });
    await page.goto('dashboard.html');
    await expect(verify(page).digits.first()).toBeFocused();
    await page.keyboard.type(CODE);
    await expect(verify(page).error).toHaveText('Too many requests. Try again in 40s.');
  });

  test('resend cooldown is visible, survives a reload, and ends', async ({ page }) => {
    const { flows } = await signedInDashboard(page, {
      verified: false,
      // The server asks for a 3 s wait: long enough to observe, short enough to wait for.
      flows: { verifyRequest: () => ({ status: 200, body: { success: true, retryAfter: 3 } }) },
    });
    await page.goto('dashboard.html');
    const v = verify(page);
    await expect(v.resend).toBeDisabled();
    await expect(v.resend).toHaveText(/Resend code in [1-3]s/);

    await page.reload();
    await expect(v.heading).toBeVisible();
    await expect(v.resend).toBeDisabled();
    // The reload did not ask for another code.
    expect(flows.filter((c) => c.path === '/auth/email-verify/request')).toHaveLength(1);

    await expect(v.resend).toBeEnabled({ timeout: 8000 });
    await expect(v.resend).toHaveText('Resend code');
    await v.resend.click();
    await expect(v.status).toHaveText('We sent you a new code.');
    expect(flows.filter((c) => c.path === '/auth/email-verify/request')).toHaveLength(2);
    await expect(v.resend).toBeDisabled();
  });

  test('a 429 on the automatic first request is silent but starts the countdown', async ({ page }) => {
    await signedInDashboard(page, {
      verified: false,
      flows: { verifyRequest: () => ({ status: 429, body: { code: 'rate_limited', retryAfter: 30 } }) },
    });
    await page.goto('dashboard.html');
    const v = verify(page);
    await expect(v.resend).toHaveText(/Resend code in (29|30)s/);
    await expect(v.error).toHaveText('');
  });

  test('double submit (Verify button after the code completed) sends one confirm request', async ({ page }) => {
    const { flows } = await signedInDashboard(page, { verified: false, flows: { confirmDelayMs: 400 } });
    await page.goto('dashboard.html');
    const v = verify(page);
    await expect(v.digits.first()).toBeFocused();
    await page.keyboard.type(CODE);
    await v.submit.click({ force: true });
    await expect(v.heading).toBeHidden();
    expect(flows.filter((c) => c.path === '/auth/email-verify/confirm')).toHaveLength(1);
  });

  test('"Use a different account" signs out', async ({ page }) => {
    await signedInDashboard(page, { verified: false });
    await page.goto('dashboard.html');
    const logout = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/logout'));
    await verify(page).other.click();
    const url = new URL((await logout).url());
    const target = url.searchParams.get('post_logout_redirect_uri') ?? url.searchParams.get('redirect_uri') ?? '';
    expect(target).toMatch(/\/PruebaMapJapan\/index\.html$/);
  });

  test('two tabs: verifying in one clears the screen in the other', async ({ page, context }) => {
    const { verification } = await signedInDashboard(page, { verified: false });
    await page.goto('dashboard.html');
    await expect(verify(page).heading).toBeVisible();

    const second = await context.newPage();
    await second.addInitScript(WEBAUTHN_SUPPORTED);
    await mockKeycloakLoggedIn(second);
    await mockAccountCredentials(second);
    await mockApi(second, { trips: [], verification, me: { onboarding: { is_new: false } } });
    await mockAuthFlows(second, { code: CODE, verification });
    await second.goto('dashboard.html');
    await expect(verify(second).heading).toBeVisible();
    // The second tab shares the resend cooldown instead of requesting another code.
    await expect(verify(second).resend).toBeDisabled();

    await second.keyboard.type(CODE);
    await expect(verify(second).heading).toBeHidden();
    await expect(verify(page).heading).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// New-user passkey onboarding
// ---------------------------------------------------------------------------

test.describe('@qa-noauth new-user passkey onboarding', () => {
  test.use({ storageState: LOGGED_OUT });

  const dialog = (page: Page) => page.getByRole('dialog');

  test('a just-registered user on a capable device is offered a passkey', async ({ page }) => {
    await signedInDashboard(page, { asNew: true });
    await page.goto('dashboard.html');
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d).toHaveAccessibleName('Welcome! Sign in faster with a passkey');
    await expect(d.getByRole('button', { name: 'Create a passkey' })).toBeFocused();
    await expect(d.getByRole('button', { name: 'Not now' })).toBeVisible();
    await expect(d.getByRole('button', { name: "Don't ask again" })).toBeVisible();
  });

  test('focus is trapped in the dialog and Escape is "Not now", returning focus', async ({ page }) => {
    await signedInDashboard(page, { asNew: true });
    await page.goto('dashboard.html');
    const d = dialog(page);
    await expect(d).toBeVisible();
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      expect(await d.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await d.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    // Background is usable again
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  });

  test('"Not now" is remembered in the account preferences and this browser (no second ask on reload)', async ({ page }) => {
    const { api } = await signedInDashboard(page, { asNew: true });
    await page.goto('dashboard.html');
    await dialog(page).getByRole('button', { name: 'Not now' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect
      .poll(() => api.filter((c) => c.method === 'PATCH' && c.path === '/users/me').length)
      .toBeGreaterThan(0);
    const patch = api.find((c) => c.method === 'PATCH' && c.path === '/users/me')!;
    expect(patch.body).toMatchObject({ preferences: { passkeyCampaign: { never: false, shown: 1 } } });
    expect((patch.body as { preferences: { passkeyCampaign: { snoozeUntil: number } } }).preferences.passkeyCampaign.snoozeUntil)
      .toBeGreaterThan(Date.now());

    await page.reload();
    await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('"Don\'t ask again" is permanent, even when the API forgets (local copy)', async ({ page }) => {
    const { api } = await signedInDashboard(page, { asNew: true });
    await page.goto('dashboard.html');
    await dialog(page).getByRole('button', { name: "Don't ask again" }).click();
    await expect
      .poll(() =>
        api.some(
          (c) => c.method === 'PATCH' && JSON.stringify(c.body).includes('"never":true'),
        ),
      )
      .toBe(true);
    // A fresh API that knows nothing (another backend, preferences wiped): the browser copy holds.
    await page.unroute('**/api/**');
    await mockApi(page, { trips: [], me: { onboarding: { is_new: true }, preferences: null } });
    await mockAuthFlows(page, { code: CODE });
    await page.reload();
    await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('"Create a passkey" starts Keycloak passkey registration', async ({ page }) => {
    await signedInDashboard(page, { asNew: true });
    await page.goto('dashboard.html');
    const authorize = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/auth'));
    await dialog(page).getByRole('button', { name: 'Create a passkey' }).click();
    const url = new URL((await authorize).url());
    expect(url.searchParams.get('kc_action')).toBe('webauthn-register-passwordless');
    expect(new URL(url.searchParams.get('redirect_uri')!).search).toBe('');
  });

  test('never for a user who already has a passkey', async ({ page }) => {
    await signedInDashboard(page, { asNew: true, passkeys: 1 });
    await page.goto('dashboard.html');
    await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('not for an existing user (no onboarding flag)', async ({ page }) => {
    await signedInDashboard(page, { asNew: false });
    await page.goto('dashboard.html');
    await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('without WebAuthn the same dialog suggests a backup password instead', async ({ page }) => {
    await signedInDashboard(page, { asNew: true, webauthn: 'unsupported', passwords: 0 });
    await page.goto('dashboard.html');
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d).toHaveAccessibleName('Set a password as a backup');
    await expect(d.getByRole('button', { name: 'Create a passkey' })).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.PublicKeyCredential)).toBe('undefined');
    const authorize = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/auth'));
    await d.getByRole('button', { name: 'Set a password' }).click();
    expect(new URL((await authorize).url()).searchParams.get('kc_action')).toBe('UPDATE_PASSWORD');
  });

  test('a platform check that says "no" is treated as unsupported', async ({ page }) => {
    await signedInDashboard(page, { asNew: true, passwords: 0 });
    await page.addInitScript(`window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);`);
    await page.goto('dashboard.html');
    await expect(dialog(page)).toHaveAccessibleName('Set a password as a backup');
  });

  test('no password suggestion when an unsupported device user already has a password', async ({ page }) => {
    await signedInDashboard(page, { asNew: true, webauthn: 'unsupported', passwords: 1 });
    await page.goto('dashboard.html');
    await expect(page.locator('#dashboard-greeting')).toContainText('Hello');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('profile: a passkey-only user is offered a backup password, once per week', async ({ page }) => {
    await signedInDashboard(page, { passkeys: 1, passwords: 0 });
    await page.goto('profile.html');
    const card = page.locator('#password-backup');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Add a password as a backup' })).toBeVisible();
    const authorize = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/auth'));
    await card.getByRole('button', { name: 'Add a password' }).click();
    expect(new URL((await authorize).url()).searchParams.get('kc_action')).toBe('UPDATE_PASSWORD');
  });

  test('profile: not shown to a user who has a password', async ({ page }) => {
    await signedInDashboard(page, { passkeys: 1, passwords: 1 });
    await page.goto('profile.html');
    await expect(page.locator('#profile-email')).toHaveText('test@example.com');
    await expect(page.locator('#password-backup')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// recover.html
// ---------------------------------------------------------------------------

test.describe('@qa-noauth recover.html', () => {
  test.use({ storageState: LOGGED_OUT });

  async function openRecover(page: Page, query = '', flows: Parameters<typeof mockAuthFlows>[1] = {}) {
    await mockKeycloakLoggedOut(page);
    const calls = await mockAuthFlows(page, { code: CODE, ...flows });
    await page.goto(`recover.html${query}`);
    return calls;
  }

  test('prefills ?email= and removes it from the address bar', async ({ page }) => {
    await openRecover(page, '?email=ana%40example.com');
    await expect(page.getByLabel('Email address')).toHaveValue('ana@example.com');
    expect(new URL(page.url()).search).toBe('');
  });

  test('happy path: email -> code and password -> done -> Sign in', async ({ page }) => {
    const calls = await openRecover(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Can't use your passkey?");
    await page.getByLabel('Email address').fill('ana@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();

    await expect(page.locator('#recover-sent')).toHaveText(
      'If an account exists for ana@example.com, we sent a 6-digit code to it. Enter it below with your new password.',
    );
    await expect(page.locator('.code-input-digit').first()).toBeFocused();
    await page.keyboard.type(CODE);

    // Live checklist
    const rules = page.locator('#recover-rules');
    await expect(rules.locator('[data-rule="length"]')).toContainText('not met');
    await page.getByLabel('New password', { exact: true }).fill('correct horse battery');
    await expect(rules.locator('[data-rule="length"]')).toContainText('(met)');
    await expect(rules.locator('[data-rule="match"]')).toContainText('not met');
    await page.getByLabel('Confirm new password').fill('correct horse battery');
    await expect(rules.locator('[data-rule="match"]')).toContainText('(met)');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your password is set');

    const confirm = calls.find((c) => c.path === '/auth/recovery/confirm')!;
    expect(confirm.body).toEqual({ email: 'ana@example.com', code: CODE, new_password: 'correct horse battery' });
    expect(page.url()).not.toMatch(/battery|123456/);

    const authorize = page.waitForRequest(isKeycloakNavigation('/protocol/openid-connect/auth'));
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await authorize;
  });

  test('anti-enumeration: any address gets the same screen and the same words', async ({ page }) => {
    await openRecover(page);
    const run = async (email: string) => {
      await page.getByLabel('Email address').fill(email);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.locator('#recover-sent')).toBeVisible();
      const copy = (await page.locator('#recover-root').innerText()).split(email).join('<email>');
      await page.getByRole('button', { name: 'Use a different email' }).click();
      return copy;
    };
    const known = await run('ana@example.com');
    await page.evaluate(() => localStorage.clear()); // drop the request cooldown for the second try
    await page.reload();
    const unknown = await run('nobody-here@example.com');
    expect(unknown).toBe(known);
  });

  test('a wrong code and an unknown account give the same message', async ({ page }) => {
    await openRecover(page);
    await page.getByLabel('Email address').fill('ghost@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.locator('#recover-sent')).toBeVisible();
    await page.keyboard.type('000000');
    await page.getByLabel('New password', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Confirm new password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.locator('#recover-error')).toHaveText("That code isn't valid or has expired. Check it, or request a new one.");
    await expect(page.locator('.code-input-digit').first()).toBeFocused();
  });

  test('a password that fails the checklist is not sent', async ({ page }) => {
    const calls = await openRecover(page);
    await page.getByLabel('Email address').fill('ana@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.locator('#recover-sent')).toBeVisible();
    await page.keyboard.type(CODE);
    await page.getByLabel('New password', { exact: true }).fill('too short');
    await page.getByLabel('Confirm new password').fill('too short');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.locator('#recover-error')).toHaveText("Your password doesn't meet the requirements yet.");
    expect(calls.filter((c) => c.path === '/auth/recovery/confirm')).toHaveLength(0);
  });

  test('429 on the code request shows a countdown that survives a reload', async ({ page }) => {
    const calls = await openRecover(page, '?email=ana%40example.com', {
      recoveryRequest: () => ({ status: 429, body: { code: 'rate_limited', retryAfter: 90 } }),
    });
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.locator('#recover-send')).toHaveText(/Send code in (89|90)s/);
    await expect(page.locator('#recover-send')).toBeDisabled();
    await expect(page.locator('#recover-email-error')).toContainText('Too many requests');
    await page.reload();
    await expect(page.locator('#recover-send')).toBeDisabled();
    expect(calls.filter((c) => c.path === '/auth/recovery/request')).toHaveLength(1);
  });

  test('the page is a normal part of the app: skip link, navbar, one h1, noindex', async ({ page }) => {
    await openRecover(page);
    await expect(page.locator('a.skip-link')).toHaveCount(1);
    await expect(page.locator('travel-nav')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });
});
