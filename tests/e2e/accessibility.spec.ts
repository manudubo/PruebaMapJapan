import { test, expect } from '@playwright/test';
import { mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';

test.describe('Accessibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
  });

  test('Landing page has a skip link that targets an existing landmark', async ({ page }) => {
    await page.goto('');

    await expect(page.locator('a[href="#main-content"]')).toHaveCount(1);
    await expect(page.locator('#main-content')).toHaveCount(1);
  });

  test('Skip link is the first tab stop and moves focus to the content', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('#landing-hero')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.locator('a.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
  });

  test('Landing page has exactly one h1', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('Tokyo page map has a non-empty aria-label', async ({ page }) => {
    await page.goto('tokyo.html');

    await expect(page.locator('#map[aria-label]')).toBeAttached();
    await expect(page.locator('#map')).toHaveAttribute('aria-label', /\S/);
  });

  test('Search input has an accessible name and combobox wiring', async ({ page }) => {
    await page.goto('');
    const input = page.locator('search-bar input.search-input');

    await expect(input).toHaveAttribute('aria-label', /\S/);
    await expect(input).toHaveAttribute('aria-controls', 'search-dropdown');
    await expect(page.locator('search-bar #search-dropdown')).toHaveAttribute('role', 'listbox');
    await expect(page.locator('search-bar .clear-btn')).toHaveAttribute('aria-label', /clear/i);
  });

  test('Day selector is a tablist whose tabs all have accessible names', async ({ page }) => {
    await page.goto('tokyo.html');

    const selector = page.locator('#day-selector');
    await expect(selector).toHaveAttribute('role', 'tablist');
    const tabs = selector.locator('[role="tab"]');
    await expect(tabs.first()).toBeVisible();
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const name = ((await tabs.nth(i).textContent()) ?? '').trim() || (await tabs.nth(i).getAttribute('aria-label'));
      expect(name, `day tab #${i} has no accessible name`).toBeTruthy();
    }
  });

  test('Day tabs can be operated from the keyboard', async ({ page }) => {
    await page.goto('tokyo.html');
    const first = page.locator('#day-selector .day-btn').first();
    await expect(first).toBeVisible();

    await first.focus();
    await page.keyboard.press('Enter');

    await expect(first).toHaveAttribute('aria-selected', 'true');
  });

  test('Theme toggle has a descriptive aria-label that tracks the current theme', async ({ page }) => {
    await page.goto('');
    const toggle = page.locator('travel-nav .theme-toggle');

    await expect(toggle).toHaveAttribute('aria-label', /^Switch to (dark|light) mode$/);
    const before = await toggle.getAttribute('aria-label');
    await toggle.click();
    await expect(toggle).not.toHaveAttribute('aria-label', before ?? '');
    await expect(toggle).toHaveAttribute('aria-label', /^Switch to (dark|light) mode$/);
  });

  test('Navigation landmarks are labelled', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('travel-nav nav[aria-label]')).toHaveAttribute('aria-label', /\S/);
  });
});
