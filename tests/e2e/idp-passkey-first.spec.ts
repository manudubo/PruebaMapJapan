import { expect, test } from './fixtures/kc-admin';
import { getUserId } from './fixtures/kc-admin';
import type { CDPSession, Page } from '@playwright/test';
import crypto from 'node:crypto';

/**
 * Passkey-first sign-in against a REAL Keycloak 26.6.1 (docs/design/PASSKEY-FIRST-LOGIN.md).
 *
 * A browser that has used a passkey with the realm gets the passkey prompt on load, with no
 * username typed (discoverable credentials: the realm requires resident keys and user
 * verification). The browser remembers that in localStorage as a marker that says nothing
 * about who. Chromium's CDP virtual authenticator plays the device; WebAuthn calls that the
 * test must control (a cancelled prompt, one that hangs) are wrapped by an init script.
 *
 * Runs in keycloak-flow.yml (CI_KEYCLOAK=1 makes every precondition required) and locally
 * against scripts/ci/keycloak-flow.sh, Chromium only. Unit tests of the marker logic are in
 * idp-passkey-first-unit.spec.ts, the rendered states in idp-passkey-first-render.spec.ts.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'japan-trip';
const REDIRECT_URI = 'http://localhost:5173/PruebaMapJapan/dashboard.html';
const REQUIRE_KC = process.env.CI_KEYCLOAK === '1';
const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;
const PASSWORD = 'Passkey-First-Test-1!';
const MARKER_KEY = `jp.passkey.${REALM}`;

function pkce(): string {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function authQuery(): string {
  return (
    '?client_id=japan-trip-frontend' +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=openid&ui_locales=en&code_challenge=${pkce()}&code_challenge_method=S256`
  );
}
const loginUrl = (extra = '') => `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth${authQuery()}${extra}`;
const registrationUrl = () => `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/registrations${authQuery()}`;
/** A page of the Keycloak origin that runs no theme script: where tests read and write the storage. */
const neutralUrl = `${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration`;

