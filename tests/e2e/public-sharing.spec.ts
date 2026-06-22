import { test, expect, request, Page } from '@playwright/test';
import * as path from 'path';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8787';
const API_BASE = `${BACKEND_URL}/api`;
const FRONTEND_BASE = process.env.FRONTEND_URL
  ? `${process.env.FRONTEND_URL}/PruebaMapJapan`
  : 'http://localhost:5173/PruebaMapJapan';

let publicTripId: string = '';
let publicSlug: string = '';
let privateSlug: string = '';
let privateTripId: string = '';
const TEST_PUBLIC_TRIP_NAME = 'Phase16 Public Fixture Trip';

async function isBackendRunning(): Promise<boolean> {
  try {
    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get('/api/health', { timeout: 3000 });
    await ctx.dispose();
    return res.status() < 500;
  } catch {
    return false;
  }
}

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

test.describe('Public sharing', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const backendUp = await isBackendRunning();
    if (!backendUp) {
      console.log('Backend not running — skipping fixture creation');
      return;
    }

    const context = await browser.newContext({
      storageState: path.join(__dirname, '../.auth/user.json'),
    });
    const page = await context.newPage();
    const token = await getToken(page);

    // Create public fixture trip
    const pubResp = await page.request.post(`${API_BASE}/trips`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: TEST_PUBLIC_TRIP_NAME, is_public: true },
    });
    const pubData = await pubResp.json();
    publicTripId = String(pubData.data.id);
    publicSlug = pubData.data.public_slug;

    // Create private fixture trip
    const privResp = await page.request.post(`${API_BASE}/trips`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Phase16 Private Fixture Trip', is_public: false },
    });
    const privData = await privResp.json();
    privateTripId = String(privData.data.id);
    privateSlug = privData.data.public_slug;

    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!publicTripId && !privateTripId) return;
    const context = await browser.newContext({
      storageState: path.join(__dirname, '../.auth/user.json'),
    });
    const page = await context.newPage();
    const token = await getToken(page);
    if (publicTripId) {
      await page.request.delete(`${API_BASE}/trips/${publicTripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (privateTripId) {
      await page.request.delete(`${API_BASE}/trips/${privateTripId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await context.close();
  });

  // --- Backend API tests ---

  test.describe('Public sharing — backend route', () => {
    test('public trip returns 200 with trip data', async () => {
      const backendUp = await isBackendRunning();
      test.skip(!backendUp, 'Backend not running');

      const ctx = await request.newContext({ baseURL: BACKEND_URL });
      const res = await ctx.get(`/api/public/trips/${publicSlug}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe(TEST_PUBLIC_TRIP_NAME);
      await ctx.dispose();
    });

    test('private trip returns 404 even with valid slug', async () => {
      const backendUp = await isBackendRunning();
      test.skip(!backendUp, 'Backend not running');

      const ctx = await request.newContext({ baseURL: BACKEND_URL });
      const res = await ctx.get(`/api/public/trips/${privateSlug}`);
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      await ctx.dispose();
    });

    test('invalid slug returns 400 with "Invalid slug"', async () => {
      const backendUp = await isBackendRunning();
      test.skip(!backendUp, 'Backend not running');

      const ctx = await request.newContext({ baseURL: BACKEND_URL });
      const res = await ctx.get('/api/public/trips/not-a-uuid');
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Invalid slug');
      await ctx.dispose();
    });
  });

  // --- Frontend UAT tests ---

  test.describe('Public sharing — guest view (?slug=)', () => {
    test('public trip loads without auth — title shown, owner controls hidden', async ({ page }) => {
      const backendUp = await isBackendRunning();
      test.skip(!backendUp, 'Backend not running');

      await page.goto(`trip.html?slug=${publicSlug}`);

      // Wait for the page to reach ready state
      await page.waitForSelector('body.ready', { timeout: 15000 });

      // Trip title should be populated (not the loading placeholder)
      const title = await page.locator('#trip-title').textContent();
      expect(title).toBeTruthy();
      expect(title).toBe(TEST_PUBLIC_TRIP_NAME);

      // edit link must be hidden (data-owner-only hidden in slug mode)
      const editLink = page.locator('#trip-edit-link');
      await expect(editLink).toBeHidden();

      // copy-link button must be hidden in guest mode (no owner controls)
      const copyBtn = page.locator('#copy-link-btn');
      await expect(copyBtn).toBeHidden();
    });
  });

  test.describe('Public sharing — non-owner ?tripId= access (WR-01)', () => {
    test('unauthenticated ?tripId= shows access-denied message', async ({ page }) => {
      const backendUp = await isBackendRunning();
      test.skip(!backendUp, 'Backend not running');

      await page.goto(`trip.html?tripId=${publicTripId}`);

      // Wait for page to settle (auth init + error state)
      await page.waitForSelector('body.ready', { timeout: 20000 });

      // Should show the access-denied error message (WR-01 fix)
      const mainContent = page.locator('#main-content');
      const text = await mainContent.textContent();
      expect(text).toContain('access');
    });
  });
});
