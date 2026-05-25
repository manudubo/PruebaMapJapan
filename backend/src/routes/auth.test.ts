import { describe, it, expect } from 'vitest';
import app from '../index';
import type { Env } from '../types';

// Mock env includes OTP_SECRET added in plan 08-01.
// RESEND_API_KEY intentionally absent — Mailpit branch used locally.
const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbccccddd0',
};

describe('POST /api/auth/otp-request — auth gate', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body['success']).toBe(false);
  });

  it('returns 401 with a malformed Bearer token', async () => {
    const res = await app.request(
      '/api/auth/otp-request',
      { method: 'POST', headers: { Authorization: 'Bearer not-a-real-jwt' } },
      mockEnv,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body['success']).toBe(false);
  });
});

describe('POST /api/auth/otp-verify — auth gate', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await app.request(
      '/api/auth/otp-verify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      },
      mockEnv,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body['success']).toBe(false);
  });

  it('returns 401 with a malformed Bearer token', async () => {
    const res = await app.request(
      '/api/auth/otp-verify',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer not-a-real-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: '123456' }),
      },
      mockEnv,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body['success']).toBe(false);
  });
});
