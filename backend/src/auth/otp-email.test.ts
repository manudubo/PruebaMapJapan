import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context, Next } from 'hono';

// SEC-08: OTP email transport gated on ENVIRONMENT; production without
// RESEND_API_KEY fails loudly instead of posting codes to localhost:8025.

const resendSend = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

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
    issueOtp: vi.fn(async () => ({ status: 'issued', otpId: 77 })),
    markOtpUsed: vi.fn(async () => {}),
    deleteStaleOtps: vi.fn(async () => 0),
  };
});

// No real DB here: the schema guard (review M1) would query the mock URL.
vi.mock('../db/schema-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/schema-guard')>()),
  checkSchemaReady: async () => ({ ok: true }),
}));

import app from '../index';
import type { Env } from '../types';
import { otpEmailTransport, sendOtpEmail, OtpEmailConfigError, MAILPIT_SEND_URL } from './otp-email';
import { issueOtp, markOtpUsed } from '../db/queries/otp';

const base: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'x'.repeat(64),
};

let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resendSend.mockReset().mockResolvedValue({ data: { id: 'em_1' }, error: null, headers: null });
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(issueOtp).mockClear();
  vi.mocked(markOtpUsed).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('otpEmailTransport', () => {
  it.each([
    [{ RESEND_API_KEY: 're_x', ENVIRONMENT: 'production' }, 'resend'],
    [{ RESEND_API_KEY: 're_x', ENVIRONMENT: 'development' }, 'resend'],
    [{ RESEND_API_KEY: 're_x' }, 'resend'],
    [{ ENVIRONMENT: 'development' }, 'mailpit'],
    [{ ENVIRONMENT: ' Development ' }, 'mailpit'],
  ])('%j → %s', (env, expected) => {
    expect(otpEmailTransport(env)).toBe(expected);
  });

  it.each([
    ['production, no key', { ENVIRONMENT: 'production' }],
    ['ENVIRONMENT missing, no key', {}],
    ['misspelled "dev", no key', { ENVIRONMENT: 'dev' }],
    ['staging, no key', { ENVIRONMENT: 'staging' }],
    ['production, empty key', { ENVIRONMENT: 'production', RESEND_API_KEY: '' }],
    ['production, whitespace key', { ENVIRONMENT: 'production', RESEND_API_KEY: '   ' }],
  ])('%s → throws OtpEmailConfigError', (_l, env) => {
    expect(() => otpEmailTransport(env)).toThrow(OtpEmailConfigError);
    expect(() => otpEmailTransport(env)).toThrow(/RESEND_API_KEY/);
  });
});

describe('sendOtpEmail', () => {
  it('production without key never contacts Mailpit', async () => {
    await expect(sendOtpEmail({ ...base, ENVIRONMENT: 'production' }, 'a@b.c', '123456')).rejects.toThrow(OtpEmailConfigError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('development without key posts to Mailpit with the code', async () => {
    await sendOtpEmail({ ...base, ENVIRONMENT: 'development' }, 'a@b.c', '123456');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(MAILPIT_SEND_URL);
    const body = JSON.parse(String(init.body));
    expect(body.To).toEqual([{ Name: '', Email: 'a@b.c' }]);
    expect(body.Text).toContain('123456');
  });

  it('development: a Mailpit HTTP error is surfaced, not swallowed', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(sendOtpEmail({ ...base, ENVIRONMENT: 'development' }, 'a@b.c', '123456')).rejects.toThrow(/Mailpit.*500/);
  });

  it('with a key, uses Resend and never Mailpit', async () => {
    await sendOtpEmail({ ...base, ENVIRONMENT: 'production', RESEND_API_KEY: 're_x' }, 'a@b.c', '654321');
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0]?.[0]).toMatchObject({ to: ['a@b.c'] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a Resend API error (returned, not thrown) becomes a thrown error', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'invalid_api_key', message: 'bad key', statusCode: 401 }, headers: null });
    await expect(
      sendOtpEmail({ ...base, ENVIRONMENT: 'production', RESEND_API_KEY: 're_bad' }, 'a@b.c', '1'),
    ).rejects.toThrow(/Resend rejected.*invalid_api_key/);
  });
});

describe('POST /api/auth/otp-request — email gating (SEC-08)', () => {
  const post = (env: Env) => app.request('/api/auth/otp-request', { method: 'POST' }, env);

  it.each([
    ['ENVIRONMENT=production', { ENVIRONMENT: 'production' }],
    ['ENVIRONMENT unset', {}],
    ['ENVIRONMENT misspelled', { ENVIRONMENT: 'developmnet' }],
  ])('%s without RESEND_API_KEY → 500, no code issued, loud log, no Mailpit call', async (_l, extra) => {
    const res = await post({ ...base, ...extra });
    expect(res.status).toBe(500);
    const text = await res.text();
    // Generic body from the global error handler (M-09).
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expect(text).not.toMatch(/RESEND|Mailpit|localhost/); // config detail stays server-side
    expect(issueOtp).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/RESEND_API_KEY/);
  });

  it('development without key → 201 via Mailpit', async () => {
    const res = await post({ ...base, ENVIRONMENT: 'development' });
    expect(res.status).toBe(201);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(MAILPIT_SEND_URL);
  });

  it('production with key → 201 via Resend', async () => {
    const res = await post({ ...base, ENVIRONMENT: 'production', RESEND_API_KEY: 're_x' });
    expect(res.status).toBe(201);
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('delivery failure burns the inserted code so the user can retry immediately', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 }, headers: null });
    const res = await post({ ...base, ENVIRONMENT: 'production', RESEND_API_KEY: 're_x' });
    expect(res.status).toBe(500);
    expect(issueOtp).toHaveBeenCalledTimes(1);
    expect(markOtpUsed).toHaveBeenCalledWith(expect.anything(), 77);
  });

  it('Mailpit network error in development → 500 and the code is burned', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    const res = await post({ ...base, ENVIRONMENT: 'development' });
    expect(res.status).toBe(500);
    expect(markOtpUsed).toHaveBeenCalledWith(expect.anything(), 77);
  });

  it('a failure while burning the code still returns the original 500', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    vi.mocked(markOtpUsed).mockRejectedValueOnce(new Error('db down'));
    const res = await post({ ...base, ENVIRONMENT: 'development' });
    expect(res.status).toBe(500);
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/fetch failed/);
  });
});
