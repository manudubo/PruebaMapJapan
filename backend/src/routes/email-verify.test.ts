import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// Sign-up e-mail verification: real routes + real Postgres; only JWT
// verification and the outbound mail HTTP call are faked.
vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import { closeDbPools } from '../db';
import { call } from '../test-utils/app';
import { closeTestPool, insertUser, resetDb, testEnv, testPool } from '../test-utils/db';

let mails: { to: string; subject: string; text: string }[];
const lastCode = () => /code is: (\d{6})/.exec(mails.at(-1)!.text)![1]!;

beforeEach(async () => {
  await resetDb();
  mails = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { To: { Email: string }[]; Subject: string; Text: string };
    mails.push({ to: body.To[0]!.Email, subject: body.Subject, text: body.Text });
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

const UNVERIFIED = { 'x-test-email-verified': 'false' };
const request = (sub = 'kc-a', headers: Record<string, string> = UNVERIFIED) =>
  call('POST', '/api/auth/email-verify/request', { sub, headers });
const confirm = (code: unknown, sub = 'kc-a', headers: Record<string, string> = UNVERIFIED) =>
  call('POST', '/api/auth/email-verify/confirm', { sub, body: { code }, headers });

async function userRow(sub = 'kc-a') {
  const { rows } = await testPool().query('SELECT * FROM users WHERE keycloak_id = $1', [sub]);
  return rows[0];
}
async function otpRows(sub = 'kc-a') {
  const { rows } = await testPool().query(
    'SELECT o.* FROM email_otp_codes o JOIN users u ON u.id = o.user_id WHERE u.keycloak_id = $1 ORDER BY o.id',
    [sub],
  );
  return rows;
}

describe('POST /api/auth/email-verify/request', () => {
  it('201: mails a purpose=email_verify code to the token address even though it is unverified', async () => {
    const res = await request();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('kc-a@example.com');
    expect(mails[0]!.subject).toMatch(/confirm/i);
    const [row] = await otpRows();
    expect(row.purpose).toBe('email_verify');
    expect(row.code_hash).not.toContain(lastCode());
  });

  it('the login OTP still refuses an unverified address (only email-verify may mail it)', async () => {
    const res = await call('POST', '/api/auth/otp-request', { sub: 'kc-a', headers: UNVERIFIED });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'email_not_verified' });
    expect(mails).toHaveLength(0);
  });

  it('second request while one is pending → 429 otp_pending, no new code or mail', async () => {
    await request();
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ success: false, error: 'otp_pending' });
    expect(await otpRows()).toHaveLength(1);
    expect(mails).toHaveLength(1);
  });

  it('the hourly cap (5 codes) applies: the 6th is otp_rate_limited', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request()).status).toBe(201);
      await testPool().query('UPDATE email_otp_codes SET used_at = now()');
    }
    const res = await request();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: 'otp_rate_limited' });
  });

  it('a pending LOGIN code does not block the verification code (and vice versa)', async () => {
    const login = await call('POST', '/api/auth/otp-request', { sub: 'kc-a' });
    expect(login.status).toBe(201);
    expect((await request('kc-a', {})).status).toBe(200); // verified by token -> nothing to do
    expect((await request()).status).toBe(201);
    expect((await otpRows()).map((r) => r.purpose)).toEqual(['login', 'email_verify']);
  });

  it('token without an email → 422 no_email', async () => {
    const res = await request('kc-a', { ...UNVERIFIED, 'x-test-email': '' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ success: false, error: 'no_email' });
    expect(mails).toHaveLength(0);
  });

  it('already verified (token claim) → 200 email_verified, no code, no mail', async () => {
    const res = await request('kc-a', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { email_verified: true } });
    expect(mails).toHaveLength(0);
    expect(await otpRows()).toHaveLength(0);
  });

  it('already verified (email_verified_at) → 200, no mail', async () => {
    await insertUser({ keycloak_id: 'kc-a', email: 'kc-a@example.com', email_verified_at: new Date() });
    const res = await request();
    expect(res.status).toBe(200);
    expect(mails).toHaveLength(0);
  });

  it('401 without a token; undelivered mail is retired so a retry is not blocked as pending', async () => {
    expect((await call('POST', '/api/auth/email-verify/request')).status).toBe(401);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new TypeError('mail down');
    });
    expect((await request()).status).toBe(500);
    expect((await request()).status).toBe(201);
  });
});

