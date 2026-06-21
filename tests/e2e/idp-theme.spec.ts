import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const CODE_VERIFIER = 'phase16-playwright-idp-theme-test-verifier-value-48c';
const CODE_CHALLENGE = crypto
  .createHash('sha256')
  .update(CODE_VERIFIER)
  .digest('base64url');

const LOGIN_URL =
  `${KEYCLOAK_URL}/realms/japan-trip/protocol/openid-connect/auth` +
  '?client_id=japan-trip-frontend' +
  '&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2FPruebaMapJapan%2Fdashboard.html' +
  '&response_type=code' +
  '&scope=openid' +
  `&code_challenge=${CODE_CHALLENGE}` +
  '&code_challenge_method=S256';

test.describe('Keycloak theme', () => {
  // Override project-level storageState — chromium project inherits '.auth/user.json'
  // which contains a KC SSO session cookie. KC skips the login page for authenticated
  // users. Empty storageState forces KC to always render the login page.
  // This is a no-op on firefox and webkit (they have no project storageState).
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ request }) => {
    const response = await request.get(`${KEYCLOAK_URL}/realms/japan-trip`, {
      timeout: 5000,
    }).catch(() => null);

    test.skip(!response?.ok(), 'Keycloak is not running locally');
  });

  test('login theme hides default header and renders app exit action', async ({ page }) => {
    await page.goto(LOGIN_URL);
    await page.waitForLoadState('domcontentloaded');

    const keycloakHeader = page.locator('#kc-header-wrapper');
    await expect(keycloakHeader).toBeHidden();

    const exitAction = page.locator('.jp-idp-exit');
    await expect(exitAction).toBeVisible();
    await expect(exitAction).toHaveText('Return');
    await expect(exitAction).toHaveAttribute('href', /\/PruebaMapJapan\/?$/);
    await expect(exitAction).not.toHaveAttribute('href', /protocol\/openid-connect\/logout/);

    const styles = await exitAction.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        borderRadius: computed.borderRadius,
        fontFamily: computed.fontFamily,
      };
    });

    expect(styles.borderRadius).toBe('0px');
    expect(styles.fontFamily).toContain('Inter');
  });
});
