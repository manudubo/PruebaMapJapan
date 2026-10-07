import { describe, it, expect, vi } from 'vitest';

// Force a deterministic unhandled error so app.onError produces the 500.
vi.mock('../db/queries/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/trips')>();
  return {
    ...actual,
    getTripBySlug: vi.fn(async () => {
      throw new Error('db exploded');
    }),
  };
});

import app from '../index';
import type { Env } from '../types';
import { PERMISSIONS_POLICY } from './security';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'x'.repeat(64),
};

function expectAllSecurityHeaders(res: Response): void {
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
  expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
}

describe('security headers (SEC-20)', () => {
  it('are present on a 200 response', async () => {
    const res = await app.request('/api/health', {}, mockEnv);
    expect(res.status).toBe(200);
    expectAllSecurityHeaders(res);
  });

  it('are present on a 404 from notFound', async () => {
    const res = await app.request('/nope', {}, mockEnv);
    expect(res.status).toBe(404);
    expectAllSecurityHeaders(res);
  });

  it('are present on a 401 from the auth middleware', async () => {
    const res = await app.request('/api/trips', {}, mockEnv);
    expect(res.status).toBe(401);
    expectAllSecurityHeaders(res);
  });

  it('are present on a 400 validation error', async () => {
    const res = await app.request('/api/public/trips/not-a-uuid', {}, mockEnv);
    expect(res.status).toBe(400);
    expectAllSecurityHeaders(res);
  });

  it('are present on a 500 from app.onError', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request(
      '/api/public/trips/00000000-0000-0000-0000-000000000000',
      {},
      mockEnv,
    );
    spy.mockRestore();
    expect(res.status).toBe(500);
    expectAllSecurityHeaders(res);
  });

  it('are present on a CORS preflight response', async () => {
    const res = await app.request(
      '/api/trips',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://manudubo.github.io',
          'Access-Control-Request-Method': 'POST',
        },
      },
      mockEnv,
    );
    expect(res.status).toBe(204);
    expectAllSecurityHeaders(res);
  });

  it('Permissions-Policy denies every listed feature', () => {
    for (const directive of PERMISSIONS_POLICY.split(', ')) {
      expect(directive).toMatch(/^[a-z-]+=\(\)$/);
    }
  });
});
