import { eq, and, gt, lt, isNull, sql } from 'drizzle-orm';
import { asPgDatabase, type Db } from '../index';
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

// ---------------------------------------------------------------------------
// Issuance: otp_pending + per-user hourly cap (BUG-16) + INSERT, atomically
//
// The cap stops the request → burn 5 attempts → request again cycle: it
// bounds guesses to OTP_MAX_PER_HOUR * 5 per user per hour.
//
// SEC-07 follow-up: the pending check, the cap and the INSERT used to be
// three statements, so N parallel requests all passed both checks and N
// codes were issued and emailed. They now run inside one call to the SQL
// function otp_issue() (migration 0009), which takes a per-user advisory
// lock first. One statement = one implicit transaction, so this also holds
// on the Neon HTTP driver (no interactive transactions there).
// ---------------------------------------------------------------------------

export const OTP_MAX_PER_HOUR = 5;
export const OTP_CAP_WINDOW_MS = 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
/** First key of the per-user pg_advisory_xact_lock(namespace, user_id) in otp_issue(). */
export const OTP_ISSUE_LOCK_NAMESPACE = 7001;

export type OtpIssueResult =
  | { status: 'issued'; otpId: number }
  /** retryAfter: seconds until the pending code expires / the cap window frees a slot (≥ 1). */
  | { status: 'otp_pending' | 'otp_rate_limited'; retryAfter: number };

/**
 * Issue a code for `userId` unless one is pending or the hourly cap is
 * reached — atomically, so concurrent calls for one user issue at most one
 * code and never exceed the cap. Timestamps come from the DB clock.
 */
export async function issueOtp(db: Db, userId: number, codeHash: string): Promise<OtpIssueResult> {
  const { rows } = await db.execute<{ status: string; otp_id: number | null; retry_after: number | null }>(
    sql`SELECT status, otp_id, retry_after FROM otp_issue(
          ${userId}::integer, ${codeHash}::text, ${OTP_TTL_MS / 1000}::integer,
          ${OTP_MAX_PER_HOUR}::integer, ${OTP_CAP_WINDOW_MS / 1000}::integer)`,
  );
  const row = rows[0];
  if (row?.status === 'issued' && row.otp_id !== null) return { status: 'issued', otpId: row.otp_id };
  if ((row?.status === 'otp_pending' || row?.status === 'otp_rate_limited') && row.retry_after !== null) {
    return { status: row.status, retryAfter: row.retry_after };
  }
  throw new Error(`issueOtp: unexpected result ${JSON.stringify(row)}`);
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
  const rows: { attempts: number }[] = await asPgDatabase(db)
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

/**
 * Mark the code used only if nothing else did first. Returns false when a
 * concurrent request already consumed it, so one code verifies exactly once.
 */
export async function markOtpUsedIfUnused(db: Db, otpId: number): Promise<boolean> {
  const rows: { id: number }[] = await asPgDatabase(db)
    .update(emailOtpCodes)
    .set({ used_at: new Date() })
    .where(and(eq(emailOtpCodes.id, otpId), isNull(emailOtpCodes.used_at)))
    .returning({ id: emailOtpCodes.id });
  return rows.length > 0;
}
