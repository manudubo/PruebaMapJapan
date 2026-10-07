/**
 * Adversarial: OTP email over SMTP (the no-domain path: Gmail + app password)
 * end to end — real app, real JWT verification, real Postgres, a real local
 * SMTP server with STARTTLS and AUTH.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OtpEmailConfigError, __setSmtpTlsCaForTests, resolveEmailConfig } from '../../src/auth/otp-email';
import { selfSignedCert, startSmtpSink, type SmtpSink } from '../../src/test-utils/smtp-sink';
import {
  client,
  createSigner,
  createTestDatabase,
  dropTestDatabase,
  installFakeNetwork,
  makeEnv,
  makeUser,
  sql,
  type Signer,
} from './harness';

let dbUrl: string;
let signer: Signer;
let sink: SmtpSink;
const CREDS = { user: 'owner.travelmap@gmail.com', pass: 'abcd efgh ijkl mnop' };

function smtpEnv(extra: Record<string, string> = {}) {
  return makeEnv(dbUrl, {
    ENVIRONMENT: 'production',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(sink.port),
    SMTP_SECURE: 'starttls',
    SMTP_USER: CREDS.user,
    SMTP_PASS: CREDS.pass,
    EMAIL_FROM: `TravelMap <${CREDS.user}>`,
    ...extra,
  });
}

function codeFrom(data: string): string | undefined {
  const body = data.split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, '');
  return Buffer.from(body, 'base64').toString('utf8').match(/code is: (\d{6})/)?.[1];
}

beforeAll(async () => {
  dbUrl = await createTestDatabase('otpsmtp');
  signer = await createSigner();
  __setSmtpTlsCaForTests(selfSignedCert().cert);
});

afterAll(async () => {
  __setSmtpTlsCaForTests(undefined);
  await dropTestDatabase(dbUrl);
});

beforeEach(async () => {
  sink = await startSmtpSink({ mode: 'starttls', auth: CREDS });
  installFakeNetwork([signer]);
});

afterEach(async () => {
  await sink.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('OTP over SMTP', () => {
  it('request → mail over STARTTLS+AUTH to the account address only → verify succeeds', async () => {
    const u = await makeUser(signer);
    const req = client(smtpEnv());
    const r = await req('POST', '/api/auth/otp-request', { token: u.token });
    expect(r.status).toBe(201);
    expect(sink.messages).toHaveLength(1);
    const m = sink.messages[0]!;
    expect(m.tls).toBe(true);
    expect(m.authUser).toBe(CREDS.user);
    expect(m.rcpt).toEqual([`<${u.email}>`]);
    const code = codeFrom(m.data);
    expect(code).toMatch(/^\d{6}$/);
    expect((await req('POST', '/api/auth/otp-verify', { token: u.token, body: { code } })).status).toBe(200);
  });

  it('SMTP server down → generic 500, code burned so a retry is not blocked, no PII in logs', async () => {
    const lines: string[] = [];
    for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation((l: unknown) => void lines.push(String(l)));
    const u = await makeUser(signer);
    await sink.close();
    const r = await client(smtpEnv())('POST', '/api/auth/otp-request', { token: u.token });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    const rows = await sql<{ used_at: Date | null }>(dbUrl, `select o.used_at from email_otp_codes o join users u on u.id = o.user_id where u.keycloak_id = $1`, [u.sub]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.used_at).not.toBeNull();
    const all = lines.join('\n');
    expect(all).toContain('connect');
    expect(all).not.toContain(u.email);
    expect(all).not.toContain(CREDS.pass);
    // restart for afterEach
    sink = await startSmtpSink({ mode: 'starttls', auth: CREDS });
  });

  it('wrong app password → 500, nothing delivered, password never logged', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: unknown) => void lines.push(String(l)));
    const u = await makeUser(signer);
    const r = await client(smtpEnv({ SMTP_PASS: 'stale-app-password' }))('POST', '/api/auth/otp-request', { token: u.token });
    expect(r.status).toBe(500);
    expect(sink.messages).toHaveLength(0);
    expect(lines.join('\n')).toContain('535');
    expect(lines.join('\n')).not.toContain('stale-app-password');
  });

  it('unverified email in the token → 422 email_not_verified, nothing sent, no code issued', async () => {
    const u = await makeUser(signer, { email_verified: false });
    const r = await client(smtpEnv())('POST', '/api/auth/otp-request', { token: u.token });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('email_not_verified');
    expect(sink.messages).toHaveLength(0);
    expect(await sql(dbUrl, `select 1 from email_otp_codes o join users u on u.id = o.user_id where u.keycloak_id = $1`, [u.sub])).toHaveLength(0);
  });

  it.each([
    ['CRLF Bcc injection', 'victim@example.org\r\nBcc: list@example.org'],
    ['two recipients', 'victim@example.org, other@example.org'],
    ['display-name form', 'Victim <victim@example.org>'],
  ])('token email with %s → refused before any SMTP command', async (_l, email) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = await makeUser(signer, { email });
    const r = await client(smtpEnv())('POST', '/api/auth/otp-request', { token: u.token });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(sink.commands.filter((c) => c.startsWith('RCPT'))).toEqual([]);
    expect(sink.messages).toHaveLength(0);
  });

  it('one account cannot be used to mail arbitrary recipients: no request field picks the address', async () => {
    const u = await makeUser(signer);
    const r = await client(smtpEnv())('POST', '/api/auth/otp-request', {
      token: u.token,
      body: { email: 'stranger@example.org', to: 'stranger@example.org' },
    });
    expect(r.status).toBe(201);
    expect(sink.messages[0]!.rcpt).toEqual([`<${u.email}>`]);
  });

  it('misconfiguration in production fails before a code is issued (SEC-08)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = await makeUser(signer);
    const r = await client(smtpEnv({ SMTP_SECURE: 'none' }))('POST', '/api/auth/otp-request', { token: u.token });
    expect(r.status).toBe(500);
    expect(await sql(dbUrl, `select 1 from email_otp_codes o join users u on u.id = o.user_id where u.keycloak_id = $1`, [u.sub])).toHaveLength(0);
  });
});

describe('resolveEmailConfig', () => {
  const prod = { ENVIRONMENT: 'production' };
  const gmail = { SMTP_HOST: 'smtp.gmail.com', EMAIL_FROM: 'TravelMap <me@gmail.com>', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'app pass word abcd' };

  it('infers resend from RESEND_API_KEY, smtp from SMTP_HOST', () => {
    expect(resolveEmailConfig({ ...prod, RESEND_API_KEY: 're_x' }).provider).toBe('resend');
    expect(resolveEmailConfig({ ...prod, ...gmail })).toEqual({
      provider: 'smtp',
      smtp: { host: 'smtp.gmail.com', port: 587, security: 'starttls', from: 'TravelMap <me@gmail.com>', user: 'me@gmail.com', pass: 'app pass word abcd' },
    });
  });

  it('Gmail implicit TLS on 465', () => {
    const c = resolveEmailConfig({ ...prod, ...gmail, SMTP_PORT: '465', SMTP_SECURE: 'tls' });
    expect(c).toMatchObject({ smtp: { port: 465, security: 'tls' } });
  });

  it('explicit EMAIL_PROVIDER wins over inference; SMTP_FROM is an alias', () => {
    const c = resolveEmailConfig({ ...prod, RESEND_API_KEY: 're_x', EMAIL_PROVIDER: 'SMTP', SMTP_HOST: 'smtp.gmail.com', SMTP_FROM: 'me@gmail.com' });
    expect(c).toMatchObject({ provider: 'smtp', smtp: { from: 'me@gmail.com' } });
  });

  it.each([
    ['nothing in production', {}, /No OTP email provider/],
    ['unknown provider', { EMAIL_PROVIDER: 'sendgrid' }, /EMAIL_PROVIDER/],
    ['resend without key', { EMAIL_PROVIDER: 'resend' }, /RESEND_API_KEY/],
    ['smtp without host', { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@b.co' }, /SMTP_HOST/],
    ['smtp without from', { SMTP_HOST: 'smtp.gmail.com' }, /EMAIL_FROM/],
    ['injected from', { ...gmail, EMAIL_FROM: 'x@y.co\r\nBcc: z@w.co' }, /EMAIL_FROM/],
    ['bad port', { ...gmail, SMTP_PORT: '99999' }, /SMTP_PORT/],
    ['port text', { ...gmail, SMTP_PORT: '587; rm' }, /SMTP_PORT/],
    ['bad secure', { ...gmail, SMTP_SECURE: 'ssl' }, /SMTP_SECURE/],
    ['plaintext in production', { ...gmail, SMTP_SECURE: 'none' }, /development/],
    ['user without pass', { ...gmail, SMTP_PASS: '' }, /together/],
    ['pass without user', { ...gmail, SMTP_USER: '' }, /together/],
    ['host with junk', { ...gmail, SMTP_HOST: 'smtp.gmail.com\r\nX' }, /SMTP_HOST/],
  ])('%s → OtpEmailConfigError (no secret in the message)', (_l, env, msg) => {
    let err: unknown;
    try {
      resolveEmailConfig({ ...prod, ...env });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OtpEmailConfigError);
    expect((err as Error).message).toMatch(msg);
    expect((err as Error).message).not.toContain('app pass word');
  });

  it('SMTP_SECURE=none is allowed in development; nothing configured → Mailpit', () => {
    expect(resolveEmailConfig({ ENVIRONMENT: 'development', SMTP_HOST: 'localhost', SMTP_SECURE: 'none', EMAIL_FROM: 'a@b.co' })).toMatchObject({
      smtp: { security: 'none' },
    });
    expect(resolveEmailConfig({ ENVIRONMENT: 'development' }).provider).toBe('mailpit');
  });
});
