import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAudience, verifyJwt, __resetJwksCacheForTests } from './keycloak';

describe('validateAudience — SEC-04', () => {
  const valid = ['japan-trip-frontend'];

  it('accepts japan-trip-frontend as a single string', () => {
    expect(validateAudience('japan-trip-frontend', valid)).toBe(true);
  });

  it('accepts japan-trip-frontend in an array', () => {
    expect(validateAudience(['japan-trip-frontend'], valid)).toBe(true);
  });

  it('rejects account audience', () => {
    expect(validateAudience('account', valid)).toBe(false);
  });

  it('rejects japan-trip-api audience', () => {
    expect(validateAudience('japan-trip-api', valid)).toBe(false);
  });

  it('rejects array containing only account', () => {
    expect(validateAudience(['account', 'japan-trip-api'], valid)).toBe(false);
  });

  it('accepts array containing japan-trip-frontend alongside others', () => {
    expect(validateAudience(['some-other', 'japan-trip-frontend'], valid)).toBe(true);
  });

  it('returns false for undefined aud', () => {
    expect(validateAudience(undefined, valid)).toBe(false);
  });
});

describe('validateAudience — BACK-01 env extraction', () => {
  it('parses comma-separated VALID_AUDIENCES env string', () => {
    const envString = 'japan-trip-frontend, japan-trip-worker';
    const parsed = envString.split(',').map(s => s.trim());
    expect(validateAudience('japan-trip-frontend', parsed)).toBe(true);
    expect(validateAudience('japan-trip-worker', parsed)).toBe(true);
    expect(validateAudience('other', parsed)).toBe(false);
  });

  it('handles single-value VALID_AUDIENCES without trailing comma', () => {
    const parsed = 'japan-trip-frontend'.split(',').map(s => s.trim());
    expect(validateAudience('japan-trip-frontend', parsed)).toBe(true);
  });
});

describe('verifyJwt — JWKS retry on signature failure (SEC-02)', () => {
  const FAKE_KID = 'test-key-id';

  function makeFakeJwt(kid: string): string {
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const now = Math.floor(Date.now() / 1000);
    const payload = btoa(JSON.stringify({
      iss: 'http://localhost:8080/realms/japan-trip',
      sub: 'test-user-id',
      aud: 'japan-trip-frontend',
      exp: now + 3600,
      nbf: now - 1,
      iat: now,
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `${header}.${payload}.fakesig`;
  }

  const mockEnv = {
    KEYCLOAK_URL: 'http://localhost:8080',
    KEYCLOAK_REALM: 'japan-trip',
    VALID_AUDIENCES: 'japan-trip-frontend',
    DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
    KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
    KC_ADMIN_CLIENT_SECRET: 'mock-secret',
    OTP_SECRET: 'a3f8c2d1e4b7f0a9d6c3e8b1f4a7d0c2e5b8f3a6d9c0e3b6f1a4d7c0e3b6f1',
  };

  const fakeCryptoKey = {} as CryptoKey;

  const fakeJwksJson = {
    keys: [{
      kid: FAKE_KID, kty: 'RSA', alg: 'RS256', use: 'sig',
      n: 'sGb_fake_n_value', e: 'AQAB',
    }],
  };

  beforeEach(() => {
    __resetJwksCacheForTests();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeJwksJson,
    }));

    vi.stubGlobal('crypto', {
      subtle: {
        importKey: vi.fn().mockResolvedValue(fakeCryptoKey),
        verify: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries JWKS fetch and succeeds when signature verification passes on retry', async () => {
    (crypto.subtle.verify as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const token = makeFakeJwt(FAKE_KID);
    const payload = await verifyJwt(token, mockEnv as unknown as import('../types').Env);
    expect(payload.sub).toBe('test-user-id');

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('throws after retry if signature still invalid (not a rotation issue)', async () => {
    (crypto.subtle.verify as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const token = makeFakeJwt(FAKE_KID);
    await expect(verifyJwt(token, mockEnv as unknown as import('../types').Env))
      .rejects.toThrow('JWT signature verification failed');

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
