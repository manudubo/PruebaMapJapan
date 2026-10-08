/**
 * Adversarial: account recovery by e-mail code
 * (POST /api/auth/recovery/request and /confirm) on the real app and a real
 * Postgres. Only the network edges are faked: the outbound mail HTTP call
 * (Mailpit) and the Keycloak token + Admin API endpoints.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import {
  POLICIES,
  __resetRateLimitsForTests,
  __setRateLimitingEnabledForTests,
} from '../../src/middleware/rate-limit';
import { __setKeycloakAdminTimeoutForTests } from '../../src/auth/keycloak-admin';
import { __settleRecoveryBackgroundForTests } from '../../src/routes/recovery';
import { setMinLogLevel } from '../../src/observability/logger';
import {
  createSigner,
  createTestDatabase,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  client,
  sql,
  type FakeNetwork,
  type Signer,
} from './harness';
import type { Env } from '../../src/types';

const SECRET = 's3cret-recovery-client-secret-0123456789';
const ADMIN_BASE = 'http://kc-internal.test:8080/auth';
const NEW_PASSWORD = 'correct horse battery staple';

let dbUrl: string;
let signer: Signer;
let net: FakeNetwork;
let kc: FakeKeycloak;

// ---------------------------------------------------------------------------
// Fake Keycloak (token + Admin API)
// ---------------------------------------------------------------------------

type Behaviour = 'ok' | '401' | '403' | '500' | '503' | 'throw' | 'hang' | 'garbage';
interface KcUser {
  id: string;
  email: string;
  enabled?: boolean;
  emailVerified?: boolean;
  requiredActions?: string[];
  credentials?: { id: string; type: string }[];
}
interface KcCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}
interface FakeKeycloak {
  users: KcUser[];
  token: Behaviour;
  find: Behaviour;
  reset: Behaviour | '400' | '404';
  calls: KcCall[];
  loggedOut: string[];
  passwordSets: { id: string; body: Record<string, unknown> }[];
  /** Base URL the backend is expected to call. */
  base: string;
}

let uuidSeq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

