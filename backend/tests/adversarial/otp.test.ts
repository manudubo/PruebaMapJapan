/**
 * Adversarial: email OTP (POST /api/auth/otp-request, /api/auth/otp-verify)
 * against a real DB. The Mailpit call is captured so tests can read the
 * issued code, which lets us exercise the success path too.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  client,
  createSigner,
  createTestDatabase,
  describeDb,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  sql,
  waitForLockWaiters,
  type FakeNetwork,
  type Req,
  type Signer,
  type TestUser,
} from './harness';

let dbUrl: string;
let req: Req;
let signer: Signer;
let net: FakeNetwork;
let user: TestUser;

const request = (u: TestUser = user) => req('POST', '/api/auth/otp-request', { token: u.token });
const verify = (code: unknown, u: TestUser = user) =>
  req('POST', '/api/auth/otp-verify', { token: u.token, body: { code } });

async function otpRows(u: TestUser) {
  return sql<{ id: number; attempts: number; used_at: Date | null; expires_at: Date }>(
    dbUrl,
    `select o.id, o.attempts, o.used_at, o.expires_at from email_otp_codes o
       join users u on u.id = o.user_id where u.keycloak_id = $1 order by o.id`,
    [u.sub],
  );
}

/**
 * Force an interleaving: a side transaction locks the row(s) selected by
 * `lockSql`, `fire()` starts `n` requests that read first and then queue on
 * that lock when they write, and the lock is released only once all `n` are
 * waiting — so every request has passed its read-side checks.
 */
async function underRowLock<T>(lockSql: string, params: unknown[], n: number, fire: () => Promise<T>[]): Promise<T[]> {
  const locker = new pg.Client({ connectionString: dbUrl });
  await locker.connect();
  try {
    await locker.query('BEGIN');
    await locker.query(lockSql, params);
    const pending = fire();
    await waitForLockWaiters(dbUrl, n);
    await locker.query('COMMIT');
    return await Promise.all(pending);
  } finally {
    await locker.end();
  }
}

const LOCK_OTP = `select o.id from email_otp_codes o join users u on u.id = o.user_id
                    where u.keycloak_id = $1 for update of o`;
const LOCK_USER = 'select id from users where keycloak_id = $1 for update';

function wrong(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, '0');
}

