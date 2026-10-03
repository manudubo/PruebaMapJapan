import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { dbMiddleware } from '../middleware/db';
import { ensureUserProvisioned } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { OtpVerifySchema } from '../validation/schemas';
import { otpEmailTransport, sendOtpEmail } from '../auth/otp-email';
import {
  getLatestUnexpiredOtp,
  issueOtp,
  deleteStaleOtps,
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

authRoute.use('*', authMiddleware, dbMiddleware, ensureUserProvisioned);

// Unexpected failures propagate to the global errorHandler (M-09), which logs
// them and answers a generic 500.

// POST /api/auth/otp-request
// No request body — email is taken from c.var.user.email
authRoute.post('/otp-request', async (c) => {
  const email = c.get('user').email;
  if (!email) {
    const response: ApiResponse<never> = { success: false, error: 'no_email' };
    return c.json(response, 422);
  }

  const db = c.get('db');
  const userId = c.get('dbUserId');

  // SEC-08: fail loudly (before issuing a code) if email cannot be sent.
  otpEmailTransport(c.env);

  // DATA-01: opportunistic purge of dead codes. Best-effort housekeeping —
  // a failure here must not block sign-in, so log and carry on.
  await deleteStaleOtps(db).catch((err: unknown) => {
    console.error('otp-request: stale OTP cleanup failed:', err);
  });

  // bias < 0.023% across Uint32 range — negligible for 6-digit OTP
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const codeHash = await hashOtp(code, c.env.OTP_SECRET);

  // otp_pending check, BUG-16 hourly cap and INSERT in one atomic statement
  // (SEC-07): parallel requests for one user issue at most one code.
  const issued = await issueOtp(db, userId, codeHash);
  if (issued.status !== 'issued') {
    return c.json(
      { success: false as const, error: issued.status, retryAfter: issued.retryAfter },
      429,
    );
  }

  try {
    await sendOtpEmail(c.env, email, code);
  } catch (err) {
    // Undelivered code must not block a retry as otp_pending for 10 min.
    await markOtpUsed(db, issued.otpId).catch(() => {});
    throw err;
  }

  const response: ApiResponse<never> = { success: true };
  return c.json(response, 201);
});

// POST /api/auth/otp-verify
// Body: { code: string } — validated by OtpVerifySchema
authRoute.post('/otp-verify', zValidator('json', OtpVerifySchema), async (c) => {
  const db = c.get('db');
  const userId = c.get('dbUserId');
  const { code } = c.req.valid('json');

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
});

export default authRoute;
