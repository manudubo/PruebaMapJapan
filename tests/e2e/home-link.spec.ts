import { test, expect } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { completeMockLogin, mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { mockTrip } from './fixtures/mockTrip';

/**
 * @qa-noauth: the navbar Home link must reach the landing page for a signed-in user.
 * The landing used to redirect every signed-in visit to the dashboard, so Home from the
 * dashboard "bounced back". In-app links now carry ?home (auth/keycloak.ts HOME_HREF).
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test home-link --project=chromium
 */

test.describe('@qa-noauth Home link with a signed-in session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [name, path] of [
    ['dashboard', 'dashboard.html'],
    ['profile', 'profile.html'],
    ['trip detail', 'trip.html?tripId=1'],
  ] as const) {
    test(`Home from ${name} stays on the landing`, async ({ page }) => {
      await mockApi(page, { trips: [mockTrip] });
      await mockKeycloakLoggedIn(page);
      await page.goto(path);
      const brand = page.locator('travel-nav .nav-brand');
      await expect(brand).toHaveAttribute('href', 'index.html?home');
      await brand.click();
      await expect(page).toHaveURL(/\/PruebaMapJapan\/index\.html\?home$/);
      await expect(page.locator('#landing-hero')).toBeVisible();
      await expect(page.locator('#landing-login-btn')).toHaveText('Go to dashboard');
      await expect(page).toHaveURL(/index\.html\?home$/);
    });
  }

  test('repeated clicks, hash and back button keep working', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedIn(page);
    await page.goto('dashboard.html');
    await page.locator('travel-nav .nav-brand').click();
    await expect(page.locator('#landing-login-btn')).toHaveText('Go to dashboard');
    await page.locator('travel-nav .nav-brand').click();
    await page.goto('index.html?home#demo');
    await expect(page.locator('#landing-login-btn')).toHaveText('Go to dashboard');
    await expect(page).toHaveURL(/index\.html\?home#demo$/);
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/dashboard\.html$/);
    await page.goForward();
    await expect(page).toHaveURL(/index\.html\?home/);
  });

  test('the dashboard shortcut on the landing opens the dashboard', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedIn(page);
    await page.goto('index.html?home');
    await page.locator('#landing-login-btn').click();
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test('a plain signed-in visit to index.html still lands on the dashboard', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedIn(page);
    await page.goto('');
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test('Keycloak unreachable: Home still opens the landing with a notice', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await page.route('**/realms/**', (route) => route.abort());
    await page.goto('index.html?home');
    await expect(page.locator('#landing-hero')).toBeVisible();
    await expect(page).toHaveURL(/index\.html\?home$/);
  });

  test('fresh sign-in from the landing still ends on the dashboard', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedOut(page);
    await page.goto('index.html?home');
    const authorize = page.waitForRequest(
      (r) => r.isNavigationRequest() && r.url().includes('/protocol/openid-connect/auth'),
    );
    await page.locator('#landing-login-btn').click();
    const authorizeUrl = new URL((await authorize).url());
    await completeMockLogin(page, authorizeUrl);
    await expect(page).toHaveURL(/dashboard\.html/);
  });
});
