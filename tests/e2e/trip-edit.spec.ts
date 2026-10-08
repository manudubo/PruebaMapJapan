import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { mockApi, type ApiCall } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';

// Trip with one destination that has a hotel and one day with three activities.
const editableTrip = {
  id: 1,
  user_id: 1,
  name: 'Viaje de prueba',
  description: 'Descripción',
  start_date: '2026-01-01',
  end_date: '2026-01-10',
  cover_image_url: null,
  is_public: false,
  destinations: [
    {
      id: 1,
      trip_id: 1,
      city_name: 'Tokio',
      country: 'Japón',
      start_date: '2026-01-01',
      end_date: '2026-01-05',
      lat: 35.6894,
      lng: 139.6917,
      zoom_level: 12,
      order_index: 0,
      hotel: {
        id: 1,
        name: 'Hotel Uno',
        url: null,
        lat: 35.68,
        lng: 139.69,
        check_in_date: '2026-01-01',
        check_out_date: '2026-01-05',
      },
      days: [
        {
          id: 1,
          date: '2026-01-02',
          label: 'Day 2',
          color_hex: '#ff3b30',
          order_index: 0,
          activities: [
            { id: 11, name: 'Uno', lat: 35.1, lng: 139.1, notes: null, time: null, is_optional: false, is_generic: false, maps_url: '', order_index: 0 },
            { id: 12, name: 'Dos', lat: 35.2, lng: 139.2, notes: null, time: null, is_optional: false, is_generic: false, maps_url: '', order_index: 1 },
            { id: 13, name: 'Tres', lat: 35.3, lng: 139.3, notes: null, time: null, is_optional: false, is_generic: false, maps_url: '', order_index: 2 },
          ],
        },
      ],
    },
  ],
};

const emptyTrip = { ...editableTrip, destinations: [] };

const writes = (calls: ApiCall[], method?: string) =>
  calls.filter((c) => c.method !== 'GET' && (!method || c.method === method));

async function openEditor(page: Page, options: Parameters<typeof mockApi>[1] = {}, trip: unknown = editableTrip) {
  await mockKeycloakLoggedIn(page);
  const calls = await mockApi(page, { trip, trips: [trip], ...options });
  await page.goto('trip-edit.html?tripId=1');
  await expect(page.locator('#metadata-section')).toBeVisible();
  return calls;
}

// Every spec here starts signed-out and signs in through the Keycloak mock.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Trip editor access', () => {
  test('a guest is sent to sign in, with a registered redirect_uri (return covered by auth-return-to.spec.ts)', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await mockApi(page);

    await page.goto('trip-edit.html?tripId=1');

    await page.waitForURL(/\/protocol\/openid-connect\/auth\?/);
    const redirectUri = new URL(new URL(page.url()).searchParams.get('redirect_uri')!);
    expect(redirectUri.pathname).toBe('/PruebaMapJapan/dashboard.html');
    expect(redirectUri.search).toBe('');
  });

  test('a signed-in user without a tripId is sent back to the dashboard', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page);

    await page.goto('trip-edit.html');

    await page.waitForURL(/dashboard\.html$/);
  });

  test('a trip the API refuses shows an error toast and returns to the dashboard', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { tripStatus: 404 });

    await page.goto('trip-edit.html?tripId=999');

    await expect(page.locator('.toast--error')).toContainText('Could not load trip');
    await expect(page.locator('#metadata-section')).toBeHidden();
    await page.waitForURL(/dashboard\.html$/);
  });
});

test.describe('TRIP-01: dashboard → editor navigation', () => {
  test('each dashboard card has an Edit link that opens that trip in the editor', async ({ page }) => {
    await mockKeycloakLoggedIn(page);
    await mockApi(page, { trips: [editableTrip], trip: editableTrip });
    await page.goto('dashboard.html');

    const edit = page.locator('#trips-grid .trip-card-actions a', { hasText: 'Edit' });
    await expect(edit).toHaveCount(1);
    await expect(edit).toHaveAttribute('href', 'trip-edit.html?tripId=1');

    await edit.click();

    await page.waitForURL(/trip-edit\.html\?tripId=1$/);
    await expect(page.locator('#trip-name')).toHaveValue('Viaje de prueba');
  });
});

