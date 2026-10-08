import type { Db } from '../db';
import type { Env } from '../types';
import {
  consumeOtpAttempt,
  deleteStaleOtps,
  getLatestUnexpiredOtp,
  issueOtp,
  markOtpUsed,
  markOtpUsedIfUnused,
  type OtpPurpose,
} from '../db/queries/otp';
import { otpEmailTransport, sendOtpEmail } from './otp-email';
import { log } from '../observability/logger';

/**
 * Shared OTP primitives for every flow that mails a 6-digit code: the login
 * step-up (routes/auth.ts), sign-up e-mail verification (routes/auth.ts) and
 * account recovery (routes/recovery.ts). Hashing, constant-time comparison
 * and the atomic attempt/claim sequence live here once so the flows cannot
 * drift apart.
 */

export async function hashOtp(code: string, secret: string): Promise<string> {
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

/** A fresh 6-digit code from the CSPRNG (bias < 0.023% across Uint32 - negligible here). */
export function generateOtpCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
}

// XOR accumulator: constant-time regardless of mismatch position.
// CRITICAL: hashOtp is called ONLY on the submitted code.
// storedHash is the raw base64 value from the DB - do NOT call hashOtp on it.
export async function timingSafeCompare(
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

export type OtpCheck =
  /** The code matched and THIS request now owns it (used_at set); otpId lets a caller give it back. */
  | { status: 'ok'; otpId: number }
  /** No unexpired, unused code of this purpose for the user. */
  | { status: 'not_found' }
  /** Five guesses were spent; the code is burned. */
  | { status: 'max_attempts' }
  | { status: 'invalid' };

/**
 * Check a submitted code against the user's latest pending code of `purpose`.
 *
 * SEC-07: the attempt is reserved atomically *before* comparing, so
 * concurrent requests can never evaluate more than OTP_MAX_ATTEMPTS guesses;
 * and a matching code is claimed with `UPDATE ... WHERE used_at IS NULL`, so
 * of N parallel requests with the right code exactly one gets 'ok'.
 */
export async function checkOtp(
  db: Db,
  env: Pick<Env, 'OTP_SECRET'>,
  userId: number,
  purpose: OtpPurpose,
  code: string,
): Promise<OtpCheck> {
  const otp = await getLatestUnexpiredOtp(db, userId, purpose);
  if (!otp) return { status: 'not_found' };

  if ((await consumeOtpAttempt(db, otp.id)) === null) {
    await markOtpUsed(db, otp.id);
    return { status: 'max_attempts' };
  }

  if (!(await timingSafeCompare(code, otp.code_hash, env.OTP_SECRET))) return { status: 'invalid' };

  if (!(await markOtpUsedIfUnused(db, otp.id))) return { status: 'not_found' };
  return { status: 'ok', otpId: otp.id };
}

export type OtpIssue =
  | { status: 'sent' }
  /** A code is already pending / the hourly cap is reached; retryAfter in seconds. */
  | { status: 'otp_pending' | 'otp_rate_limited'; retryAfter: number };

/**
 * Issue a code for `userId` and mail it to `email`.
 *
 * SEC-08: throws OtpEmailConfigError *before* issuing when no mail transport
 * is usable. DATA-01: purges dead codes first (best effort). The pending
 * check, the BUG-16 hourly cap and the INSERT are one atomic statement
 * (otp_issue(), SEC-07), so parallel calls for one user issue at most one
 * code. A code whose mail could not be sent is retired at once, so the user
 * is not locked out for 10 minutes by an "otp_pending" they never received.
 *
 * The CALLER decides whether `email` may receive mail: a verified address
 * for login codes, the token's address for sign-up verification, the stored
 * address of the account for recovery.
 */
export async function issueAndSendOtp(
  db: Db,
  env: Env,
  args: { userId: number; email: string; purpose: OtpPurpose; requestId?: string },
): Promise<OtpIssue> {
  otpEmailTransport(env);

  await deleteStaleOtps(db).catch((err: unknown) => {
    log.error('otp.cleanup_failed', { request_id: args.requestId, error: err });
  });

  const code = generateOtpCode();
  const codeHash = await hashOtp(code, env.OTP_SECRET);
  const issued = await issueOtp(db, args.userId, codeHash, args.purpose);
  if (issued.status !== 'issued') return issued;

  try {
    await sendOtpEmail(env, args.email, code, args.purpose);
  } catch (err) {
    await markOtpUsed(db, issued.otpId).catch(() => {});
    throw err;
  }
  return { status: 'sent' };
}
