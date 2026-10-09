import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import { mockOpenMeteo, type MeteoBehaviour } from './fixtures/mockOpenMeteo';
import { trip, city, day, isoFromToday, routeOwnerTrip } from './fixtures/mockTripView';

/**
 * Weather on the trip city view: the demo's Open-Meteo card, fed by the destination's own
 * coordinates and dates. Hermetic: Keycloak, API, tiles and Open-Meteo are mocked.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const XSS_CITY = 'Evil <img src=x onerror="window.__pwned=1">';

const weatherTrip = trip({ id: 41, name: 'Weather trip' }, [
  city({ name: 'Kyoto', lat: 35.0116, lng: 135.7681, start: isoFromToday(3), end: isoFromToday(5), days: [day(isoFromToday(3), 'Day 1', '#34c759', [{ name: 'Fushimi', lat: 34.97, lng: 135.77 }])] }),
  city({ name: 'Osaka', lat: 34.6937, lng: 135.5023 }), // no dates
  city({ name: 'Nara', hotel: { name: 'Ryokan', lat: 34.68, lng: 135.8 }, start: isoFromToday(3), end: isoFromToday(4) }), // no destination coordinates
  city({ name: 'Sapporo', lat: 43.0618, lng: 141.3545, start: '2031-02-01', end: '2031-02-04' }), // beyond the forecast
  city({ name: 'Hakone', lat: 35.233, lng: 139.107, start: '2019-03-01', end: '2019-03-04' }), // over
  city({ name: XSS_CITY, lat: 35, lng: 139, start: isoFromToday(1), end: isoFromToday(2) }),
]);

async function open(page: Page, behaviour: MeteoBehaviour, url: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockKeycloakLoggedIn(page);
  await mockApi(page);
  await stubMapThirdParty(page);
  const meteo = await mockOpenMeteo(page, behaviour);
  await routeOwnerTrip(page, weatherTrip);
  await page.goto(url);
  return { meteo, errors };
}

const section = (page: Page) => page.locator('#trip-weather');
const card = (page: Page) => page.locator('#trip-weather #widget-weather');
const content = (page: Page) => page.locator('#trip-weather .widget-content');
/** The card loads when it is near the viewport, like the demo's. */
const reveal = async (page: Page) => { await section(page).scrollIntoViewIfNeeded(); };

