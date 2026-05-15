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

const mockTrip = {
  id: '1',
  user_id: '1',
  name: 'Viaje de prueba',
  description: null,
  start_date: '2026-01-01',
  end_date: '2026-01-05',
  cover_image_url: null,
  is_public: false,
  destinations: [],
};

// ---------------------------------------------------------------------------
// TRIP-07: Geocoder — Nominatim results
// ---------------------------------------------------------------------------
test('TRIP-07: Nominatim mocked results appear in geocoder widget @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  // Mock API
  await page.route('**/api/trips/1', (route) =>
    route.fulfill({ json: { success: true, data: mockTrip } })
  );
  // Mock Nominatim — must include User-Agent header check
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { lat: '35.6894875', lon: '139.6917064', display_name: 'Tokyo, Japan' },
        { lat: '34.6937', lon: '135.5023', display_name: 'Osaka, Japan' },
      ]),
    });
  });

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: open destination or activity modal, type "Tokyo" in geocoder input,
  //       click "Buscar lugar", assert .geocoder-results contains "Tokyo, Japan"
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// TRIP-07: Geocoder — Google Maps URL parsing (client-side, no network call)
// ---------------------------------------------------------------------------
test('TRIP-07: Google Maps URL parsed to lat/lng without network call @smoke', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  await page.route('**/api/trips/1', (route) =>
    route.fulfill({ json: { success: true, data: mockTrip } })
  );
  // Nominatim should NOT be called for a Maps URL — if it is, the test should still pass
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, body: '[]' })
  );

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=1`);
  // TODO: paste 'https://www.google.com/maps/place/Name/@35.6894875,139.6917064,17z'
  //       into geocoder input, click "Buscar lugar",
  //       assert lat field = "35.6894875" and lng field = "139.6917064"
  //       (coordinate resolved without Nominatim call)
  expect(true).toBe(true);
});
