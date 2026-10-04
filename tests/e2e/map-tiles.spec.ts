import { test, expect, type Page } from '@playwright/test';
import { stubMapThirdParty, TILE_HOST, TILE_ROUTE } from './fixtures/mockThirdParty';

/**
 * @qa-noauth — base-map tiles (QA-DEMO-FIXES finding 1: CartoDB answered every tile
 * with an "API KEY REQUIRED" placeholder). Tiles are stubbed here; the opt-in live
 * check is `npm run check:tiles --workspace=frontend`.
 *
 *   npm run build --workspace=frontend && npm run preview --workspace=frontend
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test map-tiles --grep @qa-noauth --project=chromium
 */

async function offlineIdp(page: Page): Promise<void> {
  await page.route(/:8080\//, (r) => r.abort());
  await page.route('**/realms/**', (r) => r.abort());
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe('@qa-noauth map tiles', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('city map requests tiles only from the keyless provider, never CartoDB', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('request', (r) => {
      if (r.resourceType() === 'image') hosts.add(new URL(r.url()).host);
    });
    await offlineIdp(page);
    await stubMapThirdParty(page);
    await page.goto('kyoto.html');
    await expect(page.locator('#map img.leaflet-tile-loaded').first()).toBeVisible();
    expect([...hosts].filter((h) => h && h !== 'localhost:5173')).toEqual([TILE_HOST]);
  });

  for (const viewport of [{ width: 375, height: 740 }, { width: 1280, height: 800 }]) {
    test(`attribution is visible, links to the OSM copyright page and overlaps no control at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await offlineIdp(page);
      await stubMapThirdParty(page);
      await page.goto('tokyo.html');
      const attribution = page.locator('#map .leaflet-control-attribution');
      await expect(attribution).toBeVisible();
      await expect(attribution).toContainText('OpenStreetMap contributors');
      await expect(attribution.locator('a[href="https://www.openstreetmap.org/copyright"]')).toBeVisible();

      const attrBox = (await attribution.boundingBox())!;
      const mapBox = (await page.locator('#map').boundingBox())!;
      expect(attrBox.x).toBeGreaterThanOrEqual(mapBox.x);
      expect(attrBox.x + attrBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 0.5);
      for (const sel of ['#hotel-btn', '#map .leaflet-control-zoom']) {
        const box = await page.locator(sel).boundingBox();
        if (box) expect(overlaps(attrBox, box), `${sel} overlaps attribution`).toBe(false);
      }
    });
  }

  for (const failure of ['404', 'abort'] as const) {
    test(`tile server ${failure}: polite notice, markers still work, no uncaught errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await offlineIdp(page);
      await stubMapThirdParty(page);
      // Registered after the stub, so it wins.
      await page.route(TILE_ROUTE, (r) => (failure === '404' ? r.fulfill({ status: 404, body: '' }) : r.abort()));
      await page.goto('osaka.html');
      const notice = page.locator('#map .map-tile-notice');
      await expect(notice).toBeVisible();
      await expect(notice).toHaveAttribute('role', 'status');
      await expect(notice).toHaveCount(1);
      await expect(page.locator('#map .leaflet-marker-icon')).toHaveCount(13);
      // Keyboard: markers overlap at this zoom, and focus + Enter is what a keyboard user does.
      await page.locator('#map .leaflet-marker-icon').first().focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#map .leaflet-popup')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('theme toggled while tiles are still loading: no errors, filter follows the theme', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme: 'light' });
    await offlineIdp(page);
    await stubMapThirdParty(page);
    // Slow tiles: hold each one for 800 ms.
    await page.route(TILE_ROUTE, async (r) => {
      await new Promise((res) => setTimeout(res, 800));
      await r.fallback();
    });
    await page.goto('takayama.html');
    const toggle = page.locator('travel-nav .theme-toggle');
    await toggle.click();
    await toggle.click();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#map img.leaflet-tile-loaded').first()).toBeVisible();
    expect(await page.locator('#map .leaflet-tile-pane').evaluate((el) => getComputedStyle(el).filter)).toContain('invert(1)');
    expect(errors).toEqual([]);
  });
});
