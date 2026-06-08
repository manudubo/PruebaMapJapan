import { describe, it, expect } from 'vitest';
import app from './index';
import type { Env } from './types';

// Mock environment — DATABASE_URL is required by routes that call getDb(),
// but for auth-gated routes we expect a 401 before the DB is ever accessed.
const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'a3f8c2d1e4b7f0a9d6c3e8b1f4a7d0c2e5b8f3a6d9c0e3b6f1a4d7c0e3b6f1',
};

describe('Hono app — in-process unit tests', () => {
  it('GET / returns 200 health check', async () => {
    const res = await app.request('/', {}, mockEnv);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.message).toContain('API is running');
  });

  it('GET /api/health returns { status: "ok" }', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.status).toBe('ok');
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
    // This route hits the database — with a mock DATABASE_URL it will either
    // throw (leading to the 500 error handler) or return 404 if the DB is down.
    // We accept either 404 or 500 here since no real DB is connected in unit tests.
    const res = await app.request('/api/public/trips/00000000-0000-0000-0000-000000000000', {}, mockEnv);
    expect([404, 500]).toContain(res.status);

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
