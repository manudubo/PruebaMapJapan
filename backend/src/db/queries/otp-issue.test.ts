import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  deleteStaleOtps,
  issueOtp,
  markOtpUsed,
  OTP_CAP_WINDOW_MS,
  OTP_ISSUE_LOCK_NAMESPACE,
  OTP_MAX_PER_HOUR,
  OTP_TTL_MS,
} from './otp';
import { closeDbPools, createDb } from '../index';
import { closeTestPool, insertUser, resetDb, testDatabaseUrl, testPool } from '../../test-utils/db';

// Atomic OTP issuance (SEC-07 follow-up) on real Postgres. issueOtp is one
// statement: a per-user advisory lock, the otp_pending check, the BUG-16
// hourly cap and the INSERT all happen inside it, so concurrent requests
// for one user are serialized and each sees the others' codes.

beforeEach(resetDb);
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

const MIN = 60_000;

/** Fixture code `createdAgo` ms old (DB clock), optionally used. */
async function otp(userId: number, o: { createdAgo: number; ttl?: number; used?: boolean }) {
  const { rows } = await testPool().query(
    `INSERT INTO email_otp_codes (user_id, code_hash, created_at, expires_at, used_at)
     SELECT $1, 'fixture', t, t + make_interval(secs => $3::double precision / 1000), CASE WHEN $4 THEN t END
       FROM (SELECT now() - make_interval(secs => $2::double precision / 1000) AS t) s
     RETURNING id`,
    [userId, o.createdAgo, o.ttl ?? 10 * MIN, o.used ?? false],
  );
  return rows[0].id as number;
}

async function rows(userId?: number) {
  const { rows: r } = await testPool().query(
    `SELECT id, user_id, code_hash, used_at, extract(epoch from expires_at - created_at)::int AS ttl_s
       FROM email_otp_codes ${userId === undefined ? '' : 'WHERE user_id = $1'} ORDER BY id`,
    userId === undefined ? [] : [userId],
  );
  return r as { id: number; user_id: number; code_hash: string; used_at: Date | null; ttl_s: number }[];
}

/** An app-style handle (the cached node-postgres pool) — separate from the fixture pool. */
const appDb = () => createDb(testDatabaseUrl(), 'pg');

