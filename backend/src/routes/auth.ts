import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Resend } from 'resend';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { ensureUserProvisioned } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { OtpVerifySchema } from '../validation/schemas';
import {
  getLatestUnexpiredOtp,
  insertOtp,
  incrementOtpAttempts,
  markOtpUsed,
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
// Email delivery
// ---------------------------------------------------------------------------

async function sendOtpEmail(
  env: Env,
  toEmail: string,
  code: string,
): Promise<void> {
  const subject = 'Your TravelMap verification code';
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;

  if (env.RESEND_API_KEY) {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'TravelMap <noreply@travelmap.app>',
      to: [toEmail],
      subject,
      text,
    });
  } else {
    // Local dev — Mailpit HTTP API (Workers cannot do raw SMTP)
    await fetch('http://localhost:8025/api/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Name: 'TravelMap', Email: 'noreply@example.com' },
        To: [{ Name: '', Email: toEmail }],
        Subject: subject,
        Text: text,
      }),
    });
  }
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

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const codeHash = await hashOtp(code, c.env.OTP_SECRET);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await insertOtp(db, userId, codeHash, expiresAt);
    await sendOtpEmail(c.env, email, code);

    const response: ApiResponse<never> = { success: true };
    return c.json(response, 201);
  } catch {
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

    if (otp.attempts >= 5) {
      await markOtpUsed(db, otp.id);
      const response: ApiResponse<never> = { success: false, error: 'max_attempts' };
      return c.json(response, 429);
    }

    // CRITICAL: call hashOtp on the submitted code only.
    // otp.code_hash is the stored base64 HMAC — do NOT re-hash it.
    const match = await timingSafeCompare(code, otp.code_hash, c.env.OTP_SECRET);

    if (!match) {
      await incrementOtpAttempts(db, otp.id);
      const response: ApiResponse<never> = { success: false, error: 'invalid_code' };
      return c.json(response, 400);
    }

    await markOtpUsed(db, otp.id);
    const response: ApiResponse<never> = { success: true };
    return c.json(response, 200);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to verify OTP' };
    return c.json(response, 500);
  }
});

export default authRoute;
