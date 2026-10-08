import { test, expect, type Page } from '@playwright/test';
import { mockTrip } from './fixtures/mockTrip';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';

// Mock trip with two destinations for tab tests
const mockTripTwoDestinations = {
  ...mockTrip,
  destinations: [
    ...mockTrip.destinations,
    {
      id: 2,
      city_name: 'Kyoto',
      country: 'Japan',
      lat: 35.0116,
      lng: 135.7681,
      zoom_level: 13,
      start_date: '2026-01-06',
      end_date: '2026-01-10',
      order_index: 1,
      hotel: {
        id: 2,
        name: 'Kyoto Hotel',
        lat: 35.0116,
        lng: 135.7681,
        check_in_date: '2026-01-06',
        check_out_date: '2026-01-10',
      },
      days: [
        {
          id: 2,
          date: '2026-01-06',
          label: 'Day 6',
          color_hex: '#4ECDC4',
          order_index: 0,
          activities: [],
        },
      ],
    },
  ],
};

// Every spec starts from a clean browser so the result does not depend on
// whether the project injected a real-auth storageState.
test.use({ storageState: { cookies: [], origins: [] } });

async function signedInDashboard(page: Page, options: Parameters<typeof mockApi>[1] = {}) {
  await mockKeycloakLoggedIn(page);
  const calls = await mockApi(page, options);
  await page.goto('dashboard.html');
  await expect(page.locator('#new-trip-btn')).toBeVisible();
  return calls;
}

test.describe('Dashboard access', () => {
  test('a guest is offered sign-in instead of trips', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await mockApi(page);

    await page.goto('dashboard.html');

    await expect(page.locator('#dashboard-login-prompt')).toBeVisible();
    await expect(page.locator('#trips-grid')).toBeHidden();
    await expect(page.locator('.trip-card')).toHaveCount(0);
  });
});