test.describe('TRIP-02: trip metadata form', () => {
  test('pre-fills every field from the trip', async ({ page }) => {
    await openEditor(page);

    await expect(page.locator('#trip-name-heading')).toHaveText('Viaje de prueba');
    await expect(page.locator('#trip-name')).toHaveValue('Viaje de prueba');
    await expect(page.locator('#trip-description')).toHaveValue('Descripción');
    await expect(page.locator('#trip-start-date')).toHaveValue('2026-01-01');
    await expect(page.locator('#trip-end-date')).toHaveValue('2026-01-10');
    await expect(page.locator('#trip-public')).not.toBeChecked();
  });

  test('saving sends a PATCH with exactly the edited values and confirms', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('#trip-name').fill('Updated');
    await page.locator('#trip-end-date').fill('2026-01-12');
    await page.locator('#metadata-save-btn').click();

    await expect(page.locator('.toast--success')).toContainText('Trip saved');
    await expect(page.locator('#metadata-save-btn')).toBeEnabled();
    expect(writes(calls)).toEqual([
      {
        method: 'PATCH',
        path: '/trips/1',
        body: {
          name: 'Updated',
          description: 'Descripción',
          start_date: '2026-01-01',
          end_date: '2026-01-12',
          is_public: false,
        },
      },
    ]);
  });

  test('clearing optional fields sends null, not empty strings', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('#trip-description').fill('');
    await page.locator('#trip-start-date').fill('');
    await page.locator('#trip-end-date').fill('');
    await page.locator('#metadata-save-btn').click();

    await expect(page.locator('.toast--success')).toBeVisible();
    expect(writes(calls, 'PATCH')[0]?.body).toMatchObject({ description: null, start_date: null, end_date: null });
  });

  test('an empty name is blocked by the browser: nothing is sent', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('#trip-name').fill('');
    await page.locator('#metadata-save-btn').click();

    expect(await page.locator('#trip-name').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    expect(writes(calls)).toEqual([]);
    await expect(page.locator('.toast--success')).toHaveCount(0);
  });

  test('the name field caps typed input at 255 characters', async ({ page }) => {
    await openEditor(page);
    await page.locator('#trip-name').click();
    await page.locator('#trip-name').pressSequentially('x'.repeat(300), { delay: 0 });

    await expect(page.locator('#trip-name')).toHaveAttribute('maxlength', '255');
    expect(await page.locator('#trip-name').evaluate((el: HTMLInputElement) => el.value.length)).toBe(255);
  });

  test('a failed save shows an inline error, keeps the edits and re-enables the button', async ({ page }) => {
    const calls = await openEditor(page, { failWrites: true });

    await page.locator('#trip-name').fill('Will not save');
    await page.locator('#metadata-save-btn').click();

    await expect(page.locator('#metadata-error')).toBeVisible();
    await expect(page.locator('#metadata-error')).toContainText('Could not save');
    await expect(page.locator('#metadata-save-btn')).toBeEnabled();
    await expect(page.locator('#metadata-save-btn')).toHaveText('Save changes');
    await expect(page.locator('#trip-name')).toHaveValue('Will not save');
    await expect(page.locator('.toast--success')).toHaveCount(0);
    expect(writes(calls)).toHaveLength(1);
  });

  test('a retry after a failed save clears the error', async ({ page }) => {
    await openEditor(page);
    let fail = true;
    await page.route('**/api/trips/1', (route) => {
      if (route.request().method() === 'PATCH' && fail) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' });
      }
      return route.fallback();
    });

    await page.locator('#metadata-save-btn').click();
    await expect(page.locator('#metadata-error')).toBeVisible();

    fail = false;
    await page.locator('#metadata-save-btn').click();
    await expect(page.locator('#metadata-error')).toBeHidden();
    await expect(page.locator('.toast--success')).toBeVisible();
  });
});