describe('POST /api/auth/email-verify/confirm', () => {
  it('200: sets email_verified_at once; GET /me then reports email_verified', async () => {
    await request();
    const before = await call('GET', '/api/users/me', { sub: 'kc-a', headers: UNVERIFIED });
    expect((before.body['data'] as Record<string, unknown>)['email_verified']).toBe(false);

    const res = await confirm(lastCode());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { email_verified: true } });
    const row = await userRow();
    expect(row.email_verified_at).toBeInstanceOf(Date);

    const after = await call('GET', '/api/users/me', { sub: 'kc-a', headers: UNVERIFIED });
    expect((after.body['data'] as Record<string, unknown>)['email_verified']).toBe(true);
  });

  it('single use: replaying the same code → 400 otp_not_found and the timestamp does not move', async () => {
    await request();
    const code = lastCode();
    expect((await confirm(code)).status).toBe(200);
    const stamp = (await userRow()).email_verified_at;
    const again = await confirm(code);
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ error: 'otp_not_found' });
    expect((await userRow()).email_verified_at).toEqual(stamp);
  });

  it('wrong code → 400 invalid_code, attempt counted, user stays unverified', async () => {
    await request();
    const wrong = lastCode() === '000000' ? '000001' : '000000';
    const res = await confirm(wrong);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_code' });
    expect((await otpRows())[0].attempts).toBe(1);
    expect((await userRow()).email_verified_at).toBeNull();
  });

  it('five wrong guesses burn the code: even the right code is refused afterwards (429 max_attempts)', async () => {
    await request();
    const right = lastCode();
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await confirm(wrong)).status).toBe(400);
    const burned = await confirm(right);
    expect(burned.status).toBe(429);
    expect(burned.body).toMatchObject({ error: 'max_attempts' });
    expect((await userRow()).email_verified_at).toBeNull();
  });

  it('a code is only valid for its purpose: login code cannot verify the e-mail, and vice versa', async () => {
    await call('POST', '/api/auth/otp-request', { sub: 'kc-a' });
    const loginCode = lastCode();
    expect((await confirm(loginCode)).status).toBe(400);
    expect((await userRow()).email_verified_at).toBeNull();

    await request();
    const verifyCode = lastCode();
    const crossed = await call('POST', '/api/auth/otp-verify', { sub: 'kc-a', body: { code: verifyCode } });
    expect(crossed.status).toBe(400);
    expect((await confirm(verifyCode)).status).toBe(200);
  });

  it('another user cannot use my code', async () => {
    await request('kc-a');
    const code = lastCode();
    await call('GET', '/api/users/me', { sub: 'kc-b' });
    const res = await confirm(code, 'kc-b');
    expect(res.status).toBe(400);
    expect((await userRow('kc-b')).email_verified_at).toBeNull();
    expect((await userRow('kc-a')).email_verified_at).toBeNull();
  });

  it('expired code → 400 otp_not_found', async () => {
    await request();
    const code = lastCode();
    await testPool().query(`UPDATE email_otp_codes SET expires_at = now() - interval '1 second'`);
    expect((await confirm(code)).status).toBe(400);
  });

  it('malformed bodies are rejected before any state is touched', async () => {
    await request();
    for (const bad of [undefined, null, 123456, '12345', '1234567', 'abcdef', '12 456', ['123456'], { code: '123456' }]) {
      const res = await confirm(bad);
      expect([400, 422]).toContain(res.status);
    }
    expect((await otpRows())[0].attempts).toBe(0);
  });
});

describe('GET/PATCH /api/users/me expose email_verified', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['string', false],
    ['missing', false],
    ['1', false],
  ])('token claim %s → email_verified=%s', async (claim, expected) => {
    const res = await call('GET', '/api/users/me', { sub: 'kc-a', headers: { 'x-test-email-verified': claim } });
    expect((res.body['data'] as Record<string, unknown>)['email_verified']).toBe(expected);
    const patch = await call('PATCH', '/api/users/me', {
      sub: 'kc-a',
      body: { name: 'N' },
      headers: { 'x-test-email-verified': claim },
    });
    expect((patch.body['data'] as Record<string, unknown>)['email_verified']).toBe(expected);
  });

  it('keeps onboarding.is_new next to email_verified', async () => {
    const res = await call('GET', '/api/users/me', { sub: 'kc-a', headers: UNVERIFIED });
    expect((res.body['data'] as Record<string, unknown>)['onboarding']).toEqual({ is_new: true });
  });
});

describe('REQUIRE_VERIFIED_EMAIL gate (routes)', () => {
  const env = (extra: Record<string, string>) => testEnv(extra);

  it('off in development by default: unverified accounts use the API', async () => {
    expect((await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED })).status).toBe(200);
  });

  it('on when REQUIRE_VERIFIED_EMAIL=true: 403 email_not_verified, then 200 once verified', async () => {
    const e = env({ REQUIRE_VERIFIED_EMAIL: 'true' });
    const blocked = await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED, env: e });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ success: false, error: 'email_not_verified', code: 'email_not_verified' });

    await call('POST', '/api/auth/email-verify/request', { sub: 'kc-a', headers: UNVERIFIED, env: e });
    const ok = await call('POST', '/api/auth/email-verify/confirm', {
      sub: 'kc-a',
      headers: UNVERIFIED,
      env: e,
      body: { code: lastCode() },
    });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED, env: e })).status).toBe(200);
  });

  it('on by default when ENVIRONMENT is production (fail-closed), off when explicitly false', async () => {
    const prod = env({ ENVIRONMENT: 'production', RESEND_API_KEY: 're_test' });
    expect((await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED, env: prod })).status).toBe(403);
    const off = env({ ENVIRONMENT: 'production', REQUIRE_VERIFIED_EMAIL: 'false' });
    expect((await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED, env: off })).status).toBe(200);
  });

  it('a garbage REQUIRE_VERIFIED_EMAIL value is treated as true', async () => {
    const e = env({ REQUIRE_VERIFIED_EMAIL: 'flase' });
    expect((await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED, env: e })).status).toBe(403);
  });
});
