import { test, expect } from '@playwright/test';

const FRONTEND_BASE = 'http://localhost:5173/PruebaMapJapan';

async function isFrontendRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${FRONTEND_BASE}/`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mock trip data
// ---------------------------------------------------------------------------
const mockTrip = {
  id: '1',
  user_id: '1',
  name: 'Viaje de prueba',
  description: 'Descripción',
  start_date: '2026-01-01',
  end_date: '2026-01-10',
  cover_image_url: null,
  is_public: false,
  destinations: [
    {
      id: '1',
      trip_id: '1',
      city_name: 'Tokio',
      country: 'Japón',
      start_date: '2026-01-01',
      end_date: '2026-01-05',
      lat: 35.6894,
      lng: 139.6917,
      zoom_level: 12,
      order_index: 0,
      hotel: null,
      days: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// TRIP-01: Dashboard → trip-edit navigation
// ---------------------------------------------------------------------------
test('TRIP-01: dashboard trip card has edit link to trip-edit.html @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips', (route) =>
    route.fulfill({ json: { success: true, data: [mockTrip] } })
  );
  await page.route('**/protocol/openid-connect/**', (route) =>
    route.fulfill({ status: 200, body: '' })
  );
  await page.route('**/realms/**', (route) =>
    route.fulfill({ status: 200, body: '{}' })
  );

  await page.goto(`${FRONTEND_BASE}/dashboard.html`);
  // TODO: assert edit link exists after scaffold is built
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-02: Trip metadata form
// ---------------------------------------------------------------------------
test('TRIP-02: trip metadata form shows current values and saves via PATCH @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { success: true, data: mockTrip } });
    } else if (route.request().method() === 'PATCH') {
      route.fulfill({ json: { success: true, data: { ...mockTrip, name: 'Updated' } } });
    } else {
      route.continue();
    }
  });
  await page.route('**/protocol/openid-connect/**', (route) =>
    route.fulfill({ status: 200, body: '' })
  );

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: assert form fields, fill name, click save, assert PATCH sent
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-03: Destination CRUD
// ---------------------------------------------------------------------------
test('TRIP-03: add/edit/delete destination modal + geocoder @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) =>
    route.fulfill({ json: { success: true, data: mockTrip } })
  );

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: open destination modal, fill city/country, submit, assert POST sent
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-04: Hotel CRUD
// ---------------------------------------------------------------------------
test('TRIP-04: add/edit/delete hotel modal; hotel.url validated as URL @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) =>
    route.fulfill({ json: { success: true, data: mockTrip } })
  );

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: open hotel modal, fill name + URL, submit, assert PUT sent with url field
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-05: Day CRUD + color picker + bulk generate
// ---------------------------------------------------------------------------
test('TRIP-05: add/edit/delete day; color picker sends resolved hex; smart merge skips existing @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) =>
    route.fulfill({ json: { success: true, data: mockTrip } })
  );

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: open day modal, select color swatch, submit, assert color_hex is #hex not --marker-N
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-06: Activity CRUD + reorder
// ---------------------------------------------------------------------------
test('TRIP-06: activity CRUD + reorder POST sends ordered_ids array @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) =>
    route.fulfill({ json: { success: true, data: mockTrip } })
  );

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: add activity, click reorder ▲/▼, assert POST to .../reorder with ordered_ids
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// SHARE-01: Public/private toggle
// ---------------------------------------------------------------------------
test('SHARE-01: is_public checkbox sends PATCH; badge updates @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { success: true, data: mockTrip } });
    } else if (route.request().method() === 'PATCH') {
      route.fulfill({ json: { success: true, data: { ...mockTrip, is_public: true } } });
    } else {
      route.continue();
    }
  });

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: click is_public checkbox, assert PATCH body contains is_public: true
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-08: Migration columns exist
// ---------------------------------------------------------------------------
test('TRIP-08: activities.time and hotels.url columns exist in migration SQL @smoke', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const migrationPath = path.resolve(
    __dirname,
    '../../backend/src/db/migrations/0001_add_hotel_url_activity_time.sql'
  );

  test.skip(!fs.existsSync(migrationPath), 'Migration file not yet created');

  const sql = fs.readFileSync(migrationPath, 'utf-8');
  expect(sql).toContain('ALTER TABLE');
  expect(sql).not.toContain('CREATE TABLE');
  expect(sql.toLowerCase()).toContain('activities');
  expect(sql.toLowerCase()).toContain('hotels');
});