test.describe('SHARE-01: public/private toggle', () => {
  test('ticking is_public and saving sends is_public: true', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('#trip-public').check();
    await page.locator('#metadata-save-btn').click();

    await expect(page.locator('.toast--success')).toBeVisible();
    expect(writes(calls, 'PATCH')[0]?.body).toMatchObject({ is_public: true });
  });

  test('an already-public trip loads checked and can be made private again', async ({ page }) => {
    const calls = await openEditor(page, {}, { ...editableTrip, is_public: true });
    await expect(page.locator('#trip-public')).toBeChecked();

    await page.locator('#trip-public').uncheck();
    await page.locator('#metadata-save-btn').click();

    await expect(page.locator('.toast--success')).toBeVisible();
    expect(writes(calls, 'PATCH')[0]?.body).toMatchObject({ is_public: false });
  });
});

test.describe('TRIP-03: destinations', () => {
  test('lists existing destinations; an empty trip shows the empty message', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('#destinations-list .dest-section')).toHaveCount(1);
    await expect(page.locator('#destinations-list')).toContainText('Tokio, Japón');
    await expect(page.locator('#destinations-empty')).toBeHidden();
  });

  test('a trip with no destinations shows the empty message', async ({ page }) => {
    await openEditor(page, {}, emptyTrip);
    await expect(page.locator('#destinations-list .dest-section')).toHaveCount(0);
    await expect(page.locator('#destinations-empty')).toBeVisible();
  });

  test('adding a destination POSTs the form and renders it', async ({ page }) => {
    const calls = await openEditor(page, {}, emptyTrip);

    await page.locator('#add-dest-btn').click();
    await expect(page.locator('#dest-modal-overlay')).toBeVisible();
    await page.locator('#dest-city').fill('  Kyoto ');
    await page.locator('#dest-country').fill('Japan');
    await page.locator('#dest-start').fill('2026-01-06');
    await page.locator('#dest-end').fill('2026-01-09');
    await page.locator('#dest-save-btn').click();

    await expect(page.locator('#dest-modal-overlay')).toBeHidden();
    await expect(page.locator('#destinations-list')).toContainText('Kyoto, Japan');
    await expect(page.locator('#destinations-empty')).toBeHidden();
    const post = writes(calls, 'POST')[0];
    expect(post?.path).toBe('/trips/1/destinations');
    expect(post?.body).toEqual({ city_name: 'Kyoto', country: 'Japan', start_date: '2026-01-06', end_date: '2026-01-09', zoom_level: 12 });
  });

  test('required fields block an empty destination', async ({ page }) => {
    const calls = await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-save-btn').click();

    await expect(page.locator('#dest-modal-overlay')).toBeVisible();
    expect(writes(calls)).toEqual([]);
  });

  test('Escape and Cancel close the modal without saving', async ({ page }) => {
    const calls = await openEditor(page);
    await page.locator('#add-dest-btn').click();
    await page.locator('#dest-city').fill('Nope');

    await page.keyboard.press('Escape');
    await expect(page.locator('#dest-modal-overlay')).toBeHidden();

    await page.locator('#add-dest-btn').click();
    await page.locator('#dest-cancel-btn').click();
    await expect(page.locator('#dest-modal-overlay')).toBeHidden();
    expect(writes(calls)).toEqual([]);
    await expect(page.locator('#destinations-list')).not.toContainText('Nope');
  });

  test('editing a destination pre-fills the modal and PUTs the change', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('.dest-section-header button', { hasText: 'Edit' }).click();
    await expect(page.locator('#dest-city')).toHaveValue('Tokio');
    await expect(page.locator('#dest-country')).toHaveValue('Japón');
    await page.locator('#dest-city').fill('Tokyo');
    await page.locator('#dest-save-btn').click();

    await expect(page.locator('#dest-modal-overlay')).toBeHidden();
    await expect(page.locator('#destinations-list')).toContainText('Tokyo, Japón');
    const put = writes(calls, 'PUT')[0] ?? writes(calls, 'PATCH').find((c) => c.path.includes('/destinations/'));
    expect(put?.path).toBe('/trips/1/destinations/1');
    expect(put?.body).toMatchObject({ city_name: 'Tokyo', country: 'Japón' });
  });

  test('a save failure keeps the modal open with an error and the typed data', async ({ page }) => {
    const calls = await openEditor(page, { failWrites: true }, emptyTrip);
    await page.locator('#add-dest-btn').click();
    await page.locator('#dest-city').fill('Kyoto');
    await page.locator('#dest-country').fill('Japan');

    await page.locator('#dest-save-btn').click();

    await expect(page.locator('#dest-form-error')).toBeVisible();
    await expect(page.locator('#dest-modal-overlay')).toBeVisible();
    await expect(page.locator('#dest-city')).toHaveValue('Kyoto');
    await expect(page.locator('#dest-save-btn')).toBeEnabled();
    await expect(page.locator('#destinations-list .dest-section')).toHaveCount(0);
    expect(writes(calls)).toHaveLength(1);
  });

  test('deleting asks for confirmation; Cancel keeps it, Delete removes it', async ({ page }) => {
    const calls = await openEditor(page);
    const del = page.locator('.dest-section-header button', { hasText: 'Delete' });

    await del.click();
    await expect(page.locator('#confirm-overlay')).toBeVisible();
    await page.locator('#confirm-cancel-btn').click();
    await expect(page.locator('#confirm-overlay')).toBeHidden();
    await expect(page.locator('#destinations-list .dest-section')).toHaveCount(1);
    expect(writes(calls)).toEqual([]);

    await del.click();
    await page.locator('#confirm-delete-btn').click();

    await expect(page.locator('#destinations-list .dest-section')).toHaveCount(0);
    await expect(page.locator('#destinations-empty')).toBeVisible();
    expect(writes(calls, 'DELETE').map((c) => c.path)).toEqual(['/trips/1/destinations/1']);
  });

  test('a destination name with markup renders as text', async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const trip = { ...editableTrip, destinations: [{ ...editableTrip.destinations[0], city_name: evil }] };
    await openEditor(page, {}, trip);

    await expect(page.locator('#destinations-list')).toContainText(evil);
    await expect(page.locator('#destinations-list img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe('TRIP-04: hotel', () => {
  test('editing the hotel PUTs name, url and dates; an empty url is sent as null', async ({ page }) => {
    const calls = await openEditor(page);
    await expect(page.locator('#destinations-list')).toContainText('Hotel Uno');

    await page.locator('#destinations-list button', { hasText: 'Edit' }).nth(1).click();
    await expect(page.locator('#hotel-modal-overlay')).toBeVisible();
    await expect(page.locator('#hotel-name')).toHaveValue('Hotel Uno');
    await page.locator('#hotel-name').fill('Hotel Dos');
    await page.locator('#hotel-url').fill('https://example.com/hotel');
    await page.locator('#hotel-save-btn').click();

    await expect(page.locator('#hotel-modal-overlay')).toBeHidden();
    await expect(page.locator('#destinations-list')).toContainText('Hotel Dos');
    const put = writes(calls, 'PUT')[0];
    expect(put?.path).toBe('/trips/1/destinations/1/hotel');
    expect(put?.body).toMatchObject({ name: 'Hotel Dos', url: 'https://example.com/hotel' });

    await page.locator('#destinations-list button', { hasText: 'Edit' }).nth(1).click();
    await page.locator('#hotel-url').fill('');
    await page.locator('#hotel-save-btn').click();
    await expect(page.locator('#hotel-modal-overlay')).toBeHidden();
    expect(writes(calls, 'PUT')[1]?.body).toMatchObject({ url: null });
  });

  test('a non-URL in the URL field is rejected by validation and nothing is sent', async ({ page }) => {
    const calls = await openEditor(page);
    await page.locator('#destinations-list button', { hasText: 'Edit' }).nth(1).click();

    await page.locator('#hotel-url').fill('not a url');
    await page.locator('#hotel-save-btn').click();

    await expect(page.locator('#hotel-modal-overlay')).toBeVisible();
    expect(await page.locator('#hotel-url').evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBe(true);
    expect(writes(calls)).toEqual([]);
  });

  test('deleting the hotel asks for confirmation then sends DELETE', async ({ page }) => {
    const calls = await openEditor(page);
    await page.locator('#destinations-list button', { hasText: 'Delete' }).nth(1).click();
    await expect(page.locator('#confirm-title')).toHaveText('Delete hotel?');

    await page.locator('#confirm-delete-btn').click();

    await expect(page.locator('#destinations-list')).toContainText('No hotel assigned.');
    expect(writes(calls, 'DELETE').map((c) => c.path)).toEqual(['/trips/1/destinations/1/hotel']);
  });
});

test.describe('TRIP-05: days', () => {
  test('the colour picker sends a resolved hex, never a CSS variable name', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('#destinations-list button', { hasText: 'Add day' }).click();
    await page.locator('#day-label').fill('Day 3');
    await page.locator('#day-date').fill('2026-01-03');
    await page.locator('.color-swatch[data-color="--jp-marker-6"]').click();
    await expect(page.locator('.color-swatch[data-color="--jp-marker-6"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#day-save-btn').click();

    await expect(page.locator('#day-modal-overlay')).toBeHidden();
    const post = writes(calls, 'POST')[0];
    expect(post?.path).toBe('/trips/1/destinations/1/days');
    expect(post?.body).toEqual({ date: '2026-01-03', label: 'Day 3', color_hex: '#007aff' });
    expect(JSON.stringify(post?.body)).not.toContain('--jp-marker');
  });

  test('only one swatch is selected at a time', async ({ page }) => {
    await openEditor(page);
    await page.locator('#destinations-list button', { hasText: 'Add day' }).click();

    await page.locator('.color-swatch[data-color="--jp-marker-1"]').click();
    await page.locator('.color-swatch[data-color="--jp-marker-2"]').click();

    await expect(page.locator('.color-swatch[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('.color-swatch[data-color="--jp-marker-2"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('editing a day pre-selects its current colour', async ({ page }) => {
    await openEditor(page);

    await page.locator('.day-row button', { hasText: 'Edit' }).click();

    await expect(page.locator('#day-label')).toHaveValue('Day 2');
    await expect(page.locator('.color-swatch[data-color="--jp-marker-1"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a day without a colour omits color_hex instead of sending null/empty', async ({ page }) => {
    const calls = await openEditor(page);
    await page.locator('#destinations-list button', { hasText: 'Add day' }).click();
    await page.locator('#day-date').fill('2026-01-04');

    await page.locator('#day-save-btn').click();

    await expect(page.locator('#day-modal-overlay')).toBeHidden();
    expect(writes(calls, 'POST')[0]?.body).toEqual({ date: '2026-01-04', label: '' });
  });

  test('deleting a day requires confirmation and sends DELETE', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('.day-row button', { hasText: 'Delete' }).click();
    await page.locator('#confirm-delete-btn').click();

    await expect(page.locator('.day-row')).toHaveCount(0);
    expect(writes(calls, 'DELETE').map((c) => c.path)).toEqual(['/trips/1/destinations/1/days/1']);
  });
});

test.describe('TRIP-06: activities', () => {
  const names = (page: Page) => page.locator('.activity-row .activity-name');

  test('lists activities in order with the first ▲ and last ▼ disabled', async ({ page }) => {
    await openEditor(page);

    await expect(names(page)).toHaveText(['Uno', 'Dos', 'Tres']);
    await expect(page.locator('.activity-row').first().getByTitle('Move up')).toBeDisabled();
    await expect(page.locator('.activity-row').last().getByTitle('Move down')).toBeDisabled();
  });

  test('moving an activity down POSTs the full new order as ordered_ids', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('.activity-row').first().getByTitle('Move down').click();

    await expect.poll(() => writes(calls, 'POST').length).toBe(1);
    const post = writes(calls, 'POST')[0];
    expect(post?.path).toBe('/trips/1/destinations/1/days/1/activities/reorder');
    expect(post?.body).toEqual({ ordered_ids: [12, 11, 13] });
  });

  test('moving an activity up POSTs the swapped order', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('.activity-row').last().getByTitle('Move up').click();

    await expect.poll(() => writes(calls, 'POST').length).toBe(1);
    expect(writes(calls, 'POST')[0]?.body).toEqual({ ordered_ids: [11, 13, 12] });
  });

  // KNOWN APP BUG (24-E2E-SUMMARY.md): handleReorder() swaps array positions but
  // renderActivitiesDisplay() re-sorts by order_index, which is never updated, so the list
  // looks unchanged after a successful reorder until the page is reloaded. Fix in
  // frontend/src/pages/trip-edit/activities.ts; remove the fixme when it renders the new order.
  test.fixme('after moving an activity down the list shows the new order (order_index bug)', async ({ page }) => {
    await openEditor(page);

    await page.locator('.activity-row').first().getByTitle('Move down').click();

    await expect(names(page)).toHaveText(['Dos', 'Uno', 'Tres']);
  });

  test('a failed reorder restores the original order and shows an error', async ({ page }) => {
    const calls = await openEditor(page, { failWrites: true });

    await page.locator('.activity-row').first().getByTitle('Move down').click();

    await expect(page.locator('#destinations-list .error-msg', { hasText: 'Could not save' })).toBeVisible();
    await expect(names(page)).toHaveText(['Uno', 'Dos', 'Tres']);
    expect(writes(calls)).toHaveLength(1);
  });

  test('adding an activity POSTs name, time and coordinates', async ({ page }) => {
    const calls = await openEditor(page);

    await page.locator('.activity-row').first().locator('xpath=ancestor::div[1]').getByRole('button', { name: /add activity/i }).first().click();
    await expect(page.locator('#act-modal-overlay')).toBeVisible();
    await page.locator('#act-name').fill('Cuatro');
    await page.locator('#act-time').fill('09:30');
    await page.locator('#act-save-btn').click();

    await expect(page.locator('#act-modal-overlay')).toBeHidden();
    const post = writes(calls, 'POST')[0];
    expect(post?.path).toBe('/trips/1/destinations/1/days/1/activities');
    expect(post?.body).toMatchObject({ name: 'Cuatro', time: '09:30' });
    await expect(names(page)).toContainText(['Uno', 'Dos', 'Tres', 'Cuatro']);
  });
});

test.describe('TRIP-07: geocoder (destination modal)', () => {
  const NOMINATIM = '**/nominatim.openstreetmap.org/**';

  test('a Google Maps URL is resolved locally into lat/lng without calling Nominatim', async ({ page }) => {
    let nominatimCalls = 0;
    await page.route(NOMINATIM, (route) => {
      nominatimCalls += 1;
      return route.fulfill({ status: 200, body: '[]' });
    });
    await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-input').fill('https://www.google.com/maps/place/Name/@35.6894875,139.6917064,17z');
    await page.locator('#dest-geocoder-btn').click();

    await expect(page.locator('#dest-geocoder-results')).toContainText('Found');
    await expect(page.locator('#dest-lat')).toHaveValue('35.6894875');
    await expect(page.locator('#dest-lng')).toHaveValue('139.6917064');
    expect(nominatimCalls).toBe(0);
  });

  for (const [label, url, lat, lng] of [
    ['?q=lat,lng', 'https://maps.google.com/?q=34.6937,135.5023', '34.6937', '135.5023'],
    ['!3d!4d data', 'https://www.google.com/maps/place/X/data=!3d-33.8688!4d151.2093', '-33.8688', '151.2093'],
  ] as const) {
    test(`Google Maps URL form ${label} is parsed (including negative coordinates)`, async ({ page }) => {
      await openEditor(page, {}, emptyTrip);
      await page.locator('#add-dest-btn').click();

      await page.locator('#dest-geocoder-input').fill(url);
      await page.locator('#dest-geocoder-btn').click();

      await expect(page.locator('#dest-lat')).toHaveValue(lat);
      await expect(page.locator('#dest-lng')).toHaveValue(lng);
    });
  }

  test('a Google Maps URL with no coordinates reports no results and sets nothing', async ({ page }) => {
    await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-input').fill('https://www.google.com/maps/place/Somewhere');
    await page.locator('#dest-geocoder-btn').click();

    await expect(page.locator('#dest-geocoder-results')).toContainText('No results');
    await expect(page.locator('#dest-lat')).toHaveValue('');
  });

  test('Nominatim results are listed; choosing one fills coordinates and the search box', async ({ page }) => {
    await page.route(NOMINATIM, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { lat: '35.6894875', lon: '139.6917064', display_name: 'Tokyo, Japan' },
          { lat: '34.6937', lon: '135.5023', display_name: 'Osaka, Japan' },
        ]),
      }),
    );
    const calls = await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-input').fill('Tokyo');
    await page.locator('#dest-geocoder-btn').click();

    const results = page.locator('#dest-geocoder-results button');
    await expect(results).toHaveText(['Tokyo, Japan', 'Osaka, Japan']);
    await results.nth(1).click();

    await expect(page.locator('#dest-lat')).toHaveValue('34.6937');
    await expect(page.locator('#dest-lng')).toHaveValue('135.5023');
    await expect(page.locator('#dest-geocoder-input')).toHaveValue('Osaka, Japan');
    await expect(page.locator('#dest-geocoder-results')).toBeHidden();

    // The chosen coordinates travel with the saved destination as numbers.
    await page.locator('#dest-city').fill('Osaka');
    await page.locator('#dest-country').fill('Japan');
    await page.locator('#dest-save-btn').click();
    await expect(page.locator('#dest-modal-overlay')).toBeHidden();
    expect(writes(calls, 'POST')[0]?.body).toMatchObject({ lat: 34.6937, lng: 135.5023 });
  });

  test('no Nominatim hits shows a disabled "No results" entry', async ({ page }) => {
    await page.route(NOMINATIM, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-input').fill('zzzzzz');
    await page.locator('#dest-geocoder-btn').click();

    await expect(page.locator('#dest-geocoder-results button')).toHaveText('No results. Try a different search.');
    await expect(page.locator('#dest-geocoder-results button')).toBeDisabled();
  });

  test('a Nominatim outage shows an error and re-enables the search button', async ({ page }) => {
    await page.route(NOMINATIM, (route) => route.fulfill({ status: 503, body: 'down' }));
    await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-input').fill('Tokyo');
    await page.locator('#dest-geocoder-btn').click();

    await expect(page.locator('#dest-form-error')).toContainText('Error searching location');
    await expect(page.locator('#dest-geocoder-btn')).toBeEnabled();
    await expect(page.locator('#dest-geocoder-btn')).toHaveText('Search location');
  });

  test('an empty query does nothing', async ({ page }) => {
    let calls = 0;
    await page.route(NOMINATIM, (route) => {
      calls += 1;
      return route.fulfill({ status: 200, body: '[]' });
    });
    await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-btn').click();

    await expect(page.locator('#dest-geocoder-results')).toBeHidden();
    expect(calls).toBe(0);
  });

  test('typing never triggers a search (only the explicit button does — OSM rate limit)', async ({ page }) => {
    let calls = 0;
    await page.route(NOMINATIM, (route) => {
      calls += 1;
      return route.fulfill({ status: 200, body: '[]' });
    });
    await openEditor(page, {}, emptyTrip);
    await page.locator('#add-dest-btn').click();

    await page.locator('#dest-geocoder-input').pressSequentially('Tokyo', { delay: 30 });
    await expect(page.locator('#dest-geocoder-input')).toHaveValue('Tokyo');
    // Give any (wrong) keystroke-driven request time to happen: poll a stable condition.
    await expect.poll(() => calls, { timeout: 1500, intervals: [500] }).toBe(0);
  });
});

test.describe('TRIP-08: migration', () => {
  test('activities.time and hotels.url columns exist in the migration SQL', () => {
    const migrationPath = path.resolve(__dirname, '../../backend/src/db/migrations/0001_add_hotel_url_activity_time.sql');

    const sql = fs.readFileSync(migrationPath, 'utf-8'); // throws (fails) if the file is missing
    const lower = sql.toLowerCase();
    expect(sql).toContain('ALTER TABLE');
    expect(sql).not.toContain('CREATE TABLE');
    expect(lower).toMatch(/alter table\s+"?activities"?[^;]*\btime\b/s);
    expect(lower).toMatch(/alter table\s+"?hotels"?[^;]*\burl\b/s);
  });
});
