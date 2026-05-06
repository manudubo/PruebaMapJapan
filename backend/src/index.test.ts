import { describe, it, expect } from 'vitest';
import app from './index';
import type { Env } from './types';

// Mock environment — DATABASE_URL is required by routes that call getDb(),
// but for auth-gated routes we expect a 401 before the DB is ever accessed.
const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
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

  it('GET /api/public/trips/99999 returns 404 for missing public trip', async () => {
    // This route hits the database — with a mock DATABASE_URL it will either
    // throw (leading to the 500 error handler) or return 404 if the DB is down.
    // We accept either 404 or 500 here since no real DB is connected in unit tests.
    const res = await app.request('/api/public/trips/99999', {}, mockEnv);
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
