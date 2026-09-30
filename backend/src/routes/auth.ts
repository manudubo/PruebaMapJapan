import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ensureUserProvisioned } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { OtpVerifySchema } from '../validation/schemas';
import { otpEmailTransport, sendOtpEmail } from '../auth/otp-email';
import {
  getLatestUnexpiredOtp,
  getOtpCreatedAtsSince,
  otpHourlyCapRetryAfter,
  OTP_CAP_WINDOW_MS,
  insertOtp,
  consumeOtpAttempt,
  markOtpUsed,
  markOtpUsedIfUnused,
} from '../db/queries/otp';

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

async function hashOtp(code: string, secret: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const codeBytes = new TextEncoder().encode(code);
  const sig = await crypto.subtle.sign('HMAC', key, codeBytes);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// XOR accumulator: constant-time regardless of mismatch position.
// CRITICAL: hashOtp is called ONLY on the submitted code.
// storedHash is the raw base64 value from the DB — do NOT call hashOtp on it.
async function timingSafeCompare(
  submittedCode: string,
  storedHash: string,
  secret: string,
): Promise<boolean> {
  const submittedHash = await hashOtp(submittedCode, secret);
  const a = new TextEncoder().encode(submittedHash);
  const b = new TextEncoder().encode(storedHash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const authRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

authRoute.use('*', authMiddleware, ensureUserProvisioned);

// POST /api/auth/otp-request
// No request body — email is taken from c.var.user.email
authRoute.post('/otp-request', async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }

  const email = c.get('user').email;
  if (!email) {
    const response: ApiResponse<never> = { success: false, error: 'no_email' };
    return c.json(response, 422);
  }

  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');

  try {
    // SEC-08: fail loudly (before issuing a code) if email cannot be sent.
    otpEmailTransport(c.env);

    const existing = await getLatestUnexpiredOtp(db, userId);
    if (existing) {
      const retryAfter = Math.ceil(
        (existing.expires_at.getTime() - Date.now()) / 1000,
      );
      return c.json(
        { success: false as const, error: 'otp_pending', retryAfter },
        429,
      );
    }

    // BUG-16: per-user hourly cap — stops the request/burn/re-request cycle.
    const now = new Date();
    const capRetryAfter = otpHourlyCapRetryAfter(
      await getOtpCreatedAtsSince(db, userId, new Date(now.getTime() - OTP_CAP_WINDOW_MS)),
      now,
    );
    if (capRetryAfter !== null) {
      return c.json(
        { success: false as const, error: 'otp_rate_limited', retryAfter: capRetryAfter },
        429,
      );
    }

    // bias < 0.023% across Uint32 range — negligible for 6-digit OTP
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    const codeHash = await hashOtp(code, c.env.OTP_SECRET);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const otp = await insertOtp(db, userId, codeHash, expiresAt);
    try {
      await sendOtpEmail(c.env, email, code);
    } catch (err) {
      // Undelivered code must not block a retry as otp_pending for 10 min.
      await markOtpUsed(db, otp.id).catch(() => {});
      throw err;
    }

    const response: ApiResponse<never> = { success: true };
    return c.json(response, 201);
  } catch (err) {
    console.error('[otp-request] failed:', err);
    const response: ApiResponse<never> = { success: false, error: 'Failed to send OTP' };
    return c.json(response, 500);
  }
});

// POST /api/auth/otp-verify
// Body: { code: string } — validated by OtpVerifySchema
authRoute.post('/otp-verify', zValidator('json', OtpVerifySchema), async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }

  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const { code } = c.req.valid('json');

  try {
    const otp = await getLatestUnexpiredOtp(db, userId);
    if (!otp) {
      const response: ApiResponse<never> = { success: false, error: 'otp_not_found' };
      return c.json(response, 400);
    }

    // SEC-07: reserve the attempt atomically *before* comparing, so
    // concurrent requests can never evaluate more than OTP_MAX_ATTEMPTS guesses.
    if ((await consumeOtpAttempt(db, otp.id)) === null) {
      await markOtpUsed(db, otp.id);
      const response: ApiResponse<never> = { success: false, error: 'max_attempts' };
      return c.json(response, 429);
    }

    // CRITICAL: call hashOtp on the submitted code only.
    // otp.code_hash is the stored base64 HMAC — do NOT re-hash it.
    const match = await timingSafeCompare(code, otp.code_hash, c.env.OTP_SECRET);

    if (!match) {
      const response: ApiResponse<never> = { success: false, error: 'invalid_code' };
      return c.json(response, 400);
    }

    // Single use: a concurrent request with the same code may have won.
    if (!(await markOtpUsedIfUnused(db, otp.id))) {
      const response: ApiResponse<never> = { success: false, error: 'otp_not_found' };
      return c.json(response, 400);
    }
    const response: ApiResponse<never> = { success: true };
    return c.json(response, 200);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to verify OTP' };
    return c.json(response, 500);
  }
});

export default authRoute;
