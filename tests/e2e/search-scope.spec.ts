import { test, expect, type Page } from '@playwright/test';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import { SPRING, WINTER, mockTripsBackend } from './fixtures/mockSearchTrips';

// Scope: the search box searches the demo on demo pages and the signed-in user's own trips
// on account pages (dashboard, trip view/editor, profile). Everything is mocked: no backend,
// no Keycloak server.

test.use({ storageState: { cookies: [], origins: [] } });

const input = (page: Page) => page.locator('search-bar input.search-input');
const options = (page: Page) => page.locator('search-bar [role="option"]');
const dropdown = (page: Page) => page.locator('search-bar .search-dropdown');
const titles = (page: Page) => page.locator('search-bar .result-title');
const status = (page: Page) => page.locator('search-bar .search-status');
const chip = (page: Page) => page.locator('search-bar .scope-chip');
// Real-query results (as opposed to suggestions and status rows) end with the keyboard hint.
const hint = (page: Page) => page.locator('search-bar .keyboard-hint');

test.describe('Search scope: demo pages search the demo', () => {
  test('the landing page says it searches the demo and finds demo places', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.goto('index.html#demo');
    await expect(page.locator('#landing-hero')).toBeVisible();

    await expect(input(page)).toHaveAttribute('placeholder', 'Search the demo');
    await input(page).fill('teamlab');
    await expect(hint(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Demo trip');
    await expect(titles(page).first()).toContainText(/teamlab/i);
  });

  // (index.html is not listed: a signed-in visitor is sent on to the dashboard.)
  for (const path of ['tokyo.html', 'kyoto.html']) {
    test(`${path} stays on the demo for a signed-in user and never asks the API for trips`, async ({ page }) => {
      await mockKeycloakLoggedIn(page);
      await stubMapThirdParty(page);
      const backend = await mockTripsBackend(page);
      await page.goto(path);

      await expect(input(page)).toHaveAttribute('placeholder', 'Search the demo');
      await input(page).fill('Hokkaido');
      await expect(page.locator('search-bar .search-empty')).toContainText('No results found');
      await input(page).fill('Fushimi');
      await expect(hint(page)).toBeVisible();
      await expect(chip(page)).toHaveText('Demo trip');
      expect(backend.calls.filter((c) => c === 'GET /trips')).toEqual([]);
    });
  }
});

test.describe("Search scope: account pages search the user's trips", () => {
  test.beforeEach(async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
  });

  test("dashboard: placeholder, chip and results come from the user's trips, not the demo", async ({ page }) => {
    const backend = await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await expect(page.locator('#trips-grid')).toBeVisible();

    await expect(input(page)).toHaveAttribute('placeholder', 'Search your trips');
    await expect(input(page)).toHaveAttribute('aria-label', /your trips/i);

    await input(page).fill('ramen');
    await expect(hint(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Your trips');
    expect((await titles(page).allTextContents()).sort()).toEqual(['Dotonbori ramen', 'Ramen Yokocho', 'Ramen alley']);
    await expect(page.locator('search-bar .result-context').first()).toContainText('·');
    expect(backend.calls).toContain('GET /trips/trip-spring');
    expect(backend.calls).toContain('GET /trips/trip-winter');

    // A demo-only place is not in this account.
    await input(page).fill('teamlab');
    await expect(page.locator('search-bar .search-empty')).toContainText('No results found in your trips');
    await expect(options(page)).toHaveCount(0);
  });

  test("focusing the empty box lists the user's trips", async ({ page }) => {
    await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await input(page).click();
    await expect(page.locator('search-bar .section-header')).toHaveText('Your trips');
    await expect(titles(page)).toHaveText(['Spring in Kansai', 'Winter in Hokkaido']);
  });

  test('a result deep-links to its trip, destination and activity, and the trip page opens there', async ({ page }) => {
    await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await input(page).fill('dotonbori');
    await expect(hint(page)).toBeVisible();
    await options(page).first().click();

    await expect(page).toHaveURL(/trip\.html\?/);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tripId: 'trip-spring',
      destIndex: '1',
      day: '2026-04-03',
      activity: 'Dotonbori ramen',
    });
    // The trip page opens in the city view of the matched destination.
    await expect(page.locator('#trip-title')).toHaveText('Osaka');
    await expect(page.locator('#dest-tabs [aria-current="page"]')).toContainText('Osaka');
  });

  test('keyboard: arrows and Enter open a trip result', async ({ page }) => {
    await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await input(page).fill('snow');
    await expect(hint(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tripId=trip-winter/);
  });

  test('on a trip page the current trip comes first, then the others', async ({ page }) => {
    await mockTripsBackend(page);
    await page.goto('trip.html?tripId=trip-winter');
    await expect(page.locator('#trip-title')).toHaveText('Winter in Hokkaido');

    await input(page).fill('ramen');
    await expect(hint(page)).toBeVisible();
    await expect(page.locator('search-bar .section-header')).toHaveText(['This trip', 'Other trips']);
    await expect(titles(page).first()).toHaveText('Ramen Yokocho');
    await expect(titles(page)).toHaveCount(3);
  });

  test('the profile and trip pages use the same user scope', async ({ page }) => {
    await mockTripsBackend(page);
    for (const path of ['profile.html', 'trip.html?tripId=trip-spring']) {
      await page.goto(path);
      await expect(input(page)).toHaveAttribute('placeholder', 'Search your trips');
    }
  });

  test('switching between pages switches the scope with it', async ({ page }) => {
    const backend = await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await expect(input(page)).toHaveAttribute('placeholder', 'Search your trips');
    await input(page).fill('fushimi');
    await expect(titles(page).first()).toHaveText('Fushimi Inari');
    await expect(page.locator('search-bar [role="option"] .result-context')).toContainText('Kyoto · Spring in Kansai');

    const listCalls = (): number => backend.calls.filter((c) => c === 'GET /trips').length;
    const before = listCalls();
    await page.goto('tokyo.html');
    await expect(input(page)).toHaveAttribute('placeholder', 'Search the demo');
    await input(page).fill('fushimi');
    await expect(hint(page)).toBeVisible();
    await expect(page.locator('search-bar [role="option"] .result-context')).toHaveCount(0);
    await expect(chip(page)).toHaveText('Demo trip');
    expect(listCalls()).toBe(before);

    await page.goto('dashboard.html');
    await expect(input(page)).toHaveAttribute('placeholder', 'Search your trips');
  });

  test('a second query reuses what was loaded: no more trip requests', async ({ page }) => {
    const backend = await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await input(page).fill('ramen');
    await expect(hint(page)).toBeVisible();
    const after = backend.calls.length;
    await input(page).fill('snow');
    await expect(titles(page).first()).toHaveText('Snow festival');
    await input(page).fill('osaka');
    await expect(titles(page).first()).toHaveText('Osaka');
    expect(backend.calls.length).toBe(after);
  });

  test('a trip created from the dashboard shows up in the next search (cache invalidated)', async ({ page }) => {
    const backend = await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await input(page).fill('hakodate');
    await expect(page.locator('search-bar .search-empty')).toBeVisible();

    // The trip now exists on the backend and a write through the app's API client succeeded
    // (it announces that with this window event), so the cached index must be dropped.
    backend.setTrips([SPRING, WINTER, { id: 'trip-new', name: 'Hakodate weekend', dests: [] }]);
    await page.evaluate(() => window.dispatchEvent(new Event('travelmap:trips-changed')));

    await input(page).fill('hakodate');
    await expect(titles(page).first()).toHaveText('Hakodate weekend');
  });

  test('markup in trip names is shown as text, never run', async ({ page }) => {
    await mockTripsBackend(page, {
      trips: [
        {
          id: 'x',
          name: 'Zzq <img src=x onerror="window.__pwned=1">',
          dests: [
            {
              city: 'Zzq <script>window.__pwned=1</script>',
              days: [{ date: '2026-01-01', label: 'D', acts: [{ name: 'Zzq "><svg onload=window.__pwned=1>', notes: 'Zzq <b>note</b>' }] }],
            },
          ],
        },
      ],
    });
    await page.goto('dashboard.html');
    await input(page).fill('zzq');
    await expect(hint(page)).toBeVisible();
    await expect(page.locator('search-bar img, search-bar svg[onload], search-bar script, search-bar b')).toHaveCount(0);
    await expect(titles(page).first()).toContainText('<');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('typing quickly and then more shows only the latest query once the trips arrive', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await mockTripsBackend(page, { listGate: gate });
    await page.goto('dashboard.html');
    await input(page).fill('snow');
    await expect(status(page)).toContainText('Loading your trips');
    await input(page).fill('osaka');
    await expect(status(page)).toContainText('Loading your trips');

    release();
    await expect(hint(page)).toBeVisible();
    await expect(titles(page).first()).toHaveText('Osaka');
    await expect(titles(page).filter({ hasText: 'Snow' })).toHaveCount(0);
    await expect(status(page)).toHaveCount(0);
  });

  test('closing the box while loading cancels it: nothing opens when the answer arrives', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const backend = await mockTripsBackend(page, { listGate: gate });
    await page.goto('dashboard.html');
    await input(page).fill('ramen');
    await expect(status(page)).toContainText('Loading your trips');

    await page.keyboard.press('Escape');
    await expect(dropdown(page)).not.toHaveClass(/\bopen\b/);
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/trips') && r.request().method() === 'GET');
    release();
    await answered;
    await expect(dropdown(page)).not.toHaveClass(/\bopen\b/);

    await input(page).click();
    await expect(titles(page).first()).toBeVisible();
    await expect(dropdown(page)).toHaveClass(/\bopen\b/);
    expect(backend.calls.filter((c) => c.startsWith('GET /trips/')).length).toBeGreaterThan(0);
  });
});

test.describe('Search scope: failure and edge states', () => {
  test('logged out on the dashboard: demo results and an offer to sign in', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    const backend = await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await expect(page.locator('#dashboard-login-prompt')).toBeVisible();

    await expect(input(page)).toHaveAttribute('placeholder', 'Search the demo');
    await input(page).fill('Kyoto');
    await expect(hint(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Demo trip');
    await expect(page.locator('search-bar .scope-note')).toContainText(/sign in to search your own trips/i);
    expect(backend.calls.filter((c) => c === 'GET /trips')).toEqual([]);

    const authorize = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/auth'));
    await page.locator('search-bar .scope-bar .link-btn').click();
    expect(new URL((await authorize).url()).searchParams.get('client_id')).toBeTruthy();
  });

  test('API 500: error message with Retry, and Retry recovers', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    const backend = await mockTripsBackend(page, { listStatus: 500 });
    await page.goto('dashboard.html');
    await input(page).fill('ramen');

    await expect(page.locator('search-bar .search-status.error')).toContainText("Couldn't load your trips");
    await expect(options(page)).toHaveCount(0);

    backend.setListStatus(undefined);
    await page.locator('search-bar .search-status .link-btn').click();
    await expect(hint(page)).toBeVisible();
    await expect(status(page)).toHaveCount(0);
    await expect(titles(page).first()).toContainText(/ramen/i);
  });

  test('API that never answers: loading, then a timeout error with Retry (the box never hangs)', async ({ page }) => {
    await page.clock.install();
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    await mockTripsBackend(page, { listHangs: true });
    await page.goto('dashboard.html');
    await input(page).fill('ramen');
    await expect(page.locator('search-bar .search-status.loading')).toBeVisible();

    await page.clock.runFor(9_000);
    await expect(page.locator('search-bar .search-status.error')).toContainText('taking too long');
    await expect(page.locator('search-bar .search-status .link-btn')).toHaveText('Retry');
    await expect(page.locator('search-bar .search-status.loading')).toHaveCount(0);
  });

  test('empty account: invites to create a first trip', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    await mockTripsBackend(page, { trips: [] });
    await page.goto('dashboard.html');
    await input(page).click();

    await expect(page.locator('search-bar .search-status.empty-account')).toContainText('No trips yet');
    const create = page.locator('search-bar .search-status a.link-btn');
    await expect(create).toHaveText(/create your first trip/i);
    await create.click();
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test('sign-in service unreachable: falls back to the demo with a message instead of hanging', async ({ page }) => {
    await page.clock.install();
    await stubMapThirdParty(page);
    await mockTripsBackend(page);
    // Keycloak never answers: the app gives up on its own bounded wait.
    await page.route('**/realms/**', () => undefined);
    await page.goto('dashboard.html', { waitUntil: 'commit' });

    await page.clock.runFor(6_000);
    await input(page).fill('Kyoto');
    await expect(hint(page)).toBeVisible();
    await expect(chip(page)).toHaveText('Demo trip');
    await expect(page.locator('search-bar .scope-note')).toContainText(/can't reach sign-in/i);
    await expect(page.locator('search-bar .scope-bar .link-btn')).toHaveText('Retry');
  });
});

test.describe('Search at 375px', () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test('the button does not overlap content and the expanded box and its results fit the screen', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    await mockTripsBackend(page);
    await page.goto('dashboard.html');
    await expect(page.locator('#trips-grid')).toBeVisible();

    const wrapper = page.locator('search-bar .search-input-wrapper');
    const closed = (await wrapper.boundingBox())!;
    expect(closed.width).toBeGreaterThanOrEqual(44);
    expect(closed.height).toBeGreaterThanOrEqual(44);
    const nav = (await page.locator('travel-nav').boundingBox())!;
    expect(closed.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1); // below the navbar, not over it

    await input(page).fill('ramen');
    await expect(hint(page)).toBeVisible();
    const box = (await dropdown(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);

    // A very long query must not widen the page either.
    await input(page).fill('x'.repeat(400));
    await expect(page.locator('search-bar .search-empty')).toBeVisible();
    const [sw2, iw2] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw2).toBeLessThanOrEqual(iw2);
  });

  test('error states fit the screen too', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    await mockTripsBackend(page, { listStatus: 500 });
    await page.goto('dashboard.html');
    await input(page).fill('ramen');
    await expect(page.locator('search-bar .search-status.error')).toBeVisible();
    const box = (await dropdown(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw).toBeLessThanOrEqual(iw);
  });
});

test.describe('Search in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the dropdown and its status rows use the dark tokens (no light-on-light)', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await stubMapThirdParty(page);
    await mockTripsBackend(page, { listStatus: 500 });
    await page.goto('dashboard.html');
    await input(page).fill('ramen');
    await expect(page.locator('search-bar .search-status.error')).toBeVisible();

    const luminance = await page.evaluate(() => {
      const root = document.querySelector('search-bar')!.shadowRoot!;
      const lum = (rgb: string): number => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number) as [number, number, number];
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      return {
        bg: lum(getComputedStyle(root.querySelector('.search-dropdown')!).backgroundColor),
        fg: lum(getComputedStyle(root.querySelector('.status-title')!).color),
      };
    });
    expect(luminance.bg).toBeLessThan(0.4);
    expect(luminance.fg).toBeGreaterThan(0.6);
  });
});
