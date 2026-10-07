import { expect, test } from './fixtures/kc-admin';
import type { Page } from '@playwright/test';
import crypto from 'node:crypto';

/**
 * Internet-exposure hardening of the japan-trip realm (PROD-HARDENING.md):
 * issuer in both layouts, security headers, exact redirect URIs, brute-force
 * lockout semantics, password policy, and the documented username-step
 * behaviour. Runs against a live Keycloak:
 *
 *   KEYCLOAK_URL       base URL incl. relative path, e.g. https://box.ts.net/auth
 *   E2E_KC_PROFILE     local (default) | production — the Terraform profile applied
 *   E2E_APP_ORIGIN     SPA origin (default https://manudubo.github.io)
 *   KC_ADMIN_CLIENT_ID/SECRET   service account with manage-users (throwaway users)
 */

const KEYCLOAK_URL = (process.env.KEYCLOAK_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const PROFILE = process.env.E2E_KC_PROFILE ?? 'local';
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? 'https://manudubo.github.io';
const APP_REDIRECT = `${APP_ORIGIN}/PruebaMapJapan/dashboard.html`;
const HAS_ADMIN = !!process.env.KC_ADMIN_CLIENT_ID && !!process.env.KC_ADMIN_CLIENT_SECRET;
const ISSUER = process.env.E2E_KC_ISSUER ?? `${KEYCLOAK_URL}/realms/japan-trip`;
const QUICK_LOGIN_GAP_MS = 1300;
const VERIFIER = 'prod-hardening-negative-test-verifier-value-000000000';
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');
// Satisfies both profiles' password policies (length 12+, upper, digit, special).
const STRONG_PASSWORD = 'Hardening-Test-Pw-2026!';

function authUrl(redirectUri: string): string {
  return (
    `${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/auth?client_id=japan-trip-frontend` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid&ui_locales=en` +
    `&code_challenge=${CHALLENGE}&code_challenge_method=S256`
  );
}

const uniqueUser = (p: string) => `${p}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@local`;

async function submit(page: Page, field: 'username' | 'password', value: string) {
  const input = page.locator(`input[name="${field}"]`);
  await expect(input).toBeVisible();
  await input.fill(value);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/login-actions/')),
    input.press('Enter'),
  ]);
  await page.waitForLoadState('domcontentloaded');
}

function trackCodes(page: Page): URL[] {
  const hits: URL[] = [];
  // Never load the real app: answer the redirect target locally.
  void page.route(`${APP_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'app' }));
  page.on('request', (r) => {
    if (r.url().startsWith(APP_REDIRECT)) hits.push(new URL(r.url()));
  });
  return hits;
}
const gotCode = (hits: URL[]) => hits.some((u) => u.searchParams.has('code'));

async function formActionOf(page: Page): Promise<string> {
  const action = await page.locator('form[action*="login-actions"]').first().getAttribute('action');
  expect(action).toBeTruthy();
  return action!;
}

/** Feedback text in a raw Keycloak HTML page (error banner / field error). */
function feedbackIn(html: string): string {
  const m = html.match(/id="input-error[^"]*"[^>]*>\s*([^<]+?)\s*</) ?? html.match(/kc-feedback-text">\s*([^<]+?)\s*</);
  return m ? m[1].replace(/&#39;/g, "'").trim() : '';
}

/** POST the password form directly (no navigation); returns the outcome and the next form action. */
async function postPassword(page: Page, action: string, password: string) {
  const r = await page.request.post(action, { form: { password }, maxRedirects: 0, failOnStatusCode: false });
  const html = await r.text();
  const next = html.match(/action="([^"]*login-actions[^"]*)"/)?.[1]?.replace(/&amp;/g, '&') ?? '';
  return { location: r.headers()['location'] ?? '', feedback: feedbackIn(html), nextAction: next };
}

