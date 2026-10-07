/**
 * Adversarial: scrape EVERYTHING the app writes to the console during real
 * failure paths on a real Postgres, and assert no personal data or secret
 * reaches a log line: email addresses, bearer tokens / JWTs, OTP codes, OTP
 * HMAC hashes, query strings, public share slugs.
 *
 * Failure paths are forced with triggers that raise inside INSERTs whose bound
 * parameters carry the email (users) or the OTP hash (otp_issue) — the exact
 * shape where Drizzle's "Failed query … params: …" message used to be logged
 * verbatim by the global error handler.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setMinLogLevel } from '../../src/observability/logger';
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
} from './harness';

let dbUrl: string;
let req: Req;
let signer: Signer;
let net: FakeNetwork;
let lines: string[];

function captureConsole() {
  lines = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : (() => {
        try {
          return JSON.stringify(a, Object.getOwnPropertyNames(a ?? {}));
        } catch {
          return String(a);
        }
      })())).join(' '));
    });
  }
}

/** Every secret a log line must never contain. */
function assertClean(secrets: string[]) {
  const all = lines.join('\n');
  expect(lines.length).toBeGreaterThan(0);
  for (const s of secrets) expect(all, `log leaked ${s.slice(0, 20)}…`).not.toContain(s);
  expect(all).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./);
  expect(all).not.toMatch(/\b[A-Za-z0-9+/]{43}=/); // OTP HMAC (base64 SHA-256)
  // Every line is one JSON object (structured logging).
  for (const l of lines) expect(() => JSON.parse(l), l.slice(0, 200)).not.toThrow();
}

beforeAll(async () => {
  dbUrl = await createTestDatabase('loghyg');
  signer = await createSigner();
  req = client(makeEnv(dbUrl, { ENVIRONMENT: 'development' }));
});

afterAll(async () => {
  await dropTestDatabase(dbUrl);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setMinLogLevel('warn');
  await sql(dbUrl, 'DROP TRIGGER IF EXISTS loghyg_users ON users');
  await sql(dbUrl, 'DROP TRIGGER IF EXISTS loghyg_otp ON email_otp_codes');
});

describe('log hygiene (no PII / secrets in logs)', () => {
  it('a failing user INSERT (params carry the email) logs no email and no token', async () => {
    net = installFakeNetwork([signer]);
    captureConsole();
    setMinLogLevel('debug');
    await sql(
      dbUrl,
      `CREATE OR REPLACE FUNCTION loghyg_fail() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'forced failure for %', NEW.email USING ERRCODE = 'XX001', DETAIL = 'row ' || NEW.email; END $$`,
    );
    await sql(dbUrl, 'CREATE TRIGGER loghyg_users BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION loghyg_fail()');
    const u = await makeUser(signer, { email: 'victim.person@example.org' });
    const res = await req('GET', '/api/users/me?email=victim.person@example.org&token=abc', { token: u.token });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('victim');
    assertClean(['victim.person@example.org', u.token, 'token=abc']);
    // …but the operator still gets something actionable.
    expect(lines.join('\n')).toContain('http.unhandled_error');
    expect(lines.join('\n')).toContain('XX001');
  });

  it('a failing OTP insert (params carry the HMAC) and a mail outage log no code, hash or email', async () => {
    net = installFakeNetwork([signer]);
    const u = await makeUser(signer, { email: 'otp.victim@example.org' });
    // Provision first (no trigger yet).
    expect((await req('GET', '/api/users/me', { token: u.token })).status).toBeLessThan(300);

    captureConsole();
    setMinLogLevel('debug');
    // 1) Mail transport down: the code was generated and must not be logged.
    net.failMail = true;
    const r1 = await req('POST', '/api/auth/otp-request', { token: u.token });
    expect(r1.status).toBe(500);
    net.failMail = false;
    // 2) Successful send, then a wrong guess and the right code.
    const r2 = await req('POST', '/api/auth/otp-request', { token: u.token });
    expect(r2.status).toBe(201);
    const code = net.lastCodeFor(u.email)!;
    expect(code).toMatch(/^\d{6}$/);
    await req('POST', '/api/auth/otp-verify', { token: u.token, body: { code: code === '000000' ? '111111' : '000000' } });
    await req('POST', '/api/auth/otp-verify', { token: u.token, body: { code } });
    const [row] = await sql<{ code_hash: string }>(
      dbUrl,
      'select code_hash from email_otp_codes order by id desc limit 1',
    );
    // 3) Insert failure inside otp_issue(): Drizzle's message carries the hash.
    await sql(
      dbUrl,
      `CREATE OR REPLACE FUNCTION loghyg_fail_otp() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'otp insert failed %', NEW.code_hash USING ERRCODE = 'XX002'; END $$`,
    );
    await sql(dbUrl, 'UPDATE email_otp_codes SET used_at = now()');
    await sql(dbUrl, 'DELETE FROM email_otp_codes');
    await sql(dbUrl, 'CREATE TRIGGER loghyg_otp BEFORE INSERT ON email_otp_codes FOR EACH ROW EXECUTE FUNCTION loghyg_fail_otp()');
    const r3 = await req('POST', '/api/auth/otp-request', { token: u.token });
    expect(r3.status).toBe(500);

    assertClean(['otp.victim@example.org', u.token, code, row!.code_hash]);
    expect(lines.join('\n')).toContain('XX002');
  });

  it('access log: route pattern only — no query string, no share slug, no bearer', async () => {
    net = installFakeNetwork([signer]);
    captureConsole();
    setMinLogLevel('debug');
    const slug = '3f1c2b4a-1111-4222-8333-944455556666';
    await req('GET', `/api/public/trips/${slug}?q=secret-search-term&email=a@b.co`, {
      headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln', 'X-Request-Id': 'upstream-12345678' },
    });
    const access = lines.map((l) => JSON.parse(l)).filter((l) => l.event === 'http.request');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ route: '/api/public/trips/:slug', method: 'GET', upstream_request_id: 'upstream-12345678' });
    expect(access[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(access[0].request_id).not.toBe('upstream-12345678');
    assertClean([slug, 'secret-search-term', 'a@b.co']);
  });

  it('a hostile X-Request-Id (newlines, 10 KB) is neither adopted nor logged', async () => {
    net = installFakeNetwork([signer]);
    captureConsole();
    setMinLogLevel('debug');
    const res = await req('GET', '/api/health', { headers: { 'X-Request-Id': 'a'.repeat(10_000) } });
    expect(res.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines.join('\n')).not.toContain('a'.repeat(100));
  });
});
