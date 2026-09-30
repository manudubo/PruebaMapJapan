import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../index';
import type { Env } from '../types';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'x'.repeat(64),
  ENVIRONMENT: 'production',
};

// Anything an attacker could use to fingerprint the deployment.
const FINGERPRINTS = [/prueba/i, /map-?japan/i, /0\.1\.0/, /version/i, /running/i, /hono/i, /\d{4}-\d{2}-\d{2}T/];

describe('health endpoints are minimal (SEC-24)', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['/', '/api/health'])('%s returns exactly {status:"ok"}', async (path) => {
    const res = await app.request(path, {}, mockEnv);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'ok' });
    for (const re of FINGERPRINTS) expect(text).not.toMatch(re);
  });

  it.each(['/', '/api/health'])('%s is not cacheable and leaks no server header', async (path) => {
    const res = await app.request(path, {}, mockEnv);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('server')).toBeNull();
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('does not touch the database or Keycloak', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await app.request('/api/health', {}, { ...mockEnv, DATABASE_URL: '' });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores query strings and headers (no reflection)', async () => {
    const res = await app.request(
      '/api/health?verbose=1&debug=true&<script>=1',
      { headers: { 'X-Debug': '1', Authorization: 'Bearer garbage' } },
      mockEnv,
    );
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('only GET is routed: POST falls through to the generic 404', async () => {
    const res = await app.request('/api/health', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Not found' });
  });

  it('answers the same with no bindings at all', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
