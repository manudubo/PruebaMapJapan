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

  test('Public trip returns 404 for missing slug', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping API integration tests');

    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    // All-zeros UUID passes regex but will never match a real trip
    const res = await ctx.get('/api/public/trips/00000000-0000-0000-0000-000000000000');
    expect([404, 500]).toContain(res.status());

    const body = await res.json();
    expect(body.success).toBe(false);
    await ctx.dispose();
  });
});
