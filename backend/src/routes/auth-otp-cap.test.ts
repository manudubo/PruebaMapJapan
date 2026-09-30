import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context, Next } from 'hono';

// Route-level tests for the OTP hourly cap (BUG-16). Auth, user provisioning
// and the OTP queries are mocked: the unit suite has no Keycloak or real DB.
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
    getLatestUnexpiredOtp: vi.fn(),
    getOtpCreatedAtsSince: vi.fn(),
    insertOtp: vi.fn(),
    deleteStaleOtps: vi.fn(),
  };
});

import app from '../index';
import type { Env } from '../types';
import {
  deleteStaleOtps,
  getLatestUnexpiredOtp,
  getOtpCreatedAtsSince,
  insertOtp,
  otpHourlyCapRetryAfter,
  OTP_MAX_PER_HOUR,
} from '../db/queries/otp';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbccccddd0',
};

const HOUR = 60 * 60 * 1000;

describe('otpHourlyCapRetryAfter (BUG-16)', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('allows issuance below the cap', () => {
    const issued = Array.from({ length: OTP_MAX_PER_HOUR - 1 }, (_, i) => minsAgo(50 - i));
    expect(otpHourlyCapRetryAfter(issued, now)).toBeNull();
  });

  it('blocks at the cap and waits until the oldest code leaves the window', () => {
    // Oldest issued 50 min ago → 10 min (600 s) until it ages out.
    const issued = [minsAgo(50), ...Array.from({ length: OTP_MAX_PER_HOUR - 1 }, (_, i) => minsAgo(40 - i))];
    expect(otpHourlyCapRetryAfter(issued, now)).toBe(600);
  });

  it('ignores codes older than one hour', () => {
    const issued = [minsAgo(61), minsAgo(90), ...Array.from({ length: OTP_MAX_PER_HOUR - 1 }, () => minsAgo(5))];
    expect(otpHourlyCapRetryAfter(issued, now)).toBeNull();
  });

  it('never returns less than 1 second while blocked', () => {
    const issued = [new Date(now.getTime() - HOUR + 1), ...Array.from({ length: OTP_MAX_PER_HOUR - 1 }, () => minsAgo(1))];
    expect(otpHourlyCapRetryAfter(issued, now)).toBe(1);
  });
});

describe('POST /api/auth/otp-request — hourly cap (BUG-16)', () => {
  beforeEach(() => {
    vi.mocked(getLatestUnexpiredOtp).mockResolvedValue(undefined);
    vi.mocked(insertOtp).mockResolvedValue({} as never);
    vi.mocked(deleteStaleOtps).mockResolvedValue(0);
    // Mailpit send in the no-RESEND_API_KEY branch.
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(insertOtp).mockReset();
  });

  it('returns 429 otp_rate_limited with retryAfter once the hourly cap is reached', async () => {
    const recent = Array.from({ length: OTP_MAX_PER_HOUR }, (_, i) => new Date(Date.now() - (30 - i) * 60_000));
    vi.mocked(getOtpCreatedAtsSince).mockResolvedValue(recent);

    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, error: 'otp_rate_limited' });
    expect(typeof body['retryAfter']).toBe('number');
    expect(body['retryAfter'] as number).toBeGreaterThan(0);
    expect(insertOtp).not.toHaveBeenCalled();
  });

  it('still issues a code below the cap', async () => {
    vi.mocked(getOtpCreatedAtsSince).mockResolvedValue([new Date(Date.now() - 10 * 60_000)]);

    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);
    expect(res.status).toBe(201);
    expect(insertOtp).toHaveBeenCalledTimes(1);
  });

  it('a failing stale-code cleanup is logged but does not block issuing (DATA-01)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getOtpCreatedAtsSince).mockResolvedValue([]);
    vi.mocked(deleteStaleOtps).mockRejectedValue(new Error('cleanup exploded'));

    const res = await app.request('/api/auth/otp-request', { method: 'POST' }, mockEnv);

    expect(res.status).toBe(201);
    expect(insertOtp).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('otp-request: stale OTP cleanup failed:', expect.any(Error));
  });
});
