import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, formatJwtRejection } from './auth';
import { __resetJwksCacheForTests } from '../auth/keycloak';
import {
  TEST_ENV,
  TEST_ISSUER,
  b64url,
  generateTestKey,
  jwksBody,
  jwksFetchStub,
  signJwt,
  validClaims,
  type TestKey,
} from '../auth/jwt-test-fixtures';
import type { Env, ContextVariables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: ContextVariables }>();
app.use('*', authMiddleware);
app.get('/whoami', (c) => c.json({ sub: c.get('user').sub }));

let key: TestKey;
let attackerKey: TestKey;

// Strings that would reveal Keycloak topology / config if they reached a client.
const SECRETS = [
  TEST_ENV.KEYCLOAK_URL,
  'localhost',
  '8080',
  'realms',
  TEST_ENV.KEYCLOAK_REALM,
  TEST_ENV.VALID_AUDIENCES,
  'expected',
  'issuer',
  'kid',
  'JWKS',
];

async function call(authorization?: string, env: Env = TEST_ENV) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['Authorization'] = authorization;
  return app.request('/whoami', { headers }, env);
}

/** Asserts the exact generic 401 and returns the raw body for extra checks. */
async function expectGenericRejection(res: Response): Promise<string> {
  expect(res.status).toBe(401);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ success: false, error: 'invalid_token' });
  for (const s of SECRETS) expect(text).not.toContain(s);
  expect(res.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
  return text;
}

