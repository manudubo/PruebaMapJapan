import { afterEach, describe, expect, it } from 'vitest';
import { __setLogSinkForTests, formatLogLine, log, scrub, scrubString, setMinLogLevel } from './logger';

afterEach(() => setMinLogLevel('warn'));

describe('scrubString', () => {
  it.each([
    ['email', 'user alice.b+tag@mail.example.co.uk failed', 'alice.b+tag@mail.example.co.uk'],
    ['jwt', 'token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl here', 'eyJhbGciOiJSUzI1NiJ9'],
    ['bearer', 'Authorization: Bearer abc.def-ghi', 'abc.def-ghi'],
    ['basic', 'Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['hmac', 'hash q83vEjRWeJBN/lE3ZQ7k6t3uQz8Yb8Lz2hq6qkKZ1Yw= stored', 'q83vEjRWeJBN/lE3ZQ7k6t3uQz8Yb8Lz2hq6qkKZ1Yw='],
    ['otp code', 'Your verification code is: 042917', '042917'],
  ])('removes %s', (_l, input, secret) => {
    expect(scrubString(input)).not.toContain(secret);
  });

  it('cuts the bound parameters off a Drizzle "Failed query" message', () => {
    const msg = 'Failed query: insert into "users" ("keycloak_id","email") values ($1,$2)\nparams: kc-1,someone@x.io';
    const out = scrubString(msg);
    expect(out).toContain('insert into "users"');
    expect(out).not.toContain('kc-1');
    expect(out).toContain('params: [redacted]');
  });

  it('keeps UUIDs, ports and versions intact', () => {
    expect(scrubString('id 933d5198-29b3-481f-9444-b123456fd596 port 543210x v1.123456')).toBe(
      'id 933d5198-29b3-481f-9444-b123456fd596 port 543210x v1.123456',
    );
  });

  it('truncates very long strings', () => {
    const t0 = Date.now();
    expect(scrubString('a'.repeat(50_000)).length).toBeLessThanOrEqual(2001);
    expect(scrubString('a'.repeat(1_000_000) + '@').length).toBeLessThanOrEqual(2001);
    expect(Date.now() - t0).toBeLessThan(500); // no catastrophic backtracking
  });
});

describe('scrub', () => {
  it('redacts sensitive keys at any depth', () => {
    const out = scrub({ a: { email: 'x', Authorization: 'y', nested: [{ code_hash: 'h', otp: '1', token: 't' }] }, ok: 1 });
    expect(out).toEqual({
      a: { email: '[redacted]', Authorization: '[redacted]', nested: [{ code_hash: '[redacted]', otp: '[redacted]', token: '[redacted]' }] },
      ok: 1,
    });
  });

  it('reduces errors to name/message/sqlstate/frames and walks the cause, never detail/params', () => {
    const pgErr = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (email)=(leak@example.com) already exists.',
    });
    const drizzleErr = Object.assign(new Error('Failed query: select 1\nparams: leak@example.com'), {
      query: 'select 1',
      params: ['leak@example.com'],
      cause: pgErr,
    });
    const text = JSON.stringify(scrub(drizzleErr));
    expect(text).not.toContain('leak@example.com');
    expect(text).toContain('23505');
    expect(text).toContain('duplicate key');
  });

  it('survives cycles and depth bombs', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => JSON.stringify(scrub(a))).not.toThrow();
  });
});

describe('log', () => {
  it('emits one JSON object per line with level, ts and event', () => {
    const lines: string[] = [];
    const restore = __setLogSinkForTests((_lvl, line) => lines.push(line));
    try {
      setMinLogLevel('debug');
      log.info('thing.happened', { n: 1, email: 'a@b.co' });
    } finally {
      restore();
    }
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({ level: 'info', event: 'thing.happened', n: 1, email: '[redacted]' });
    expect(typeof parsed.ts).toBe('string');
  });

  it('honours the minimum level', () => {
    const lines: string[] = [];
    const restore = __setLogSinkForTests((_lvl, line) => lines.push(line));
    try {
      setMinLogLevel('error');
      log.warn('dropped');
      log.error('kept');
      setMinLogLevel('nonsense'); // ignored
      log.warn('still dropped');
    } finally {
      restore();
    }
    expect(lines.map((l) => JSON.parse(l).event)).toEqual(['kept']);
  });

  it('newlines in values cannot forge a second line', () => {
    const line = formatLogLine('warn', 'x', { reason: 'a\n{"level":"info","event":"forged"}' });
    expect(line.split('\n')).toHaveLength(1);
  });
});
