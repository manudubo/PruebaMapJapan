import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Wire contract with the frontend (contracts/auth-flows.json, read by
// frontend/tests/auth-flows-contract.test.ts): every case below is produced by the
// REAL routes and compared to the shared file, so neither side can drift alone.
vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));

import app from '../index';
import { closeDbPools } from '../db';
import { call } from '../test-utils/app';
import { closeTestPool, insertUser, resetDb, testEnv } from '../test-utils/db';
import { __resetRateLimitsForTests, __setRateLimitingEnabledForTests } from '../middleware/rate-limit';

interface Case {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}
const contract = JSON.parse(
  readFileSync(join(__dirname, '../../../contracts/auth-flows.json'), 'utf8'),
) as { cases: Case[] };
const byId = (id: string): Case => {
  const c = contract.cases.find((x) => x.id === id);
  if (!c) throw new Error(`no contract case ${id}`);
  return c;
};

const NUMBER = '<number>';
/** Subset match; "<number>" in the contract matches any non-negative number. */
function expectMatches(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(expected)) {
    if (v === NUMBER) {
      expect(typeof actual[k], `${k} must be a number`).toBe('number');
      expect(actual[k] as number).toBeGreaterThanOrEqual(0);
    } else if (v && typeof v === 'object') {
      expectMatches(actual[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      expect(actual[k], k).toEqual(v);
    }
  }
}
function check(id: string, res: { status: number; body: Record<string, unknown> }): void {
  const c = byId(id);
  expect(res.status, `${id} status`).toBe(c.status);
  expectMatches(res.body, c.body);
}

let mails: { text: string }[];
const lastCode = () => /code is: (\d{6})/.exec(mails.at(-1)!.text)![1]!;

beforeEach(async () => {
  await resetDb();
  mails = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { Text: string };
    mails.push({ text: body.Text });
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  __setRateLimitingEnabledForTests(false);
});
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

const UNVERIFIED = { 'x-test-email-verified': 'false' };
const verifyRequest = () => call('POST', '/api/auth/email-verify/request', { sub: 'kc-a', headers: UNVERIFIED });
const verifyConfirm = (code: string) =>
  call('POST', '/api/auth/email-verify/confirm', { sub: 'kc-a', body: { code }, headers: UNVERIFIED });
const wrong = () => (lastCode() === '000000' ? '111111' : '000000');

describe('auth-flows contract: e-mail verification', () => {
  it('request: sent, pending, already verified', async () => {
    check('verify.request.sent', await verifyRequest());
    check('verify.request.pending', await verifyRequest());
    check('verify.request.already', await call('POST', '/api/auth/email-verify/request', { sub: 'kc-b' }));
  });

  it('confirm: wrong, ok, and a spent code is "not found"', async () => {
    await verifyRequest();
    check('verify.confirm.wrong', await verifyConfirm(wrong()));
    const code = lastCode();
    check('verify.confirm.ok', await verifyConfirm(code));
    check('verify.confirm.expired', await verifyConfirm(code));
  });

  it('confirm: the fifth wrong guess burns the code with 429 max_attempts', async () => {
    await verifyRequest();
    for (let i = 0; i < 5; i++) await verifyConfirm(wrong());
    check('verify.confirm.locked', await verifyConfirm(wrong()));
  });

  it('gate: an unverified account gets 403 email_not_verified on a data route', async () => {
    const res = await call('GET', '/api/trips', { sub: 'kc-a', headers: UNVERIFIED, env: { ...testEnv(), REQUIRE_VERIFIED_EMAIL: 'true' } });
    check('gate.email_not_verified', res);
  });
});

describe('auth-flows contract: recovery', () => {
  const recoveryEnv = () => ({ ...testEnv(), KEYCLOAK_RECOVERY_CLIENT_SECRET: 'contract-test-secret' });
  const post = (path: string, body: unknown, env = recoveryEnv()) => call('POST', `/api/auth/recovery/${path}`, { body, env });

  it('request is always the generic 202', async () => {
    check('recovery.request.generic', await post('request', { email: 'nobody@example.com' }));
  });

  it('request: the per-IP limit answers 429 rate_limited with retryAfter and Retry-After', async () => {
    __resetRateLimitsForTests();
    __setRateLimitingEnabledForTests(true);
    let last: Response | undefined;
    for (let i = 0; i < 12; i++) {
      last = await app.request(
        '/api/auth/recovery/request',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `n${i}@example.com` }) },
        recoveryEnv(),
      );
      if (last.status === 429) break;
    }
    const c = byId('recovery.request.rate_limited');
    expect(last!.status).toBe(c.status);
    expectMatches((await last!.json()) as Record<string, unknown>, c.body);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('confirm: unknown account / weak password / not configured', async () => {
    const good = { email: 'nobody@example.com', code: '123456', new_password: 'correct horse battery staple' };
    check('recovery.confirm.invalid', await post('confirm', good));
    check('recovery.confirm.weak_password', await post('confirm', { ...good, new_password: 'short' }));
    check('recovery.confirm.unavailable', await post('confirm', good, testEnv()));
  });

  it('confirm: a disabled/missing Keycloak account is 422 recovery_unavailable', async () => {
    // Real user row and a real recovery code; Keycloak (fetch) answers "no such user".
    await insertUser({ keycloak_id: 'kc-r', email: 'r@example.com' });
    const env = { ...recoveryEnv(), KEYCLOAK_ADMIN_URL: 'http://kc.test/auth', KEYCLOAK_URL: 'http://kc.test/auth' };
    const pw = 'correct horse battery staple';
    const mailSpy = vi.mocked(global.fetch);
    mailSpy.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes('/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 60 }), { status: 200 });
      }
      if (u.includes('/admin/realms/')) return new Response('[]', { status: 200 }); // user lookup: nobody
      const body = JSON.parse(String(init?.body)) as { Text: string };
      mails.push({ text: body.Text });
      return new Response('{}', { status: 200 });
    });
    check('recovery.request.generic', await post('request', { email: 'r@example.com' }, env));
    await vi.waitFor(() => expect(mails).toHaveLength(1));
    const res = await post('confirm', { email: 'r@example.com', code: lastCode(), new_password: pw }, env);
    check('recovery.confirm.account_unusable', res);
  });
});