beforeAll(async () => {
  key = await generateTestKey('kc-key-1');
  attackerKey = await generateTestKey('kc-key-1'); // same kid, different key
});

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetJwksCacheForTests();
  vi.stubGlobal('fetch', vi.fn(jwksFetchStub(() => jwksBody(key)).fn));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authMiddleware — happy path', () => {
  it('accepts a correctly signed token and exposes its claims', async () => {
    const res = await call(`Bearer ${await signJwt(key)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: 'user-123' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts an array audience that contains a valid one', async () => {
    const token = await signJwt(key, validClaims({ aud: ['account', 'japan-trip-frontend'] }));
    expect((await call(`Bearer ${token}`)).status).toBe(200);
  });
});

describe('authMiddleware — generic invalid_token (SEC-06)', () => {
  const now = () => Math.floor(Date.now() / 1000);

  const cases: Array<[string, () => Promise<string>, RegExp]> = [
    ['wrong issuer', () => signJwt(key, validClaims({ iss: 'https://evil.example.com/realms/x' })), /issuer mismatch/],
    ['issuer of another realm on same host', () => signJwt(key, validClaims({ iss: `${TEST_ENV.KEYCLOAK_URL}/realms/master` })), /issuer mismatch/],
    ['missing issuer', () => signJwt(key, validClaims({ iss: undefined })), /issuer mismatch/],
    ['wrong audience', () => signJwt(key, validClaims({ aud: 'account' })), /audience/],
    ['missing audience', () => signJwt(key, validClaims({ aud: undefined })), /audience/],
    ['expired', () => signJwt(key, validClaims({ exp: now() - 1 })), /expired/],
    ['missing exp', () => signJwt(key, validClaims({ exp: undefined })), /expired/],
    ['not yet valid (nbf)', () => signJwt(key, validClaims({ nbf: now() + 600 })), /nbf/],
    ['missing sub', () => signJwt(key, validClaims({ sub: '' })), /sub/],
    ['alg none', async () => {
      const h = b64url(JSON.stringify({ alg: 'none', kid: 'kc-key-1' }));
      return `${h}.${b64url(JSON.stringify(validClaims()))}.`;
    }, /algorithm/],
    ['alg HS256 (key confusion)', () => signJwt(key, validClaims(), { alg: 'HS256' }), /algorithm/],
    ['missing kid', () => signJwt(key, validClaims(), { kid: undefined }), /kid/],
    ['unknown kid', () => signJwt(key, validClaims(), { kid: 'nope' }), /signing key not found/],
    ['forged signature with same kid', () => signJwt(attackerKey), /signature/],
    ['tampered payload (sub swapped after signing)', async () => {
      const [h, , s] = (await signJwt(key)).split('.');
      return `${h}.${b64url(JSON.stringify(validClaims({ sub: 'admin' })))}.${s}`;
    }, /signature/],
    ['two segments', async () => 'aaa.bbb', /Malformed/],
    ['four segments', async () => 'a.b.c.d', /Malformed/],
    ['empty-ish token (single space)', async () => ' x', /Malformed/],
    ['non-base64 header', async () => '!!!.@@@.###', /header/],
    ['header is not JSON', async () => `${b64url('not json')}.${b64url('{}')}.x`, /header/],
    ['payload is not JSON', async () => `${b64url(JSON.stringify({ alg: 'RS256', kid: 'kc-key-1' }))}.${b64url('nope')}.x`, /payload/],
  ];

  it.each(cases)('%s → generic body, detail logged', async (_label, makeToken, logPattern) => {
    const res = await call(`Bearer ${await makeToken()}`);
    await expectGenericRejection(res);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(logPattern);
  });

  it('logs the expected issuer server-side (so operators can debug) but never returns it', async () => {
    const res = await call(`Bearer ${await signJwt(key, validClaims({ iss: 'https://evil/realms/x' }))}`);
    await expectGenericRejection(res);
    expect(String(warn.mock.calls[0]?.[0])).toContain(TEST_ISSUER);
  });

  it('Keycloak JWKS outage → generic body, Keycloak URL only in logs', async () => {
    vi.stubGlobal('fetch', vi.fn(jwksFetchStub(() => ({}), false).fn));
    const res = await call(`Bearer ${await signJwt(key)}`);
    await expectGenericRejection(res);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/503/);
  });

  it('JWKS with no usable keys → generic body', async () => {
    vi.stubGlobal('fetch', vi.fn(jwksFetchStub(() => ({ keys: [] })).fn));
    await expectGenericRejection(await call(`Bearer ${await signJwt(key)}`));
  });

  it('JWKS fetch throwing (network error) → generic body, not a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND keycloak.internal'); }));
    const body = await expectGenericRejection(await call(`Bearer ${await signJwt(key)}`));
    expect(body).not.toContain('keycloak.internal');
    expect(String(warn.mock.calls[0]?.[0])).toContain('keycloak.internal');
  });

  it('giant (1 MB) token is rejected generically without echoing it', async () => {
    const huge = 'A'.repeat(1_000_000);
    const res = await call(`Bearer ${huge}.${huge}.${huge}`);
    await expectGenericRejection(res);
  });

  it('giant attacker-controlled issuer is truncated in the log line', async () => {
    const iss = 'x'.repeat(50_000);
    await expectGenericRejection(await call(`Bearer ${await signJwt(key, validClaims({ iss }))}`));
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line.length).toBeLessThan(400);
  });

  it('newlines in attacker claims cannot forge extra log lines', async () => {
    const iss = 'evil\n[auth] JWT accepted: admin\r\nfake';
    await expectGenericRejection(await call(`Bearer ${await signJwt(key, validClaims({ iss }))}`));
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).not.toMatch(/[\r\n]/);
  });

  it('HTML/script in claims is not reflected', async () => {
    const res = await call(`Bearer ${await signJwt(key, validClaims({ aud: '<script>alert(1)</script>' }))}`);
    expect(await expectGenericRejection(res)).not.toContain('<script>');
  });
});

describe('authMiddleware — missing/odd Authorization headers', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['lower-case scheme', 'bearer abc'],
    ['Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['scheme only', 'Bearer'],
  ])('%s → 401 without verification', async (_l, header) => {
    const res = await call(header);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['success']).toBe(false);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('"Bearer " + whitespace is trimmed by the platform and treated as missing', async () => {
    const res = await call('Bearer    ');
    expect(res.status).toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('"Bearer  <token>" (double space) is rejected, not silently accepted', async () => {
    await expectGenericRejection(await call(`Bearer  ${await signJwt(key)}`));
  });
});

describe('formatJwtRejection', () => {
  it('handles non-Error throwables', () => {
    expect(formatJwtRejection('boom')).toBe('[auth] JWT rejected: "JWT verification failed"');
    expect(formatJwtRejection(undefined)).toContain('JWT verification failed');
  });
});
