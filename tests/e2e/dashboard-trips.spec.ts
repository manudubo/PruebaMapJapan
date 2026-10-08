import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import {
  japanTrip, activeTrip, upcomingTrip, pastTrip, undatedTrip, longNamesTrip, xssTrip, XSS, routeOwnerTrip, routeTripList,
} from './fixtures/mockTripView';

/**
 * "My Trips" as trip cards: cover, dates, counts, countdown/progress, grouping, and the states
 * around loading them (skeleton, slow, error, empty). Hermetic (mocked Keycloak + API).
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test dashboard-trips --project=chromium
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function open(page: Page, trips: unknown[], listOptions?: Parameters<typeof routeTripList>[2]) {
  await mockKeycloakLoggedIn(page);
  await mockApi(page, { trips });
  await stubMapThirdParty(page);
  const list = listOptions ? await routeTripList(page, trips, listOptions) : null;
  await page.goto('dashboard.html');
  return list;
}

const cards = (page: Page) => page.locator('#trips-grid .trip-card:not(.trip-card--skeleton)');

test.describe('trip cards', () => {
  test('a card shows name, dates, counts and countdown, and opens the trip overview', async ({ page }) => {
    await open(page, [japanTrip()]);
    const card = cards(page).first();
    await expect(card.locator('.trip-card-title')).toHaveText('Japan 2027');
    await expect(card.locator('.trip-card-dates')).toContainText('2026');
    await expect(card.locator('.trip-card-meta li')).toHaveText(['5 cities', '14 days', '12 places']);
    await expect(card.locator('.trip-card-badge--phase')).toHaveText('In 40 days');
    await expect(card.locator('.trip-card-badge--public')).toHaveText('Public');
    await expect(card.locator('.trip-card-route li')).toHaveText(['T', 'K', 'O', 'H', 'T']);
    await expect(card.locator('.trip-card-desc')).toHaveText('Two weeks of temples, trains and ramen.');

    await routeOwnerTrip(page, japanTrip());
    await card.getByRole('link', { name: 'Japan 2027', exact: true }).click();
    await page.waitForURL(/trip\.html\?tripId=11$/);
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(5);
  });

  test('clicking anywhere on the card opens it, Edit still goes to the editor, and links are not nested', async ({ page }) => {
    await open(page, [japanTrip()]);
    const card = cards(page).first();
    expect(await card.locator('a a').count()).toBe(0);
    await expect(card.getByRole('link', { name: 'Edit Japan 2027' })).toHaveAttribute('href', 'trip-edit.html?tripId=11');
    // A real pointer click on the cover (Playwright's actionability check would refuse: the title link is stretched over it).
    const box = (await card.locator('.trip-card-cover').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(/trip\.html\?tripId=11$/);
  });

  test('trips are grouped: in progress, upcoming (soonest first), no dates, past', async ({ page }) => {
    await open(page, [pastTrip, undatedTrip, upcomingTrip(30), activeTrip, upcomingTrip(5)]);
    await expect(page.locator('#trips-grid h2')).toHaveText(['In progress', 'Upcoming', 'No dates yet', 'Past trips']);
    await expect(cards(page).locator('.trip-card-title')).toHaveText(['Right now', 'Soon', 'Soon', 'Someday', 'Last year']);
    await expect(cards(page).nth(1).locator('.trip-card-badge--phase')).toHaveText('In 5 days');
    await expect(cards(page).nth(2).locator('.trip-card-badge--phase')).toHaveText('In 30 days');
  });

  test('progress: bar while under way, full when completed, none while upcoming', async ({ page }) => {
    await open(page, [activeTrip, pastTrip, upcomingTrip()]);
    await expect(cards(page).nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '38');
    await expect(cards(page).nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Day 3 of 8');
    await expect(cards(page).nth(2).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(cards(page).nth(1).getByRole('progressbar')).toHaveCount(0);
  });

  test('hostile and very long names: text only, no overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, [xssTrip, longNamesTrip]);
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(1).locator('.trip-card-title')).toHaveText(XSS);
    expect(await page.locator('#trips-grid img, #trips-grid script').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('an unusable cover image URL is ignored; an http one is applied under the gradient', async ({ page }) => {
    await open(page, [
      { ...japanTrip(), id: 31, name: 'Bad cover', cover_image_url: 'javascript:alert(1)' },
      { ...japanTrip(), id: 32, name: 'Good cover', cover_image_url: 'https://example.com/c.jpg' },
    ]);
    await expect(cards(page)).toHaveCount(2);
    const covers = await page.locator('.trip-card-cover').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.backgroundImage));
    expect(covers.filter((c) => c.includes('javascript'))).toEqual([]);
    expect(covers.filter((c) => c.includes('https://example.com/c.jpg'))).toHaveLength(1);
  });
});

test.describe('states around loading', () => {
  test('no trips: "Create your first trip" opens the form and "See the demo" goes to the demo', async ({ page }) => {
    await open(page, []);
    await expect(page.locator('#trips-grid')).toContainText("You don't have any trips saved yet.");
    await expect(page.locator('#trips-grid .trip-card')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See the demo' })).toHaveAttribute('href', 'index.html#demo');
    await page.getByRole('button', { name: 'Create your first trip' }).click();
    await expect(page.locator('#create-trip-overlay')).toBeVisible();
  });

  test('loading shows skeleton cards, not "Loading trips..." text', async ({ page }) => {
    await open(page, [japanTrip()], { delayMs: 1500 });
    await expect(page.locator('#trips-grid .trip-card--skeleton')).toHaveCount(3);
    await expect(page.locator('#trips-grid')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Loading trips...')).toHaveCount(0);
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('#trips-grid')).not.toHaveAttribute('aria-busy', 'true');
  });

  test('API down: a clear error with Try again (never a silently empty dashboard), and retry recovers', async ({ page }) => {
    const list = await open(page, [japanTrip()], { abort: true });
    await expect(page.locator('#trips-error')).toBeVisible();
    await expect(page.locator('#trips-error')).toContainText("We couldn't load your trips");
    await expect(page.locator('#empty-state-create-btn')).toHaveCount(0);
    await expect(page.locator('#new-trip-btn')).toBeVisible();

    list!.setOptions({});
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('#trips-error')).toHaveCount(0);
  });

  test('server error (500) lands in the same error state', async ({ page }) => {
    await open(page, [], { status: 500 });
    await expect(page.locator('#trips-error')).toBeVisible();
  });

  test('slow API: notice with Try again after 3s, then the trips when they arrive', async ({ page }) => {
    await open(page, [japanTrip()], { delayMs: 4500 });
    await expect(page.locator('#trips-grid .trip-card--skeleton')).toHaveCount(3);
    await expect(page.locator('#trips-slow')).toBeVisible({ timeout: 3900 });
    await expect(page.locator('#trips-slow-retry')).toBeVisible();
    await expect(cards(page)).toHaveCount(1, { timeout: 6000 });
    await expect(page.locator('#trips-slow')).toHaveCount(0);
  });
});

test.describe('light and dark', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: cards use the themed surface`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, [japanTrip()]);
      await expect(cards(page)).toHaveCount(1);
      const bg = await cards(page).first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)');
    });
  }
});
