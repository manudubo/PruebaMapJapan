import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// Real OTP routes + real Postgres; only JWT verification and the outbound
// email HTTP call are faked.
vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import { closeDbPools } from '../db';
import { call } from '../test-utils/app';
import { closeTestPool, insertUser, resetDb, testPool } from '../test-utils/db';

let sentCodes: string[];

beforeEach(async () => {
  await resetDb();
  sentCodes = [];
  // No RESEND_API_KEY in testEnv → the Mailpit branch posts JSON via fetch.
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const text = JSON.parse(String(init?.body))['Text'] as string;
    sentCodes.push(/code is: (\d{6})/.exec(text)![1]!);
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

const request = (sub = 'kc-a', headers: Record<string, string> = {}) =>
  call('POST', '/api/auth/otp-request', { sub, headers });
const verify = (code: unknown, sub = 'kc-a') => call('POST', '/api/auth/otp-verify', { sub, body: { code } });

async function rows(sub = 'kc-a') {
  const { rows } = await testPool().query(
    'SELECT o.* FROM email_otp_codes o JOIN users u ON u.id = o.user_id WHERE u.keycloak_id = $1 ORDER BY o.id',
    [sub],
  );
  return rows;
}

describe('POST /api/auth/otp-request', () => {
  it('201: stores a hashed code (never plaintext), expiring in ~10 min, and emails it', async () => {
    const res = await request();
    expect(res.status).toBe(201);
    expect(sentCodes).toHaveLength(1);
    const [row] = await rows();
    expect(row.code_hash).not.toContain(sentCodes[0]);
    const ttl = new Date(row.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
  });

  it('second request while one is pending → 429 otp_pending with retryAfter, no new code', async () => {
    await request();
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ success: false, error: 'otp_pending' });
    expect(res.body['retryAfter']).toBeGreaterThan(590);
    expect(res.body['retryAfter']).toBeLessThanOrEqual(600);
    expect(await rows()).toHaveLength(1);
  });

  it('token without an email → 422 no_email, nothing stored or sent', async () => {
    const res = await request('kc-a', { 'x-test-email': '' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ success: false, error: 'no_email' });
    expect(await rows()).toHaveLength(0);
    expect(sentCodes).toHaveLength(0);
  });

  it('purges stale codes of all users on request, keeping in-window ones (DATA-01)', async () => {
    const other = await insertUser({ keycloak_id: 'kc-other' });
    await testPool().query(
      `INSERT INTO email_otp_codes (user_id, code_hash, expires_at, created_at, used_at) VALUES
        ($1, 'stale', now() - interval '3 hours', now() - interval '3 hours 10 minutes', NULL),
        ($1, 'burned-recent', now() - interval '20 minutes', now() - interval '30 minutes', now() - interval '29 minutes')`,
      [other.id],
    );

    expect((await request()).status).toBe(201);

    const { rows: left } = await testPool().query('SELECT code_hash FROM email_otp_codes WHERE user_id = $1', [other.id]);
    expect(left.map((r) => r.code_hash)).toEqual(['burned-recent']);
  });

  it('hourly cap survives cleanup: 5 burned codes this hour → 429 otp_rate_limited', async () => {
    const me = await insertUser({ keycloak_id: 'kc-a', email: 'kc-a@example.com', name: 'kc-a' });
    for (let i = 0; i < 5; i++) {
      await testPool().query(
        `INSERT INTO email_otp_codes (user_id, code_hash, expires_at, created_at, used_at)
         VALUES ($1, 'h', now() - interval '1 minute', now() - make_interval(mins => $2), now())`,
        [me.id, 15 + i * 5],
      );
    }
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: 'otp_rate_limited' });
    expect(sentCodes).toHaveLength(0);
  });

  it('email provider failure → 500 generic body and the error is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('mailpit down'));
    const res = await request();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expect(JSON.stringify(log.mock.calls.map((c) => String(c[1])))).toContain('mailpit down');
  });
});

describe('POST /api/auth/otp-verify', () => {
  it('correct code → 200 and the code is consumed (second use → 400 otp_not_found)', async () => {
    await request();
    const ok = await verify(sentCodes[0]);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });
    expect((await rows())[0].used_at).not.toBeNull();

    const again = await verify(sentCodes[0]);
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ success: false, error: 'otp_not_found' });
  });

  it('wrong code → 400 invalid_code and attempts incremented', async () => {
    await request();
    const wrong = sentCodes[0] === '000000' ? '000001' : '000000';
    const res = await verify(wrong);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'invalid_code' });
    expect((await rows())[0].attempts).toBe(1);
  });

  it('after 5 wrong attempts the code is burned: 429 max_attempts, then even the right code fails', async () => {
    await request();
    const wrong = sentCodes[0] === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await verify(wrong)).status).toBe(400);
    const locked = await verify(sentCodes[0]);
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ success: false, error: 'max_attempts' });
    expect((await verify(sentCodes[0])).status).toBe(400);
  });

  it("another user's valid code does not verify me", async () => {
    await request('kc-b');
    const res = await verify(sentCodes[0], 'kc-a');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'otp_not_found' });
    // …and B's code is still usable by B.
    expect((await verify(sentCodes[0], 'kc-b')).status).toBe(200);
  });

  it('no pending code → 400 otp_not_found', async () => {
    const res = await verify('123456');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'otp_not_found' });
  });

  it('expired code → 400 otp_not_found even if correct', async () => {
    await request();
    await testPool().query(`UPDATE email_otp_codes SET expires_at = now() - interval '1 second'`);
    expect((await verify(sentCodes[0])).body['error']).toBe('otp_not_found');
  });

  it.each([
    ['5 digits', '12345'],
    ['7 digits', '1234567'],
    ['letters', 'abcdef'],
    ['full-width digits', '１２３４５６'],
    ['number instead of string', 123456],
    ['empty', ''],
    ['null', null],
  ])('malformed code (%s) → 400 from the schema, attempts untouched', async (_l, code) => {
    await request();
    const res = await verify(code);
    expect(res.status).toBe(400);
    expect((await rows())[0].attempts).toBe(0);
  });
});
