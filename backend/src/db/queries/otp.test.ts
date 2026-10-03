import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { deleteStaleOtps, getLatestUnexpiredOtp, issueOtp, OTP_CAP_WINDOW_MS } from './otp';
import { closeTestPool, insertUser, resetDb, testDb, testPool } from '../../test-utils/db';

beforeEach(resetDb);
afterAll(closeTestPool);

const MIN = 60_000;
const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);

async function otp(userId: number, o: { createdAgo: number; ttl?: number; used?: boolean }) {
  const created = ago(o.createdAgo);
  const expires = new Date(created.getTime() + (o.ttl ?? 10 * MIN));
  const { rows } = await testPool().query(
    `INSERT INTO email_otp_codes (user_id, code_hash, expires_at, used_at, created_at)
     VALUES ($1, 'h', $2, $3, $4) RETURNING id`,
    [userId, expires, o.used ? created : null, created],
  );
  return rows[0].id as number;
}

async function ids(): Promise<number[]> {
  const { rows } = await testPool().query('SELECT id FROM email_otp_codes ORDER BY id');
  return rows.map((r) => r.id);
}

describe('email_otp_codes index (DATA-01)', () => {
  it('exists on (user_id, expires_at) after migrations', async () => {
    const { rows } = await testPool().query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'email_otp_codes' AND indexname = 'email_otp_codes_user_id_expires_at_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(user_id, expires_at\)/);
  });

  it('is usable by the pending-code lookup', async () => {
    const client = await testPool().connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query(
        `EXPLAIN SELECT * FROM email_otp_codes WHERE user_id = 1 AND expires_at > now() AND used_at IS NULL`,
      );
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('email_otp_codes_user_id_expires_at_idx');
    } finally {
      await client.query('RESET enable_seqscan');
      client.release();
    }
  });
});

describe('deleteStaleOtps (DATA-01)', () => {
  it('deletes only codes that are expired AND issued before the cap window', async () => {
    const u = await insertUser();
    const oldUsed = await otp(u.id, { createdAgo: 3 * 60 * MIN, used: true });
    const oldUnused = await otp(u.id, { createdAgo: 2 * 60 * MIN });
    const justOutside = await otp(u.id, { createdAgo: OTP_CAP_WINDOW_MS + 11 * MIN });
    const recentUsed = await otp(u.id, { createdAgo: 30 * MIN, used: true });
    const recentExpired = await otp(u.id, { createdAgo: 50 * MIN });
    const live = await otp(u.id, { createdAgo: 1 * MIN });

    const n = await deleteStaleOtps(testDb(), now);

    expect(n).toBe(3);
    const remaining = await ids();
    expect(remaining).toEqual([recentUsed, recentExpired, live]);
    for (const gone of [oldUsed, oldUnused, justOutside]) expect(remaining).not.toContain(gone);
  });

  it('keeps an old code that is somehow still unexpired (long TTL) — never deletes a usable code', async () => {
    const u = await insertUser();
    const longLived = await otp(u.id, { createdAgo: 2 * 60 * MIN, ttl: 3 * 60 * MIN });
    expect(await deleteStaleOtps(testDb(), now)).toBe(0);
    expect(await ids()).toEqual([longLived]);
  });

  it("cleans every user's stale codes, not just the caller's", async () => {
    const a = await insertUser();
    const b = await insertUser();
    await otp(a.id, { createdAgo: 5 * 60 * MIN });
    await otp(b.id, { createdAgo: 5 * 60 * MIN });
    expect(await deleteStaleOtps(testDb(), now)).toBe(2);
    expect(await ids()).toEqual([]);
  });

  it('empty table → 0, no error; running twice is idempotent', async () => {
    expect(await deleteStaleOtps(testDb(), now)).toBe(0);
    const u = await insertUser();
    await otp(u.id, { createdAgo: 5 * 60 * MIN });
    expect(await deleteStaleOtps(testDb(), now)).toBe(1);
    expect(await deleteStaleOtps(testDb(), now)).toBe(0);
  });

  it('never weakens the BUG-16 hourly cap: burned codes inside the window still count', async () => {
    const u = await insertUser();
    for (let i = 0; i < 5; i++) await otp(u.id, { createdAgo: (10 + i * 5) * MIN, used: true });

    await deleteStaleOtps(testDb(), now);

    expect(await ids()).toHaveLength(5);
    expect((await issueOtp(testDb(), u.id, 'h')).status).toBe('otp_rate_limited');
  });

  it('concurrent cleanups do not error or double count', async () => {
    const u = await insertUser();
    for (let i = 0; i < 10; i++) await otp(u.id, { createdAgo: 5 * 60 * MIN });
    const counts = await Promise.all(Array.from({ length: 4 }, () => deleteStaleOtps(testDb(), now)));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(await ids()).toEqual([]);
  });
});

describe('getLatestUnexpiredOtp', () => {
  it('returns the newest unused unexpired code of that user only', async () => {
    const a = await insertUser();
    const b = await insertUser();
    await otp(a.id, { createdAgo: 3 * MIN });
    const newest = await otp(a.id, { createdAgo: 2 * MIN });
    await otp(b.id, { createdAgo: 1 * MIN });
    await otp(a.id, { createdAgo: 0, used: true });

    const got = await getLatestUnexpiredOtp(testDb(), a.id);
    expect(got?.id).toBe(newest);
    expect(got?.user_id).toBe(a.id);
  });

  it('ignores expired and used codes', async () => {
    const a = await insertUser();
    await otp(a.id, { createdAgo: 20 * MIN });
    await otp(a.id, { createdAgo: 1 * MIN, used: true });
    expect(await getLatestUnexpiredOtp(testDb(), a.id)).toBeUndefined();
  });
});