/** Visible feedback text on a Keycloak form (error/info banner). */
async function feedback(page: Page): Promise<string> {
  const el = page.locator('#input-error, .kc-feedback-text, [class*="alert"], #input-error-username, #input-error-password').first();
  return (await el.count()) ? ((await el.textContent()) ?? '').trim() : '';
}

test.describe('Keycloak internet-exposure hardening', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Keycloak behaviour checks run once (chromium)');
    const r = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, { timeout: 5000 }).catch(() => null);
    test.skip(!r?.ok(), 'Keycloak is not running');
  });

  test('issuer in discovery matches KEYCLOAK_URL (incl. a relative path such as /auth)', async ({ request }) => {
    const r = await request.get(`${KEYCLOAK_URL}/realms/japan-trip/.well-known/openid-configuration`);
    expect(r.ok()).toBe(true);
    const doc = await r.json();
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.jwks_uri).toBe(`${ISSUER}/protocol/openid-connect/certs`);
    expect(doc.authorization_endpoint.startsWith(`${ISSUER}/`)).toBe(true);
  });

  test('login page carries anti-framing, no-index and no-referrer headers', async ({ request }) => {
    const r = await request.get(authUrl(APP_REDIRECT), { maxRedirects: 0 });
    expect(r.status()).toBe(200);
    const h = r.headers();
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(h['x-robots-tag']).toBe('none');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-content-type-options']).toBe('nosniff');
    if (PROFILE === 'production') expect(h['strict-transport-security']).toContain('max-age=31536000');
  });

  test.describe('redirect_uri allow-list is exact', () => {
    const bad: Array<[string, string]> = [
      ['foreign origin', 'https://evil.example/PruebaMapJapan/dashboard.html'],
      ['another github.io user', 'https://attacker.github.io/PruebaMapJapan/dashboard.html'],
      ['suffix look-alike host', `${APP_ORIGIN}.evil.test/PruebaMapJapan/dashboard.html`],
      ['http downgrade', APP_REDIRECT.replace('https://', 'http://')],
      ['unlisted page on the right origin', `${APP_ORIGIN}/PruebaMapJapan/evil.html`],
      ['path traversal', `${APP_ORIGIN}/PruebaMapJapan/../evil/dashboard.html`],
      ['encoded traversal', `${APP_ORIGIN}/PruebaMapJapan/%2e%2e/evil/dashboard.html`],
      ['userinfo trick', `https://manudubo.github.io@evil.example/PruebaMapJapan/dashboard.html`],
      ['fragment smuggling', `${APP_REDIRECT}#@evil.example`],
    ];
    if (PROFILE === 'production') bad.push(['localhost in production', 'http://localhost:5173/PruebaMapJapan/dashboard.html']);

    for (const [label, uri] of bad) {
      test(`${label} → no redirect`, async ({ request }) => {
        const r = await request.get(authUrl(uri), { maxRedirects: 0, failOnStatusCode: false });
        expect(r.headers()['location'] ?? '').toBe('');
        expect(r.status()).toBe(400);
      });
    }

    test('the listed Pages redirect URI renders the login form', async ({ request }) => {
      const r = await request.get(authUrl(APP_REDIRECT), { maxRedirects: 0 });
      expect(r.status()).toBe(200);
      expect(await r.text()).toContain('name="username"');
    });
  });

  test('username step: documented behaviour for unknown users (enumeration residual risk)', async ({ page }) => {
    // Keycloak's username-first form answers an unknown username with an error on the
    // same step, and a known one with the next credential step. That reveals whether
    // an account exists; PROD-HARDENING.md documents why this layout is kept and how
    // the exposure is bounded. If Keycloak ever makes the two indistinguishable, this
    // test fails and the doc should be updated.
    await page.goto(authUrl(APP_REDIRECT));
    await submit(page, 'username', uniqueUser('no-such-user'));
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    test.info().annotations.push({ type: 'residual-risk', description: `unknown user feedback: ${await feedback(page)}` });
  });

  test.describe('with throwaway users (admin credentials)', () => {
    test.beforeEach(() => {
      test.skip(!HAS_ADMIN, 'KC_ADMIN_CLIENT_ID/SECRET not set');
    });

    test('quick successive failures lock the account temporarily, with the same generic error', async ({ page, kcAdmin }) => {
      const username = uniqueUser('bf-quick');
      await kcAdmin.createUser(username, STRONG_PASSWORD);
      await kcAdmin.clearRequiredActions(username);
      try {
        test.setTimeout(90_000);
        trackCodes(page);
        await page.goto(authUrl(APP_REDIRECT));
        await submit(page, 'username', username);
        // The two failures go out as raw form POSTs back to back, so they are
        // < 1 s apart however slow the browser or Keycloak is on this machine.
        const first = await postPassword(page, await formActionOf(page), 'Wrong-Password-1!');
        const second = await postPassword(page, first.nextAction, 'Wrong-Password-2!');
        expect(second.location).toBe('');
        await page.waitForTimeout(QUICK_LOGIN_GAP_MS);
        const third = await postPassword(page, second.nextAction, STRONG_PASSWORD);
        expect(third.location.startsWith(APP_REDIRECT), 'correct password must be refused during the lockout').toBe(false);
        // A locked account must not be distinguishable from a wrong password.
        expect(third.feedback).toBe(first.feedback);
        expect(third.feedback.toLowerCase()).not.toMatch(/disabled|locked|temporar/);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('slow failures below the threshold do not lock; the correct password then works', async ({ page, kcAdmin }) => {
      test.setTimeout(90_000);
      const username = uniqueUser('bf-slow');
      await kcAdmin.createUser(username, STRONG_PASSWORD);
      await kcAdmin.clearRequiredActions(username);
      try {
        const hits = trackCodes(page);
        await page.goto(authUrl(APP_REDIRECT));
        await submit(page, 'username', username);
        for (let i = 0; i < 2; i++) {
          await submit(page, 'password', `Wrong-Password-${i}!`);
          await page.waitForTimeout(QUICK_LOGIN_GAP_MS);
        }
        await submit(page, 'password', STRONG_PASSWORD);
        await expect.poll(() => gotCode(hits)).toBe(true);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('reaching max_login_failures locks the account (production threshold)', async ({ page, kcAdmin }) => {
      const max = Number(process.env.E2E_KC_MAX_FAILURES ?? (PROFILE === 'production' ? 10 : 30));
      test.skip(max > 12, 'run with E2E_KC_PROFILE=production (threshold 10) — 30 spaced attempts take too long');
      test.setTimeout(60_000 + max * 10_000);
      const username = uniqueUser('bf-max');
      await kcAdmin.createUser(username, STRONG_PASSWORD);
      await kcAdmin.clearRequiredActions(username);
      try {
        const hits = trackCodes(page);
        await page.goto(authUrl(APP_REDIRECT));
        await submit(page, 'username', username);
        for (let i = 0; i < max; i++) {
          await submit(page, 'password', `Wrong-Password-${i}!`);
          await page.waitForTimeout(QUICK_LOGIN_GAP_MS);
        }
        await submit(page, 'password', STRONG_PASSWORD);
        expect(gotCode(hits)).toBe(false);
      } finally {
        await kcAdmin.deleteUser(username);
      }
    });

    test('password policy rejects weak passwords', async ({ kcAdmin }) => {
      const weak = PROFILE === 'production' ? 'Short-Pw-1!' /* 11 chars < 12 */ : 'password';
      const username = uniqueUser('pw-policy');
      let error: unknown;
      try {
        await kcAdmin.createUser(username, weak);
      } catch (e) {
        error = e;
      } finally {
        await kcAdmin.deleteUser(username);
      }
      expect(String(error)).toMatch(/400|policy|invalidPassword/i);
    });
  });
});