describe('issueOtp — sequential semantics', () => {
  it('issues a code with the hash given and a 10-minute TTL', async () => {
    const u = await insertUser();
    const r = await issueOtp(appDb(), u.id, 'hash-1');
    expect(r.status).toBe('issued');
    const stored = await rows(u.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ code_hash: 'hash-1', used_at: null, ttl_s: OTP_TTL_MS / 1000 });
    if (r.status === 'issued') expect(r.otpId).toBe(stored[0]!.id);
  });

  it('an unexpired unused code → otp_pending with the seconds left, nothing inserted', async () => {
    const u = await insertUser();
    await otp(u.id, { createdAgo: 4 * MIN }); // 6 min left
    const r = await issueOtp(appDb(), u.id, 'h');
    expect(r.status).toBe('otp_pending');
    if (r.status !== 'issued') {
      expect(r.retryAfter).toBeGreaterThan(355);
      expect(r.retryAfter).toBeLessThanOrEqual(360);
    }
    expect(await rows(u.id)).toHaveLength(1);
  });

  it.each([
    ['expired', { createdAgo: 11 * MIN }],
    ['used', { createdAgo: 1 * MIN, used: true }],
  ])('a %s code is not pending', async (_l, fixture) => {
    const u = await insertUser();
    await otp(u.id, fixture);
    expect((await issueOtp(appDb(), u.id, 'h')).status).toBe('issued');
  });

  it(`${OTP_MAX_PER_HOUR - 1} codes this hour → the next is issued`, async () => {
    const u = await insertUser();
    for (let i = 0; i < OTP_MAX_PER_HOUR - 1; i++) await otp(u.id, { createdAgo: (40 - i) * MIN, used: true });
    expect((await issueOtp(appDb(), u.id, 'h')).status).toBe('issued');
  });

  it(`${OTP_MAX_PER_HOUR} codes this hour → otp_rate_limited until the oldest leaves the window`, async () => {
    const u = await insertUser();
    await otp(u.id, { createdAgo: 50 * MIN, used: true }); // leaves the window in 10 min
    for (let i = 0; i < OTP_MAX_PER_HOUR - 1; i++) await otp(u.id, { createdAgo: (40 - i) * MIN, used: true });
    const r = await issueOtp(appDb(), u.id, 'h');
    expect(r.status).toBe('otp_rate_limited');
    if (r.status !== 'issued') {
      expect(r.retryAfter).toBeGreaterThan(595);
      expect(r.retryAfter).toBeLessThanOrEqual(600);
    }
    expect(await rows(u.id)).toHaveLength(OTP_MAX_PER_HOUR);
  });

  it('burned/used and expired codes still count toward the cap; codes older than an hour do not', async () => {
    const u = await insertUser();
    await otp(u.id, { createdAgo: 61 * MIN, used: true });
    await otp(u.id, { createdAgo: 90 * MIN });
    for (let i = 0; i < OTP_MAX_PER_HOUR - 1; i++) await otp(u.id, { createdAgo: (30 - i) * MIN });
    expect((await issueOtp(appDb(), u.id, 'h')).status).toBe('issued');
    await testPool().query('UPDATE email_otp_codes SET used_at = now() WHERE user_id = $1', [u.id]);
    expect((await issueOtp(appDb(), u.id, 'h')).status).toBe('otp_rate_limited');
  });

  it('retryAfter is at least 1 second right at the window edge', async () => {
    const u = await insertUser();
    await otp(u.id, { createdAgo: OTP_CAP_WINDOW_MS - 200, used: true });
    for (let i = 0; i < OTP_MAX_PER_HOUR - 1; i++) await otp(u.id, { createdAgo: MIN, used: true });
    const r = await issueOtp(appDb(), u.id, 'h');
    expect(r.status).toBe('otp_rate_limited');
    if (r.status !== 'issued') expect(r.retryAfter).toBe(1);
  });

  it('pending is reported before the cap', async () => {
    const u = await insertUser();
    for (let i = 0; i < OTP_MAX_PER_HOUR - 1; i++) await otp(u.id, { createdAgo: (40 - i) * MIN, used: true });
    await otp(u.id, { createdAgo: MIN });
    expect((await issueOtp(appDb(), u.id, 'h')).status).toBe('otp_pending');
  });

  it("is per user: another user's codes neither block nor count", async () => {
    const a = await insertUser();
    const b = await insertUser();
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) await otp(a.id, { createdAgo: (40 - i) * MIN, used: true });
    await otp(a.id, { createdAgo: MIN });
    expect((await issueOtp(appDb(), b.id, 'h')).status).toBe('issued');
  });

  it('a code burned after a failed send (markOtpUsed) frees the user to retry at once', async () => {
    const u = await insertUser();
    const r = await issueOtp(appDb(), u.id, 'h');
    if (r.status !== 'issued') throw new Error('expected issued');
    await markOtpUsed(appDb(), r.otpId);
    expect((await issueOtp(appDb(), u.id, 'h2')).status).toBe('issued');
  });

  it('unknown user id → FK error (23503), nothing inserted', async () => {
    await expect(issueOtp(appDb(), 999_999, 'h')).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) });
    expect(await rows()).toHaveLength(0);
  });
});

