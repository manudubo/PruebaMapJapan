import { test, expect, type Page } from '@playwright/test';
import { mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty, TILE_ROUTE } from './fixtures/mockThirdParty';

/**
 * @qa-noauth — trip overview map in the landing demo (#demo), restored from ab6b603
 * after 6ff0f80 removed it (QA-DEMO-FIXES finding 2).
 *
 *   npm run build --workspace=frontend && npm run preview --workspace=frontend
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test overview-map --grep @qa-noauth --project=chromium
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockKeycloakLoggedOut(page);
  await stubMapThirdParty(page);
  await page.goto('');
  return errors;
}

const markers = (page: Page) => page.locator('#map .leaflet-marker-icon');

test.describe('@qa-noauth landing overview map', () => {
  test('is lazy: no Leaflet map or tile request until the demo scrolls into view', async ({ page }) => {
    const tiles: string[] = [];
    page.on('request', (r) => { if (r.url().includes('tile.openstreetmap.org')) tiles.push(r.url()); });
    await page.setViewportSize({ width: 375, height: 740 });
    await open(page);
    await expect(page.locator('#landing-hero h1')).toBeVisible();
    // observeOverviewMap's IntersectionObserver delivers its first (not intersecting)
    // entry in the next rendering update; after two animation frames it has run, so a
    // missing map below is a real "not initialised", not "not yet".
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect(page.locator('#map.leaflet-container')).toHaveCount(0);
    expect(tiles).toEqual([]);

    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect(markers(page)).toHaveCount(8);
    await expect.poll(() => tiles.length).toBeGreaterThan(0);
  });

  test('8 numbered markers in itinerary order, a dashed route line and visible attribution', async ({ page }) => {
    const errors = await open(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect(markers(page)).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8']);
    await expect(page.locator('#map path.leaflet-interactive[stroke-dasharray="8, 8"]')).toHaveCount(1);
    await expect(page.locator('#map .leaflet-control-attribution')).toContainText('OpenStreetMap contributors');
    await expect(page.locator('#map')).toHaveAttribute('aria-label', 'Map of the Japan 2026 trip');
    expect(errors).toEqual([]);
  });

  test('click a marker: popup with dates and a link that opens the city page under the base path', async ({ page }) => {
    await open(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    await markers(page).nth(4).click(); // Osaka (5)
    const popup = page.locator('#map .leaflet-popup');
    await expect(popup.locator('h4')).toHaveText('Osaka');
    await expect(popup).toContainText('14–17 Mar');
    await expect(page.locator('#overview-cities .city-card.is-selected')).toHaveAttribute('data-city', 'osaka');
    await popup.getByRole('link', { name: 'View itinerary' }).click();
    await expect(page).toHaveURL(/\/PruebaMapJapan\/osaka\.html$/);
    await expect(page.locator('#map')).toHaveAttribute('data-city', 'osaka');
  });

  test('keyboard: Tab to a marker, Enter opens its popup and focuses the link', async ({ page }) => {
    await open(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect(markers(page)).toHaveCount(8);
    const kyoto = page.locator('#map .leaflet-marker-icon[data-city="kyoto"]');
    await expect(kyoto).toHaveAttribute('aria-label', '4. Kyoto, 8–13 Mar – show details');
    await kyoto.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#map .leaflet-popup h4')).toHaveText('Kyoto');
    await expect(page.locator('#map .leaflet-popup .overview-popup-link')).toBeFocused();
  });

  test('list -> map: hovering/focusing a card highlights its marker; clicking navigates', async ({ page }) => {
    await open(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect(markers(page)).toHaveCount(8);
    const card = page.locator('#overview-cities .city-card[data-city="hakone"]');
    await card.focus();
    await expect(page.locator('#map .leaflet-marker-icon[data-city="hakone"]')).toHaveClass(/is-highlighted/);
    await card.click();
    await expect(page).toHaveURL(/\/PruebaMapJapan\/hakone\.html$/);
  });

  test('tiles blocked: polite notice, markers and list still work, no uncaught errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.route(TILE_ROUTE, (r) => r.abort());
    await page.goto('');
    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect(page.locator('#map .map-tile-notice')).toBeVisible();
    await expect(markers(page)).toHaveCount(8);
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(8);
    expect(errors).toEqual([]);
  });

  test('375px: map and cards fit without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await open(page);
    await page.locator('#overview-cities').scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = (await page.locator('#map').boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    expect(box.height).toBeGreaterThan(250);
  });
});
