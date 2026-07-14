/**
 * Phase 2 manual-verification integration tests.
 * Requires: frontend + backend running, Keycloak up, testuser/Test1234! created.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

// Integration tests include a full Keycloak login round-trip — allow extra time
test.setTimeout(90000);

test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration');

// sessionStorage replay for Playwright bug #31108 — keycloak-js stores tokens here
const sessionEntries: [string, string][] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '../.auth/session.json'), 'utf-8')
    ) as [string, string][];
  } catch {
    return [];
  }
})();

const FRONTEND_BASE = 'http://localhost:5173/PruebaMapJapan';
const API_BASE = 'http://localhost:8787/api';

async function isFrontendRunning(): Promise<boolean> {
  try {
    const r = await fetch(`${FRONTEND_BASE}/`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function createTrip(page: Page, token: string): Promise<string> {
  const tripId: string = await page.evaluate(async (args) => {
    const [apiBase, tok] = args as [string, string];
    const resp = await fetch(`${apiBase}/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: 'Test trip', start_date: '2026-08-01', end_date: '2026-08-15' }),
    });
    const data = await resp.json();
    if (!data.data?.id) throw new Error(`Trip create failed: ${JSON.stringify(data)}`);
    return String(data.data.id);
  }, [API_BASE, token]);
  return tripId;
}

// CRITICAL: addInitScript must run before any page.goto() (Playwright bug #31108)
test.beforeEach(async ({ context }) => {
  if (sessionEntries.length) {
    await context.addInitScript((entries) => {
      for (const [k, v] of entries) {
        window.sessionStorage.setItem(k, v);
      }
    }, sessionEntries);
  }
});

// ---------------------------------------------------------------------------
// P2-V1: trip-edit page loads and form pre-fills from API
// ---------------------------------------------------------------------------
test('P2-V1: trip-edit page loads; metadata form pre-fills from API @integration', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
  await page.waitForSelector('#metadata-form', { timeout: 10000 });

  const nameVal = await page.inputValue('#trip-name');
  expect(nameVal).toBe('Test trip');

  const startVal = await page.inputValue('#trip-start-date');
  expect(startVal).toBe('2026-08-01');

  const endVal = await page.inputValue('#trip-end-date');
  expect(endVal).toBe('2026-08-15');

  const isPublicChecked = await page.isChecked('#trip-public');
  expect(isPublicChecked).toBe(false);
});

// ---------------------------------------------------------------------------
// P2-V2: is_public toggle PATCHes with correct field
// ---------------------------------------------------------------------------
test('P2-V2: is_public checkbox sends PATCH with is_public:true @integration', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
  await page.waitForSelector('#metadata-form', { timeout: 10000 });

  const patchBodies: Record<string, unknown>[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes(`/trips/${tripId}`)) {
      try { patchBodies.push(JSON.parse(req.postData() ?? '{}')); } catch { /* */ }
    }
  });

  await page.check('#trip-public');
  await page.click('#metadata-save-btn');
  await page.waitForResponse(
    (r) => r.url().includes(`/trips/${tripId}`) && r.request().method() === 'PATCH',
    { timeout: 8000 }
  );

  expect(patchBodies.length).toBeGreaterThan(0);
  expect(patchBodies[patchBodies.length - 1]).toMatchObject({ is_public: true });
});

