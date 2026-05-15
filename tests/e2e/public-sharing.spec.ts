import { test, expect, request } from '@playwright/test';

const BACKEND_URL = 'http://localhost:8787';
const PUBLIC_SLUG = '4dd5492e-2111-4b38-bc45-47848d27af42'; // trip 1 "Japan 2026" — is_public=true
const PRIVATE_SLUG = 'e3214d9f-e5a3-47b6-8441-fb167041b4fa'; // trip 2 — is_public=false
const PUBLIC_TRIP_ID = '1';

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

// --- Backend API tests ---

test.describe('Public sharing — backend route', () => {
  test('public trip returns 200 with trip data', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend not running');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get(`/api/public/trips/${PUBLIC_SLUG}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Japan 2026');
    await ctx.dispose();
  });

  test('private trip returns 404 even with valid slug', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend not running');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get(`/api/public/trips/${PRIVATE_SLUG}`);
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

    await page.goto(`trip.html?slug=${PUBLIC_SLUG}`);

    // Wait for the page to reach ready state
    await page.waitForSelector('body.ready', { timeout: 15000 });

    // Trip title should be populated (not the loading placeholder)
    const title = await page.locator('#trip-title').textContent();
    expect(title).not.toBe('Cargando viaje…');
    expect(title).toBeTruthy();

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

    await page.goto(`trip.html?tripId=${PUBLIC_TRIP_ID}`);

    // Wait for page to settle (auth init + error state)
    await page.waitForSelector('body.ready', { timeout: 20000 });

    // Should show the access-denied error message (WR-01 fix)
    const mainContent = page.locator('#main-content');
    const text = await mainContent.textContent();
    expect(text).toContain('access');
  });
});
