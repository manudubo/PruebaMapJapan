/**
 * Strict access-token checks (typ / azp / aud / iss / iat) and issuer
 * derivation for both deployment layouts:
 *   split hosts  — KEYCLOAK_URL=https://auth.example.org
 *   single host  — KEYCLOAK_URL=https://box.tailnet.ts.net/auth (KC_HTTP_RELATIVE_PATH=/auth)
 * Real RS256 keys; only the JWKS fetch is stubbed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
import {
  __resetJwksCacheForTests,
  allowedAuthorizedParties,
  keycloakEndpoints,
  verifyJwt,
} from './keycloak';
import { TEST_ENV, generateTestKey, jwksBody, signJwt, validClaims, type TestKey } from './jwt-test-fixtures';
import type { Env } from '../types';

let key: TestKey;
let fetched: string[];

beforeAll(async () => {
  key = await generateTestKey('kid-typ');
});

beforeEach(() => {
  __resetJwksCacheForTests();
  fetched = [];
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    fetched.push(String(url));
    return new Response(JSON.stringify(jwksBody(key)), { headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const now = () => Math.floor(Date.now() / 1000);

describe('token type: only Keycloak access tokens are accepted', () => {
  it('a normal access token passes', async () => {
    const payload = await verifyJwt(await signJwt(key), TEST_ENV);
    expect(payload.sub).toBe('user-123');
  });

  it.each([
    // A Keycloak ID token for the SPA: same key, same issuer, aud = client id.
    ['ID token', { typ: 'ID', aud: 'japan-trip-frontend', azp: 'japan-trip-frontend', nonce: 'n', at_hash: 'x' }],
    ['refresh token claims', { typ: 'Refresh' }],
    ['offline token', { typ: 'Offline' }],
    ['logout token', { typ: 'Logout' }],
    ['missing typ', { typ: undefined }],
    ['lower-case bearer', { typ: 'bearer' }],
    ['typ as array', { typ: ['Bearer'] }],
    ['typ with whitespace', { typ: 'Bearer ' }],
  ])('%s → rejected', async (_l, over) => {
    await expect(verifyJwt(await signJwt(key, validClaims(over)), TEST_ENV)).rejects.toThrow(/access token/);
  });

  it.each([
    ['service account of the worker client', { azp: 'japan-trip-worker' }],
    ['another realm client', { azp: 'account-console' }],
    ['missing azp', { azp: undefined }],
    ['azp as array', { azp: ['japan-trip-frontend'] }],
    ['azp empty', { azp: '' }],
    ['azp case variant', { azp: 'Japan-Trip-Frontend' }],
  ])('%s → rejected (azp)', async (_l, over) => {
    await expect(verifyJwt(await signJwt(key, validClaims(over)), TEST_ENV)).rejects.toThrow(/azp/);
  });

  it('ALLOWED_AZP overrides the default (VALID_AUDIENCES)', async () => {
    const env = { ...TEST_ENV, ALLOWED_AZP: 'mobile-app, japan-trip-frontend' };
    expect(allowedAuthorizedParties(env)).toEqual(['mobile-app', 'japan-trip-frontend']);
    await expect(verifyJwt(await signJwt(key, validClaims({ azp: 'mobile-app' })), env)).resolves.toBeTruthy();
    expect(allowedAuthorizedParties(TEST_ENV)).toEqual(['japan-trip-frontend']);
  });

  it('a worker token that carries our audience via a mapper is still rejected', async () => {
    const t = await signJwt(key, validClaims({ azp: 'japan-trip-worker', aud: ['japan-trip-frontend', 'realm-management'] }));
    await expect(verifyJwt(t, TEST_ENV)).rejects.toThrow(/azp/);
  });

  it('iat far in the future → rejected; within 60 s skew → accepted', async () => {
    await expect(verifyJwt(await signJwt(key, validClaims({ iat: now() + 3600 })), TEST_ENV)).rejects.toThrow(/future/);
    await expect(verifyJwt(await signJwt(key, validClaims({ iat: now() + 30 })), TEST_ENV)).resolves.toBeTruthy();
  });

  it.each([
    ['at+jwt header typ', { typ: 'at+jwt' }],
    ['JWE-ish header typ', { typ: 'JOSE' }],
  ])('%s → rejected', async (_l, header) => {
    await expect(verifyJwt(await signJwt(key, validClaims(), header), TEST_ENV)).rejects.toThrow(/typ/);
  });

  it('header without typ (some libraries omit it) is still fine when the payload is an access token', async () => {
    await expect(verifyJwt(await signJwt(key, validClaims(), { typ: undefined }), TEST_ENV)).resolves.toBeTruthy();
  });

  it('JSON null header/payload → rejected without a TypeError leaking out', async () => {
    const b = (s: string) => Buffer.from(s).toString('base64url');
    await expect(verifyJwt(`${b('null')}.${b('{}')}.x`, TEST_ENV)).rejects.toThrow(/header/);
    await expect(verifyJwt(`${b('{"alg":"RS256","kid":"kid-typ"}')}.${b('null')}.x`, TEST_ENV)).rejects.toThrow();
  });

  it('through the app: an ID token gets the generic 401 invalid_token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const idToken = await signJwt(key, validClaims({ typ: 'ID' }));
    const res = await app.request('/api/trips', { headers: { Authorization: `Bearer ${idToken}` } }, TEST_ENV);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'invalid_token' });
  });
});

describe('issuer and JWKS URL in both deployment layouts', () => {
  const splitEnv: Env = { ...TEST_ENV, KEYCLOAK_URL: 'https://auth.example.org' };
  const singleEnv: Env = { ...TEST_ENV, KEYCLOAK_URL: 'https://box.tail1234.ts.net/auth' };

  it('derives issuer and JWKS URL (split hosts)', () => {
    expect(keycloakEndpoints(splitEnv)).toEqual({
      issuer: 'https://auth.example.org/realms/japan-trip',
      jwksUrl: 'https://auth.example.org/realms/japan-trip/protocol/openid-connect/certs',
    });
  });

  it('derives issuer and JWKS URL with a path prefix (single host, /auth)', () => {
    expect(keycloakEndpoints(singleEnv)).toEqual({
      issuer: 'https://box.tail1234.ts.net/auth/realms/japan-trip',
      jwksUrl: 'https://box.tail1234.ts.net/auth/realms/japan-trip/protocol/openid-connect/certs',
    });
  });

  it('ignores trailing slashes on KEYCLOAK_URL', () => {
    expect(keycloakEndpoints({ ...singleEnv, KEYCLOAK_URL: 'https://box.tail1234.ts.net/auth//' }).issuer).toBe(
      'https://box.tail1234.ts.net/auth/realms/japan-trip',
    );
  });

  it('single host: accepts the /auth issuer and fetches keys under /auth', async () => {
    const t = await signJwt(key, validClaims({ iss: 'https://box.tail1234.ts.net/auth/realms/japan-trip' }));
    await expect(verifyJwt(t, singleEnv)).resolves.toBeTruthy();
    expect(fetched).toEqual(['https://box.tail1234.ts.net/auth/realms/japan-trip/protocol/openid-connect/certs']);
  });

  it.each([
    ['issuer without the /auth prefix', 'https://box.tail1234.ts.net/realms/japan-trip'],
    ['issuer with a trailing slash', 'https://box.tail1234.ts.net/auth/realms/japan-trip/'],
    ['other path prefix', 'https://box.tail1234.ts.net/evil/realms/japan-trip'],
    ['http instead of https', 'http://box.tail1234.ts.net/auth/realms/japan-trip'],
    ['other tailnet host', 'https://box.tail9999.ts.net/auth/realms/japan-trip'],
    ['realm prefix', 'https://box.tail1234.ts.net/auth/realms/japan-trip-evil'],
    ['master realm', 'https://box.tail1234.ts.net/auth/realms/master'],
  ])('single host: %s → rejected', async (_l, iss) => {
    await expect(verifyJwt(await signJwt(key, validClaims({ iss })), singleEnv)).rejects.toThrow(/issuer/);
  });

  it('split hosts: a single-host issuer is rejected and vice versa', async () => {
    const single = await signJwt(key, validClaims({ iss: 'https://box.tail1234.ts.net/auth/realms/japan-trip' }));
    const split = await signJwt(key, validClaims({ iss: 'https://auth.example.org/realms/japan-trip' }));
    await expect(verifyJwt(single, splitEnv)).rejects.toThrow(/issuer/);
    await expect(verifyJwt(split, singleEnv)).rejects.toThrow(/issuer/);
    await expect(verifyJwt(split, splitEnv)).resolves.toBeTruthy();
  });

  it('KEYCLOAK_JWKS_URL: keys from the internal URL, iss must still be the public issuer', async () => {
    const env: Env = {
      ...singleEnv,
      KEYCLOAK_JWKS_URL: 'http://keycloak:8080/auth/realms/japan-trip/protocol/openid-connect/certs',
    };
    const good = await signJwt(key, validClaims({ iss: 'https://box.tail1234.ts.net/auth/realms/japan-trip' }));
    await expect(verifyJwt(good, env)).resolves.toBeTruthy();
    expect(fetched).toEqual(['http://keycloak:8080/auth/realms/japan-trip/protocol/openid-connect/certs']);
    const internalIss = await signJwt(key, validClaims({ iss: 'http://keycloak:8080/auth/realms/japan-trip' }));
    await expect(verifyJwt(internalIss, env)).rejects.toThrow(/issuer/);
  });

  it('KEYCLOAK_ISSUER overrides the derived issuer', async () => {
    const env: Env = { ...TEST_ENV, KEYCLOAK_URL: 'http://keycloak:8080/auth', KEYCLOAK_ISSUER: 'https://box.tail1234.ts.net/auth/realms/japan-trip/' };
    expect(keycloakEndpoints(env)).toEqual({
      issuer: 'https://box.tail1234.ts.net/auth/realms/japan-trip',
      jwksUrl: 'http://keycloak:8080/auth/realms/japan-trip/protocol/openid-connect/certs',
    });
    const t = await signJwt(key, validClaims({ iss: 'https://box.tail1234.ts.net/auth/realms/japan-trip' }));
    await expect(verifyJwt(t, env)).resolves.toBeTruthy();
  });
});
