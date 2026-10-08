/**
 * Phase 2 manual-verification integration tests.
 * Requires: frontend + backend running, Keycloak up and the global-setup session
 * (.auth/session.json, e2e-test@local). Trips created here are deleted in afterAll.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

// Integration tests include a full Keycloak login round-trip — allow extra time
test.setTimeout(90000);

test.fixme(!!process.env.SKIP_REAL_AUTH, 'requires a live Keycloak + backend (SKIP_REAL_AUTH is set, as in CI); run locally per SETUP.md');

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

// Trips created by this file, deleted in afterAll so repeated runs do not pile up rows.
const createdTrips: Array<{ id: string; token: string }> = [];

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
  createdTrips.push({ id: tripId, token });
  return tripId;
}

test.afterAll(async ({ request }) => {
  for (const { id, token } of createdTrips.splice(0)) {
    const res = await request.delete(`${API_BASE}/trips/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok(), `cleanup DELETE /trips/${id}`).toBe(true);
  }
});

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
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}#trip`);
  await page.waitForSelector('#metadata-form', { timeout: 10000 });

  const nameVal = await page.inputValue('#trip-name');
  expect(nameVal).toBe('Test trip');

  const startVal = await page.inputValue('#trip-start-date');
  expect(startVal).toBe('2026-08-01');

  const endVal = await page.inputValue('#trip-end-date');
  expect(endVal).toBe('2026-08-15');

  await page.click('.te-step[data-step="share"]');
  const isPublicChecked = await page.isChecked('#trip-public');
  expect(isPublicChecked).toBe(false);
});

// ---------------------------------------------------------------------------
// P2-V2: is_public toggle PATCHes with correct field
// ---------------------------------------------------------------------------
test('P2-V2: is_public checkbox sends PATCH with is_public:true @integration', async ({ page }) => {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}#share`);
  await page.waitForSelector('#trip-public', { timeout: 10000 });

  const patchBodies: Record<string, unknown>[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes(`/trips/${tripId}`)) {
      try { patchBodies.push(JSON.parse(req.postData() ?? '{}')); } catch { /* */ }
    }
  });

  // Autosave: toggling visibility saves at once, there is no Save button.
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/trips/${tripId}`) && r.request().method() === 'PATCH',
    { timeout: 8000 }
  );
  await page.check('#trip-public');
  await patched;

  expect(patchBodies.length).toBeGreaterThan(0);
  expect(patchBodies[patchBodies.length - 1]).toMatchObject({ is_public: true });
});

// ---------------------------------------------------------------------------
// P2-V3: Destination CRUD — add a destination via modal
// ---------------------------------------------------------------------------
test('P2-V3: add destination via modal; POST to /destinations succeeds @integration', async ({ page }) => {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}#route`);
  await page.waitForSelector('#dest-search', { timeout: 10000 });

  // A pasted Google Maps link carries coordinates and (in /place/<Name>/) the city name,
  // so no live geocoder is needed.
  await page.fill('#dest-search', 'https://www.google.com/maps/place/Kioto/@35.0116,135.7681,13z');

  const destRespPromise = page.waitForResponse(
    (r) => r.url().includes('/destinations') && r.request().method() === 'POST',
    { timeout: 8000 }
  );
  await page.locator('#dest-search-list .place-option').first().click();
  const resp = await destRespPromise;
  expect(resp.status()).toBe(201);

  await expect(page.locator('#destinations-list .te-dest-name')).toHaveText(['Kioto']);
});

// ---------------------------------------------------------------------------
// P2-V4: hotel is set from a place search/link and shown as text in an input, not a link
// ---------------------------------------------------------------------------
test('P2-V4: hotel set from a pasted link is saved with PUT and shown in an input @integration', async ({ page }) => {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  const token = req.headers()['authorization'].slice('Bearer '.length);
  const tripId = await createTrip(page, token);

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

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}#city/${destId}`);
  await page.waitForSelector('#hotel-search', { timeout: 10000 });

  const put = page.waitForResponse(
    (r) => r.url().includes('/hotel') && r.request().method() === 'PUT',
    { timeout: 8000 }
  );
  await page.fill('#hotel-search', 'https://www.google.com/maps/place/Hotel+Osaka/@34.69,135.50,17z');
  await page.locator('#hotel-search-list .place-option').first().click();
  expect((await put).status()).toBe(200);

  await expect(page.locator('#hotel-name')).toHaveValue('Hotel Osaka');
  expect(await page.locator('#hotel-section a').count()).toBe(0);
});

// ---------------------------------------------------------------------------
// P2-V5: Activity time field + reorder via POST
// ---------------------------------------------------------------------------
test('P2-V5: activity time input saved; reorder POST sends ordered_ids @integration', async ({ page }) => {
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

  await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}#city/${ids.destId}/2026-08-05`);
  await expect(page.locator('#activity-list > li')).toHaveCount(2, { timeout: 8000 });

  // Activities render with their time values (in inputs)
  await expect(page.locator('#activity-list [data-role="time"]').first()).toHaveValue('09:00');
  await expect(page.locator('#activity-list [data-role="time"]').last()).toHaveValue('14:00');

  // Capture the reorder POST
  let reorderBody: Record<string, unknown> | null = null;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/reorder')) {
      try { reorderBody = JSON.parse(req.postData() ?? '{}'); } catch { /* */ }
    }
  });

  // Click ▲ on second activity (move up)
  const upBtns = page.locator('#activity-list [data-role="up"]');
  await upBtns.last().click();

  await page.waitForResponse(
    (r) => r.url().includes('/reorder') && r.request().method() === 'POST',
    { timeout: 8000 }
  );

  expect(reorderBody).not.toBeNull();
  expect(Array.isArray((reorderBody as any).ordered_ids)).toBe(true);
  expect((reorderBody as any).ordered_ids.length).toBe(2);
});