describe('issueOtp — concurrency', () => {
  it('50 parallel requests for one user → exactly one code', async () => {
    const u = await insertUser();
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => issueOtp(appDb(), u.id, `h${i}`)));
    expect(results.filter((r) => r.status === 'issued')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'otp_pending')).toHaveLength(49);
    expect(await rows(u.id)).toHaveLength(1);
  });

  it('100 parallel requests across 10 users → exactly one code per user', async () => {
    const users = await Promise.all(Array.from({ length: 10 }, () => insertUser()));
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => issueOtp(appDb(), users[i % 10]!.id, `h${i}`)),
    );
    expect(results.filter((r) => r.status === 'issued')).toHaveLength(10);
    for (const u of users) expect(await rows(u.id)).toHaveLength(1);
  });

  it('the hourly cap holds under bursts: never more than 5 codes in the window', async () => {
    const u = await insertUser();
    for (let i = 0; i < OTP_MAX_PER_HOUR - 2; i++) await otp(u.id, { createdAgo: (40 - i) * MIN, used: true });
    // Burst → one code (#4); burn it; burst → one code (#5); burn; burst → none.
    const issued: number[] = [];
    for (let round = 0; round < 4; round++) {
      const results = await Promise.all(Array.from({ length: 20 }, () => issueOtp(appDb(), u.id, 'h')));
      const won = results.filter((r) => r.status === 'issued');
      issued.push(won.length);
      expect(won.length).toBeLessThanOrEqual(1);
      await testPool().query('UPDATE email_otp_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [u.id]);
    }
    expect(issued).toEqual([1, 1, 0, 0]);
    const { rows: c } = await testPool().query(
      `SELECT count(*)::int AS n FROM email_otp_codes WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [u.id],
    );
    expect(c[0].n).toBe(OTP_MAX_PER_HOUR);
  });

  it('issuance racing the stale-code cleanup never errors and never double-issues', async () => {
    const u = await insertUser();
    for (let i = 0; i < 20; i++) await otp(u.id, { createdAgo: (2 * 60 + i) * MIN });
    const ops = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? deleteStaleOtps(appDb()).then(() => null) : issueOtp(appDb(), u.id, 'h'),
    );
    const results = (await Promise.all(ops)).filter((r) => r !== null);
    expect(results.filter((r) => r!.status === 'issued')).toHaveLength(1);
    const left = await rows(u.id);
    expect(left.filter((r) => r.used_at === null && r.ttl_s === 600)).toHaveLength(1);
  });

  it('the lock is per user: a held lock for A blocks A only, and A proceeds once released', async () => {
    const a = await insertUser();
    const b = await insertUser();
    const side = await testPool().connect();
    try {
      await side.query('BEGIN');
      await side.query('SELECT pg_advisory_xact_lock($1, $2)', [OTP_ISSUE_LOCK_NAMESPACE, a.id]);
      const pendingA = issueOtp(appDb(), a.id, 'ha');
      // B is not blocked by A's lock.
      expect((await issueOtp(appDb(), b.id, 'hb')).status).toBe('issued');
      // A is still waiting.
      const raced = await Promise.race([pendingA.then(() => 'done'), new Promise((r) => setTimeout(() => r('waiting'), 300))]);
      expect(raced).toBe('waiting');
      await side.query('COMMIT');
      expect((await pendingA).status).toBe('issued');
    } finally {
      side.release();
    }
  });

  it('a code inserted by a concurrent (uncommitted) transaction is seen after it commits', async () => {
    const u = await insertUser();
    const side = await testPool().connect();
    try {
      await side.query('BEGIN');
      // Same lock the function takes, then a code — like a concurrent issueOtp.
      await side.query('SELECT pg_advisory_xact_lock($1, $2)', [OTP_ISSUE_LOCK_NAMESPACE, u.id]);
      await side.query(
        `INSERT INTO email_otp_codes (user_id, code_hash, expires_at) VALUES ($1, 'side', now() + interval '10 minutes')`,
        [u.id],
      );
      const pending = issueOtp(appDb(), u.id, 'mine');
      await new Promise((r) => setTimeout(r, 200));
      await side.query('COMMIT');
      expect((await pending).status).toBe('otp_pending');
    } finally {
      side.release();
    }
    expect((await rows(u.id)).map((r) => r.code_hash)).toEqual(['side']);
  });
});