function uniqueUser(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@local`;
}

/** Requests Keycloak sent to the app redirect URI; one with a `code` means "signed in". */
function trackAppRedirects(page: Page): URL[] {
  const hits: URL[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(REDIRECT_URI)) hits.push(new URL(request.url()));
  });
  return hits;
}
const issuedCode = (hits: URL[]) => hits.some((u) => u.searchParams.has('code'));

/** Bodies of the form posts the browser sent to Keycloak's login-actions endpoints. */
function trackPosts(page: Page): string[] {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/login-actions/')) bodies.push(request.postData() ?? '');
  });
  return bodies;
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

/** The "this browser has no autofill UI" half of every test that must reach the page's own prompt. */
async function withoutAutofill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  });
}

/**
 * Wrap navigator.credentials.get: count the modal (non-autofill) requests in sessionStorage,
 * and answer the first `cancelFirst` of them with NotAllowedError (a cancelled prompt) or,
 * with `hangFirst`, leave the first one pending until the page aborts it.
 */
async function controlPrompts(page: Page, options: { cancelFirst?: number; hangFirst?: boolean } = {}): Promise<void> {
  await page.addInitScript((opts) => {
    const original = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (request?: CredentialRequestOptions) => {
      if (request?.mediation === 'conditional') return original(request);
      const n = Number(sessionStorage.getItem('__modalGets') ?? '0');
      sessionStorage.setItem('__modalGets', String(n + 1));
      if (n < (opts.cancelFirst ?? 0)) return Promise.reject(new DOMException('cancelled', 'NotAllowedError'));
      if (n === 0 && opts.hangFirst) {
        return new Promise((_resolve, reject) => {
          request?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return original(request);
    };
  }, options);
}
const modalGets = async (page: Page) => Number(await page.evaluate(() => sessionStorage.getItem('__modalGets') ?? '0'));

/** Same wrapper idea for pages where the call must never happen: how many get() calls were made. */
async function countAllGets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (request?: CredentialRequestOptions) => {
      sessionStorage.setItem('__allGets', String(Number(sessionStorage.getItem('__allGets') ?? '0') + 1));
      return original(request);
    };
  });
}
const allGets = async (page: Page) => Number(await page.evaluate(() => sessionStorage.getItem('__allGets') ?? '0'));

async function readMarker(page: Page): Promise<string | null> {
  await page.goto(neutralUrl);
  return page.evaluate((key) => localStorage.getItem(key), MARKER_KEY);
}
async function writeMarker(page: Page, marker: unknown): Promise<void> {
  await page.goto(neutralUrl);
  await page.evaluate(([key, value]) => localStorage.setItem(key as string, JSON.stringify(value)), [MARKER_KEY, marker]);
}
const freshMarker = (misses = 0) => ({ v: 1, t: Date.now(), m: misses });

/**
 * A user with a password and a passkey, the passkey held by the page's virtual
 * authenticator. The passkey is enrolled the way users do it (password sign-in, then the
 * "create a passkey" step), which also leaves the marker in the browser. Cookies are
 * dropped afterwards (a new visit, not an SSO session); the marker stays.
 */
async function userWithPasskey(
  page: Page,
  kcAdmin: { createUser: (u: string, p: string | null) => Promise<void>; clearRequiredActions: (u: string) => Promise<void> },
  prefix: string,
): Promise<{ username: string; cdp: CDPSession; authenticatorId: string }> {
  const username = uniqueUser(prefix);
  await kcAdmin.createUser(username, PASSWORD);
  await kcAdmin.clearRequiredActions(username);
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
  await page.goto(loginUrl('&kc_action=webauthn-register-passwordless'));
  await page.locator('#username').fill(username);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
    page.locator('#kc-login').click(),
  ]);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();
  const hits = trackAppRedirects(page);
  const leftKeycloak = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame() && !frame.url().startsWith(KEYCLOAK_URL),
  });
  await page.locator('#registerWebAuthn').click();
  await leftKeycloak;
  await expect.poll(() => issuedCode(hits)).toBe(true);
  await page.context().clearCookies();
  return { username, cdp, authenticatorId };
}

test.describe('Passkey-first sign-in (live Keycloak, Chromium virtual authenticator)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request, browserName }) => {
    test.fixme(browserName !== 'chromium', 'CDP virtual authenticator is Chromium-only');
    const realm = await request.get(`${KEYCLOAK_URL}/realms/${REALM}`, { timeout: 5000 }).catch(() => null);
    test.fixme(!realm?.ok() && !REQUIRE_KC, 'needs Keycloak with the japan-trip realm (scripts/ci/keycloak-flow.sh)');
    test.fixme(!HAS_ADMIN && !REQUIRE_KC, 'needs KC_ADMIN_CLIENT_ID/SECRET');
    expect(realm?.ok(), `realm ${REALM} at ${KEYCLOAK_URL}`).toBe(true);
    expect(HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET').toBe(true);
  });

  test('(a) first visit: username form, passkey in the autofill list signs in, and sets the marker', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-autofill');
    try {
      // A browser that never used a passkey here: no marker.
      await page.goto(neutralUrl);
      await page.evaluate((key) => localStorage.removeItem(key), MARKER_KEY);
      // What Keycloak serves: the username form with the autofill token, the passkey panel hidden.
      const served = await (await page.request.get(loginUrl())).text();
      expect(served).toMatch(/id="username"[^>]*autocomplete="username webauthn"/);
      expect(served).toMatch(/id="jp-passkey-first"[^>]*\shidden/);
      expect(served).toMatch(/id="kc-form"/);
      const hits = trackAppRedirects(page);
      const posts = trackPosts(page);
      await page.goto(loginUrl());
      // Not a returning browser, so the page never shows the passkey panel. The virtual
      // authenticator answers the autofill request by itself; no username is typed.
      await expect.poll(() => issuedCode(hits)).toBe(true);
      expect(posts.every((body) => !body.includes('username='))).toBe(true);
      expect(posts.some((body) => body.includes('credentialId='))).toBe(true);
      const marker = JSON.parse((await readMarker(page)) ?? 'null');
      expect(marker).toMatchObject({ v: 1, m: 0 });
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(b) second visit: the passkey prompt starts by itself, no username typed, and signs in', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-auto');
    try {
      expect(JSON.parse((await readMarker(page)) ?? 'null'), 'enrolling a passkey leaves the marker').toMatchObject({ v: 1, m: 0 });
      await withoutAutofill(page); // the prompt below is the page's own, not the autofill list's
      await controlPrompts(page);
      const hits = trackAppRedirects(page);
      const posts = trackPosts(page);
      await page.goto(loginUrl());
      await expect.poll(() => issuedCode(hits)).toBe(true);
      // What the browser sent: an assertion, never a username.
      expect(posts).toHaveLength(1);
      expect(posts[0]).toContain('credentialId=');
      expect(posts[0]).not.toContain('username=');
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(c) cancel: the form is usable, the page does not prompt again, "Continue with passkey" works', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-cancel');
    try {
      await withoutAutofill(page);
      await controlPrompts(page, { cancelFirst: 1 });
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      // The user cancelled the browser's sheet.
      await expect(page.locator('#jp-passkey-status')).toContainText(/cancelled/i);
      await expect(page.locator('#jp-passkey-status')).toBeVisible();
      await expect(page.locator('#jp-passkey-continue')).toBeFocused();
      await expect(page.locator('#username')).toBeVisible();
      await expect(page.locator('#username')).toBeEnabled();
      expect(await modalGets(page)).toBe(1);
      expect(issuedCode(hits)).toBe(false);

      // No loop: a reload and a trip away and back are the same login attempt, no new prompt.
      await page.reload();
      await expect(page.locator('#jp-passkey-button')).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
      expect(await modalGets(page)).toBe(1);

      // The cancel counted once; the marker is still there.
      const marker = JSON.parse((await readMarker(page)) ?? 'null');
      expect(marker).toMatchObject({ v: 1, m: 1 });
      await page.goBack();
      await expect(page.locator('#jp-passkey-button')).toBeVisible();
      expect(await modalGets(page)).toBe(1);

      // The user can still choose the passkey (a user gesture): that works and resets the count.
      await page.locator('#jp-passkey-button').click();
      await expect.poll(() => issuedCode(hits)).toBe(true);
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(c2) cancel, then "Continue with passkey" in the panel signs in', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-continue');
    try {
      await withoutAutofill(page);
      await controlPrompts(page, { cancelFirst: 1 });
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-status')).toContainText(/cancelled/i);
      await page.locator('#jp-passkey-continue').click();
      await expect.poll(() => issuedCode(hits)).toBe(true);
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(d) "Use another account": the form takes over, the password sign-in works, the marker is cleared', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-other');
    try {
      await withoutAutofill(page);
      await controlPrompts(page, { hangFirst: true }); // the prompt is open while the user decides
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-first')).toBeVisible();
      await expect(page.locator('#kc-form')).toBeHidden();
      await expect(page.locator('#jp-passkey-status')).toContainText(/confirm/i);

      await page.locator('#jp-passkey-other').click();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
      await expect(page.locator('#kc-form')).toBeVisible();
      await expect(page.locator('#username')).toBeFocused();
      expect(await modalGets(page)).toBe(1); // the open prompt was aborted, none started

      await page.locator('#username').fill(username);
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
        page.locator('#kc-login').click(),
      ]);
      // Password first: this account's password was created before its passkey.
      await expect(page.locator('#password')).toBeVisible();
      // Choosing another account and signing in with its credentials drops this browser's memory.
      expect(await page.evaluate((key) => localStorage.getItem(key), MARKER_KEY)).toBeNull();
      await page.locator('#password').fill(PASSWORD);
      const leftKeycloak = page.waitForEvent('framenavigated', {
        predicate: (frame) => frame === page.mainFrame() && !frame.url().startsWith(KEYCLOAK_URL),
      });
      await page.locator('#kc-login').click();
      await leftKeycloak; // the redirect to the app has committed: the next goto cannot be interrupted by it
      await expect.poll(() => issuedCode(hits)).toBe(true);

      // The next visit is a plain page: no marker, no prompt of its own.
      await page.context().clearCookies();
      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-button')).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(e) marker but no passkey on the device: graceful fallback, and two dismissed prompts end the automatic prompting', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-gone');
    try {
      await withoutAutofill(page);
      await controlPrompts(page, { cancelFirst: 99 }); // what a browser does when there is nothing to offer
      await cdp.send('WebAuthn.clearCredentials', { authenticatorId });

      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-status')).toContainText(/cancelled/i);
      await expect(page.locator('#username')).toBeVisible();
      expect(JSON.parse((await readMarker(page)) ?? 'null')).toMatchObject({ m: 1 });

      // A new login attempt prompts once more; the second miss drops the marker.
      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-status')).toContainText(/cancelled/i);
      expect(await readMarker(page)).toBeNull();

      // And from then on the page is the plain one.
      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-button')).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
      expect(await modalGets(page)).toBe(2); // one automatic prompt per visit, none on the third
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(e2) the server no longer knows the passkey: the error page forgets the marker and does not prompt again', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-revoked');
    try {
      await kcAdmin.removeCredentials(username, ['webauthn-passwordless']); // revoked server-side, still on the device
      await withoutAutofill(page);
      await controlPrompts(page);
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      await expect(page.locator('#kc-error-message, .jp-alert, #jp-passkey-status').first()).toBeVisible();
      expect(issuedCode(hits)).toBe(false);
      await expect.poll(async () => page.evaluate((key) => localStorage.getItem(key), MARKER_KEY)).toBeNull();
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(f) a browser without WebAuthn is never prompted, whatever it remembers', async ({ page, kcAdmin }) => {
    const username = uniqueUser('pkf-nowebauthn');
    await kcAdmin.createUser(username, PASSWORD);
    await kcAdmin.clearRequiredActions(username);
    try {
      await writeMarker(page, freshMarker());
      await page.addInitScript(() => {
        delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
      });
      await countAllGets(page);
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      await expect(page.locator('#username')).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
      await expect(page.locator('#jp-passkey-alt')).toBeHidden(); // no passkey button either
      expect(await allGets(page)).toBe(0);
      // The password path (and, for passkey-only accounts, the e-mail recovery) is untouched.
      await page.locator('#username').fill(username);
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
        page.locator('#kc-login').click(),
      ]);
      await page.locator('#password').fill(PASSWORD);
      await page.locator('#kc-login').click();
      await expect.poll(() => issuedCode(hits)).toBe(true);
    } finally {
      await kcAdmin.deleteUser(username);
    }
  });

  test('(g) the marker and everything else the page stores say nothing about who signed in', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-privacy');
    try {
      const userId = await getUserId(username);
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      expect(credentials).toHaveLength(1);
      const credentialIds = [credentials[0]!.credentialId, Buffer.from(credentials[0]!.credentialId, 'base64').toString('base64url')];

      // Sign in with the passkey once more so the marker is as fresh as it gets.
      await withoutAutofill(page);
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      await expect.poll(() => issuedCode(hits)).toBe(true);
      await page.context().clearCookies();

      await page.goto(neutralUrl);
      const stored = await page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
      }));
      const marker = stored.local[MARKER_KEY]!;
      expect(Object.keys(JSON.parse(marker)).sort()).toEqual(['m', 't', 'v']);
      const everything = JSON.stringify(stored) + JSON.stringify(await page.context().cookies());
      const [local] = username.split('@');
      for (const secret of [username, local!, userId, ...credentialIds]) {
        expect(everything, `storage must not contain ${secret.slice(0, 8)}...`).not.toContain(secret);
      }
      // The theme sets no cookie of its own (the context holds no cookie at all here).
      expect((await page.context().cookies()).filter((c) => /^jp/i.test(c.name))).toEqual([]);
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });

  test('(h) a forged or unknown assertion posted to the username page signs nobody in (the credential step is not skippable)', async ({ page, kcAdmin }) => {
    const username = uniqueUser('pkf-forged');
    await kcAdmin.createUser(username, PASSWORD);
    await kcAdmin.clearRequiredActions(username);
    try {
      const userId = await getUserId(username);
      await withoutAutofill(page);
      const hits = trackAppRedirects(page);
      await page.goto(loginUrl());
      const action = await page.locator('#webauth').getAttribute('action');
      expect(action, 'the passkey form of the username page').toBeTruthy();
      const random = (n: number) => crypto.randomBytes(n).toString('base64url');
      const attempts: Record<string, string>[] = [
        // what the browser posts, with made-up data, claiming to be this account
        { clientDataJSON: random(60), authenticatorData: random(37), signature: random(70), credentialId: random(32), userHandle: Buffer.from(userId).toString('base64url') },
        // the same without a user handle (an unidentified user)
        { clientDataJSON: random(60), authenticatorData: random(37), signature: random(70), credentialId: random(32) },
        // an "I did a passkey" claim with nothing behind it
        { credentialId: random(32) },
        { error: 'NotAllowedError' },
      ];
      for (const form of attempts) {
        const response = await page.request.post(action!, { form, maxRedirects: 0, failOnStatusCode: false });
        const location = response.headers()['location'] ?? '';
        expect(location.startsWith(REDIRECT_URI) && location.includes('code='), `${Object.keys(form)} must not yield a code`).toBe(false);
        // Keycloak answers with a page again (an error or the same form): never a redirect to the app.
        expect([200, 302, 400]).toContain(response.status());
      }
      expect(issuedCode(hits)).toBe(false);
      // The username alone gets nothing either: the password is still asked for.
      await page.goto(loginUrl());
      await page.locator('#username').fill(username);
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
        page.locator('#kc-login').click(),
      ]);
      await expect(page.locator('#password')).toBeVisible();
      expect(issuedCode(hits)).toBe(false);
    } finally {
      await kcAdmin.deleteUser(username);
    }
  });

  test('never prompts on the sign-up page or on an error page, whatever the marker says', async ({ page, kcAdmin }) => {
    const { username, cdp, authenticatorId } = await userWithPasskey(page, kcAdmin, 'pkf-pages');
    try {
      await withoutAutofill(page);
      await countAllGets(page);
      await page.goto(registrationUrl());
      await expect(page.locator('#kc-register-form')).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toHaveCount(0);
      expect(await allGets(page)).toBe(0);

      // A sign-in page that carries an error message is not eligible either.
      await controlPrompts(page, { cancelFirst: 1 });
      await page.goto(loginUrl());
      await expect(page.locator('#jp-passkey-status')).toContainText(/cancelled/i); // the one automatic prompt, cancelled
      await page.locator('#username').fill(uniqueUser('pkf-unknown'));
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
        page.locator('#kc-login').click(),
      ]);
      await expect(page.locator('.jp-alert, #input-error-username').first()).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
      expect(await modalGets(page)).toBe(1);
    } finally {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await kcAdmin.deleteUser(username);
    }
  });
});
