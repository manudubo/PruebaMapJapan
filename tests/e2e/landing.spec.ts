import { test, expect } from '@playwright/test';
import { mockKeycloakLoggedOut } from './fixtures/mockKeycloak';

const CITY_LINKS = [
  ['Tokyo', 'tokyo.html'],
  ['Nagoya', 'nagoya.html'],
  ['Takayama', 'takayama.html'],
  ['Kyoto', 'kyoto.html'],
  ['Osaka', 'osaka.html'],
  ['Naoshima', 'naoshima.html'],
  ['Hakone', 'hakone.html'],
  ['Tokyo (return)', 'tokyo2.html'],
] as const;

test.describe('Landing page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('');
    // The hero stays hidden until the auth check resolves; wait for that state.
    await expect(page.locator('#landing-hero')).toBeVisible();
  });

  test('countdown shows numeric values and keeps ticking', async ({ page }) => {
    await expect(page.locator('#demo-countdown')).toBeVisible();

    await expect(page.locator('#cd-days')).toHaveText(/^\d+$/);
    await expect(page.locator('#cd-hours')).toHaveText(/^\d{2}$/);
    await expect(page.locator('#cd-mins')).toHaveText(/^\d{2}$/);
    await expect(page.locator('#cd-secs')).toHaveText(/^\d{2}$/);

    const first = await page.locator('#cd-secs').textContent();
    // Web-first: retries until the seconds digit changes (or fails at the timeout).
    await expect(page.locator('#cd-secs')).not.toHaveText(first ?? '', { timeout: 3000 });
  });

  test('city chips list all 8 destinations with the right targets', async ({ page }) => {
    const chips = page.locator('.city-chip');
    await expect(chips).toHaveCount(8);
    for (const [label, href] of CITY_LINKS) {
      await expect(page.locator(`.city-chip[href="${href}"]`)).toHaveText(label);
    }
  });

  test('clicking a city chip navigates to that city page', async ({ page }) => {
    await page.locator('.city-chip[href="kyoto.html"]').click();
    await expect(page).toHaveURL(/kyoto\.html$/);
    await expect(page.locator('#map')).toHaveAttribute('data-city', 'kyoto');
  });

  test('theme toggle flips data-theme, updates its label and survives a reload', async ({ page }) => {
    const html = page.locator('html');
    const toggle = page.locator('travel-nav .theme-toggle');
    await expect(toggle).toBeVisible();

    const initial = (await html.getAttribute('data-theme')) ?? 'light';
    const expected = initial === 'dark' ? 'light' : 'dark';

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', expected);
    await expect(toggle).toHaveAttribute('aria-label', new RegExp(`Switch to ${initial} mode`));
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(expected);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', expected);

    // Toggling back restores the original theme (no stuck state).
    await page.locator('travel-nav .theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', initial);
  });

  test('a corrupted saved theme value does not break the page', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('theme', 'purple'));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.reload();

    await expect(page.locator('#landing-hero')).toBeVisible();
    await expect(page.locator('.city-chip')).toHaveCount(8);
    expect(errors).toEqual([]);
  });

  test('search bar is visible', async ({ page }) => {
    await expect(page.locator('search-bar')).toBeVisible();
  });

  test('sign-in button on the hero starts a login that returns to the dashboard', async ({ page }) => {
    await page.locator('#landing-login-btn').click();
    await page.waitForURL(/\/protocol\/openid-connect\/auth\?/);
    expect(new URL(page.url()).searchParams.get('redirect_uri')).toContain('dashboard.html');
  });

  test('mobile viewport: content fits without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();

    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('.demo-cities')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
