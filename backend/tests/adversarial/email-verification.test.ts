/**
 * Adversarial: sign-up e-mail verification and the REQUIRE_VERIFIED_EMAIL gate
 * on the real app (real JWT verification, real Postgres).
 *
 * The route table is enumerated from the app itself, so a route added later
 * without the gate fails here instead of shipping open to unverified accounts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import {
  POLICIES,
  __resetRateLimitsForTests,
  __setRateLimitingEnabledForTests,
} from '../../src/middleware/rate-limit';
import {
  client,
  createSigner,
  createTestDatabase,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  sql,
  type FakeNetwork,
  type Req,
  type Signer,
  type TestUser,
} from './harness';
import type { Env } from '../../src/types';

let dbUrl: string;
let signer: Signer;
let net: FakeNetwork;
let req: Req;
let env: Env;

const REQUIRE = { ENVIRONMENT: 'development', REQUIRE_VERIFIED_EMAIL: 'true' };

beforeAll(async () => {
  signer = await createSigner();
  dbUrl = await createTestDatabase('emailverify');
  env = makeEnv(dbUrl, REQUIRE);
  req = client(env);
}, 60_000);
afterAll(async () => {
  await dropTestDatabase(dbUrl);
});
beforeEach(() => {
  net = installFakeNetwork([signer]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const unverified = (claim: unknown = false) => makeUser(signer, { email_verified: claim });
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

/** Authenticated routes an unverified account must still reach. */
const ALLOWED_FOR_UNVERIFIED = new Set([
  'GET /api/users/me',
  'PATCH /api/users/me',
  'POST /api/auth/email-verify/request',
  'POST /api/auth/email-verify/confirm',
]);
/** Not authenticated routes: the gate does not apply. */
const NOT_AUTHENTICATED = (path: string) =>
  path === '/' || path === '/api/health' || path.startsWith('/api/health/') || path.startsWith('/api/public/') ||
  path.startsWith('/api/auth/recovery/');

function concretePath(path: string): string {
  return path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, '1');
}

function routeTable() {
  const seen = new Set<string>();
  const out: { method: string; template: string; path: string }[] = [];
  for (const r of app.routes) {
    if (r.method === 'ALL' || r.path.includes('*')) continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, template: r.path, path: concretePath(r.path) });
  }
  return out;
}

