import { eq, and, gt, isNull, sql } from 'drizzle-orm';
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

export async function incrementOtpAttempts(db: Db, otpId: number): Promise<void> {
  await db
    .update(emailOtpCodes)
    .set({ attempts: sql`${emailOtpCodes.attempts} + 1` })
    .where(eq(emailOtpCodes.id, otpId));
}

export async function markOtpUsed(db: Db, otpId: number): Promise<void> {
  await db
    .update(emailOtpCodes)
    .set({ used_at: new Date() })
    .where(eq(emailOtpCodes.id, otpId));
}