describeDb('OTP', () => {
  beforeAll(async () => {
    signer = await createSigner();
    net = installFakeNetwork([signer]);
    dbUrl = await createTestDatabase('otp');
    req = client(makeEnv(dbUrl, { ENVIRONMENT: 'development' })); // Mailpit transport (SEC-08 gate)
  }, 60_000);

  afterAll(async () => {
    await dropTestDatabase(dbUrl);
  });

  beforeEach(async () => {
    user = await makeUser(signer); // fresh user per test: no shared OTP state
    net.failMail = false;
  });

  describe('happy path and replay', () => {
    it('request → email carries a 6-digit code → verify 200 → replay rejected', async () => {
      expect((await request()).status).toBe(201);
      const code = net.lastCodeFor(user.email)!;
      expect(code).toMatch(/^\d{6}$/);
      expect((await verify(code)).status).toBe(200);
      const replay = await verify(code);
      expect(replay.status).toBe(400);
      expect(replay.body.error).toBe('otp_not_found');
    });

    it('the code is stored hashed, never in clear', async () => {
      await request();
      const code = net.lastCodeFor(user.email)!;
      const rows = await sql<{ code_hash: string }>(
        dbUrl,
        'select code_hash from email_otp_codes o join users u on u.id=o.user_id where u.keycloak_id=$1',
        [user.sub],
      );
      expect(rows[0]!.code_hash).not.toContain(code);
    });

    it('a code issued to user A cannot be redeemed by user B', async () => {
      const b = await makeUser(signer);
      await request(user);
      await request(b);
      const aCode = net.lastCodeFor(user.email)!;
      const bCode = net.lastCodeFor(b.email)!;
      if (aCode !== bCode) expect((await verify(aCode, b)).status).toBe(400);
      expect((await verify(bCode, b)).status).toBe(200);
    });
  });

  describe('attempt exhaustion', () => {
    it('5 wrong guesses → 6th request is max_attempts (429) and even the right code is dead', async () => {
      await request();
      const code = net.lastCodeFor(user.email)!;
      for (let i = 0; i < 5; i++) {
        const r = await verify(wrong(code));
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('invalid_code');
      }
      const sixth = await verify(code);
      expect(sixth.status).toBe(429);
      expect(sixth.body.error).toBe('max_attempts');
      expect((await verify(code)).status).toBe(400); // burned → otp_not_found
    });

    // SEC-07 (fixed in Phase 26 by the atomic attempts UPDATE): the check +
    // increment used to be read-then-write, so parallel guesses were all
    // evaluated (30/30) and one code could be redeemed 5 times.
    it('SEC-07: 30 parallel wrong guesses are capped at 5 evaluated attempts', async () => {
      await request();
      const code = net.lastCodeFor(user.email)!;
      const results = await underRowLock(LOCK_OTP, [user.sub], 30, () =>
        Array.from({ length: 30 }, () => verify(wrong(code))),
      );
      const evaluated = results.filter((r) => r.body.error === 'invalid_code').length;
      expect(evaluated).toBeLessThanOrEqual(5);
    });

    it('SEC-07: parallel verifies of the correct code succeed at most once', async () => {
      await request();
      const code = net.lastCodeFor(user.email)!;
      const results = await underRowLock(LOCK_OTP, [user.sub], 5, () =>
        Array.from({ length: 5 }, () => verify(code)),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });
  });

  describe('expiry, pending and hourly cap (BUG-16)', () => {
    it('expired code → otp_not_found, and a new code can be requested', async () => {
      await request();
      const code = net.lastCodeFor(user.email)!;
      await sql(
        dbUrl,
        `update email_otp_codes set expires_at = now() - interval '1 second'
           where user_id = (select id from users where keycloak_id=$1)`,
        [user.sub],
      );
      expect((await verify(code)).body.error).toBe('otp_not_found');
      expect((await request()).status).toBe(201);
    });

    it('second request while a code is pending → 429 otp_pending with retryAfter ≤ 600', async () => {
      await request();
      const res = await request();
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('otp_pending');
      expect(res.body.retryAfter).toBeGreaterThan(0);
      expect(res.body.retryAfter).toBeLessThanOrEqual(600);
    });

    it('request/burn cycle is capped at 5 codes per hour, then 429 otp_rate_limited', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await request()).status).toBe(201);
        const code = net.lastCodeFor(user.email)!;
        expect((await verify(code)).status).toBe(200); // use it so it is no longer pending
      }
      const capped = await request();
      expect(capped.status).toBe(429);
      expect(capped.body.error).toBe('otp_rate_limited');
      expect(capped.body.retryAfter).toBeGreaterThan(3000);
      expect(net.mails.filter((m) => m.to === user.email)).toHaveLength(5);
    });

    it('cap resets once the oldest code is older than one hour', async () => {
      for (let i = 0; i < 5; i++) {
        await request();
        await verify(net.lastCodeFor(user.email)!);
      }
      expect((await request()).status).toBe(429);
      await sql(
        dbUrl,
        `update email_otp_codes set created_at = created_at - interval '61 minutes'
           where id = (select min(o.id) from email_otp_codes o join users u on u.id=o.user_id where u.keycloak_id=$1)`,
        [user.sub],
      );
      expect((await request()).status).toBe(201);
      expect((await request()).status).toBe(429);
    });

    it('the cap is per user: another user is unaffected', async () => {
      for (let i = 0; i < 5; i++) {
        await request();
        await verify(net.lastCodeFor(user.email)!);
      }
      expect((await request()).status).toBe(429);
      const other = await makeUser(signer);
      expect((await request(other)).status).toBe(201);
    });

    // STILL OPEN — SEC-07 follow-up (Phase 26 OTP atomicity). Phase 26 made the
    // attempts counter atomic, but issuance is still check-then-insert: the
    // pending check, the hourly cap (BUG-16) and the INSERT are separate
    // statements, so a burst of parallel requests passes every check and
    // issues (and emails) 20 codes, bypassing both otp_pending and the cap.
    it.fails('SEC-07 (issuance): 20 parallel otp-requests issue at most one code', async () => {
      await req('GET', '/api/users/me', { token: user.token }); // provision the user row first
      // The OTP INSERT's FK check needs a KEY SHARE lock on the user row.
      const results = await underRowLock(LOCK_USER, [user.sub], 20, () =>
        Array.from({ length: 20 }, () => request()),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await otpRows(user)).toHaveLength(1);
    });
  });

  describe('input and account edge cases', () => {
    it.each([
      ['5 digits', '12345'],
      ['7 digits', '1234567'],
      ['letters', 'abcdef'],
      ['spaces', ' 12345'],
      ['arabic-indic digits', '١٢٣٤٥٦'],
      ['number instead of string', 123456],
      ['null', null],
      ['SQL-ish', "1' OR 1"],
    ])('code = %s → 400 validation error, attempts not consumed', async (_l, code) => {
      await request();
      const res = await verify(code);
      expect(res.status).toBe(400);
      expect((await otpRows(user))[0]!.attempts).toBe(0);
    });

    it('verify without any issued code → 400 otp_not_found', async () => {
      const res = await verify('123456');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('otp_not_found');
    });

    it('user whose token has no email → 422 no_email, nothing stored', async () => {
      const noMail = await makeUser(signer, { email: undefined });
      const res = await request(noMail);
      expect(res.status).toBe(422);
      expect(await otpRows(noMail)).toHaveLength(0);
    });

    it('SEC-08: production without RESEND_API_KEY fails loudly and issues no code', async () => {
      const prod = client(makeEnv(dbUrl)); // no ENVIRONMENT → production, no RESEND_API_KEY
      const before = net.mails.length;
      const res = await prod('POST', '/api/auth/otp-request', { token: user.token });
      expect(res.status).toBe(500);
      expect(net.mails.length).toBe(before); // never fell back to Mailpit
      const pending = (await otpRows(user)).filter((r) => r.used_at === null);
      expect(pending).toHaveLength(0);
      expect((await request()).status).toBe(201); // user not locked out afterwards
    });

    it('otp routes require auth', async () => {
      expect((await req('POST', '/api/auth/otp-request')).status).toBe(401);
      expect((await req('POST', '/api/auth/otp-verify', { body: { code: '123456' } })).status).toBe(401);
    });

    // SEC-08 (fixed in Phase 26): a failed send used to leave the undelivered
    // code pending, locking the user out by otp_pending for 10 minutes.
    it('SEC-08: a failed email send does not leave the user locked out by otp_pending', async () => {
      net.failMail = true;
      const first = await request();
      expect(first.status).toBe(500);
      net.failMail = false;
      const retry = await request();
      expect(retry.status).toBe(201);
    });
  });
});