function installKeycloak(base: string): FakeKeycloak {
  const state: FakeKeycloak = { users: [], token: 'ok', find: 'ok', reset: 'ok', calls: [], loggedOut: [], passwordSets: [], base };
  const prior = globalThis.fetch;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const apply = async (b: Behaviour | '400' | '404', init: RequestInit, okResponse: () => Response): Promise<Response> => {
    switch (b) {
      case 'ok': return okResponse();
      case '401': case '403': case '500': case '503': case '400': case '404':
        return json(Number(b), { error: 'x', secret_detail: 'do-not-leak' });
      case 'garbage': return new Response('<html>not json</html>', { status: 200 });
      case 'throw': throw new TypeError('fetch failed (fake keycloak down)');
      case 'hang':
        return new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(init.signal!.reason));
        });
    }
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isToken = url.endsWith('/protocol/openid-connect/token');
    const isAdmin = url.includes('/admin/realms/');
    if (!isToken && !isAdmin) return prior(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const method = init.method ?? 'GET';
    state.calls.push({ method, url, headers, body: String(init.body ?? '') });
    if (!url.startsWith(state.base)) return json(404, { error: 'wrong base' });

    if (isToken) {
      return apply(state.token, init, () => json(200, { access_token: 'svc-token-abc', token_type: 'Bearer' }));
    }
    if (headers['authorization'] !== 'Bearer svc-token-abc') return json(401, { error: 'no token' });
    if (method === 'GET' && /\/users\?/.test(url)) {
      return apply(state.find, init, () => {
        const q = new URL(url).searchParams;
        const email = (q.get('email') ?? '').toLowerCase();
        return json(200, state.users.filter((u) => u.email.toLowerCase() === email));
      });
    }
    const m = /\/users\/([^/]+)\/reset-password$/.exec(url);
    if (method === 'PUT' && m) {
      return apply(state.reset, init, () => {
        state.passwordSets.push({ id: m[1]!, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return new Response(null, { status: 204 });
      });
    }
    const u = /\/users\/([^/?]+)(\/.*)?$/.exec(url);
    const user = u && state.users.find((x) => x.id === u[1]);
    if (user) {
      if (method === 'PUT' && !u![2]) {
        Object.assign(user, JSON.parse(String(init.body)) as object);
        return new Response(null, { status: 204 });
      }
      if (method === 'GET' && u![2] === '/credentials') return json(200, user.credentials ?? []);
      const cred = /^\/credentials\/([^/]+)$/.exec(u![2] ?? '');
      if (method === 'DELETE' && cred) {
        user.credentials = (user.credentials ?? []).filter((c) => c.id !== cred[1]);
        return new Response(null, { status: 204 });
      }
      if (method === 'POST' && u![2] === '/logout') {
        state.loggedOut.push(user.id);
        return new Response(null, { status: 204 });
      }
    }
    return json(404, {});
  });
  return state;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let envBase: Env;
const logLines: string[] = [];
let seq = 0;

function reqWith(env: Env) {
  return client(env);
}
const call = (path: string, body: unknown, env: Env = envBase, headers: Record<string, string> = {}) =>
  reqWith(env)('POST', path, { body, headers });
const request = (email: string, env?: Env, headers?: Record<string, string>) =>
  call('/api/auth/recovery/request', { email }, env, headers);
const confirm = (email: string, code: string, new_password = NEW_PASSWORD, env?: Env) =>
  call('/api/auth/recovery/confirm', { email, code, new_password }, env);

async function account(email = `rec${++seq}-${process.pid}@example.test`, opts: { kcUser?: boolean } = {}) {
  await sql(dbUrl, `delete from users where lower(email) = lower($1)`, [email]);
  kc.users = kc.users.filter((u) => u.email.toLowerCase() !== email.toLowerCase());
  const [row] = await sql<{ id: number }>(
    dbUrl,
    `insert into users (keycloak_id, email, name) values ($1, $2, 'R') returning id`,
    [`kc-rec-${process.pid}-${seq}-${Math.random().toString(36).slice(2, 8)}`, email],
  );
  const id = uuid();
  if (opts.kcUser !== false) kc.users.push({ id, email, enabled: true });
  return { email, userId: row!.id, kcId: id };
}

async function issue(email: string): Promise<string> {
  const res = await request(email);
  expect(res.status).toBe(202);
  await __settleRecoveryBackgroundForTests();
  const code = net.lastCodeFor(email);
  expect(code, 'a recovery code should have been mailed').toMatch(/^\d{6}$/);
  return code!;
}
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

const otpRows = (userId: number) =>
  sql<{ purpose: string; attempts: number; used_at: Date | null }>(
    dbUrl,
    `select purpose, attempts, used_at from email_otp_codes where user_id = $1 order by id`,
    [userId],
  );
const userRow = async (userId: number) =>
  (await sql<{ email_verified_at: Date | null }>(dbUrl, `select email_verified_at from users where id=$1`, [userId]))[0]!;

beforeAll(async () => {
  signer = await createSigner();
  dbUrl = await createTestDatabase('recovery');
  envBase = makeEnv(dbUrl, {
    ENVIRONMENT: 'development',
    KEYCLOAK_RECOVERY_CLIENT_SECRET: SECRET,
    KEYCLOAK_ADMIN_URL: ADMIN_BASE,
  });
}, 60_000);
afterAll(async () => {
  await dropTestDatabase(dbUrl);
});
beforeEach(() => {
  net = installFakeNetwork([signer]);
  kc = installKeycloak(ADMIN_BASE);
  logLines.length = 0;
  setMinLogLevel('debug');
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(async () => {
  await __settleRecoveryBackgroundForTests();
  __setKeycloakAdminTimeoutForTests(undefined);
  __setRateLimitingEnabledForTests(false);
  setMinLogLevel(process.env.TEST_LOG_LEVEL ?? 'warn');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------

describe('POST /api/auth/recovery/request', () => {
  it('existing account: 202, generic body, a purpose=recovery code is mailed to the stored address', async () => {
    const a = await account();
    const res = await request(a.email);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ success: true, message: expect.stringMatching(/if an account exists/i) });
    await __settleRecoveryBackgroundForTests();
    expect(net.mails.filter((m) => m.to === a.email)).toHaveLength(1);
    expect(net.mails.at(-1)!.text).toMatch(/recovery code is: \d{6}/);
    expect((await otpRows(a.userId)).map((r) => r.purpose)).toEqual(['recovery']);
  });

  it('unknown account: byte-identical status, body and headers; nothing sent or stored', async () => {
    const a = await account();
    const known = await request(a.email);
    const unknown = await request(`nobody-${process.pid}@example.test`);
    await __settleRecoveryBackgroundForTests();
    expect(unknown.status).toBe(known.status);
    expect(unknown.text).toBe(known.text);
    for (const h of ['content-type', 'cache-control', 'retry-after']) {
      expect(unknown.headers.get(h)).toBe(known.headers.get(h));
    }
    expect(net.mails.map((m) => m.to)).toEqual([a.email]);
    expect(await otpRows(a.userId)).toHaveLength(1);
  });

  it('a second request while a code is pending, and a mail outage, are still the same 202', async () => {
    const a = await account();
    const first = await request(a.email);
    await __settleRecoveryBackgroundForTests();
    const second = await request(a.email);
    await __settleRecoveryBackgroundForTests();
    expect(second.text).toBe(first.text);
    expect(net.mails.filter((m) => m.to === a.email)).toHaveLength(1);

    const b = await account();
    net.failMail = true;
    const outage = await request(b.email);
    await __settleRecoveryBackgroundForTests();
    expect(outage.status).toBe(202);
    expect(outage.text).toBe(first.text);
    // The undelivered code was retired, so a retry after the outage works.
    net.failMail = false;
    await request(b.email);
    await __settleRecoveryBackgroundForTests();
    expect(net.lastCodeFor(b.email)).toMatch(/^\d{6}$/);
  });

  it('normalises case and whitespace (the same account), and refuses non-addresses with the same 422 for everyone', async () => {
    const a = await account('mixed.case@example.test');
    expect((await request('  Mixed.Case@Example.TEST ')).status).toBe(202);
    await __settleRecoveryBackgroundForTests();
    expect(net.mails.map((m) => m.to)).toEqual([a.email]);

    for (const bad of ['', 'nope', 'a@b', '@x.y', 'a b@c.de', 'a@b@c.de', 'x\u0000@y.zz', 5, null, ['a@b.cc'], { email: 'a@b.cc' }]) {
      const res = await call('/api/auth/recovery/request', { email: bad });
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await call('/api/auth/recovery/request', {})).status).toBe(422);
    expect((await reqWith(envBase)('POST', '/api/auth/recovery/request', { body: '{not json' })).status).toBeGreaterThanOrEqual(400);
  });

  it('works without any Authorization header, and ignores a bogus one', async () => {
    const a = await account();
    expect((await request(a.email)).status).toBe(202);
    const res = await reqWith(envBase)('POST', '/api/auth/recovery/request', {
      body: { email: a.email },
      headers: { Authorization: 'Bearer garbage' },
    });
    expect(res.status).toBe(202);
  });

  it('latency does not tell an existing account from an unknown one (medians within tolerance)', async () => {
    const N = 25;
    const known: number[] = [];
    const unknown: number[] = [];
    const accounts = [];
    for (let i = 0; i < N; i++) accounts.push(await account());
    // warm up the pool and the module graph
    await request(`warm-${process.pid}@example.test`);
    for (let i = 0; i < N; i++) {
      let t = performance.now();
      await request(accounts[i]!.email);
      known.push(performance.now() - t);
      await __settleRecoveryBackgroundForTests();
      t = performance.now();
      await request(`ghost${i}-${process.pid}@example.test`);
      unknown.push(performance.now() - t);
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
    expect(Math.abs(median(known) - median(unknown))).toBeLessThan(20);
  });

  it('recovery not configured (no client secret): 503 try_again_later for every address alike, nothing mailed', async () => {
    const a = await account();
    const off = makeEnv(dbUrl, { ENVIRONMENT: 'development' });
    const r1 = await request(a.email, off);
    const r2 = await request('who@example.test', off);
    expect(r1.status).toBe(503);
    expect(r1.text).toBe(r2.text);
    expect(r1.body).toEqual({ success: false, error: 'try_again_later', code: 'service_unavailable' });
    expect(net.mails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// confirm: happy path and Keycloak interaction
// ---------------------------------------------------------------------------

describe('POST /api/auth/recovery/confirm', () => {
  it('request → code → confirm: sets the password via the Admin API, marks the e-mail verified, spends the code', async () => {
    const a = await account();
    const code = await issue(a.email);
    const res = await confirm(a.email, code);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // Exactly: token, find by exact e-mail, reset-password.
    expect(kc.calls.map((c) => `${c.method} ${c.url.replace(ADMIN_BASE, '')}`)).toEqual([
      'POST /realms/japan-trip/protocol/openid-connect/token',
      `GET /admin/realms/japan-trip/users?email=${encodeURIComponent(a.email)}&exact=true&max=5`,
      `PUT /admin/realms/japan-trip/users/${a.kcId}/reset-password`,
      // Never-verified account: credentials other than the password are purged.
      `GET /admin/realms/japan-trip/users/${a.kcId}/credentials`,
      `POST /admin/realms/japan-trip/users/${a.kcId}/logout`,
    ]);
    const form = new URLSearchParams(kc.calls[0]!.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'travelmap-recovery',
      client_secret: SECRET,
    });
    expect(kc.passwordSets).toEqual([
      { id: a.kcId, body: { type: 'password', value: NEW_PASSWORD, temporary: false } },
    ]);

    expect((await userRow(a.userId)).email_verified_at).toBeInstanceOf(Date);
    const rows = await otpRows(a.userId);
    expect(rows[0]!.used_at).not.toBeNull();
    // Replay of the same code: refused, Keycloak untouched.
    const before = kc.calls.length;
    expect((await confirm(a.email, code)).status).toBe(400);
    expect(kc.calls.length).toBe(before);
  });

  it('after recovery the (still "unverified" token of the) account passes the verified-email gate', async () => {
    const u = await makeUser(signer, { email_verified: false });
    await sql(dbUrl, `insert into users (keycloak_id, email, name) values ($1,$2,'R')`, [u.sub, u.email]);
    kc.users.push({ id: uuid(), email: u.email, enabled: true });
    const strict = { ...envBase, REQUIRE_VERIFIED_EMAIL: 'true' } as Env;
    const api = client(strict);
    expect((await api('GET', '/api/trips', { token: u.token })).status).toBe(403);
    const code = await issue(u.email);
    expect((await confirm(u.email, code)).status).toBe(200);
    expect((await api('GET', '/api/trips', { token: u.token })).status).toBe(200);
  });

  it('uses KEYCLOAK_URL when KEYCLOAK_ADMIN_URL is unset, a custom client id, and tolerates trailing slashes / a path prefix', async () => {
    const a = await account();
    kc.base = 'http://kc.test';
    const env = makeEnv(dbUrl, {
      ENVIRONMENT: 'development',
      KEYCLOAK_RECOVERY_CLIENT_SECRET: SECRET,
      KEYCLOAK_RECOVERY_CLIENT_ID: 'custom-recovery',
    });
    const code = await issue(a.email);
    expect((await confirm(a.email, code, NEW_PASSWORD, env)).status).toBe(200);
    expect(new URLSearchParams(kc.calls[0]!.body).get('client_id')).toBe('custom-recovery');

    const b = await account();
    kc.base = 'http://kc.test/auth';
    kc.calls.length = 0;
    const withPrefix = makeEnv(dbUrl, {
      ENVIRONMENT: 'development',
      KEYCLOAK_RECOVERY_CLIENT_SECRET: SECRET,
      KEYCLOAK_ADMIN_URL: 'http://kc.test/auth///',
    });
    const code2 = await issue(b.email);
    expect((await confirm(b.email, code2, NEW_PASSWORD, withPrefix)).status).toBe(200);
    expect(kc.calls[0]!.url).toBe('http://kc.test/auth/realms/japan-trip/protocol/openid-connect/token');
  });

  it('only the account behind the code is changed: the wrong e-mail, an unknown e-mail and a wrong code are one indistinguishable 400', async () => {
    const a = await account();
    const b = await account();
    const code = await issue(a.email);
    const good = await confirm(a.email, wrong(code));
    const otherAccount = await confirm(b.email, code); // b has no pending code at all
    const unknown = await confirm(`ghost-${process.pid}@example.test`, code);
    for (const r of [good, otherAccount, unknown]) {
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ success: false, error: 'invalid_code' });
    }
    expect(good.text).toBe(unknown.text);
    expect(otherAccount.text).toBe(unknown.text);
    expect(kc.passwordSets).toEqual([]);
    // b's own request does not make a's code valid for b.
    const bCode = await issue(b.email);
    expect((await confirm(b.email, code === bCode ? wrong(code) : code)).status).toBe(400);
    expect(kc.passwordSets).toEqual([]);
  });

  it('a login or e-mail-verification code can not recover an account', async () => {
    const a = await account();
    for (const purpose of ['login', 'email_verify']) {
      await sql(
        dbUrl,
        `insert into email_otp_codes (user_id, code_hash, purpose, expires_at) values ($1, $2, $3, now() + interval '5 minutes')`,
        [a.userId, 'x'.repeat(44), purpose],
      );
    }
    expect((await confirm(a.email, '123456')).status).toBe(400);
    expect(kc.calls).toEqual([]);
  });

  it('expired code → 400 and Keycloak untouched', async () => {
    const a = await account();
    const code = await issue(a.email);
    await sql(dbUrl, `update email_otp_codes set expires_at = now() - interval '1 second' where user_id=$1`, [a.userId]);
    expect((await confirm(a.email, code)).status).toBe(400);
    expect(kc.calls).toEqual([]);
  });

  it('brute force: 50 parallel guesses evaluate at most 5, then the code is dead (even the right one)', async () => {
    const a = await account();
    const code = await issue(a.email);
    const results = await Promise.all(Array.from({ length: 50 }, () => confirm(a.email, wrong(code))));
    expect(results.every((r) => r.status === 400 && r.text === results[0]!.text)).toBe(true);
    expect((await otpRows(a.userId))[0]!.attempts).toBeLessThanOrEqual(5);
    expect((await confirm(a.email, code)).status).toBe(400);
    expect(kc.calls).toEqual([]);
    expect((await userRow(a.userId)).email_verified_at).toBeNull();
  });

  it('5 parallel confirms with the right code: exactly one succeeds and Keycloak is called once', async () => {
    const a = await account();
    const code = await issue(a.email);
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(a.email, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 400)).toBe(true);
    expect(kc.passwordSets).toHaveLength(1);
  });

  it('50 parallel confirms with the right code: never more than one success, never more than one reset', async () => {
    const a = await account();
    const code = await issue(a.email);
    const results = await Promise.all(Array.from({ length: 50 }, () => confirm(a.email, code)));
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(kc.passwordSets.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// confirm: password policy
// ---------------------------------------------------------------------------

describe('password policy (enforced before Keycloak, without burning a guess)', () => {
  const email = 'policy.user@example.test';
  const cases: [string, string, string][] = [
    ['11 characters', 'a'.repeat(11), 'too_short'],
    ['empty', '', 'too_short'],
    ['129 characters', 'a'.repeat(129), 'too_long'],
    ['2 000 characters', 'a'.repeat(2000), 'too_long'],
    ['NUL inside', 'valid password\u0000tail', 'contains_nul'],
    ['only NUL bytes', '\u0000'.repeat(20), 'contains_nul'],
    ['whitespace only', ' '.repeat(14), 'blank'],
    ['equal to the e-mail', email, 'matches_email'],
    ['the e-mail in other case', email.toUpperCase(), 'matches_email'],
    ['e-mail with a prefix', `x-${email}`, 'matches_email'],
    ['contained in the e-mail', 'policy.user@e', 'matches_email'],
    ['full-width look-alike of the e-mail', 'ｐｏｌｉｃｙ．ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｔｅｓｔ', 'matches_email'],
    ['11 emoji (code points, not UTF-16 units)', '😀'.repeat(11), 'too_short'],
    ['129 emoji', '😀'.repeat(129), 'too_long'],
  ];
  it.each(cases)('%s → 422 weak_password/%s', async (_n, password, reason) => {
    const a = await account(email);
    const code = await issue(a.email);
    const res = await confirm(a.email, code, password);
    // The 2 000-char case passes the size bound of the schema; anything bigger is a plain 422 validation error.
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, error: 'weak_password', code: 'weak_password', reason });
    expect(kc.calls).toEqual([]);
    expect((await otpRows(a.userId))[0]!.attempts).toBe(0);
    // The code survives a rejected password.
    expect((await confirm(a.email, code)).status).toBe(200);
  });

  it.each([
    ['exactly 12 characters', 'abcdefghijkl'],
    ['exactly 128 characters', 'p'.repeat(128)],
    ['12 emoji', '😀'.repeat(12)],
    ['128 emoji', '😀'.repeat(128)],
    ['accents and combining marks', 'Ünïcödé-pässwörd-é'],
    ['CJK', '日本語のパスワードです長い'],
    ['spaces inside', 'correct horse battery'],
    ['quotes, backslashes and JSON-ish text', '"\\{}[],\' pass\\u0000word'],
  ])('accepted and passed to Keycloak byte for byte: %s', async (_n, password) => {
    const a = await account();
    const code = await issue(a.email);
    expect((await confirm(a.email, code, password)).status).toBe(200);
    expect(kc.passwordSets[0]!.body['value']).toBe(password);
  });

  it('a 1 MB password is refused as a validation error, with no work done', async () => {
    const a = await account();
    const code = await issue(a.email);
    const res = await confirm(a.email, code, 'p'.repeat(1_000_000));
    expect(res.status).toBe(422);
    expect(kc.calls).toEqual([]);
    expect((await otpRows(a.userId))[0]!.attempts).toBe(0);
  });

  it('non-string passwords and missing fields are validation errors', async () => {
    const a = await account();
    for (const bad of [123456789012, null, ['x'.repeat(12)], { a: 1 }, undefined]) {
      const res = await call('/api/auth/recovery/confirm', { email: a.email, code: '123456', new_password: bad });
      expect(res.status).toBe(422);
    }
  });

  it('the password policy answer does not depend on whether the account exists', async () => {
    const a = await account('real.user@example.test');
    const known = await confirm(a.email, '123456', 'short');
    const unknown = await confirm('nobody.here@example.test', '123456', 'short');
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });
});

// ---------------------------------------------------------------------------
// confirm: Keycloak failures
// ---------------------------------------------------------------------------

describe('Keycloak Admin API failures', () => {
  const UNAVAILABLE = { success: false, error: 'try_again_later', code: 'service_unavailable' };

  async function attempt(setup: (a: { email: string; kcId: string }) => void) {
    const a = await account();
    setup(a);
    const code = await issue(a.email);
    const res = await confirm(a.email, code);
    return { a, code, res };
  }

  it.each([
    ['token endpoint 401 (rotated secret)', () => (kc.token = '401')],
    ['token endpoint 403', () => (kc.token = '403')],
    ['token endpoint 500', () => (kc.token = '500')],
    ['token endpoint unparseable', () => (kc.token = 'garbage')],
    ['token endpoint unreachable', () => (kc.token = 'throw')],
    ['user search 401', () => (kc.find = '401')],
    ['user search 403 (missing view-users)', () => (kc.find = '403')],
    ['user search 500', () => (kc.find = '500')],
    ['user search unparseable', () => (kc.find = 'garbage')],
    ['user search unreachable', () => (kc.find = 'throw')],
    ['reset 401', () => (kc.reset = '401')],
    ['reset 403 (missing manage-users)', () => (kc.reset = '403')],
    ['reset 500', () => (kc.reset = '500')],
    ['reset 503', () => (kc.reset = '503')],
    ['reset unreachable', () => (kc.reset = 'throw')],
  ])('%s → generic 503, nothing leaked, the code is given back and the retry succeeds', async (_n, setup) => {
    const { a, code, res } = await attempt(() => setup());
    expect(res.status).toBe(503);
    expect(res.body).toEqual(UNAVAILABLE);
    expect(res.text).not.toMatch(/keycloak|secret|token|do-not-leak|svc-token|travelmap-recovery/i);
    expect((await userRow(a.userId)).email_verified_at).toBeNull();
    expect(kc.passwordSets).toEqual([]);
    // Back to normal: the same code still works.
    kc.token = kc.find = kc.reset = 'ok';
    expect((await confirm(a.email, code)).status).toBe(200);
    expect(kc.passwordSets).toHaveLength(1);
  });

  it.each([
    ['token', () => (kc.token = 'hang')],
    ['user search', () => (kc.find = 'hang')],
    ['reset', () => (kc.reset = 'hang')],
  ])('a hanging %s call times out → generic 503 (not a hung request)', async (_n, setup) => {
    __setKeycloakAdminTimeoutForTests(60);
    const started = performance.now();
    const { res } = await attempt(() => setup());
    expect(res.status).toBe(503);
    expect(res.body).toEqual(UNAVAILABLE);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('user not in Keycloak → 422 recovery_unavailable (code spent), password never set', async () => {
    const a = await account(undefined, { kcUser: false });
    const code = await issue(a.email);
    const res = await confirm(a.email, code);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ success: false, error: 'recovery_unavailable', code: 'recovery_unavailable' });
    expect(kc.passwordSets).toEqual([]);
    expect((await userRow(a.userId)).email_verified_at).toBeNull();
    expect((await confirm(a.email, code)).status).toBe(400);
  });

  it('two Keycloak users with that e-mail → refused (never guess), no password set', async () => {
    const a = await account();
    kc.users.push({ id: uuid(), email: a.email.toUpperCase(), enabled: true });
    const code = await issue(a.email);
    const res = await confirm(a.email, code);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'recovery_unavailable' });
    expect(kc.passwordSets).toEqual([]);
  });

  it('a disabled Keycloak user is not recoverable; a near-match returned by the search is ignored', async () => {
    const a = await account(undefined, { kcUser: false });
    kc.users.push({ id: uuid(), email: a.email, enabled: false });
    const code = await issue(a.email);
    expect((await confirm(a.email, code)).body).toMatchObject({ error: 'recovery_unavailable' });

    const b = await account(undefined, { kcUser: false });
    // A search that returns somebody else (substring match in an old Keycloak) must not be acted on.
    kc.users.push({ id: uuid(), email: `x${b.email}`, enabled: true });
    const orig = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/users\?/.test(url)) {
        return new Response(JSON.stringify([{ id: uuid(), email: `x${b.email}`, enabled: true }]), { status: 200 });
      }
      return orig(input, init);
    });
    const code2 = await issue(b.email);
    expect((await confirm(b.email, code2)).body).toMatchObject({ error: 'recovery_unavailable' });
    expect(kc.passwordSets).toEqual([]);
  });

  it('a malicious Keycloak user id never reaches the URL path', async () => {
    const a = await account(undefined, { kcUser: false });
    kc.users.push({ id: '../../master/users/x', email: a.email, enabled: true });
    const code = await issue(a.email);
    expect((await confirm(a.email, code)).body).toMatchObject({ error: 'recovery_unavailable' });
    expect(kc.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it("Keycloak's own policy refusing the password (400) → 422 weak_password/rejected, code given back", async () => {
    const a = await account();
    kc.reset = '400';
    const code = await issue(a.email);
    const res = await confirm(a.email, code, 'Password1234!');
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: 'weak_password', reason: 'rejected' });
    expect(res.text).not.toContain('do-not-leak');
    kc.reset = 'ok';
    expect((await confirm(a.email, code, 'a-different-longer-password')).status).toBe(200);
  });

  it('not configured → weak passwords are still 422 (no account needed), anything else is the generic 503', async () => {
    const a = await account();
    const code = await issue(a.email);
    const off = makeEnv(dbUrl, { ENVIRONMENT: 'development' });
    expect((await confirm(a.email, code, 'short', off)).status).toBe(422);
    const res = await confirm(a.email, code, NEW_PASSWORD, off);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(UNAVAILABLE);
    // Nothing was spent: it works once configured.
    expect((await confirm(a.email, code)).status).toBe(200);
  });
});

describe('after the password is set', () => {
  it('removes the pending passkey-enrolment required action (and only that one)', async () => {
    const a = await account();
    const user = kc.users.find((u) => u.id === a.kcId)!;
    user.requiredActions = ['webauthn-register-passwordless', 'UPDATE_PROFILE'];
    const code = await issue(a.email);
    expect((await confirm(a.email, code)).status).toBe(200);
    expect(user.requiredActions).toEqual(['UPDATE_PROFILE']);
  });

  it('unverified (squatting) account: other credentials are deleted, the password kept, sessions ended', async () => {
    const a = await account(); // email_verified_at is NULL
    const user = kc.users.find((u) => u.id === a.kcId)!;
    user.credentials = [
      { id: uuid(), type: 'password' },
      { id: uuid(), type: 'webauthn-passwordless' },
      { id: uuid(), type: 'webauthn' },
    ];
    const code = await issue(a.email);
    expect((await confirm(a.email, code)).status).toBe(200);
    expect(user.credentials.map((c) => c.type)).toEqual(['password']);
    expect(kc.loggedOut).toEqual([a.kcId]);
  });

  it('a verified account keeps its passkeys and sessions', async () => {
    const a = await account();
    await sql(dbUrl, `update users set email_verified_at = now() where id = $1`, [a.userId]);
    const user = kc.users.find((u) => u.id === a.kcId)!;
    user.credentials = [{ id: uuid(), type: 'webauthn-passwordless' }];
    const code = await issue(a.email);
    expect((await confirm(a.email, code)).status).toBe(200);
    expect(user.credentials).toHaveLength(1);
    expect(kc.loggedOut).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

describe('log hygiene', () => {
  it('no code, password, e-mail, client secret or Keycloak token appears in any log line, success or failure', async () => {
    const a = await account();
    const code = await issue(a.email);
    kc.reset = '500';
    await confirm(a.email, code); // failure path
    kc.reset = 'ok';
    kc.token = '401';
    await confirm(a.email, code);
    kc.token = 'ok';
    const distinctive = 'zQ9-distinct-password-value';
    expect((await confirm(a.email, code, distinctive)).status).toBe(200);
    await confirm(a.email, wrong(code), distinctive);
    await confirm('ghost@example.test', code, distinctive);
    await request('ghost@example.test');
    net.failMail = true;
    const b = await account();
    await request(b.email);
    await __settleRecoveryBackgroundForTests();

    const all = logLines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [code, distinctive, NEW_PASSWORD, SECRET, 'svc-token-abc', a.email, b.email, 'ghost@example.test']) {
      expect(all, `log leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

describe('rate limits (no oracle: the same buckets for known and unknown addresses)', () => {
  beforeEach(() => {
    __setRateLimitingEnabledForTests(true);
    __resetRateLimitsForTests();
  });
  const from = (peer: string, extra: Record<string, string> = {}) =>
    ({ ...makeEnv(dbUrl, { ENVIRONMENT: 'development', KEYCLOAK_RECOVERY_CLIENT_SECRET: SECRET, KEYCLOAK_ADMIN_URL: ADMIN_BASE, ...extra }), incoming: { socket: { remoteAddress: peer } } }) as unknown as Env;

  it('request, per address: the 4th within the window is 429 for an existing and for an unknown address alike', async () => {
    const known = await account();
    const env = from('203.0.113.70');
    const ghost = `ghost-${process.pid}@example.test`;
    for (const email of [known.email, ghost]) {
      const statuses: number[] = [];
      for (let i = 0; i < POLICIES.recoveryRequestPerEmail.limit + 2; i++) {
        statuses.push((await request(i % 2 ? email.toUpperCase() : ` ${email}`, env)).status);
      }
      expect(statuses).toEqual([202, 202, 202, 429, 429]);
    }
  });

  it('request, per IP: rotating addresses from one peer is capped; spoofed forwarding headers do not help', async () => {
    const env = from('203.0.113.71');
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.recoveryRequestPerIp.limit + 4; i++) {
      statuses.push(
        (await request(`rot${i}-${process.pid}@example.test`, env, {
          'X-Forwarded-For': `198.51.100.${i}`,
          'X-Real-IP': `198.51.100.${i}`,
          'CF-Connecting-IP': `198.51.100.${i}`,
        })).status,
      );
    }
    expect(statuses.filter((s) => s === 202)).toHaveLength(POLICIES.recoveryRequestPerIp.limit);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    expect((await request('fresh@example.test', from('203.0.113.72'))).status).toBe(202);
  });

  it('request, behind a trusted proxy: the client entry of X-Forwarded-For is the bucket, left entries are ignored', async () => {
    const env = from('10.0.0.9', { TRUSTED_PROXY_HOPS: '1' });
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.recoveryRequestPerIp.limit + 2; i++) {
      statuses.push(
        (await request(`hop${i}-${process.pid}@example.test`, env, { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.73` })).status,
      );
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  it('request, global ceiling: exhausted by many peers, then everyone gets 429 until the window passes', async () => {
    let now = 1_000_000_000_000;
    __resetRateLimitsForTests({ now: () => now });
    let ok = 0;
    for (let i = 0; i < POLICIES.recoveryRequestGlobal.limit + 3; i++) {
      const peer = `192.0.2.${(i % 250) + 1}`;
      // Fresh peer+address each time: only the global bucket can refuse.
      const res = await request(`g${i}-${process.pid}@example.test`, from(`${peer}`, { }), { });
      if (res.status === 202) ok++;
      if (i % 5 === 4) now += 1; // stay inside one window
      if (i % 9 === 8) await __settleRecoveryBackgroundForTests();
    }
    expect(ok).toBeLessThanOrEqual(POLICIES.recoveryRequestGlobal.limit + 1);
    expect(ok).toBeGreaterThanOrEqual(POLICIES.recoveryRequestGlobal.limit - 1);
    expect((await request('after@example.test', from('198.18.0.1'))).status).toBe(429);
    now += 2 * 60 * 60 * 1000;
    expect((await request('later@example.test', from('198.18.0.2'))).status).toBe(202);
  }, 60_000);

  it('confirm, per address: guesses are cut off at the budget for known and unknown addresses alike', async () => {
    const known = await account();
    const run = async (email: string, env: Env) => {
      const out: number[] = [];
      for (let i = 0; i < POLICIES.recoveryConfirmPerEmail.limit + 2; i++) out.push((await confirm(email, '000000', NEW_PASSWORD, env)).status);
      return out;
    };
    const a = await run(known.email, from('203.0.113.77'));
    const b = await run(`nobody-${process.pid}@example.test`, from('203.0.113.78'));
    expect(a).toEqual(b);
    expect(a.slice(-2)).toEqual([429, 429]);
    expect(a.filter((s) => s === 400)).toHaveLength(POLICIES.recoveryConfirmPerEmail.limit);
  });

  it('confirm, per IP', async () => {
    const env = from('203.0.113.75');
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.recoveryConfirmPerIp.limit + 2; i++) {
      statuses.push((await confirm(`x${i}-${process.pid}@example.test`, '000000', NEW_PASSWORD, env)).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  it('a 429 carries Retry-After and the generic rate_limited body, not account information', async () => {
    const env = from('203.0.113.76');
    const email = `rl-${process.pid}@example.test`;
    for (let i = 0; i < POLICIES.recoveryRequestPerEmail.limit; i++) await request(email, env);
    const res = await request(email, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(res.body).toMatchObject({ success: false, error: 'rate_limited' });
  });
});

describe('route table', () => {
  it('the recovery endpoints are the only unauthenticated /api/auth routes', () => {
    const unauth = app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/auth/recovery/'))
      .map((r) => `${r.method} ${r.path}`);
    expect([...new Set(unauth)].sort()).toEqual(['POST /api/auth/recovery/confirm', 'POST /api/auth/recovery/request']);
  });
});