describe('every authenticated route is gated (table-driven over app.routes)', () => {
  const table = routeTable();
  const authenticated = table.filter((r) => !NOT_AUTHENTICATED(r.template));

  it('the table is not empty and covers trips, hotels, days, activities, geocode, users and auth', () => {
    const joined = authenticated.map((r) => `${r.method} ${r.template}`).join('\n');
    for (const needle of ['/api/trips', '/hotel', '/days', '/activities', '/api/geocode', '/api/users/me/trips', '/api/auth/otp-request', '/api/auth/otp-verify']) {
      expect(joined).toContain(needle);
    }
    expect(authenticated.length).toBeGreaterThan(20);
    for (const key of ALLOWED_FOR_UNVERIFIED) expect(authenticated.map((r) => `${r.method} ${r.template}`)).toContain(key);
  });

  it.each(authenticated.map((r) => [`${r.method} ${r.template}`, r] as const))(
    '%s',
    async (key, r) => {
      const u = await unverified();
      const res = await req(r.method, r.path, { token: u.token, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      if (ALLOWED_FOR_UNVERIFIED.has(key)) {
        expect(res.status, res.text).not.toBe(403);
        expect(res.status).not.toBe(401);
      } else {
        expect(res.status, res.text).toBe(403);
        expect(res.body).toEqual({ success: false, error: 'email_not_verified', code: 'email_not_verified' });
      }
    },
  );

  it.each(authenticated.filter((r) => !ALLOWED_FOR_UNVERIFIED.has(`${r.method} ${r.template}`)).map((r) => [`${r.method} ${r.template}`, r] as const))(
    '%s still answers 401 (not 403) without a token',
    async (_key, r) => {
      const res = await req(r.method, r.path);
      expect(res.status).toBe(401);
    },
  );

  it('public and health routes are unaffected', async () => {
    expect((await req('GET', '/api/health')).status).toBe(200);
    expect((await req('GET', '/api/public/trips/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('writes by an unverified account change nothing (trip create → 403, no row)', async () => {
    const u = await unverified();
    expect((await req('POST', '/api/trips', { token: u.token, body: { name: 'sneaky' } })).status).toBe(403);
    expect(await sql(dbUrl, `select 1 from trips where name = 'sneaky'`)).toEqual([]);
  });
});

describe('what counts as verified', () => {
  it.each([
    ['boolean false', false],
    ['string "true"', 'true'],
    ['string "false"', 'false'],
    ['number 1', 1],
    ['null', null],
    ['object', {}],
    ['array', [true]],
  ])('token claim %s → 403 on /api/trips', async (_n, claim) => {
    const u = await unverified(claim);
    expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(403);
  });

  it('token without the claim → 403', async () => {
    const u = await makeUser(signer);
    // makeUser spreads overrides after the default; re-sign without the claim.
    const now = Math.floor(Date.now() / 1000);
    const token = await signer.sign({
      sub: u.sub,
      iss: 'http://kc.test/realms/japan-trip',
      aud: 'japan-trip-frontend',
      typ: 'Bearer',
      azp: 'japan-trip-frontend',
      email: u.email,
      name: 'x',
      preferred_username: 'x',
      iat: now,
      exp: now + 600,
    });
    expect((await req('GET', '/api/trips', { token })).status).toBe(403);
  });

  it('token email_verified === true → 200 (no DB flag needed)', async () => {
    const u = await makeUser(signer, { email_verified: true });
    expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(200);
  });

  it('users.email_verified_at set → 200 even though the token says false', async () => {
    const u = await unverified();
    expect((await req('GET', '/api/users/me', { token: u.token })).status).toBe(201);
    await sql(dbUrl, `update users set email_verified_at = now() where keycloak_id = $1`, [u.sub]);
    expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(200);
  });

  it('REQUIRE_VERIFIED_EMAIL=false lets unverified accounts through', async () => {
    const open = client(makeEnv(dbUrl, { ENVIRONMENT: 'development', REQUIRE_VERIFIED_EMAIL: 'false' }));
    const u = await unverified();
    expect((await open('GET', '/api/trips', { token: u.token })).status).toBe(200);
  });

  it('production default: unverified is blocked when REQUIRE_VERIFIED_EMAIL is not set', async () => {
    const prod = client(makeEnv(dbUrl, { ENVIRONMENT: 'production', RESEND_API_KEY: 're_x' }));
    const u = await unverified();
    expect((await prod('GET', '/api/trips', { token: u.token })).status).toBe(403);
    expect([200, 201]).toContain((await prod('GET', '/api/users/me', { token: u.token })).status);
  });
});

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

async function startVerification(u: TestUser) {
  const res = await req('POST', '/api/auth/email-verify/request', { token: u.token });
  expect(res.status, res.text).toBe(201);
  const code = net.lastCodeFor(u.email)!;
  expect(code).toMatch(/^\d{6}$/);
  return code;
}
const confirm = (u: TestUser, code: unknown) => req('POST', '/api/auth/email-verify/confirm', { token: u.token, body: { code } });

describe('verification flow', () => {
  it('request → confirm → the very same token now passes the gate', async () => {
    const u = await unverified();
    expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(403);
    const code = await startVerification(u);
    expect((await confirm(u, code)).status).toBe(200);
    expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(200);
    const me = await req('GET', '/api/users/me', { token: u.token });
    expect(me.body.data.email_verified).toBe(true);
  });

  it('the mail goes to the token address only (never to a body-supplied one)', async () => {
    const u = await unverified();
    const res = await req('POST', '/api/auth/email-verify/request', { token: u.token, body: { email: 'victim@example.test' } });
    expect(res.status).toBe(201);
    expect(net.mails.map((m) => m.to)).toEqual([u.email]);
  });

  it('parallel confirms with the right code → never more than one 200 (5 parallel: exactly one)', async () => {
    const u = await unverified();
    const code = await startVerification(u);
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(u, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 400 || r.status === 429)).toBe(true);

    // 50 in flight: every request spends an attempt (SEC-07), so the winner is
    // not guaranteed - but a second success is impossible.
    const v = await unverified();
    const code2 = await startVerification(v);
    const many = await Promise.all(Array.from({ length: 50 }, () => confirm(v, code2)));
    expect(many.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    const rows = await sql<{ n: number }>(dbUrl, `select count(*)::int as n from users where keycloak_id=$1 and email_verified_at is not null`, [v.sub]);
    expect(rows[0]!.n).toBe(many.some((r) => r.status === 200) ? 1 : 0);
  });

  it('50 parallel wrong guesses evaluate at most 5 and then burn the code (right code dead too)', async () => {
    const u = await unverified();
    const code = await startVerification(u);
    const results = await Promise.all(Array.from({ length: 50 }, () => confirm(u, wrong(code))));
    expect(results.filter((r) => r.status === 400 && r.body.error === 'invalid_code').length).toBeLessThanOrEqual(5);
    const rows = await sql<{ attempts: number }>(
      dbUrl,
      `select o.attempts from email_otp_codes o join users x on x.id=o.user_id where x.keycloak_id=$1 and o.purpose='email_verify'`,
      [u.sub],
    );
    expect(rows[0]!.attempts).toBeLessThanOrEqual(5);
    expect([400, 429]).toContain((await confirm(u, code)).status);
    const stillUnverified = await sql(dbUrl, `select 1 from users where keycloak_id=$1 and email_verified_at is null`, [u.sub]);
    expect(stillUnverified).toHaveLength(1);
  });

  it('replay and expiry', async () => {
    const u = await unverified();
    const code = await startVerification(u);
    expect((await confirm(u, code)).status).toBe(200);
    expect((await confirm(u, code)).status).toBe(400);

    const v = await unverified();
    const code2 = await startVerification(v);
    await sql(dbUrl, `update email_otp_codes set expires_at = now() - interval '1 second' where user_id = (select id from users where keycloak_id=$1)`, [v.sub]);
    expect((await confirm(v, code2)).body.error).toBe('otp_not_found');
  });

  it("user A's code does not verify user B (wrong user)", async () => {
    const a = await unverified();
    const b = await unverified();
    const aCode = await startVerification(a);
    await req('GET', '/api/users/me', { token: b.token });
    expect((await confirm(b, aCode)).status).toBe(400);
    expect((await req('GET', '/api/trips', { token: b.token })).status).toBe(403);
  });

  it('a recovery-purpose or login-purpose code cannot verify the e-mail', async () => {
    const u = await unverified();
    await req('GET', '/api/users/me', { token: u.token });
    for (const purpose of ['login', 'recovery']) {
      await sql(
        dbUrl,
        `insert into email_otp_codes (user_id, code_hash, purpose, expires_at)
         select id, $2, $3, now() + interval '5 minutes' from users where keycloak_id=$1`,
        [u.sub, 'x'.repeat(44), purpose],
      );
      expect((await confirm(u, '123456')).body.error).toBe('otp_not_found');
    }
  });

  it('unauthenticated and forged tokens cannot reach either endpoint', async () => {
    expect((await req('POST', '/api/auth/email-verify/request')).status).toBe(401);
    expect((await req('POST', '/api/auth/email-verify/confirm', { body: { code: '123456' } })).status).toBe(401);
    expect((await req('POST', '/api/auth/email-verify/request', { token: 'a.b.c' })).status).toBe(401);
    expect(net.mails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

describe('rate limits on the verification endpoints', () => {
  beforeEach(() => {
    __setRateLimitingEnabledForTests(true);
    __resetRateLimitsForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    __setRateLimitingEnabledForTests(false);
    vi.restoreAllMocks();
  });

  const from = (peer: string, extra: Record<string, string> = {}) =>
    client({ ...makeEnv(dbUrl, { ...REQUIRE, ...extra }), incoming: { socket: { remoteAddress: peer } } } as unknown as Env);

  it('per user: the request budget is spent, then 429 rate_limited with Retry-After', async () => {
    const u = await unverified();
    const r = from('203.0.113.50');
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.emailVerifyRequestPerUser.limit + 2; i++) {
      const res = await r('POST', '/api/auth/email-verify/request', { token: u.token });
      statuses.push(res.status);
      if (res.status === 429 && res.body.error === 'rate_limited') expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    }
    expect(statuses.slice(0, 1)).toEqual([201]);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1); // pending code blocks the rest
    expect(statuses.at(-1)).toBe(429);
    expect(net.mails.filter((m) => m.to === u.email)).toHaveLength(1);
  });

  it('per IP: rotating accounts from one address is capped; spoofed X-Forwarded-For does not help (hops=0)', async () => {
    const r = from('203.0.113.51');
    let ok = 0;
    for (let i = 0; i < POLICIES.emailVerifyRequestPerIp.limit + 5; i++) {
      const u = await unverified();
      const res = await r('POST', '/api/auth/email-verify/request', {
        token: u.token,
        headers: { 'X-Forwarded-For': `198.51.100.${i}`, 'X-Real-IP': `198.51.100.${i}`, 'CF-Connecting-IP': `198.51.100.${i}` },
      });
      if (res.status === 201) ok++;
      else expect(res.body.error).toBe('rate_limited');
    }
    expect(ok).toBe(POLICIES.emailVerifyRequestPerIp.limit);
    // A different peer is unaffected.
    const other = await unverified();
    expect((await from('203.0.113.52')('POST', '/api/auth/email-verify/request', { token: other.token })).status).toBe(201);
  });

  it('per IP behind a trusted proxy: the client entry of X-Forwarded-For is the bucket', async () => {
    const r = from('10.0.0.2', { TRUSTED_PROXY_HOPS: '1' });
    let ok = 0;
    for (let i = 0; i < POLICIES.emailVerifyRequestPerIp.limit + 3; i++) {
      const u = await unverified();
      const res = await r('POST', '/api/auth/email-verify/request', {
        token: u.token,
        // The left entries are client-controlled and must be ignored; the last one is ours.
        headers: { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.60` },
      });
      if (res.status === 201) ok++;
    }
    expect(ok).toBe(POLICIES.emailVerifyRequestPerIp.limit);
  });

  it('confirm: per-user budget stops brute force before the attempt cap is even needed', async () => {
    const u = await unverified();
    const r = from('203.0.113.53');
    await r('POST', '/api/auth/email-verify/request', { token: u.token });
    const code = net.lastCodeFor(u.email)!;
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.emailVerifyConfirmPerUser.limit + 3; i++) {
      statuses.push((await r('POST', '/api/auth/email-verify/confirm', { token: u.token, body: { code: wrong(code) } })).status);
    }
    // 5 real guesses, then the code is burned (429 max_attempts / 400 not_found);
    // the limiter itself only answers once the 15-per-window budget is spent.
    expect(statuses).toHaveLength(POLICIES.emailVerifyConfirmPerUser.limit + 3);
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, POLICIES.emailVerifyConfirmPerUser.limit)).not.toContain(200);
  });
});
