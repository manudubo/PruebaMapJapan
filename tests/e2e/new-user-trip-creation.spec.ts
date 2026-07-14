import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe.configure({ mode: 'serial' });

test.use({
  storageState: path.join(__dirname, '../.auth/new-user.json'),
});

test.fixme(
  ({ browserName }) => browserName === 'webkit',
  'webkit handles KC redirect differently when building a fresh browser context from new-user.json — environment constraint',
);

// sessionStorage replay for Playwright bug #31108 — keycloak-js stores tokens here
const sessionEntries: [string, string][] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '../.auth/new-user-session.json'), 'utf-8')
    ) as [string, string][];
  } catch {
    return [];
  }
})();

test.setTimeout(120_000);

const FRONTEND_BASE = process.env.FRONTEND_URL
  ? `${process.env.FRONTEND_URL}/PruebaMapJapan`
  : 'http://localhost:5173/PruebaMapJapan';
const API_BASE = process.env.BACKEND_URL
  ? `${process.env.BACKEND_URL}/api`
  : 'http://localhost:8787/api';

// Shared state for the serial flow
let capturedTripId: string | null = null;


// ---------------------------------------------------------------------------
// Helper: extract token from Authorization header of first authenticated request.
// keycloak is a module-private ES export never on window — page.evaluate for it throws.
// ---------------------------------------------------------------------------
async function getToken(page: Page): Promise<string> {
  const [req] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/api/') &&
      (r.headers()['authorization'] ?? '').startsWith('Bearer ')
    ),
    page.goto(`${FRONTEND_BASE}/dashboard.html`),
  ]);
  return req.headers()['authorization'].slice('Bearer '.length);
}

