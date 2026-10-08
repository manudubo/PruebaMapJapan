import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * @qa-noauth — frontend end-to-end checks that need NO Keycloak and NO backend.
 *
 * Run against a PRODUCTION build (the service worker only registers in prod):
 *   npm run build --workspace=frontend
 *   npm run preview --workspace=frontend            # http://localhost:5173/PruebaMapJapan/
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test qa-frontend --grep @qa-noauth --project=chromium
 *
 * Map tiles / fonts / news proxies are external; specs never depend on them.
 */

const CITIES = ['tokyo', 'nagoya', 'takayama', 'kyoto', 'osaka', 'naoshima', 'hakone', 'tokyo2'] as const;
const EXPECTED_MARKERS: Record<string, number> = {
  tokyo: 34, nagoya: 4, takayama: 10, kyoto: 26, osaka: 13, naoshima: 4, hakone: 3, tokyo2: 3,
};

/** Keycloak is absent in this suite: fail its requests fast instead of hanging. */
async function offlineIdp(target: Page | BrowserContext): Promise<void> {
  await target.route(/:8080\//, (r) => r.abort());
  await target.route('**/realms/**', (r) => r.abort());
}

/** Block every external host (tiles, fonts, news, weather); only the app origin is reachable. */
async function blockExternal(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
}

test.describe('@qa-noauth city pages', () => {
  for (const city of CITIES) {
    test(`${city}: map is styled, markers render, no unpkg requests`, async ({ page }) => {
      const external: string[] = [];
      page.on('request', (r) => { if (r.url().includes('unpkg.com')) external.push(r.url()); });
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await offlineIdp(page);
      await blockExternal(page);
      await page.goto(`${city}.html`);

      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.leaflet-marker-icon')).toHaveCount(EXPECTED_MARKERS[city]);
      // Leaflet CSS really applied (bundled, not from a CDN): container is position:relative.
      const pos = await page.locator('#map.leaflet-container').evaluate((el) => getComputedStyle(el).position);
      expect(pos).toBe('relative');
      const box = await page.locator('#map').boundingBox();
      expect(box!.height).toBeGreaterThan(200);
      expect(external).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    for (const width of [240, 320]) {
      test(`${city}: no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 600 });
        await offlineIdp(page);
        await blockExternal(page);
        await page.goto(`${city}.html`);
        await expect(page.locator('h1')).toBeVisible();
        const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(sw).toBeLessThanOrEqual(iw);
      });
    }
  }

  test('map still renders when localStorage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('denied', 'SecurityError'); },
      });
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('kyoto.html');
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(EXPECTED_MARKERS['kyoto']);
    // Only errors raised by the page's own inline pre-paint script are tolerated (it is not app code).
    expect(pageErrors.filter((m) => !/denied/.test(m))).toEqual([]);
  });

  test('rapid navigation across all cities raises no page errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await offlineIdp(page);
    await blockExternal(page);
    for (const city of [...CITIES, ...CITIES]) {
      await page.goto(`${city}.html`, { waitUntil: 'commit' }).catch(() => undefined);
    }
    await page.goto('kyoto.html');
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(EXPECTED_MARKERS['kyoto']);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('@qa-noauth theme', () => {
  test('toggle persists across navigation and reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('tokyo.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('travel-nav .theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    for (const next of ['kyoto.html', 'index.html', 'osaka.html']) {
      await page.goto(next);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // Body must actually be dark (not just the attribute).
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgb(245, 245, 247)');
  });

  test('theme switch keeps the OSM tiles and darkens them with a CSS filter (no tile reload)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const tiles: string[] = [];
    page.on('request', (r) => { if (r.url().includes('tile.openstreetmap.org')) tiles.push(r.url()); });
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('kyoto.html');
    await expect.poll(() => tiles.length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    const pane = page.locator('#map .leaflet-tile-pane');
    expect(await pane.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    const before = tiles.length;
    await page.locator('travel-nav .theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => pane.evaluate((el) => getComputedStyle(el).filter)).toContain('invert(1)');
    // Markers are not filtered (only the tile pane is).
    expect(await page.locator('#map .leaflet-marker-pane').evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    expect(tiles.length).toBe(before);
    expect(tiles.every((u) => !u.includes('cartocdn'))).toBe(true);
  });
});

test.describe('@qa-noauth search', () => {
  test('finds an activity from another city and navigates to it', async ({ page }) => {
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('tokyo.html');
    const input = page.locator('search-bar input');
    await input.click();
    await input.fill('Fushimi Inari');
    const first = page.locator('search-bar .search-result').first();
    await expect(first).toContainText('Fushimi Inari');
    await first.click();
    await expect(page).toHaveURL(/kyoto\.html/);
  });

  test('a city query lists that city; nonsense shows the empty state, HTML is inert', async ({ page }) => {
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('index.html');
    const input = page.locator('search-bar input');
    await input.click();
    await input.fill('naoshima');
    await expect(page.locator('search-bar .search-result').first()).toContainText(/Naoshima/i);
    await input.fill('qqqqzzzzxxxx');
    await expect(page.locator('search-bar .search-empty')).toBeVisible();
    // Clearing shows the suggestions list (synchronously, with a "Cities" header); the
    // debounced search for the payload then replaces it. Waiting for the header to go
    // proves the payload was searched and rendered, without a fixed sleep.
    await input.fill('');
    const suggestionsHeader = page.locator('search-bar .section-header');
    await expect(suggestionsHeader).toBeVisible();
    await input.fill('<img src=x onerror=window.__pwned=1>');
    await expect(suggestionsHeader).toHaveCount(0);
    expect(await page.locator('search-bar img').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await input.fill('');
    await page.keyboard.press('Escape');
  });
});

test.describe('@qa-noauth widgets', () => {
  async function loadOsakaWidgets(page: Page): Promise<void> {
    await page.goto('osaka.html');
    await page.locator('.widgets-section').scrollIntoViewIfNeeded();
  }

  test('weather + news degrade gracefully when APIs return garbage', async ({ page }) => {
    await offlineIdp(page);
    await page.route(/api\.open-meteo\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"foo":1}' }));
    await page.route(/allorigins/, (r) => r.fulfill({ status: 200, body: '<html>not json' }));
    await page.route(/corsproxy/, (r) => r.fulfill({ status: 200, body: '<<<not xml' }));
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|api\.open-meteo|api\.allorigins|corsproxy)/, (r) => r.abort());
    await loadOsakaWidgets(page);
    await expect(page.locator('#widget-weather')).toContainText('Weather unavailable');
    await expect(page.locator('#widget-news')).toContainText(/No recent news|Reload/);
    await expect(page.locator('.widgets-section .loader')).toHaveCount(0);
  });

  test('a corrupted cached weather entry does not leave the loader spinning', async ({ page }) => {
    await offlineIdp(page);
    await page.addInitScript(() => {
      localStorage.setItem('weather_34.69_135.5', JSON.stringify({ data: { foo: 1 }, timestamp: Date.now() }));
    });
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await loadOsakaWidgets(page);
    await expect(page.locator('#widget-weather')).toContainText('Weather unavailable');
  });

  test('hostile RSS items are inert: no script execution, no javascript: links', async ({ page }) => {
    await offlineIdp(page);
    const rss = `<rss><channel>
      <item><title>&lt;img src=x onerror=window.__pwned=1&gt; Hello</title><link>javascript:window.__pwned=1</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate><source>S</source></item>
      <item><title>Fine article</title><link>https://example.com/ok</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate><source>S</source></item>
    </channel></rss>`;
    await page.route(/allorigins/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contents: rss }) }));
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|api\.allorigins)/, (r) => r.abort());
    await loadOsakaWidgets(page);
    await expect(page.locator('#widget-news .widget-link')).toHaveCount(1);
    await expect(page.locator('#widget-news .widget-link')).toHaveAttribute('href', 'https://example.com/ok');
    expect(await page.locator('#widget-news img, #widget-news script').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe('@qa-noauth landing', () => {
  test('landing hero is shown immediately when Keycloak is unreachable (no auth gate)', async ({ page }) => {
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('index.html', { waitUntil: 'domcontentloaded' });
    // The hero no longer waits for keycloak-js (was ~10 s); see qa-followup.spec.ts for the notice.
    await expect(page.locator('#landing-hero h1')).toBeVisible({ timeout: 1500 });
    await expect(page.locator('#landing-loading')).toHaveCount(0);
  });

  test('countdown updates once a minute on the minute boundary (fake clock)', async ({ page }) => {
    await page.clock.install({ time: new Date(2027, 1, 20, 21, 30, 15) });
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('index.html');
    await expect(page.locator('#cd-days')).toHaveText('1');
    await expect(page.locator('#cd-hours')).toHaveText('02');
    await expect(page.locator('#cd-mins')).toHaveText('30');
    await page.clock.runFor(44_000); // 21:30:59: same minute, nothing changes
    await expect(page.locator('#cd-mins')).toHaveText('30');
    await page.clock.runFor(1_000); // 21:31:00
    await expect(page.locator('#cd-mins')).toHaveText('29');
    await expect(page.locator('#cd-secs')).toHaveCount(0);
  });

  test('countdown is hidden once the trip has started', async ({ page }) => {
    await page.clock.install({ time: new Date(2027, 1, 22, 0, 0, 1) });
    await offlineIdp(page);
    await blockExternal(page);
    await page.goto('index.html');
    await expect(page.locator('#demo-countdown-wrap')).toBeHidden();
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(8);
  });
});
