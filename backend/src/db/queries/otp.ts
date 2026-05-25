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
