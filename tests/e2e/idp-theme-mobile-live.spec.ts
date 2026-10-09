import { devices, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { contrastOf, layoutProblems, TEXT_SELECTORS } from './fixtures/idp-theme/mobile-checks';

/**
 * The same phone audit as idp-theme-mobile.spec.ts, but against the LIVE Keycloak: the server's own
 * HTML and CSS with its scripts running (so the passkey button is shown by the real
 * js/passkey-first.js, as on the phone in the bug report). Run it against a Keycloak served under
 * /auth like production (KEYCLOAK_URL=http://localhost:8080/auth) and, to see what production
 * caches, one started with `start --optimized` (theme caching on).
 *
 *   QA_SCREENSHOTS_DIR=<dir> also saves a full-page PNG of every state.
 */
const KEYCLOAK_URL = process.env['KEYCLOAK_URL'] ?? 'http://localhost:8080';
const USER = process.env['E2E_TEST_USERNAME'] ?? '';
const SHOTS = process.env['QA_SCREENSHOTS_DIR'];
const AUTH =
  `${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/auth?client_id=japan-trip-frontend` +
  '&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2FPruebaMapJapan%2Fdashboard.html&response_type=code&scope=openid&ui_locales=en' +
  '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';

const strip = ({ defaultBrowserType: _d, ...rest }: (typeof devices)[string]) => rest;
const VIEWPORTS = {
  'iphone-390': { ...strip(devices['iPhone 13']), viewport: { width: 390, height: 844 } },
  'iphone-320': { ...strip(devices['iPhone 13']), viewport: { width: 320, height: 568 } },
  'pixel-7': strip(devices['Pixel 7']),
} as const;

const PAGES: Record<string, (page: Page) => Promise<void>> = {
  username: async (page) => {
    await page.goto(AUTH);
    await expect(page.locator('#username')).toBeVisible();
  },
  password: async (page) => {
    test.fixme(!USER, 'needs a seeded user (E2E_TEST_USERNAME)');
    await page.goto(AUTH);
    await page.locator('#username').fill(USER);
    await page.locator('#kc-login').click();
    await expect(page.locator('#password')).toBeVisible();
  },
  'password-error': async (page) => {
    test.fixme(!USER, 'needs a seeded user (E2E_TEST_USERNAME)');
    await page.goto(AUTH);
    await page.locator('#username').fill(USER);
    await page.locator('#kc-login').click();
    await page.locator('#password').fill('not-the-password');
    await page.locator('#kc-login').click();
    await expect(page.locator('#input-error-password')).toBeVisible();
  },
  register: async (page) => {
    await page.goto(AUTH.replace('/auth?', '/registrations?'));
    await expect(page.locator('main.jp-card')).toBeVisible();
  },
  'error-redirect': async (page) => {
    await page.goto(AUTH.replace('redirect_uri=http', 'redirect_uri=https%3A%2F%2Fevil.example%2F&x=http'));
    await expect(page.locator('#kc-error-message')).toBeVisible();
  },
  'error-client': async (page) => {
    await page.goto(AUTH.replace('japan-trip-frontend', 'no-such-client'));
    await expect(page.locator('#kc-error-message')).toBeVisible();
  },
  'error-expired': async (page) => {
    await page.goto(AUTH);
    await page.context().clearCookies();
    await page.locator('#username').fill('traveler@example.test');
    await page.locator('#kc-login').click();
    await expect(page.locator('#kc-error-message')).toBeVisible();
  },
  info: async (page) => {
    await page.goto(`${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/logout`);
    await page.locator('#kc-logout').click();
    await expect(page.locator('#kc-info-message')).toBeAttached();
  },
};

for (const [vpName, descriptor] of Object.entries(VIEWPORTS)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`live theme on a phone: ${vpName}, ${scheme}`, () => {
      test.use({ ...descriptor, colorScheme: scheme, storageState: { cookies: [], origins: [] } });

      test.beforeEach(async ({ request }) => {
        const response = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, { timeout: 5000 }).catch(() => null);
        test.fixme(!response?.ok(), 'requires Keycloak with the japan-trip realm (scripts/ci/keycloak-flow.sh); not started in CI by default');
      });

      for (const [name, reach] of Object.entries(PAGES)) {
        test(`${name}: one flat responsive card`, async ({ page }) => {
          await reach(page);
          // the real passkey script has run on the username page: its button is part of what is audited
          if (name === 'username') await expect(page.locator('#jp-passkey-alt, #jp-passkey-first')).not.toHaveCount(0);
          expect(await layoutProblems(page)).toEqual([]);
          for (const selector of TEXT_SELECTORS) {
            for (const { ratio } of await contrastOf(page, selector)) expect(ratio, `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
          }
          if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: path.join(SHOTS, `${name}-${scheme}-${vpName}.png`), fullPage: true });
          }
        });
      }
    });
  }
}
