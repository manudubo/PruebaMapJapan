import { test, expect } from '@playwright/test';

/**
 * @qa-noauth — A11Y-04 (target-size) and A11Y-05 (landing LCP). Run against a production build
 * (npm run build && npm run preview); Keycloak and external hosts are blocked.
 */
test.describe('@qa-noauth LCP and target size', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/:8080\//, (r) => r.abort());
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  });

  test('landing paints immediately: body not hidden, AVIF hero fetched, Leaflet not loaded', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('index.html', { waitUntil: 'domcontentloaded' });
    const opacity = await page.evaluate(() => getComputedStyle(document.body).opacity);
    expect(opacity).toBe('1');
    await expect(page.locator('#landing-hero h1')).toBeVisible();
    await page.waitForLoadState('load');
    expect(requests.some((p) => p.endsWith('/demo-hero-640.avif'))).toBe(true);
    expect(requests.some((p) => p.endsWith('/demo-hero.jpg'))).toBe(false);
    // the lazy overview map (below the fold) must not pull Leaflet in during the first load
    expect(requests.filter((p) => /\/assets\/leaflet-/.test(p))).toEqual([]);
  });

  for (const width of [375, 1280]) {
    test(`tokyo markers do not overlap and are >= 24px at ${width}px, keyboard focus works`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('tokyo.html');
      const markers = page.locator('.leaflet-marker-icon.custom-marker');
      await expect(markers.first()).toBeVisible();
      const n = await markers.count();
      expect(n).toBeGreaterThanOrEqual(10);
      const rects = await markers.evaluateAll((els) => els.map((e) => {
        const r = (e.querySelector('.numbered-marker, .hotel-marker') as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }));
      for (const r of rects) {
        expect(r.w).toBeGreaterThanOrEqual(24);
        expect(r.h).toBeGreaterThanOrEqual(24);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `markers ${i} and ${j} overlap`).toBe(false);
        }
      }
      // keyboard: markers stay focusable and show a focus ring
      await markers.first().focus();
      await expect(markers.first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.leaflet-popup')).toBeVisible();
    });
  }
});
