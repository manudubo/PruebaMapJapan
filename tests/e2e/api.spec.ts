import { test, expect, request } from '@playwright/test';

const BACKEND_URL = 'http://localhost:8787';

// Check if backend is reachable before running these tests.
// Individual tests use test.skip() when the backend is not available.
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

test.describe('Backend API integration tests', () => {
  test('Health endpoint returns 200', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping API integration tests');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get('/api/health');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
    await ctx.dispose();
  });

  test('Trips endpoint requires auth', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping API integration tests');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    // No Authorization header — should return 401
    const res = await ctx.get('/api/trips');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('Users endpoint requires auth', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping API integration tests');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    // No Authorization header — should return 401
    const res = await ctx.get('/api/users/me');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('Public trip returns 404 for missing trip', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping API integration tests');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    // Trip ID 99999 should not exist — no auth needed for public route
    const res = await ctx.get('/api/public/trips/99999');
    expect(res.status()).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    await ctx.dispose();
  });
});
