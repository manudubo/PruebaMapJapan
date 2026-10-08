import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty, TILE_HOST } from './fixtures/mockThirdParty';
import {
  japanTrip, singleCityTrip, noActivitiesTrip, noCoordsTrip, allUnlocatedTrip, longNamesTrip, xssTrip, XSS,
  upcomingTrip, activeTrip, pastTrip, routeOwnerTrip, routePublicTrip,
} from './fixtures/mockTripView';

/**
 * Viewing a saved trip the way the demo is viewed: overview map (numbered cities, dashed route,
 * city cards) and per-city views. Hermetic: Keycloak, API and tiles are mocked.
 *
 *   npm run build --workspace=frontend && npm run preview --workspace=frontend
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test trip-view --project=chromium
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function openOwner(page: Page, trip: unknown, url: string, options: Parameters<typeof routeOwnerTrip>[2] = {}) {
  await mockKeycloakLoggedIn(page);
  await mockApi(page);
  await stubMapThirdParty(page);
  const route = await routeOwnerTrip(page, trip, options);
  await page.goto(url);
  return route;
}

const markers = (page: Page) => page.locator('#map .leaflet-marker-icon.custom-marker');
const cards = (page: Page) => page.locator('#overview-cities .city-card');

test.describe('overview of a saved trip', () => {
  test('many cities: numbered markers in order, a dashed route, a card per city, OSM attribution', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tileHosts = new Set<string>();
    page.on('request', (r) => { if (/\/\d+\/\d+\/\d+\.png/.test(r.url())) tileHosts.add(new URL(r.url()).host); });

    await openOwner(page, japanTrip(), 'trip.html?tripId=11');

    await expect(cards(page)).toHaveCount(5);
    await expect(markers(page)).toHaveText(['1', '2', '3', '4', '5']);
    await expect(page.locator('#map path.leaflet-interactive[stroke-dasharray="8, 8"]')).toHaveCount(1);
    await expect(cards(page).nth(0).locator('strong')).toHaveText('Tokyo');
    await expect(cards(page).nth(4).locator('strong')).toHaveText('Tokyo (return)');
    await expect(cards(page).nth(0).locator('small')).toContainText('3 days · 6 places');
    await expect(page.locator('#map .leaflet-control-attribution')).toContainText('OpenStreetMap contributors');
    await expect(page.locator('#trip-stats li')).toHaveText(['5 cities', '14 days', '12 places']);
    expect([...tileHosts]).toEqual([TILE_HOST]);
    expect(errors).toEqual([]);
  });

  test('a single city: one marker, one card, no stray route', async ({ page }) => {
    await openOwner(page, singleCityTrip, 'trip.html?tripId=12');
    await expect(cards(page)).toHaveCount(1);
    await expect(markers(page)).toHaveCount(1);
    await expect(page.locator('#trip-stats li').first()).toHaveText('1 city');
  });

  test('clicking a marker opens a popup whose link opens that city without reloading', async ({ page }) => {
    await openOwner(page, japanTrip(), 'trip.html?tripId=11');
    await page.evaluate(() => { (window as unknown as { __kept: number }).__kept = 1; });

    await markers(page).nth(1).click();
    const popup = page.locator('#map .leaflet-popup');
    await expect(popup.locator('h4')).toHaveText('Kyoto');
    await popup.locator('.overview-popup-link').click();

    await expect(page).toHaveURL(/destIndex=1/);
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
    expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
  });

  test('hovering a card highlights its marker; a card is keyboard reachable', async ({ page }) => {
    await openOwner(page, japanTrip(), 'trip.html?tripId=11');
    await cards(page).nth(2).hover();
    await expect(markers(page).nth(2)).toHaveClass(/is-highlighted/);
    await cards(page).nth(3).focus();
    await expect(markers(page).nth(3)).toHaveClass(/is-highlighted/);
  });

  test('cities without coordinates are listed, flagged and left off the map', async ({ page }) => {
    await openOwner(page, noCoordsTrip, 'trip.html?tripId=14');
    await expect(cards(page)).toHaveCount(4);
    await expect(markers(page)).toHaveText(['1', '4']);
    await expect(cards(page).nth(1).locator('.city-nopin')).toHaveText('No location yet');
    await expect(cards(page).nth(2).locator('.city-nopin')).toBeVisible();
    await expect(page.locator('#overview-map-note')).toContainText('2 of 4 cities have no location');
  });

  test('no city has a location: no map, a clear note, cards still work', async ({ page }) => {
    await openOwner(page, allUnlocatedTrip, 'trip.html?tripId=15');
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('#map.leaflet-container')).toHaveCount(0);
    await expect(page.locator('#overview-map-note')).toContainText('None of the cities has a location');
    await cards(page).first().click();
    await expect(page.locator('#trip-title')).toHaveText('First');
    await expect(page.locator('#city-map-note')).toContainText('no map to show');
  });

  test('exactly one h1 and a named map', async ({ page }) => {
    await openOwner(page, japanTrip(), 'trip.html?tripId=11');
    await expect(page.locator('main h1:visible')).toHaveCount(1);
    await expect(page.locator('#map')).toHaveAttribute('aria-label', 'Map of Japan 2027');
    await expect(page.locator('#map')).toHaveAttribute('role', 'application');
  });
});

test.describe('trip phase', () => {
  test('upcoming trip: countdown and an "In N days" chip', async ({ page }) => {
    await openOwner(page, upcomingTrip(12), 'trip.html?tripId=21');
    await expect(page.locator('#trip-chip')).toHaveText('In 12 days');
    await expect(page.locator('#demo-countdown-wrap')).toBeVisible();
    await expect(page.locator('#cd-days')).toHaveText('11');
    await expect(page.locator('#trip-progress')).toBeHidden();
  });

  test('trip in progress: day-of-trip progress, no countdown', async ({ page }) => {
    await openOwner(page, activeTrip, 'trip.html?tripId=22');
    await expect(page.locator('#trip-chip')).toHaveText('Day 3 of 8');
    await expect(page.locator('#trip-progress [role="progressbar"]')).toHaveAttribute('aria-valuenow', '38');
    await expect(page.locator('#demo-countdown-wrap')).toBeHidden();
  });

  test('past trip: "Completed", nothing counting down', async ({ page }) => {
    await openOwner(page, pastTrip, 'trip.html?tripId=23');
    await expect(page.locator('#trip-chip')).toHaveText('Completed');
    await expect(page.locator('#demo-countdown-wrap')).toBeHidden();
    await expect(page.locator('#trip-progress')).toBeHidden();
  });
});

test.describe('a city of a saved trip', () => {
  test('days, activities, hotel and a day filter that hides the other days', async ({ page }) => {
    await openOwner(page, japanTrip(), 'trip.html?tripId=11&destIndex=0');

    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    await expect(page.locator('#trip-back')).toHaveText('Japan 2027');
    await expect(page.locator('#day-selector .day-btn')).toHaveCount(3);
    await expect(page.locator('#legend-grid .day-group')).toHaveCount(3);
    await expect(page.locator('#legend-grid .legend-item')).toHaveCount(6);
    await expect(page.locator('#hotel-info')).toContainText('Via Inn Akasaka');
    await expect(page.locator('.day-group.has-options')).toHaveCount(1);
    await expect(page.locator('.legend-item.is-optional .legend-marker')).toHaveText(['A', 'B']);

    const second = page.locator('#day-selector .day-btn').nth(1);
    await second.click();
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend-grid .day-group:visible')).toHaveCount(1);
    await expect(markers(page).filter({ hasText: /^[1-9AB]$/ })).not.toHaveCount(0);
    await second.click();
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#legend-grid .day-group:visible')).toHaveCount(3);
  });

  test('the back link returns to the overview and the browser back button works', async ({ page }) => {
    await openOwner(page, japanTrip(), 'trip.html?tripId=11');
    await cards(page).nth(1).click();
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
    await page.locator('#trip-back').click();
    await expect(page.locator('#trip-title')).toHaveText('Japan 2027');
    await expect(page).not.toHaveURL(/destIndex/);
    await page.goBack();
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
  });

  test('a city with no activities (and a day with none) says so instead of looking broken', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openOwner(page, noActivitiesTrip, 'trip.html?tripId=13&destIndex=0');
    await expect(page.locator('.legend-empty')).toHaveText('Nothing planned for this day yet.');
    await expect(page.locator('#hotel-info')).toBeHidden();
    await expect(page.locator('#hotel-btn')).toBeHidden();

    await page.locator('#dest-tabs .dest-tab').nth(1).click();
    await expect(page.locator('#legend-grid')).toContainText('No days have been planned for Kobe yet.');
    expect(errors).toEqual([]);
  });

  test('a city with no location shows a note instead of a world map', async ({ page }) => {
    await openOwner(page, noCoordsTrip, 'trip.html?tripId=14&destIndex=2');
    await expect(page.locator('#city-map-note')).toContainText('No locations have been added for Blank coords');
    await expect(page.locator('#map.leaflet-container')).toHaveCount(0);
  });

  test('an activity without a pin is listed, a located one links to Maps', async ({ page }) => {
    await openOwner(page, noCoordsTrip, 'trip.html?tripId=14&destIndex=1');
    await expect(page.locator('#legend-grid .legend-item')).toContainText('A place with no pin');
    await expect(page.locator('#legend-grid .legend-actions')).toHaveCount(0);
  });

  test('keeps OSM tiles and attribution in a city map', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('request', (r) => { if (/\/\d+\/\d+\/\d+\.png/.test(r.url())) hosts.add(new URL(r.url()).host); });
    await openOwner(page, japanTrip(), 'trip.html?tripId=11&destIndex=1');
    await expect(markers(page).first()).toBeVisible();
    await expect(page.locator('#map .leaflet-control-attribution')).toContainText('OpenStreetMap contributors');
    expect([...hosts]).toEqual([TILE_HOST]);
  });
});

test.describe('hostile and awkward content', () => {
  test('XSS strings in every field render as text and never run', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openOwner(page, xssTrip, 'trip.html?tripId=17');

    await expect(page.locator('#trip-title')).toHaveText(XSS);
    await expect(page.locator('#trip-description')).toHaveText(XSS);
    await expect(cards(page).first().locator('strong')).toHaveText(XSS);
    await markers(page).first().click();
    await expect(page.locator('#map .leaflet-popup h4')).toHaveText(XSS);

    await page.locator('#map .leaflet-popup .overview-popup-link').click();
    await expect(page.locator('#legend-grid .legend-item strong')).toHaveText(XSS);
    await expect(page.locator('#hotel-info')).toContainText(XSS);
    // The activity's javascript: maps link is dropped; the pin falls back to a coordinate search link.
    const hrefs = await page.locator('#legend-grid a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.every((h) => h && h.startsWith('https://'))).toBe(true);
    await page.locator('#map .leaflet-marker-icon.custom-marker').first().click();
    await expect(page.locator('#map .leaflet-popup h4').first()).toHaveText(XSS);

    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.locator('#trip-header img, #trip-header script, #legend-grid img, #legend-grid script, #overview-cities img, #hotel-info img, #dest-tabs img, .leaflet-popup img, .leaflet-popup script').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('very long names wrap: no horizontal scroll at 375px, in either view', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openOwner(page, longNamesTrip, 'trip.html?tripId=16');
    await expect(cards(page)).toHaveCount(2);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await cards(page).first().click();
    await expect(page.locator('#legend-grid .legend-item').first()).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test.describe('shared (public) trip', () => {
  async function openShared(page: Page, body: unknown, url: string, options: Parameters<typeof routePublicTrip>[2] = {}) {
    await mockKeycloakLoggedOut(page);
    const calls = await mockApi(page);
    await stubMapThirdParty(page);
    const route = await routePublicTrip(page, body, options);
    await page.goto(url);
    return { calls, route };
  }

  test('loads without signing in: overview, shared chip, no owner controls, links keep the slug', async ({ page }) => {
    const auth: string[] = [];
    page.on('request', (r) => { const h = r.headers()['authorization']; if (h) auth.push(r.url()); });
    await openShared(page, japanTrip(), 'trip.html?slug=a1b2c3d4-japan');

    await expect(page.locator('#trip-title')).toHaveText('Japan 2027');
    await expect(page.locator('#trip-chip')).toContainText('Shared trip');
    await expect(cards(page)).toHaveCount(5);
    await expect(markers(page)).toHaveCount(5);
    await expect(page.locator('#trip-edit-link')).toBeHidden();
    await expect(page.locator('#copy-link-btn')).toBeHidden();
    await expect(page.locator('#trip-back')).toBeHidden();
    await expect(cards(page).first()).toHaveAttribute('href', 'trip.html?slug=a1b2c3d4-japan&destIndex=0');
    expect(auth).toEqual([]);

    await cards(page).first().click();
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    await expect(page.locator('#trip-back')).toHaveAttribute('href', 'trip.html?slug=a1b2c3d4-japan');
  });

  test('a slug that does not exist (or was un-shared) says so, with no retry', async ({ page }) => {
    await openShared(page, null, 'trip.html?slug=gone', { status: 404 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shared trip not available');
    await expect(page.locator('#trip-retry-btn')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', 'index.html');
  });

  test('a shared trip with an unplanned, empty trip shows the owner-not-added message', async ({ page }) => {
    await openShared(page, { ...japanTrip(), destinations: [] }, 'trip.html?slug=a1b2c3d4-japan');
    await expect(page.locator('#trip-empty')).toContainText('The owner has not added any cities');
    await expect(page.locator('#trip-empty a')).toHaveCount(0);
  });
});

test.describe('trip that cannot be loaded', () => {
  test('403 from the API: no access, no retry button', async ({ page }) => {
    await openOwner(page, null, 'trip.html?tripId=11', { status: 403 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No access to this trip');
    await expect(page.locator('#trip-retry-btn')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to dashboard' })).toBeVisible();
  });

  test('API down: a clear message with Try again, and Try again recovers', async ({ page }) => {
    const route = await openOwner(page, japanTrip(), 'trip.html?tripId=11', { abort: true });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Couldn't load the trip");
    await expect(page.locator('#trip-problem [role="alert"]')).toBeVisible();

    route.setOptions({});
    await page.locator('#trip-retry-btn').click();
    await expect(page.locator('#trip-title')).toHaveText('Japan 2027');
    await expect(cards(page)).toHaveCount(5);
    await expect(page.locator('#trip-problem')).toHaveCount(0);
  });

  test('a gateway error page (non-JSON 502) is treated as retryable, not "no access"', async ({ page }) => {
    await openOwner(page, null, 'trip.html?tripId=11', { gatewayError: true });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Couldn't load the trip");
    await expect(page.locator('#trip-retry-btn')).toBeVisible();
  });

  test('slow API: skeleton first, then a "taking longer" notice at 3s, then the trip when it arrives', async ({ page }) => {
    await openOwner(page, japanTrip(), 'trip.html?tripId=11', { delayMs: 4500 });
    await expect(page.locator('#trip-skeleton')).toBeVisible();
    await expect(page.locator('#trip-card')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#trip-slow')).toBeVisible({ timeout: 3900 });
    await expect(page.locator('#trip-slow-retry')).toBeVisible();

    await expect(page.locator('#trip-title')).toHaveText('Japan 2027', { timeout: 6000 });
    await expect(page.locator('#trip-slow')).toBeHidden();
    await expect(page.locator('#trip-skeleton')).toBeHidden();
    await expect(page.locator('#trip-card')).toHaveAttribute('aria-busy', 'false');
  });
});

test.describe('light and dark', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: card surface follows the theme tokens and text stays readable`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openOwner(page, japanTrip(), 'trip.html?tripId=11');
      await expect(cards(page).first()).toBeVisible();
      const colors = await page.evaluate(() => {
        const bg = getComputedStyle(document.querySelector('.page-card')!).backgroundColor;
        const fg = getComputedStyle(document.querySelector('#trip-title')!).color;
        return { bg, fg };
      });
      expect(colors).toEqual(scheme === 'dark'
        ? { bg: 'rgb(28, 28, 30)', fg: 'rgb(245, 245, 247)' }
        : { bg: 'rgb(255, 255, 255)', fg: 'rgb(29, 29, 31)' });
    });
  }
});
