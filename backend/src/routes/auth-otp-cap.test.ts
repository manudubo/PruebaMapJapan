import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context, Next } from 'hono';

// Route-level tests for the OTP hourly cap (BUG-16). Auth, user provisioning
// and the OTP queries are mocked: the unit suite has no Keycloak or real DB.
// The DB is mocked: skip dbMiddleware's schema-readiness query.
vi.mock('../db/schema-check', () => ({ schemaStatus: async () => [] }));
vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: Context, next: Next) => {
    c.set('user', { sub: 'kc-1', email: 'user@example.com', name: 'U', preferred_username: 'u' });
    await next();
  },
}));
vi.mock('../middleware/user', () => ({
  ensureUserProvisioned: async (c: Context, next: Next) => {
    c.set('dbUserId', 1);
    await next();
  },
}));
vi.mock('../db/queries/otp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/otp')>();
  return {
    ...actual,
    issueOtp: vi.fn(),
    deleteStaleOtps: vi.fn(),
  };
});

import app from '../index';
import type { Env } from '../types';
import { deleteStaleOtps, issueOtp } from '../db/queries/otp';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbccccddd0',
  ENVIRONMENT: 'development', // Mailpit fallback is dev-only (SEC-08)
};

// The cap arithmetic itself (window, retryAfter, pending-before-cap, burned
// codes counting) now runs in SQL and is tested on real Postgres in
// db/queries/otp-issue.test.ts; this file covers the HTTP contract.

describe('POST /api/auth/otp-request — hourly cap (BUG-16)', () => {
  beforeEach(() => {
    vi.mocked(issueOtp).mockResolvedValue({ status: 'issued', otpId: 1 });
    vi.mocked(deleteStaleOtps).mockResolvedValue(0);
    // Mailpit send in the no-RESEND_API_KEY branch.
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(issueOtp).mockReset();
  });

  it('returns 429 otp_rate_limited with the retryAfter computed by the DB', async () => {
    vi.mocked(issueOtp).mockResolvedValue({ status: 'otp_rate_limited', retryAfter: 600 });

    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ success: false, error: 'otp_rate_limited', retryAfter: 600 });
    expect(fetch).not.toHaveBeenCalled(); // no email for a refused request
  });

  it('returns 429 otp_pending with retryAfter while a code is pending', async () => {
    vi.mocked(issueOtp).mockResolvedValue({ status: 'otp_pending', retryAfter: 321 });

    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ success: false, error: 'otp_pending', retryAfter: 321 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('issues (one atomic call with the HMAC of the emailed code) below the cap', async () => {
    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(201);
    expect(issueOtp).toHaveBeenCalledTimes(1);
    const [, userId, codeHash] = vi.mocked(issueOtp).mock.calls[0]!;
    expect(userId).toBe(1);
    expect(codeHash).toMatch(/^[A-Za-z0-9+/]{43}=$/); // base64 HMAC-SHA256, never the raw code
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a failing stale-code cleanup is logged but does not block issuing (DATA-01)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deleteStaleOtps).mockRejectedValue(new Error('cleanup exploded'));

    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);

    expect(res.status).toBe(201);
    expect(issueOtp).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('otp-request: stale OTP cleanup failed:', expect.any(Error));
  });
});
