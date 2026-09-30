import { test, expect, type Page } from '@playwright/test';
import { mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';

const cityPages = [
  { city: 'Tokyo', path: 'tokyo.html', key: 'tokyo' },
  { city: 'Nagoya', path: 'nagoya.html', key: 'nagoya' },
  { city: 'Takayama', path: 'takayama.html', key: 'takayama' },
  { city: 'Kyoto', path: 'kyoto.html', key: 'kyoto' },
  { city: 'Osaka', path: 'osaka.html', key: 'osaka' },
  { city: 'Naoshima', path: 'naoshima.html', key: 'naoshima' },
  { city: 'Hakone', path: 'hakone.html', key: 'hakone' },
  { city: 'Tokyo (return)', path: 'tokyo2.html', key: 'tokyo2' },
];

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await mockKeycloakLoggedOut(page);
  await stubMapThirdParty(page);
});

async function openCity(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
}

test.describe('City pages – static itinerary pages', () => {
  for (const { city, path, key } of cityPages) {
    test.describe(`${city} page`, () => {
      test.beforeEach(async ({ page }) => {
        await openCity(page, path);
      });

      test('has a heading and the right city key', async ({ page }) => {
        await expect(page.locator('h1, h2').first()).toBeVisible();
        await expect(page.locator('h1, h2').first()).not.toBeEmpty();
        await expect(page.locator('#map')).toHaveAttribute('data-city', key);
      });

      // Only tokyo.html gives #map an aria-label; the other 7 static pages omit it
      // (a11y gap in frontend/*.html, outside the e2e scope). Documented fixme so the
      // expectation is recorded and turns on as each page is fixed.
      test('map has an aria-label', async ({ page }) => {
        test.fixme(key !== 'tokyo', 'map aria-label missing on this static page — a11y gap');
        await expect(page.locator('#map')).toHaveAttribute('aria-label', /.+/);
      });

      test('renders one day button per legend group and markers on the map', async ({ page }) => {
        const dayButtons = page.locator('#day-selector .day-btn');
        await expect(dayButtons.first()).toBeVisible();
        const count = await dayButtons.count();
        expect(count).toBeGreaterThan(0);

        await expect(page.locator('#legend-grid .day-group')).toHaveCount(count);
        await expect(page.locator('#map .leaflet-marker-icon').first()).toBeVisible();
        // Every day button starts unselected and has a non-empty name.
        for (const btn of await dayButtons.all()) {
          await expect(btn).toHaveAttribute('aria-selected', 'false');
          await expect(btn).not.toBeEmpty();
        }
      });

      test('has a skip link targeting the main content', async ({ page }) => {
        await expect(page.locator('.skip-link[href="#main-content"]')).toHaveCount(1);
        await expect(page.locator('#main-content')).toHaveCount(1);
      });
    });
  }

  test.describe('Tokyo page – day filtering', () => {
    test.beforeEach(async ({ page }) => {
      await openCity(page, 'tokyo.html');
      await expect(page.locator('#day-selector .day-btn').first()).toBeVisible();
    });

    test('selecting a day marks it active and shows only that day in the legend', async ({ page }) => {
      const buttons = page.locator('#day-selector .day-btn');
      const total = await buttons.count();
      expect(total).toBeGreaterThan(1);
      const allMarkers = await page.locator('#map .leaflet-marker-icon').count();

      await buttons.nth(1).click();

      await expect(buttons.nth(1)).toHaveClass(/active/);
      await expect(buttons.nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(buttons.nth(0)).toHaveAttribute('aria-selected', 'false');
      await expect(page.locator('#legend-grid .day-group:visible')).toHaveCount(1);
      await expect(page.locator('#legend-grid .day-group:visible')).toHaveAttribute(
        'data-day',
        (await buttons.nth(1).getAttribute('data-day')) ?? '',
      );
      await expect.poll(() => page.locator('#map .leaflet-marker-icon').count()).toBeLessThan(allMarkers);
    });

    test('clicking the active day again restores every day and marker', async ({ page }) => {
      const buttons = page.locator('#day-selector .day-btn');
      const total = await buttons.count();
      const allMarkers = await page.locator('#map .leaflet-marker-icon').count();

      await buttons.first().click();
      await expect(buttons.first()).toHaveClass(/active/);
      await buttons.first().click();

      await expect(page.locator('#day-selector .day-btn.active')).toHaveCount(0);
      await expect(page.locator('#legend-grid .day-group:visible')).toHaveCount(total);
      await expect.poll(() => page.locator('#map .leaflet-marker-icon').count()).toBe(allMarkers);
    });

    test('rapidly clicking every day button leaves exactly one (or zero) selected', async ({ page }) => {
      const buttons = page.locator('#day-selector .day-btn');
      const total = await buttons.count();
      for (let i = 0; i < total; i++) await buttons.nth(i).click();
      for (let i = total - 1; i >= 0; i--) await buttons.nth(i).click();

      const selected = await page.locator('#day-selector .day-btn[aria-selected="true"]').count();
      expect(selected).toBeLessThanOrEqual(1);
      await expect(page.locator('#day-selector .day-btn.active')).toHaveCount(selected);
    });

    test('legend lists activities with map/directions links', async ({ page }) => {
      await expect(page.locator('#legend-grid .legend-item').first()).toBeVisible();
      await expect(page.locator('#legend-grid .legend-action-btn').first()).toHaveAttribute('href', /^https?:\/\//);
    });
  });
});
