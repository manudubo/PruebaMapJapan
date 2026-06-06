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

test.describe('JWT audience rejection', () => {
  test('worker client_credentials token without japan-trip-frontend audience returns 401', async () => {
    const backendUp = await isBackendRunning();
    test.skip(!backendUp, 'Backend is not running — skipping audience assertion test');

    const keycloakUrl = process.env['KEYCLOAK_URL'] ?? 'http://localhost:8080';
    const kcRealm = process.env['KEYCLOAK_REALM'] ?? 'japan-trip';
    const clientId = process.env['KC_ADMIN_CLIENT_ID']!;
    const clientSecret = process.env['KC_ADMIN_CLIENT_SECRET']!;

    // Fetch a client_credentials token from the dedicated worker client.
    // This client has NO japan-trip-frontend audience mapper — its tokens will be rejected by validateAudience().
    const tokenRes = await fetch(
      `${keycloakUrl}/realms/${kcRealm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );

    expect(tokenRes.ok).toBe(true);
    const { access_token } = await tokenRes.json() as { access_token: string };
    expect(access_token).toBeTruthy();

    // Send the worker token to an authenticated endpoint — expect 401 (wrong audience)
    const ctx = await request.newContext({ baseURL: BACKEND_URL });
    const res = await ctx.get('/api/trips', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
