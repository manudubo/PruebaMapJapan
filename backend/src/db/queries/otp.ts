import { eq, and, gt, lt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { emailOtpCodes } from '../schema';

export type OtpRow = typeof emailOtpCodes.$inferSelect;

export async function getLatestUnexpiredOtp(
  db: Db,
  userId: number,
): Promise<OtpRow | undefined> {
  const now = new Date();
  const results = await db
    .select()
    .from(emailOtpCodes)
    .where(
      and(
        eq(emailOtpCodes.user_id, userId),
        gt(emailOtpCodes.expires_at, now),
        isNull(emailOtpCodes.used_at),
      ),
    )
    .orderBy(sql`${emailOtpCodes.created_at} DESC`)
    .limit(1);

  return results[0];
}

export async function insertOtp(
  db: Db,
  userId: number,
  codeHash: string,
  expiresAt: Date,
): Promise<OtpRow> {
  const [created] = await db
    .insert(emailOtpCodes)
    .values({ user_id: userId, code_hash: codeHash, expires_at: expiresAt })
    .returning();

  if (!created) throw new Error('insertOtp: insert returned no rows');
  return created;
}

// ---------------------------------------------------------------------------
// Per-user hourly issuance cap (BUG-16)
//
// Without it, a caller can cycle: request code → burn 5 attempts → request a
// fresh code immediately (burned codes no longer count as pending) → repeat,
// throttled only by email send rate. Capping issuance bounds guesses to
// OTP_MAX_PER_HOUR * 5 per user per hour.
// ---------------------------------------------------------------------------

export const OTP_MAX_PER_HOUR = 5;
export const OTP_CAP_WINDOW_MS = 60 * 60 * 1000;

/** created_at of every code issued to `userId` since `since` (used or not). */
export async function getOtpCreatedAtsSince(
  db: Db,
  userId: number,
  since: Date,
): Promise<Date[]> {
  const rows: { created_at: Date }[] = await db
    .select({ created_at: emailOtpCodes.created_at })
    .from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.user_id, userId), gt(emailOtpCodes.created_at, since)));
  return rows.map((r) => r.created_at);
}

/**
 * Seconds until another code may be issued, or null if under the cap.
 * Once the cap is hit, the wait lasts until the oldest code in the window
 * ages out of it.
 */
export function otpHourlyCapRetryAfter(issuedAt: Date[], now: Date): number | null {
  const windowStart = now.getTime() - OTP_CAP_WINDOW_MS;
  const inWindow = issuedAt
    .map((d) => d.getTime())
    .filter((t) => t > windowStart)
    .sort((a, b) => a - b);
  if (inWindow.length < OTP_MAX_PER_HOUR) return null;
  const oldest = inWindow[0]!;
  return Math.max(1, Math.ceil((oldest + OTP_CAP_WINDOW_MS - now.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// Verification attempts (SEC-07)
//
// The old flow read `attempts`, checked `< 5` in JS, compared, then
// incremented — N parallel requests all read the same count and all got to
// guess. The check and the increment are now one statement; the route only
// compares the code if this returns a slot.
// ---------------------------------------------------------------------------

export const OTP_MAX_ATTEMPTS = 5;

/**
 * Atomically reserve one verification attempt:
 * `UPDATE ... SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5
 *  AND used_at IS NULL RETURNING attempts`.
 * Returns the new count (1..OTP_MAX_ATTEMPTS), or null when the code is
 * exhausted, already used, or gone — in which case no guess is allowed.
 */
export async function consumeOtpAttempt(db: Db, otpId: number): Promise<number | null> {
  const rows: { attempts: number }[] = await db
    .update(emailOtpCodes)
    .set({ attempts: sql`${emailOtpCodes.attempts} + 1` })
    .where(
      and(
        eq(emailOtpCodes.id, otpId),
        lt(emailOtpCodes.attempts, OTP_MAX_ATTEMPTS),
        isNull(emailOtpCodes.used_at),
      ),
    )
    .returning({ attempts: emailOtpCodes.attempts });
  return rows[0]?.attempts ?? null;
}

export async function markOtpUsed(db: Db, otpId: number): Promise<void> {
  await db
    .update(emailOtpCodes)
    .set({ used_at: new Date() })
    .where(eq(emailOtpCodes.id, otpId));
}

/**
 * Mark the code used only if nothing else did first. Returns false when a
 * concurrent request already consumed it, so one code verifies exactly once.
 */
export async function markOtpUsedIfUnused(db: Db, otpId: number): Promise<boolean> {
  const rows: { id: number }[] = await db
    .update(emailOtpCodes)
    .set({ used_at: new Date() })
    .where(and(eq(emailOtpCodes.id, otpId), isNull(emailOtpCodes.used_at)))
    .returning({ id: emailOtpCodes.id });
  return rows.length > 0;
}
