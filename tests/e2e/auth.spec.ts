import { test, expect } from '@playwright/test';
import { mockTrip } from './fixtures/mockTrip';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import * as fs from 'fs';
import * as path from 'path';

// These specs must behave identically with and without a real Keycloak, so they
// start from an empty browser state regardless of the project's storageState.
test.describe('Auth flow — mocked Keycloak', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.describe('guest', () => {
    test.beforeEach(async ({ page }) => {
      await mockKeycloakLoggedOut(page);
      await mockApi(page);
    });

    test('dashboard shows the sign-in prompt and no trip data', async ({ page }) => {
      await page.goto('dashboard.html');

      await expect(page.locator('#dashboard-login-prompt')).toBeVisible();
      await expect(page.locator('#auth-login-prompt-btn')).toBeVisible();
      await expect(page.locator('#new-trip-btn')).toBeHidden();

      // Guest must not see (or be able to reveal) any trip content.
      const grid = page.locator('#trips-grid');
      await expect(grid).toBeHidden();
      await expect(grid).toBeEmpty();
      await expect(page.locator('.trip-card')).toHaveCount(0);
      await expect(page.getByText('Loading trips')).toHaveCount(0);
      await expect(page.locator('#dashboard-greeting')).toHaveText('My Trips');
    });

    test('guest check never redirects the user away from the dashboard', async ({ page }) => {
      const keycloakRequests: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('/realms/')) keycloakRequests.push(req.url());
      });

      await page.goto('dashboard.html');
      await expect(page.locator('#dashboard-login-prompt')).toBeVisible();

      // Silent SSO check happened (Keycloak was consulted) ...
      expect(keycloakRequests.some((u) => u.includes('/protocol/openid-connect/auth'))).toBe(true);
      // ... but only inside an iframe: the top-level page never left the dashboard.
      expect(new URL(page.url()).pathname).toMatch(/dashboard\.html$/);
      await expect(page.locator('#mock-kc')).toHaveCount(0);
    });

    test('sign-in button starts a PKCE login against the japan-trip realm', async ({ page }) => {
      await page.goto('dashboard.html');
      await page.locator('#auth-login-prompt-btn').click();

      await page.waitForURL(/\/realms\/japan-trip\/protocol\/openid-connect\/auth\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get('client_id')).toBe('japan-trip-frontend');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toContain('openid');
      // The user must come back to where they started.
      expect(url.searchParams.get('redirect_uri')).toContain('dashboard.html');
    });

    test('navbar offers sign-in and hides sign-out / user label', async ({ page }) => {
      await page.goto('dashboard.html');
      await expect(page.locator('travel-nav .nav-auth-login')).toBeVisible();
      await expect(page.locator('travel-nav .nav-auth-logout')).toBeHidden();
      await expect(page.locator('travel-nav .nav-auth-user')).toBeHidden();
    });

    test('a hostile hash fragment does not authenticate the guest', async ({ page }) => {
      // keycloak-js parses #code=/#error= fragments; an attacker-supplied one with no
      // matching stored state must be ignored, not treated as a session.
      await page.goto('dashboard.html#code=forged&state=not-a-real-state&session_state=x');

      await expect(page.locator('#dashboard-login-prompt')).toBeVisible();
      await expect(page.locator('.trip-card')).toHaveCount(0);
      await expect(page.locator('travel-nav .nav-auth-logout')).toBeHidden();
    });
  });

  test.describe('authenticated', () => {
    test('dashboard renders the greeting, new-trip button and one card per trip', async ({ page }) => {
      await mockKeycloakLoggedIn(page);
      await mockApi(page, {
        trips: [mockTrip, { ...mockTrip, id: 2, name: 'Second Trip', is_public: false }],
      });

      await page.goto('dashboard.html');

      await expect(page.locator('#dashboard-greeting')).toHaveText('Hello, Test');
      await expect(page.locator('#dashboard-login-prompt')).toBeHidden();
      await expect(page.locator('#new-trip-btn')).toBeVisible();
      await expect(page.locator('#trips-grid')).toBeVisible();

      const cards = page.locator('#trips-grid .trip-card');
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0).locator('.trip-card-title')).toHaveText(mockTrip.name);
      await expect(cards.nth(1).locator('.trip-card-title')).toHaveText('Second Trip');
      await expect(cards.nth(0).locator('.trip-card-link')).toHaveAttribute('href', `trip.html?tripId=${mockTrip.id}`);
      // Only the public trip carries the badge.
      await expect(cards.nth(0).locator('.trip-card-badge--public')).toHaveCount(1);
      await expect(cards.nth(1).locator('.trip-card-badge--public')).toHaveCount(0);
    });

    test('a user with no trips gets the empty state with a working call to action', async ({ page }) => {
      await mockKeycloakLoggedIn(page);
      await mockApi(page, { trips: [] });

      await page.goto('dashboard.html');

      await expect(page.locator('#trips-grid .trip-card')).toHaveCount(0);
      await expect(page.locator('#trips-grid')).toContainText("You don't have any trips saved yet.");
      await page.locator('#empty-state-create-btn').click();
      await expect(page.locator('#create-trip-overlay')).toBeVisible();
    });

    test('an API outage shows an error state with Try again instead of a blank or stuck grid', async ({ page }) => {
      await mockKeycloakLoggedIn(page);
      await mockApi(page, { failWith: 500 });

      await page.goto('dashboard.html');

      // Persistent and announced to assistive tech (role=alert), not a toast that disappears.
      await expect(page.getByRole('alert')).toContainText("We couldn't load your trips");
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      await expect(page.locator('#trips-grid .trip-card--skeleton')).toHaveCount(0);
      // Page still finished initialising (not hung on the loading state forever).
      await expect(page.locator('body')).toHaveClass(/ready/);
    });

    test('a trip name with markup is rendered as text, never as HTML', async ({ page }) => {
      const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
      await mockKeycloakLoggedIn(page);
      await mockApi(page, { trips: [{ ...mockTrip, name: evil }] });

      await page.goto('dashboard.html');

      const title = page.locator('#trips-grid .trip-card-title');
      await expect(title).toHaveText(evil);
      await expect(page.locator('#trips-grid img')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    });

    test('sign-out navigates to the Keycloak logout endpoint and returns to the home page', async ({ page }) => {
      await mockKeycloakLoggedIn(page);
      await mockApi(page);

      await page.goto('dashboard.html');
      await expect(page.locator('travel-nav .nav-auth-user')).toContainText('Test');
      await expect(page.locator('travel-nav .nav-auth-login')).toBeHidden();

      await page.locator('travel-nav .nav-auth-logout').click();

      await page.waitForURL(/\/realms\/japan-trip\/protocol\/openid-connect\/logout\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get('post_logout_redirect_uri') ?? url.searchParams.get('redirect_uri')).toContain(
        'index.html',
      );
    });

    test('first login on a device is sent once to passkey registration, then left alone', async ({ page, context }) => {
      await mockKeycloakLoggedIn(page, { passkeyCampaignDone: false });
      await mockApi(page);

      await page.goto('dashboard.html');
      await page.waitForURL(/\/protocol\/openid-connect\/auth\?/);
      expect(new URL(page.url()).searchParams.get('kc_action')).toBe('webauthn-register-passwordless');

      // The per-device cookie is written BEFORE the redirect so a failing
      // registration cannot loop the user forever.
      const cookies = await context.cookies();
      expect(cookies.map((c) => c.name)).toContain('pnk_test-user-id');

      // Coming back (registration skipped/failed) must land on the dashboard, not loop.
      await page.goto('dashboard.html');
      await expect(page.locator('#trips-grid')).toBeVisible();
      await expect(page.locator('#mock-kc')).toHaveCount(0);
    });

    test('an authenticated visitor to the landing page is sent to the dashboard', async ({ page }) => {
      await mockKeycloakLoggedIn(page);
      await mockApi(page);

      await page.goto('');

      await page.waitForURL(/dashboard\.html$/);
      await expect(page.locator('#dashboard-login-prompt')).toBeHidden();
    });
  });
});