// ---------------------------------------------------------------------------
// P2-V3: Destination CRUD — add a destination via modal
// ---------------------------------------------------------------------------
test('P2-V3: add destination via modal; POST to /destinations succeeds @integration', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
  await page.waitForSelector('#destinations-section', { timeout: 10000 });

  // Click Add destination button
  await page.click('#add-dest-btn');
  await page.waitForSelector('#dest-modal-overlay:not([hidden])', { timeout: 5000 });

  // Fill city and country; use Google Maps URL for coordinates
  await page.fill('#dest-city', 'Kioto');
  await page.fill('#dest-country', 'Japón');
  // Paste a Google Maps URL into the geocoder input — extractCoordsFromGoogleMapsUrl handles it
  await page.fill('#dest-geocoder-input', 'https://www.google.com/maps/@35.0116,135.7681,13z');

  // Wait for POST /destinations response
  const destRespPromise = page.waitForResponse(
    (r) => r.url().includes('/destinations') && r.request().method() === 'POST',
    { timeout: 8000 }
  );
  await page.click('#dest-save-btn');
  const resp = await destRespPromise;
  expect(resp.status()).toBe(201);

  // City name appears in the destination list
  await page.waitForSelector(':text("Kioto")', { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// P2-V4: Hotel URL rendered as plain text, not an anchor
// ---------------------------------------------------------------------------
test('P2-V4: hotel URL renders as plain text, not an <a> tag @integration', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  // Create destination via API
  const destId: string = await page.evaluate(async (args) => {
    const [apiBase, tId, tok] = args as [string, string, string];
    const resp = await fetch(`${apiBase}/trips/${tId}/destinations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ city_name: 'Osaka', country: 'Japón', lat: '34.6937', lng: '135.5023', order_index: 0 }),
    });
    const data = await resp.json();
    if (!data.data?.id) throw new Error(`Dest create failed: ${JSON.stringify(data)}`);
    return String(data.data.id);
  }, [API_BASE, tripId, token]);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
  await page.waitForSelector('#destinations-section', { timeout: 10000 });

  // Open hotel modal (hotel section should render under each destination)
  await page.waitForSelector('button:has-text("Add hotel")', { timeout: 5000 });
  await page.locator('button:has-text("Add hotel")').first().click();
  await page.waitForSelector('#hotel-modal-overlay:not([hidden])', { timeout: 5000 });

  await page.fill('#hotel-name', 'Hotel Osaka');
  await page.fill('#hotel-url', 'https://hotel.example.com');
  await page.click('#hotel-save-btn');

  await page.waitForResponse(
    (r) => r.url().includes('/hotel') && r.request().method() === 'PUT',
    { timeout: 8000 }
  );

  // URL should not be an anchor — find any element containing the URL text
  await page.waitForSelector(':text("https://hotel.example.com")', { timeout: 5000 });
  const urlEl = page.locator(':text("https://hotel.example.com")').first();
  const tagName = await urlEl.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName).not.toBe('a');
});

// ---------------------------------------------------------------------------
// P2-V5: Activity time field + reorder via POST
// ---------------------------------------------------------------------------
test('P2-V5: activity time input saved; reorder POST sends ordered_ids @integration', async ({ page }) => {
  const up = await isFrontendRunning();
  test.skip(!up, 'Frontend not running');

  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  // Create destination + day via API
  const ids: { destId: string; dayId: string } = await page.evaluate(async (args) => {
    const [apiBase, tId, tok] = args as [string, string, string];
    const destResp = await fetch(`${apiBase}/trips/${tId}/destinations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ city_name: 'Nara', country: 'Japón', lat: '34.685', lng: '135.805', order_index: 0 }),
    });
    const dest = await destResp.json();
    if (!dest.data?.id) throw new Error(`Dest failed: ${JSON.stringify(dest)}`);
    const dayResp = await fetch(`${apiBase}/trips/${tId}/destinations/${dest.data.id}/days`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ date: '2026-08-05' }),
    });
    const day = await dayResp.json();
    if (!day.data?.id) throw new Error(`Day failed: ${JSON.stringify(day)}`);
    return { destId: String(dest.data.id), dayId: String(day.data.id) };
  }, [API_BASE, tripId, token]);

  // Create two activities via API
  await page.evaluate(async (args) => {
    const [apiBase, tId, dId, dayId, tok] = args as [string, string, string, string, string];
    const base = `${apiBase}/trips/${tId}/destinations/${dId}/days/${dayId}/activities`;
    await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: 'Actividad A', time: '09:00', lat: '34.685', lng: '135.805' }),
    });
    await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: 'Actividad B', time: '14:00', lat: '34.685', lng: '135.805' }),
    });
  }, [API_BASE, tripId, ids.destId, ids.dayId, token]);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
  await page.waitForSelector('#destinations-section', { timeout: 10000 });

  // Activities should render with time values
  await page.waitForSelector(':text("Actividad A")', { timeout: 8000 });
  await page.waitForSelector(':text("09:00")', { timeout: 5000 });
  await page.waitForSelector(':text("14:00")', { timeout: 5000 });

  // Capture the reorder POST
  let reorderBody: Record<string, unknown> | null = null;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/reorder')) {
      try { reorderBody = JSON.parse(req.postData() ?? '{}'); } catch { /* */ }
    }
  });

  // Click ▲ on second activity (move up)
  const upBtns = page.locator('button[title="Move up"]');
  const count = await upBtns.count();
  expect(count).toBeGreaterThan(0);
  await upBtns.last().click();

  await page.waitForResponse(
    (r) => r.url().includes('/reorder') && r.request().method() === 'POST',
    { timeout: 8000 }
  );

  expect(reorderBody).not.toBeNull();
  expect(Array.isArray((reorderBody as any).ordered_ids)).toBe(true);
  expect((reorderBody as any).ordered_ids.length).toBe(2);
});
