import { test, expect, type Request } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { completeMockLogin, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { mockTrip } from './fixtures/mockTrip';

/**
 * @qa-noauth: sign-in from a page with a query string (PROD-HARDENING "also found").
 *
 * Keycloak accepts only the exact redirect URIs registered in terraform/keycloak (no
 * query strings), so sending window.location.href from trip-edit.html?tripId=N got
 * 400 "Invalid redirect_uri". The app now sends a registered page and returns the user
 * to the original page and query once the callback is processed (auth/keycloak.ts).
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test auth-return-to --project=chromium
 */

const REGISTERED = ['dashboard.html', 'profile.html', 'index.html'].map((p) => `/PruebaMapJapan/${p}`);

const isAuthorizeNavigation = (r: Request) =>
  r.isNavigationRequest() && r.frame() === r.frame().page().mainFrame() && r.url().includes('/protocol/openid-connect/auth');

test.describe('@qa-noauth sign-in returns to the page it started from', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('trip-edit.html?tripId=N: registered redirect_uri, then back to the editor with its query', async ({ page }) => {
    const trip = { ...mockTrip, id: 42 };
    await mockApi(page, { trip, trips: [trip] });
    await mockKeycloakLoggedOut(page);

    // Signed out on the editor: the page starts the Keycloak login itself.
    const authorize = page.waitForRequest(isAuthorizeNavigation);
    await page.goto('trip-edit.html?tripId=42');
    const authorizeUrl = new URL((await authorize).url());
    await expect(page.locator('#mock-kc')).toBeVisible();

    const redirectUri = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
    expect(redirectUri.search, 'redirect_uri must not carry a query string').toBe('');
    expect(redirectUri.hash).toBe('');
    expect(REGISTERED).toContain(redirectUri.pathname);

    // The user signs in at Keycloak, which redirects to that registered page with a code.
    await completeMockLogin(page, authorizeUrl);

    await expect(page).toHaveURL(/\/PruebaMapJapan\/trip-edit\.html\?tripId=42$/);
    await expect(page.locator('#destinations-section')).toBeVisible();
  });

  test('a registered page is sent as is (no detour, nothing to restore)', async ({ page }) => {
    await mockApi(page, { trips: [] });
    await mockKeycloakLoggedOut(page);
    await page.goto('dashboard.html');
    const authorize = page.waitForRequest(isAuthorizeNavigation);
    await page.locator('#auth-login-prompt-btn').click();
    const redirectUri = new URL(new URL((await authorize).url()).searchParams.get('redirect_uri')!);
    expect(redirectUri.pathname).toBe('/PruebaMapJapan/dashboard.html');
    expect(redirectUri.search).toBe('');
    expect(await page.evaluate(() => sessionStorage.getItem('travelmap.auth.returnTo'))).toBeNull();
  });
});
