import { describe, it, expect, afterAll } from 'vitest';
import app from './index';
import { closeTestPool, testEnv } from './test-utils/db';

// DATABASE_URL points at the real ephemeral test database (ARCH-06);
// auth-gated routes still answer 401 before the DB is touched.
const mockEnv = testEnv();
afterAll(closeTestPool);

describe('Hono app — in-process unit tests', () => {
  it('GET / returns 200 health check', async () => {
    const res = await app.request('/', {}, mockEnv);
    expect(res.status).toBe(200);

    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/health returns { status: "ok" }', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/trips without Authorization header returns 401', async () => {
    const res = await app.request('/api/trips', {}, mockEnv);
    expect(res.status).toBe(401);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('GET /api/users/me without Authorization header returns 401', async () => {
    const res = await app.request('/api/users/me', {}, mockEnv);
    expect(res.status).toBe(401);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('GET /api/public/trips/:slug returns 404 for missing public trip', async () => {
    const res = await app.request('/api/public/trips/00000000-0000-0000-0000-000000000000', {}, mockEnv);
    expect(res.status).toBe(404);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('Unknown route returns 404', async () => {
    const res = await app.request('/this-route-does-not-exist', {}, mockEnv);
    expect(res.status).toBe(404);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });
});

describe('Security headers middleware', () => {
  it('sets all 4 security headers on every response', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sets security headers on 401 unauthenticated responses', async () => {
    const res = await app.request('/api/trips', {}, mockEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
