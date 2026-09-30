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

// ---------------------------------------------------------------------------
// Opportunistic cleanup (DATA-01)
//
// Nothing ever purged used/expired codes, so the table grew monotonically.
// Each otp-request now deletes codes that can no longer matter: already
// expired AND issued before the hourly-cap window. Codes inside the window
// must survive — even used/burned ones — or deleting them would reset the
// BUG-16 cap and reopen the request/burn/re-request cycle.
// ---------------------------------------------------------------------------

/** Delete every user's codes that are expired and older than the cap window. Returns rows deleted. */
export async function deleteStaleOtps(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - OTP_CAP_WINDOW_MS);
  const deleted = await db
    .delete(emailOtpCodes)
    .where(and(lt(emailOtpCodes.expires_at, cutoff), lt(emailOtpCodes.created_at, cutoff)))
    .returning();
  return deleted.length;
}
