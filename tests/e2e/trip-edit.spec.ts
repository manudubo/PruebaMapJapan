import { test, expect } from '@playwright/test';
import { mockTripStore, emptyTrip } from './fixtures/mockTripStore';
import { openEditor, openNew, addCity, addPlace, saved } from './fixtures/editorHelpers';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { mockApi } from './fixtures/mockApi';

// Every spec starts signed-out and signs in through the Keycloak mock.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Access', () => {
  test('a guest is sent to sign in with a registered redirect_uri', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await mockApi(page);
    await page.goto('trip-edit.html?tripId=1');
    await page.waitForURL(/\/protocol\/openid-connect\/auth\?/);
    const redirectUri = new URL(new URL(page.url()).searchParams.get('redirect_uri')!);
    expect(redirectUri.pathname).toBe('/PruebaMapJapan/dashboard.html');
  });

  test('a signed-in user with neither tripId nor ?new=1 goes to the dashboard', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page);
    await page.goto('trip-edit.html');
    await page.waitForURL(/dashboard\.html$/);
  });

  test('a trip the API refuses shows an error toast and returns to the dashboard', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockTripStore(page, { trips: [] });
    await page.goto('trip-edit.html?tripId=999');
    await expect(page.locator('.toast--error')).toContainText('Could not load trip');
    await expect(page.locator('#te-workspace')).toBeHidden();
    await page.waitForURL(/dashboard\.html$/);
  });
});