test.describe('Trip detail page', () => {
  test('opens on the overview: title, dates, one city card, a Leaflet map and the owner edit link', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page);

    await page.goto('trip.html?tripId=1');

    await expect(page.locator('#trip-title')).toHaveText(mockTrip.name);
    await expect(page.locator('#trip-subtitle')).toContainText('2026');
    await expect(page.locator('#map.leaflet-container')).toBeVisible();
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(1);
    await expect(page.locator('#overview-cities .city-card').first()).toContainText('Tokyo');
    await expect(page.locator('#trip-edit-link')).toHaveAttribute('href', `trip-edit.html?tripId=${mockTrip.id}`);
  });

  test('a city card opens that city (no reload) and the tabs switch between cities and update the URL', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trip: mockTripTwoDestinations });

    await page.goto('trip.html?tripId=1');
    await page.locator('#overview-cities .city-card').first().click();

    await expect(page).toHaveURL(/[?&]destIndex=0/);
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
    const tabs = page.locator('#dest-tabs .dest-tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'page');
    await expect(tabs.nth(1)).not.toHaveAttribute('aria-current', 'page');

    await tabs.nth(1).click();

    await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'page');
    await expect(tabs.nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
    await expect(page).toHaveURL(/[?&]destIndex=1/);
    await expect(page.locator('#map.leaflet-container')).toBeVisible();

    await page.goBack();
    await expect(page.locator('#trip-title')).toHaveText('Tokyo');
  });

  test('a deep link with destIndex opens that city directly', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trip: mockTripTwoDestinations });

    await page.goto('trip.html?tripId=1&destIndex=1');

    await expect(page.locator('#dest-tabs .dest-tab').nth(1)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#trip-title')).toHaveText('Kyoto');
  });

  test('an out-of-range destIndex falls back to the overview without errors', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trip: mockTripTwoDestinations });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('trip.html?tripId=1&destIndex=99');

    await expect(page.locator('#trip-title')).toHaveText(mockTrip.name);
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(2);
    await expect(page.locator('#map.leaflet-container')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/ready/);
    expect(errors).toEqual([]);
  });

  test('a trip with zero destinations still shows its name and an empty state (no stuck placeholder)', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trip: { ...mockTrip, destinations: [] } });

    await page.goto('trip.html?tripId=1');

    await expect(page.locator('#trip-title')).toHaveText(mockTrip.name);
    await expect(page.locator('#overview-cities .city-card')).toHaveCount(0);
    await expect(page.locator('#trip-empty')).toContainText('no cities yet');
    await expect(page.locator('#trip-empty a')).toHaveAttribute('href', `trip-edit.html?tripId=${mockTrip.id}`);
    await expect(page.locator('body')).toHaveClass(/ready/);
  });

  test('a trip the API refuses (404) says it was not found or not accessible, not a broken page', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { tripStatus: 404 });

    await page.goto('trip.html?tripId=12345');

    await expect(page.locator('#main-content')).toContainText("don't have access");
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trip not found');
    await expect(page.locator('#map.leaflet-container')).toHaveCount(0);
    await expect(page.locator('#trip-retry-btn')).toHaveCount(0);
  });

  test('a missing tripId is reported instead of loading forever', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page);

    await page.goto('trip.html');

    await expect(page.locator('#main-content')).toContainText('No trip specified');
  });

  test('a guest opening a private trip URL gets no trip data', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    const calls = await mockApi(page);

    await page.goto('trip.html?tripId=1');

    await expect(page.locator('#main-content')).toContainText("You don't have access to this trip");
    await expect(page.locator('#trip-login-btn')).toBeVisible();
    // The guest path must not even try the owner-only endpoint.
    expect(calls.filter((c) => c.path.startsWith('/trips/'))).toEqual([]);
  });

  test('a trip name with markup is shown as text', async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1">Trip';
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trip: { ...mockTrip, name: evil } });

    await page.goto('trip.html?tripId=1');

    await expect(page.locator('#trip-title')).toHaveText(evil);
    await expect(page.locator('#trip-title img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe('Create trip form', () => {
  test('opens from the New Trip button and closes via Cancel and via the backdrop', async ({ page }) => {
    await signedInDashboard(page);
    const overlay = page.locator('#create-trip-overlay');
    await expect(overlay).toBeHidden();

    await page.locator('#new-trip-btn').click();
    await expect(overlay).toBeVisible();
    await expect(page.locator('#trip-name')).toBeVisible();

    await page.locator('#create-trip-cancel').click();
    await expect(overlay).toBeHidden();

    await page.locator('#new-trip-btn').click();
    await expect(overlay).toBeVisible();
    // Click on the dim backdrop (top-left corner is outside the centered modal).
    await overlay.click({ position: { x: 2, y: 2 } });
    await expect(overlay).toBeHidden();
  });

  test('submitting a valid trip POSTs the entered data and opens the new trip', async ({ page }) => {
    const calls = await signedInDashboard(page);
    await page.locator('#new-trip-btn').click();

    await page.locator('#trip-name').fill('New Test Trip');
    await page.locator('#trip-description').fill('Cherry blossoms');
    await page.locator('#trip-start').fill('2027-03-20');
    await page.locator('#trip-end').fill('2027-04-02');
    await page.locator('#create-trip-form button[type="submit"]').click();

    await page.waitForURL(/trip\.html\?tripId=99$/);
    const post = calls.find((c) => c.method === 'POST' && c.path === '/trips');
    expect(post?.body).toEqual({
      name: 'New Test Trip',
      description: 'Cherry blossoms',
      start_date: '2027-03-20',
      end_date: '2027-04-02',
      is_public: false,
    });
  });

  test('optional fields left blank are sent as null, not empty strings', async ({ page }) => {
    const calls = await signedInDashboard(page);
    await page.locator('#new-trip-btn').click();

    await page.locator('#trip-name').fill('Minimal');
    await page.locator('#create-trip-form button[type="submit"]').click();

    await page.waitForURL(/trip\.html\?tripId=99$/);
    const post = calls.find((c) => c.method === 'POST' && c.path === '/trips');
    expect(post?.body).toMatchObject({ name: 'Minimal', description: null, start_date: null, end_date: null });
  });

  for (const [label, name] of [
    ['empty', ''],
    ['whitespace-only', '   '],
  ] as const) {
    test(`a ${label} name is rejected: error toast, form stays open, no navigation`, async ({ page }) => {
      await signedInDashboard(page);
      await page.locator('#new-trip-btn').click();

      await page.locator('#trip-name').fill(name);
      await page.locator('#create-trip-form button[type="submit"]').click();

      await expect(page.locator('.toast--error')).toBeVisible();
      await expect(page.locator('#create-trip-overlay')).toBeVisible();
      expect(new URL(page.url()).pathname).toMatch(/dashboard\.html$/);
      // Submit button must be usable again after the failure.
      await expect(page.locator('#create-trip-form button[type="submit"]')).toBeEnabled();
    });
  }

  test('an API failure on create shows an error toast and lets the user retry', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await page.goto('dashboard.html');
    // Fail only the POST; everything else falls back to the regular API mock.
    await mockApi(page);
    let posts = 0;
    await page.route('**/api/trips', (route) => {
      if (route.request().method() === 'POST') {
        posts += 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' });
      }
      return route.fallback();
    });
    await expect(page.locator('#new-trip-btn')).toBeVisible();

    await page.locator('#new-trip-btn').click();
    await page.locator('#trip-name').fill('Will fail');
    const submit = page.locator('#create-trip-form button[type="submit"]');
    await submit.click();

    await expect(page.locator('.toast--error')).toContainText('Something went wrong');
    await expect(submit).toBeEnabled();
    await expect(page.locator('#trip-name')).toHaveValue('Will fail');
    expect(posts).toBe(1);
  });

  // KNOWN APP BUG (found while writing this suite, reported in 24-E2E-SUMMARY.md):
  // dashboard.ts handleCreateTrip() awaits a dynamic import BEFORE it disables the
  // submit button, so a fast double-click creates two trips. Fix belongs in
  // frontend/src/pages/dashboard.ts (disable the button first); remove the fixme then.
  test.fixme('double-clicking submit sends a single create request (duplicate-trip bug)', async ({ page }) => {
    const calls = await signedInDashboard(page, { createDelayMs: 600 });
    await page.locator('#new-trip-btn').click();
    await page.locator('#trip-name').fill('Once only');

    const submit = page.locator('#create-trip-form button[type="submit"]');
    await submit.dblclick();

    await page.waitForURL(/trip\.html\?tripId=99$/);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/trips')).toHaveLength(1);
  });

  test('a name with markup and quotes is sent verbatim as data', async ({ page }) => {
    const calls = await signedInDashboard(page);
    await page.locator('#new-trip-btn').click();
    const nasty = `"><script>alert(1)</script> ' OR 1=1 --`;

    await page.locator('#trip-name').fill(nasty);
    await page.locator('#create-trip-form button[type="submit"]').click();

    await page.waitForURL(/trip\.html\?tripId=99$/);
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: nasty });
  });

  // BIZ-06 (Phase 25) adds start_date <= end_date validation. Until then the form
  // happily submits an end date before the start date. Kept as a documented
  // known-gap so the expectation is written down and flips on when BIZ-06 lands.
  test.fixme('an end date before the start date is rejected client-side (BIZ-06, Phase 25)', async ({ page }) => {
    const calls = await signedInDashboard(page);
    await page.locator('#new-trip-btn').click();

    await page.locator('#trip-name').fill('Backwards');
    await page.locator('#trip-start').fill('2027-04-02');
    await page.locator('#trip-end').fill('2027-03-20');
    await page.locator('#create-trip-form button[type="submit"]').click();

    await expect(page.locator('#create-trip-overlay')).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});