test.describe('New user trip creation flow', () => {
  test.skip(!!process.env.SKIP_REAL_AUTH, 'KC not available in this environment');

  test.beforeEach(async ({ context }) => {
    // CRITICAL: addInitScript must run before any page.goto() (Playwright bug #31108)
    if (sessionEntries.length) {
      await context.addInitScript((entries) => {
        for (const [k, v] of entries) {
          window.sessionStorage.setItem(k, v);
        }
      }, sessionEntries);
    }
  });

  test.beforeAll(async ({ browser }) => {
    // page fixture is per-test and unavailable in beforeAll — create context manually
    const context = await browser.newContext({
      storageState: path.join(__dirname, '../.auth/new-user.json'),
    });
    if (sessionEntries.length) {
      await context.addInitScript((entries) => {
        for (const [k, v] of entries) {
          window.sessionStorage.setItem(k, v);
        }
      }, sessionEntries);
    }
    const page = await context.newPage();

    // Unconditional cleanup: delete ALL existing trips for new_user_test.
    const token = await getToken(page);
    const resp = await page.request.get(`${API_BASE}/trips`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    for (const trip of data.data ?? []) {
      await page.request.delete(`${API_BASE}/trips/${trip.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    // Safety net: delete test trip if not already deleted in the flow
    if (capturedTripId) {
      const context = await browser.newContext({
        storageState: path.join(__dirname, '../.auth/new-user.json'),
      });
      if (sessionEntries.length) {
        await context.addInitScript((entries) => {
          for (const [k, v] of entries) {
            window.sessionStorage.setItem(k, v);
          }
        }, sessionEntries);
      }
      const page = await context.newPage();
      const token = await getToken(page);
      await page.request.delete(`${API_BASE}/trips/${capturedTripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* already deleted in test flow */ });
      capturedTripId = null;
      await context.close();
    }
  });

  test('NU-01: full trip creation flow — empty dashboard to delete', async ({ page }) => {

    // --- Step 2: Navigate to dashboard + capture token; assert empty-state CTA visible ---
    const [req] = await Promise.all([
      page.waitForRequest(r =>
        r.url().includes('/api/') &&
        (r.headers()['authorization'] ?? '').startsWith('Bearer ')
      ),
      page.goto(`${FRONTEND_BASE}/dashboard.html`),
    ]);
    const token = req.headers()['authorization'].slice('Bearer '.length);
    await page.waitForLoadState('domcontentloaded');

    const ctaBtn = page.locator('#empty-state-create-btn');
    await expect(ctaBtn).toBeVisible();

    // --- Step 3: Create trip via UI form (UX-01, UX-03) ---
    await ctaBtn.click();
    await page.waitForSelector('#create-trip-overlay:not([hidden])', { timeout: 5_000 });

    await page.fill('#trip-name', 'New User Test Trip');
    await page.fill('#trip-start', '2026-08-01');
    await page.fill('#trip-end', '2026-08-15');

    await Promise.all([
      page.waitForURL(/trip\.html\?tripId=/, { timeout: 15_000 }),
      page.getByRole('button', { name: 'Create trip' }).click(),
    ]);
    await page.waitForLoadState('domcontentloaded');

    const tripId = new URL(page.url()).searchParams.get('tripId')!;
    capturedTripId = tripId;

    // --- Step 4: Navigate to trip-edit; add destination via geocoder ---
    await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
    await page.waitForSelector('#destinations-section', { timeout: 10_000 });

    await page.click('#add-dest-btn');
    await page.waitForSelector('#dest-modal-overlay:not([hidden])', { timeout: 5_000 });

    await page.fill('#dest-city', 'Tokyo');
    await page.fill('#dest-country', 'Japan');

    await page.fill('#dest-geocoder-input', 'https://www.google.com/maps/@35.6762,139.6503,13z');
    await page.click('#dest-geocoder-btn');
    await page.waitForSelector('#dest-geocoder-results:not([hidden])', { timeout: 5_000 });

    // Save destination
    const destRespPromise = page.waitForResponse(
      r => r.url().includes('/destinations') && r.request().method() === 'POST',
      { timeout: 8_000 }
    );
    await page.click('#dest-save-btn');
    const destResp = await destRespPromise;
    expect(destResp.status()).toBe(201);
    const destData = await destResp.json();
    const destId = String(destData.data.id);
    void destId;

    // --- Step 5: Add hotel via geocoder ---
    await page.waitForSelector('button:has-text("Add hotel")', { timeout: 5_000 });
    await page.locator('button:has-text("Add hotel")').first().click();
    await page.waitForSelector('#hotel-modal-overlay:not([hidden])', { timeout: 5_000 });

    await page.fill('#hotel-name', 'Tokyo Hotel');
    await page.fill('#hotel-geocoder-input', 'https://www.google.com/maps/@35.6762,139.6503,13z');
    await page.click('#hotel-geocoder-btn');
    await page.waitForSelector('#hotel-geocoder-results:not([hidden])', { timeout: 5_000 });

    const hotelRespPromise = page.waitForResponse(
      r => r.url().includes('/hotel') && r.request().method() === 'PUT',
      { timeout: 8_000 }
    );
    await page.click('#hotel-save-btn');
    const hotelResp = await hotelRespPromise;
    expect(hotelResp.status()).toBe(200);

    // --- Step 6: Add day via modal ---
    // "Add day" button has no ID — text-based selector (days.ts:388)
    await page.waitForSelector('button:has-text("Add day")', { timeout: 5_000 });
    await page.locator('button:has-text("Add day")').first().click();
    await page.waitForSelector('#day-modal-overlay:not([hidden])', { timeout: 5_000 });

    // date is required (days.ts:86 dInput.required = true)
    await page.fill('#day-date', '2026-08-01');

    const dayRespPromise = page.waitForResponse(
      r => r.url().includes('/days') && r.request().method() === 'POST',
      { timeout: 8_000 }
    );
    await page.click('#day-save-btn');
    const dayResp = await dayRespPromise;
    expect(dayResp.status()).toBe(201);

    // --- Step 7: Add activity via geocoder ---
    // Open activity modal (first day's "Add activity" button — no ID, text-based)
    await page.waitForSelector('button:has-text("Add activity")', { timeout: 5_000 });
    await page.locator('button:has-text("Add activity")').first().click();
    await page.waitForSelector('#act-modal-overlay:not([hidden])', { timeout: 5_000 });

    await page.fill('#act-name', 'Senso-ji Temple');
    await page.fill('#act-geocoder-input', 'https://www.google.com/maps/@35.6762,139.6503,13z');
    await page.click('#act-geocoder-btn');
    await page.waitForSelector('#act-geocoder-results:not([hidden])', { timeout: 5_000 });

    const actRespPromise = page.waitForResponse(
      r => r.url().includes('/activities') && r.request().method() === 'POST',
      { timeout: 8_000 }
    );
    await page.click('#act-save-btn');
    const actResp = await actRespPromise;
    expect(actResp.status()).toBe(201);

    // --- Step 8: Navigate to trip-detail; assert Leaflet map renders ---
    await page.goto(`${FRONTEND_BASE}/trip.html?tripId=${tripId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });

    // Assert at least one marker rendered
    const markers = page.locator('.leaflet-marker-pane .custom-marker');
    await expect(markers).not.toHaveCount(0, { timeout: 5_000 });

    // Click first marker and assert popup contains the activity name
    await markers.first().click({ force: true });
    await expect(page.locator('.leaflet-popup-content')).toContainText('Senso-ji Temple', { timeout: 5_000 });

    // --- Step 9: Return to dashboard; verify trip card appears ---
    await page.goto(`${FRONTEND_BASE}/dashboard.html`);
    await page.waitForSelector('.trip-card', { timeout: 10_000 });
    await expect(page.locator('.trip-card').filter({ hasText: 'New User Test Trip' })).toBeVisible({ timeout: 5_000 });

    // --- Step 10: Edit trip metadata ---
    await page.goto(`${FRONTEND_BASE}/trip-edit.html?tripId=${tripId}`);
    await page.waitForSelector('#metadata-form', { timeout: 10_000 });
    await page.fill('#trip-name', 'New User Test Trip (edited)');
    const patchRespPromise = page.waitForResponse(
      r => r.url().includes(`/trips/${tripId}`) && r.request().method() === 'PATCH',
      { timeout: 8_000 }
    );
    await page.click('#metadata-save-btn');
    const patchResp = await patchRespPromise;
    expect(patchResp.status()).toBe(200);

    // --- Step 11: Delete trip (via API — deterministic, no UI navigation) ---
    const deleteResp = await page.request.delete(`${API_BASE}/trips/${tripId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteResp.status()).toBe(200);
    capturedTripId = null; // afterAll safety net knows it's already cleaned up
  });
});
