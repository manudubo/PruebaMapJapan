import { test, expect, request } from '@playwright/test';

test.describe('PWA requirements', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Keycloak to avoid external redirects
    await page.route('**/realms/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
  });

  test('Manifest is linked in index page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // The <head> should contain a link[rel="manifest"]
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);

    // Optionally verify the href is set
    const href = await manifestLink.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('Service worker file is accessible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Fetch /sw.js and expect a 200 response
    const response = await page.evaluate(async () => {
      try {
        const res = await fetch('/sw.js');
        return { status: res.status, ok: res.ok };
      } catch {
        return { status: 0, ok: false };
      }
    });

    // sw.js should be served (200) — if 404, PWA offline support is broken
    expect(response.status).toBe(200);
  });

  test('Manifest has required fields', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Fetch the manifest.json from the page's origin
    const manifestData = await page.evaluate(async () => {
      try {
        const res = await fetch('/manifest.json');
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    });

    // manifest.json must exist and be valid JSON
    expect(manifestData).not.toBeNull();

    // Required PWA manifest fields
    expect(manifestData).toHaveProperty('name');
    expect(typeof manifestData.name).toBe('string');
    expect(manifestData.name.length).toBeGreaterThan(0);

    // start_url is required for installability
    expect(manifestData).toHaveProperty('start_url');
    expect(typeof manifestData.start_url).toBe('string');

    // icons array is required for PWA install prompt
    expect(manifestData).toHaveProperty('icons');
    expect(Array.isArray(manifestData.icons)).toBe(true);
    expect(manifestData.icons.length).toBeGreaterThan(0);
  });
});