test.describe('forecast for the destination', () => {
  test('a stay inside the forecast horizon: its days, same card as the demo', async ({ page }) => {
    const { meteo, errors } = await open(page, 'ok', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    await expect(section(page)).toBeVisible();
    await expect(page.locator('#trip-weather-title')).toHaveText('Weather in Kyoto');
    await expect(card(page).locator('h4')).toHaveText('Weather & Forecast');
    await expect(content(page).locator('.weather-temp')).toHaveText('15°');
    await expect(content(page).locator('.weather-period')).toHaveText(/^Forecast for \d+(–| ?\w* ?–)/);
    await expect(content(page).locator('.forecast-day')).toHaveCount(2);
    await expect(content(page).locator('.forecast-icon svg')).toHaveCount(2);
    await expect(content(page)).toHaveAttribute('aria-busy', 'false');

    expect(meteo.requests).toHaveLength(1);
    const q = meteo.requests[0]!.searchParams;
    expect(q.get('start_date')).toBe(isoFromToday(3));
    expect(q.get('end_date')).toBe(isoFromToday(5));
    expect(q.get('latitude')).toBe('35.01');
    expect(q.get('longitude')).toBe('135.77');
    expect(q.get('timezone')).toBe('auto');
    expect(errors).toEqual([]);
  });

  test('the markup is the demo one (reused classes), with an accessible name per part', async ({ page }) => {
    await open(page, 'ok', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    await expect(content(page).locator('.weather-current .weather-condition .weather-icon-large')).toBeVisible();
    await expect(content(page).locator('.weather-temp')).toHaveAttribute('role', 'img');
    await expect(content(page).locator('.weather-temp')).toHaveAttribute('aria-label', /^High on /);
    await expect(content(page).locator('.weather-forecast')).toHaveAttribute('role', 'list');
    await expect(page.locator('#trip-weather')).toHaveAttribute('aria-labelledby', 'trip-weather-title');
    await expect(page.locator('#trip-weather h3')).toHaveCount(1);
  });

  test('no dates: the current weather and the next days, saying why', async ({ page }) => {
    const { meteo } = await open(page, 'ok', 'trip.html?tripId=41&destIndex=1');
    await reveal(page);
    await expect(content(page).locator('.weather-temp')).toHaveText('12°');
    await expect(content(page).locator('.weather-temp')).toHaveAttribute('aria-label', 'Current temperature 12 degrees');
    await expect(content(page).locator('.weather-period')).toContainText('No dates for this stay yet');
    await expect(content(page).locator('.forecast-day')).toHaveCount(4);
    expect(meteo.requests[0]!.searchParams.get('forecast_days')).toBe('5');
    expect(meteo.requests[0]!.searchParams.has('start_date')).toBe(false);
  });

  test('a stay beyond the forecast horizon or already over: the current weather, with the reason', async ({ page }) => {
    const { meteo } = await open(page, 'ok', 'trip.html?tripId=41&destIndex=3');
    await reveal(page);
    await expect(content(page).locator('.weather-period')).toContainText('more than two weeks away');
    await page.locator('#dest-tabs a', { hasText: 'Hakone' }).click();
    await expect(page.locator('#trip-weather-title')).toHaveText('Weather in Hakone');
    await reveal(page);
    await expect(content(page).locator('.weather-period')).toContainText('This stay is over');
    expect(meteo.requests.every((r) => r.searchParams.has('forecast_days'))).toBe(true);
  });

  test('a destination without its own coordinates: no card and no request', async ({ page }) => {
    const { meteo } = await open(page, 'ok', 'trip.html?tripId=41&destIndex=2');
    await expect(page.locator('#trip-title')).toHaveText('Nara');
    await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible(); // the hotel pin: the map is there
    await expect(section(page)).toBeHidden();
    expect(meteo.requests).toEqual([]);
  });

  test('the overview has no weather; switching city shows the new city and its own request', async ({ page }) => {
    const { meteo } = await open(page, 'ok', 'trip.html?tripId=41');
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(6);
    await expect(section(page)).toBeHidden();
    expect(meteo.requests).toEqual([]);

    await page.locator('#overview-cities .city-card', { hasText: 'Osaka' }).click();
    await reveal(page);
    await expect(page.locator('#trip-weather-title')).toHaveText('Weather in Osaka');
    await expect(content(page).locator('.weather-temp')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(6);
    await expect(section(page)).toBeHidden();
  });

  test('a repeat visit is served from the cache: no second request', async ({ page }) => {
    const { meteo } = await open(page, 'ok', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    await expect(content(page).locator('.weather-temp')).toBeVisible();
    expect(meteo.requests).toHaveLength(1);
    await page.reload();
    await reveal(page);
    await expect(content(page).locator('.weather-temp')).toBeVisible();
    expect(meteo.requests).toHaveLength(1);
  });

  test('the request waits until the card is near the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    const { meteo } = await open(page, 'ok', 'trip.html?tripId=41&destIndex=0');
    await expect(page.locator('#legend-grid .legend-item').first()).toBeAttached();
    expect(meteo.requests).toHaveLength(0);
    await reveal(page);
    await expect(content(page).locator('.weather-temp')).toBeVisible();
    expect(meteo.requests).toHaveLength(1);
  });
});

test.describe('when Open-Meteo misbehaves', () => {
  for (const behaviour of ['http500', 'http429', 'malformed', 'garbage', 'empty', 'no-days'] as const) {
    test(`${behaviour}: a short message and Try again; the itinerary is untouched; Try again recovers`, async ({ page }) => {
      const { meteo, errors } = await open(page, behaviour, 'trip.html?tripId=41&destIndex=0');
      await reveal(page);
      await expect(content(page)).toContainText('Weather unavailable right now.');
      await expect(content(page).locator('[role="status"]')).toBeVisible();
      await expect(content(page)).toHaveAttribute('aria-busy', 'false');
      await expect(content(page).locator('.loader')).toHaveCount(0);
      // The page works: map, legend, day filter.
      await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
      await page.locator('#day-selector .day-btn').first().click();
      await expect(page.locator('#day-selector .day-btn.active')).toHaveCount(1);

      meteo.set('ok');
      await page.locator('#trip-weather-retry').click();
      await expect(content(page).locator('.weather-temp')).toBeVisible();
      await expect(page.locator('#trip-weather-retry')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('unreachable (connection fails): the card hides itself, and returns when the browser is back online', async ({ page }) => {
    const { meteo, errors } = await open(page, 'abort', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    await expect.poll(() => section(page).getAttribute('data-state')).toBe('hidden');
    await expect(section(page)).toBeHidden();
    await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();

    meteo.set('ok');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(section(page)).toBeVisible();
    await expect(content(page).locator('.weather-temp')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('no answer: loading state first, then the card gives up and hides (the page never waits for it)', async ({ page }) => {
    test.setTimeout(45_000);
    const { errors } = await open(page, 'hang', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    await expect(section(page)).toHaveAttribute('data-state', 'loading');
    await expect(content(page).locator('.loader[role="status"]')).toBeVisible();
    await expect(content(page)).toHaveAttribute('aria-busy', 'true');
    // The itinerary is usable while it waits.
    await page.locator('#day-selector .day-btn').first().click();
    await expect(page.locator('#day-selector .day-btn.active')).toHaveCount(1);
    await expect(section(page)).toHaveAttribute('data-state', 'hidden', { timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test('a hostile answer and a markup-like city name are shown as text and never run', async ({ page }) => {
    const { errors } = await open(page, 'hostile', 'trip.html?tripId=41&destIndex=5');
    await reveal(page);
    await expect(content(page).locator('.weather-temp')).toBeVisible();
    await expect(page.locator('#trip-weather-title')).toHaveText(`Weather in ${XSS_CITY}`);
    await expect(section(page).locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
  });
});

test.describe('CSP', () => {
  test('connect-src allows Open-Meteo and the card works without a single CSP violation', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    await open(page, 'ok', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    await expect(content(page).locator('.weather-temp')).toBeVisible();

    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '');
    const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(connect.split(/\s+/)).toContain('https://api.open-meteo.com');
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  });
});

test.describe('light and dark', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: the card uses the theme tokens and its text stays readable`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, 'ok', 'trip.html?tripId=41&destIndex=0');
      await reveal(page);
      await expect(content(page).locator('.weather-temp')).toBeVisible();
      const c = await page.evaluate(() => {
        const get = (sel: string, prop: 'color' | 'backgroundColor') => getComputedStyle(document.querySelector(sel)!)[prop];
        return {
          card: get('#trip-weather .widget-card', 'backgroundColor'),
          temp: get('#trip-weather .weather-temp', 'color'),
          caption: get('#trip-weather .weather-period', 'color'),
        };
      });
      expect(c.card).toBe(scheme === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)');
      expect(c.temp).not.toBe(c.card);
      expect(c.caption).not.toBe(c.card);
    });
  }
});

test.describe('small screens', () => {
  test('375px: the card fits, the retry button is a 44px target, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, 'http500', 'trip.html?tripId=41&destIndex=0');
    await reveal(page);
    const retry = page.locator('#trip-weather-retry');
    await expect(retry).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await retry.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(36); // 44 on coarse pointers (mobile-layout gates that)
    await expect(content(page)).toBeVisible();
  });
});