test.describe('The journey: create -> cities -> days -> places -> preview -> share -> reload', () => {
  test('builds a trip the way the demo looks, and it survives a reload', async ({ page }) => {
    const store = await openNew(page);

    // 1. Create
    await expect(page.locator('#trip-name-heading')).toHaveText('New trip');
    await expect(page.locator('.te-step[data-step="route"]')).toBeDisabled();
    await page.locator('#trip-name').fill('Japan 2026');
    await page.locator('#trip-start-date').fill('2026-02-22');
    await page.locator('#trip-end-date').fill('2026-03-02');
    await page.locator('#metadata-save-btn').click();
    await expect(page).toHaveURL(/trip-edit\.html\?tripId=\d+#route/);
    await expect(page.locator('#trip-name-heading')).toHaveText('Japan 2026');
    expect(store.writes('POST')[0]).toMatchObject({ path: '/trips', body: { name: 'Japan 2026', start_date: '2026-02-22', end_date: '2026-03-02' } });

    // 2. Cities: empty state, then two stops with a dashed route between them
    await expect(page.locator('#destinations-empty')).toBeVisible();
    await addCity(page, 'Tokyo');
    await addCity(page, 'Kyoto');
    await expect(page.locator('#destinations-list > li')).toHaveCount(2);
    await expect(page.locator('#destinations-list .te-dest-name')).toHaveText(['Tokyo', 'Kyoto']);
    await expect(page.locator('#map .numbered-marker')).toHaveCount(2);
    await expect(page.locator('#map path.leaflet-interactive')).toHaveCount(0); // route line is non-interactive...
    await expect(page.locator('#map svg path[stroke-dasharray]')).toHaveCount(1); // ...but drawn, dashed
    await expect(page.locator('#te-cities-grid .city-card')).toHaveCount(2);

    // 3. Per city: day chips from the dates, add places, mark an alternative
    await page.locator('.te-dest-open', { hasText: 'Kyoto' }).click();
    await expect(page.locator('#city-title')).toHaveText('Kyoto');
    await expect(page.locator('#dest-start')).toHaveValue('2026-02-24');
    await expect(page.locator('#day-chips .day-btn')).toHaveCount(3);
    await addPlace(page, 'Kinkaku');
    await addPlace(page, 'Fushimi');
    await expect(page.locator('#activity-list > li')).toHaveCount(2);
    await expect(page.locator('#activity-list .te-act-name').first()).toHaveValue('Kinkaku-ji');
    await expect(page.locator('#map .numbered-marker')).toHaveCount(2);
    await expect(page.locator('#te-legend-grid .legend-item')).toHaveCount(2);

    await page.locator('#activity-list > li').nth(1).locator('[data-role="toggle"]').click();
    await page.getByLabel('Alternative option').check();
    await page.locator('#activity-list > li').nth(1).locator('[data-role="time"]').fill('09:30');

    // hotel
    await page.locator('#hotel-search').fill('Granvia');
    await page.locator('#hotel-search-list .place-option').first().click();
    await expect(page.locator('#hotel-name')).toHaveValue('Hotel Granvia Kyoto');
    await expect(page.locator('#map .hotel-marker')).toHaveCount(1);

    // 4. Share
    await page.locator('.te-step[data-step="share"]').click();
    await expect(page.locator('#share-stats')).toContainText('2 destinations');
    await expect(page.locator('#share-stats')).toContainText('2 places');
    await page.locator('#trip-public').check();
    await expect(page.locator('#public-link')).toHaveValue(/trip\.html\?slug=slug-\d+/);

    await saved(page);
    await expect(page.locator('#save-status .save-text')).toHaveText('Saved');

    // Persisted: reload and read it all back
    await page.reload();
    await expect(page.locator('#te-workspace')).toBeVisible();
    await expect(page.locator('#trip-public')).toBeChecked();
    await page.locator('.te-step[data-step="route"]').click();
    await expect(page.locator('#destinations-list .te-dest-name')).toHaveText(['Tokyo', 'Kyoto']);
    await page.locator('.te-dest-open', { hasText: 'Kyoto' }).click();
    await expect(page.locator('#activity-list > li')).toHaveCount(2);
    expect(await page.locator('#activity-list .te-act-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['Kinkaku-ji', 'Fushimi Inari Taisha']);
    await expect(page.locator('#activity-list > li').nth(1).locator('[data-role="time"]')).toHaveValue('09:30');
    await expect(page.locator('#activity-list > li').nth(1).locator('.te-tag--option')).toBeVisible();
  });
});

test.describe('Day colour', () => {
  const kyoto = emptyTrip({
    destinations: [{
      id: 12, trip_id: 1, city_name: 'Kyoto', country: 'Japan', start_date: '2026-02-24', end_date: '2026-02-26',
      lat: 35.0116, lng: 135.7681, zoom_level: 12, order_index: 0, hotel: null,
      days: [{
        id: 21, date: '2026-02-25', label: null, color_hex: '#ff9500', order_index: 0,
        activities: [{ id: 31, name: 'Kinkaku-ji', lat: 35.0394, lng: 135.7292, notes: null, time: null, maps_url: null, is_optional: false, is_generic: false, order_index: 0 }],
      }],
    }],
  });

  test('the demo hand-picks a colour per day: the user can too, and it is saved and shown everywhere', async ({ page }) => {
    const store = await openEditor(page, kyoto, {}, '#city/12/2026-02-25');
    await page.locator('#day-options summary').click();
    await expect(page.getByRole('radio', { name: 'Orange' })).toBeChecked();

    await page.getByRole('radio', { name: 'Purple' }).check();
    const purple = 'rgb(175, 82, 222)';
    await expect(page.locator('#day-chips .day-btn.active .te-day-dot')).toHaveCSS('background-color', purple);
    await expect(page.locator('#activity-list .te-num')).toHaveCSS('background-color', purple);
    await expect(page.locator('#map .numbered-marker')).toHaveCSS('background-color', purple);
    await saved(page);
    expect(store.writes('PATCH').filter((c) => c.path === '/trips/1/destinations/12/days/21').map((c) => c.body)).toEqual([{ color_hex: '#af52de' }]);

    await page.reload();
    await page.locator('#day-options summary').click();
    await expect(page.getByRole('radio', { name: 'Purple' })).toBeChecked();
  });
});
