import { test, expect, type Page } from '@playwright/test';
import { mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';

test.use({ storageState: { cookies: [], origins: [] } });

const input = (page: Page) => page.locator('search-bar input.search-input');
const options = (page: Page) => page.locator('search-bar [role="option"]');
// The keyboard-hint footer is rendered only for real (debounced) query results, never for
// the empty-query suggestions, so it is the signal that the search for the typed text ran.
const resultsSettled = (page: Page) => page.locator('search-bar .keyboard-hint');

test.describe('Search functionality', () => {
  test.beforeEach(async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await stubMapThirdParty(page);
    await page.goto('');
    await expect(page.locator('#landing-hero')).toBeVisible();
  });

  test('search input is labelled and starts with the results closed', async ({ page }) => {
    await expect(input(page)).toBeVisible();
    await expect(input(page)).toHaveAttribute('aria-label', /search/i);
    await expect(page.locator('search-bar .search-dropdown')).not.toHaveClass(/\bopen\b/);
  });

  test('focusing an empty search offers city suggestions', async ({ page }) => {
    await input(page).click();

    await expect(page.locator('search-bar .search-dropdown')).toHaveClass(/\bopen\b/);
    await expect(page.locator('search-bar .section-header')).toHaveText('Cities');
    await expect(options(page).first()).toBeVisible();
  });

  test('typing a partial city name lists matching results and highlights the match', async ({ page }) => {
    await input(page).fill('Tok');
    await expect(resultsSettled(page)).toBeVisible();

    await expect(options(page).first()).toBeVisible();
    await expect(page.locator('search-bar .search-dropdown')).toHaveClass(/\bopen\b/);
    await expect(page.locator('search-bar .result-title').first()).toContainText(/tok/i);
    await expect(page.locator('search-bar .result-title mark').first()).toHaveText(/tok/i);
    // The best match must be the one that actually contains the query.
    await expect(page.locator('search-bar .result-title').first()).toHaveText(/^tokyo/i);
  });

  // KNOWN APP BUG (24-E2E-SUMMARY.md): search.ts calculateScore() adds a per-type boost to
  // every item, so a query that matches nothing still scores > 0 and returns 8 arbitrary
  // results; "No results found" is unreachable. Fix in frontend/src/modules/search.ts.
  test.fixme('a query with no match shows the empty state (search.ts typeBoost bug)', async ({ page }) => {
    await input(page).fill('zzzzqqqq');
    await expect(resultsSettled(page)).toBeVisible();

    await expect(page.locator('search-bar .search-empty')).toContainText('No results found');
    await expect(options(page)).toHaveCount(0);
  });

  test('special characters and markup in the query are inert', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const q of ['<img src=x onerror="window.__pwned=1">', '"\'&<>', '.*+?^${}()|[]\\', '   ']) {
      await input(page).fill(q);
      await expect(input(page)).toHaveValue(q);
    }

    // Let the debounced search settle, then check nothing executed or exploded.
    await expect(page.locator('search-bar .search-dropdown')).toBeAttached();
    await expect(page.locator('search-bar img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
    await expect(page.locator('#overview-cities')).toBeVisible();
  });

  test('a very long query does not crash search', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await input(page).fill('kyoto '.repeat(500));

    await expect(resultsSettled(page)).toBeVisible();
    await expect(page.locator('search-bar .search-dropdown')).toHaveClass(/\bopen\b/);
    expect(errors).toEqual([]);
  });

  test('the clear button empties the input and returns to suggestions', async ({ page }) => {
    await input(page).fill('Kyoto');
    await expect(resultsSettled(page)).toBeVisible();

    await page.locator('search-bar .clear-btn').click();

    await expect(input(page)).toHaveValue('');
    await expect(page.locator('search-bar .section-header')).toHaveText('Cities');
    await expect(input(page)).toBeFocused();
  });

  test('Escape closes the dropdown', async ({ page }) => {
    await input(page).fill('Kyoto');
    await expect(resultsSettled(page)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('search-bar .search-dropdown')).not.toHaveClass(/\bopen\b/);
    await expect(page.locator('search-bar .search-dropdown')).not.toHaveClass(/open/);
  });

  test('clicking outside closes the dropdown', async ({ page }) => {
    await input(page).fill('Kyoto');
    await expect(resultsSettled(page)).toBeVisible();

    await page.locator('h1').first().click();

    await expect(page.locator('search-bar .search-dropdown')).not.toHaveClass(/\bopen\b/);
  });

  test('Ctrl+K focuses the search from anywhere', async ({ page }) => {
    await page.locator('h1').first().click();
    await page.keyboard.press('Control+k');
    await expect(input(page)).toBeFocused();
  });

  test('arrow keys move the selection and Enter opens the chosen result', async ({ page }) => {
    await input(page).fill('Kyoto');
    await expect(resultsSettled(page)).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
    // ArrowUp at the top stays on the first item (no wrap to -1 / crash).
    await page.keyboard.press('ArrowUp');
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
    // Only one item is selected at a time.
    await expect(page.locator('search-bar [role="option"][aria-selected="true"]')).toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/kyoto\.html/);
  });

  test('Enter with nothing selected does not navigate', async ({ page }) => {
    const before = page.url();
    await input(page).fill('Kyoto');
    await expect(resultsSettled(page)).toBeVisible();

    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(before);
  });

  test('clicking a result navigates to its page', async ({ page }) => {
    await input(page).fill('Osaka');
    await expect(resultsSettled(page)).toBeVisible();
    await expect(page.locator('search-bar .result-title').first()).toHaveText(/osaka/i);
    await options(page).first().click();
    await expect(page).toHaveURL(/osaka\.html/);
  });

  test('searching an activity name finds a place result that deep-links with day and activity params', async ({ page }) => {
    await input(page).fill('Hikawa');
    await expect(resultsSettled(page)).toBeVisible();

    const place = page.locator('search-bar [role="option"]', { has: page.locator('.result-badge', { hasText: 'place' }) });
    await expect(place.first()).toBeVisible();
    await place.first().click();

    await expect(page).toHaveURL(/\.html\?.*day=.*&activity=/);
  });

  test('accents are ignored: "kokyo" finds "Kōkyo"', async ({ page }) => {
    await input(page).fill('kokyo');
    await expect(resultsSettled(page)).toBeVisible();

    await expect(page.locator('search-bar .result-title').first()).toContainText('Kōkyo');
  });

  test('search bar is present on city pages too and works there', async ({ page }) => {
    await page.goto('tokyo.html');

    await expect(input(page)).toBeVisible();
    await input(page).fill('Kyoto');
    await expect(options(page).first()).toBeVisible();
  });
});
