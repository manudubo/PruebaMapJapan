/**
 * Test-only helpers: a real RS256 key pair, a JWKS document and a token
 * signer, so JWT tests exercise the actual Web Crypto verification path
 * instead of a mocked crypto.subtle. Never imported by production code.
 */
import type { Env } from '../types';

export const TEST_ENV: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
  OTP_SECRET: 'x'.repeat(64),
  ENVIRONMENT: 'production',
};

export const TEST_ISSUER = `${TEST_ENV.KEYCLOAK_URL}/realms/${TEST_ENV.KEYCLOAK_REALM}`;

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; use: string; alg: string };
}

export async function generateTestKey(kid: string): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, publicJwk: { ...jwk, kid, use: 'sig', alg: 'RS256' } };
}

export function jwksBody(...keys: TestKey[]): { keys: TestKey['publicJwk'][] } {
  return { keys: keys.map((k) => k.publicJwk) };
}

export function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: TEST_ISSUER,
    sub: 'user-123',
    aud: 'japan-trip-frontend',
    typ: 'Bearer',
    azp: 'japan-trip-frontend',
    exp: now + 300,
    iat: now,
    email: 'u@example.com',
    name: 'U',
    preferred_username: 'u',
    ...overrides,
  };
}

export async function signJwt(
  key: TestKey,
  claims: Record<string, unknown> = validClaims(),
  headerOverrides: Record<string, unknown> = {},
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid: key.kid, ...headerOverrides };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/** A fetch stub that serves `body` as the JWKS and counts calls. */
export function jwksFetchStub(getBody: () => unknown, ok = true) {
  const calls: string[] = [];
  const fn = async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(getBody()), {
      status: ok ? 200 : 503,
      statusText: ok ? 'OK' : 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn, calls };
}