test.describe('Auth flow — real session', () => {
  test.fixme(!!process.env.SKIP_REAL_AUTH, 'requires a live Keycloak + backend (SKIP_REAL_AUTH is set, as in CI); the mocked-Keycloak specs cover the CI-safe paths — run this locally per SETUP.md');
  // webkit environment constraint: this describe relies on restoring an authenticated
  // session purely from a persisted storageState (.auth/user.json) + injected
  // sessionStorage, with no fresh login flow in the test itself. On webkit this
  // restoration doesn't reliably produce an authenticated app state (observed:
  // dashboard.html renders as if unauthenticated) — same class of webkit-specific
  // session-restoration limitation as session-management.spec.ts's webkit fixme.
  test.fixme(({ browserName }) => browserName === 'webkit', 'webkit does not reliably restore an authenticated session from storageState alone — environment constraint');

  const sessionEntries: [string, string][] = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(__dirname, '../.auth/session.json'), 'utf-8')
      ) as [string, string][];
    } catch {
      return [];
    }
  })();

  test.use({
    storageState: path.join(__dirname, '../.auth/user.json'),
  });

  test.beforeEach(async ({ context }) => {
    if (sessionEntries.length) {
      await context.addInitScript((entries) => {
        for (const [k, v] of entries) {
          window.sessionStorage.setItem(k, v);
        }
      }, sessionEntries);
    }
  });

  test('authenticated dashboard does not show login prompt', async ({ page }) => {
    await page.goto('dashboard.html');
    // `ready` is set only after init() finished (auth check + trips load), so the
    // negative assertion below cannot pass merely because init has not run yet.
    await expect(page.locator('body')).toHaveClass(/ready/, { timeout: 15000 });

    await expect(page.locator('#dashboard-login-prompt')).toBeHidden();
  });

  test('authenticated dashboard renders trips grid', async ({ page }) => {
    await page.goto('dashboard.html');

    await expect(page.locator('#trips-grid')).toBeVisible({ timeout: 15000 });
  });
});
