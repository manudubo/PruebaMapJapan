import type { Env, KeycloakJwtPayload } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

interface CachedJwks {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

export interface UserInfo {
  keycloakId: string;
  email: string;
  name: string;
  preferredUsername: string;
  emailVerified: boolean;
  roles: string[];
  avatarUrl?: string;
  preferences?: string;
}

// ---------------------------------------------------------------------------
// Module-level JWKS cache — Workers share memory within an isolate
// ---------------------------------------------------------------------------

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let jwksCache: CachedJwks | null = null;

/**
 * Minimum gap between *forced* JWKS refreshes (unknown kid / bad signature).
 * Without it, every request carrying a bogus kid or signature made the isolate
 * drop its cache and hit Keycloak — DoS amplification (SEC-05). Trade-off: a
 * genuinely rotated key can be rejected for up to this long if an attacker
 * burned the refresh just before; Keycloak serves the new key in JWKS before
 * using it, so the next TTL/forced refresh picks it up.
 */
export const JWKS_FORCED_REFRESH_COOLDOWN_MS = 60 * 1000;
let lastForcedRefreshAt = Number.NEGATIVE_INFINITY;

/** Shared in-flight fetch so concurrent cache misses hit Keycloak once. */
let jwksInFlight: Promise<Map<string, CryptoKey>> | null = null;

// ---------------------------------------------------------------------------
// Base64url helpers (Web Crypto API only — no Node.js)
// ---------------------------------------------------------------------------

function base64urlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Decode a base64url JWT segment to text. JWT JSON is UTF-8 (RFC 7519). */
function base64urlDecode(base64url: string): string {
  // atob() yields one char per byte; decoding that directly as text turned
  // non-ASCII claims ("José") into mojibake ("JosÃ©").
  return new TextDecoder().decode(base64urlToArrayBuffer(base64url));
}

// ---------------------------------------------------------------------------
// Import a JWK RSA public key using Web Crypto API
// ---------------------------------------------------------------------------

async function importRsaPublicKey(jwk: JwkKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg || 'RS256',
      ext: true,
      key_ops: ['verify'],
      use: 'sig',
    },
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['verify'],
  );
}

export function validateAudience(aud: string | string[] | undefined, valid: string[]): boolean {
  if (!aud) return false;
  const audArray = Array.isArray(aud) ? aud : [aud];
  return audArray.some((a) => valid.includes(a));
}

// ---------------------------------------------------------------------------
// Fetch JWKS from Keycloak and cache imported CryptoKeys
// ---------------------------------------------------------------------------

export async function getKeycloakJwks(env: Env): Promise<Map<string, CryptoKey>> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  if (!jwksInFlight) {
    jwksInFlight = fetchJwks(env).finally(() => {
      jwksInFlight = null;
    });
  }
  return jwksInFlight;
}

/**
 * Refetch JWKS ignoring the TTL, at most once per cooldown window.
 * Returns null (no fetch) while cooling down. On fetch failure the previous
 * keys are kept so a Keycloak blip does not lock out valid tokens.
 */
async function forceRefreshJwks(env: Env): Promise<Map<string, CryptoKey> | null> {
  const now = Date.now();
  if (now - lastForcedRefreshAt < JWKS_FORCED_REFRESH_COOLDOWN_MS) {
    return null;
  }
  // Claim the window before awaiting so concurrent callers see the cooldown.
  lastForcedRefreshAt = now;
  const previous = jwksCache;
  jwksCache = null;
  try {
    return await getKeycloakJwks(env);
  } catch (err) {
    jwksCache ??= previous;
    throw err;
  }
}

async function fetchJwks(env: Env): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  const jwksUrl = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/certs`;

  const response = await fetch(jwksUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS from Keycloak: ${response.status} ${response.statusText}`);
  }

  const jwks = (await response.json()) as JwksResponse;

  if (!jwks.keys || !Array.isArray(jwks.keys)) {
    throw new Error('Invalid JWKS response: missing keys array');
  }

  const keyMap = new Map<string, CryptoKey>();

  for (const jwk of jwks.keys) {
    if (jwk.kty === 'RSA' && jwk.use === 'sig' && jwk.kid) {
      try {
        const cryptoKey = await importRsaPublicKey(jwk);
        keyMap.set(jwk.kid, cryptoKey);
      } catch {
        // Skip keys that fail to import — log but don't break
        console.warn(`Failed to import JWK with kid=${jwk.kid}`);
      }
    }
  }

  if (keyMap.size === 0) {
    throw new Error('No valid RSA signing keys found in JWKS');
  }

  jwksCache = { keys: keyMap, fetchedAt: now };
  return keyMap;
}

// ---------------------------------------------------------------------------
// Verify a JWT token — returns decoded payload on success, throws on failure
// ---------------------------------------------------------------------------

export async function verifyJwt(token: string, env: Env): Promise<KeycloakJwtPayload> {
  // Split JWT into header.payload.signature
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT: expected 3 parts');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  // Decode header to get kid and alg
  let header: { kid?: string; alg?: string };
  try {
    header = JSON.parse(base64urlDecode(encodedHeader)) as { kid?: string; alg?: string };
  } catch {
    throw new Error('Failed to parse JWT header');
  }

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}. Expected RS256`);
  }

  if (!header.kid) {
    throw new Error('JWT header missing kid claim');
  }

  // Decode payload
  let payload: KeycloakJwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload)) as KeycloakJwtPayload;
  } catch {
    throw new Error('Failed to parse JWT payload');
  }

  // Validate expiry
  // exp/nbf must be numbers: a string such as "tomorrow" compares false
  // against `now` and would make the token never expire.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('JWT treated as expired: exp claim missing or not a number');
  }
  if (payload.exp < now) {
    throw new Error('JWT has expired');
  }

  // Validate not-before (nbf) if present
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > now)) {
    throw new Error('JWT is not yet valid (nbf)');
  }

  // Validate issuer
  const expectedIssuer = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}`;
  if (!payload.iss || payload.iss !== expectedIssuer) {
    throw new Error(`JWT issuer mismatch: got "${payload.iss}", expected "${expectedIssuer}"`);
  }

  const validAudiences = env.VALID_AUDIENCES.split(',').map(s => s.trim());
  const aud = payload.aud;
  if (!validateAudience(aud, validAudiences)) {
    throw new Error(`JWT audience not accepted: ${JSON.stringify(aud)}`);
  }

  // Validate required claims
  if (!payload.sub) {
    throw new Error('JWT missing required sub claim');
  }

  // Get JWKS and find the matching key
  const keyMap = await getKeycloakJwks(env);
  let publicKey = keyMap.get(header.kid);

  let jwksRefreshed = false;

  if (!publicKey) {
    // Refresh in case the key was rotated (rate-limited — SEC-05)
    const refreshedKeyMap = await forceRefreshJwks(env);
    jwksRefreshed = refreshedKeyMap !== null;
    publicKey = refreshedKeyMap?.get(header.kid);
    if (!publicKey) {
      throw new Error(`JWT signing key not found: kid=${header.kid}`);
    }
  }

  // Verify RS256 signature using Web Crypto API
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signingInputBytes = new TextEncoder().encode(signingInput);
  let signatureBytes: ArrayBuffer;
  try {
    signatureBytes = base64urlToArrayBuffer(encodedSignature);
  } catch {
    throw new Error('Malformed JWT signature encoding');
  }

  let isValid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signatureBytes,
    signingInputBytes,
  );

  if (!isValid && !jwksRefreshed) {
    // Retry once with fresh JWKS (stale key after rotation) — rate-limited
    // so garbage signatures cannot force a Keycloak fetch per request (SEC-05).
    const retryKeyMap = await forceRefreshJwks(env);
    const retryKey = retryKeyMap?.get(header.kid);
    if (retryKey) {
      isValid = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        retryKey,
        signatureBytes,
        signingInputBytes,
      );
    }
  }

  if (!isValid) {
    throw new Error('JWT signature verification failed');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Extract standardized user info from a verified Keycloak JWT payload
// ---------------------------------------------------------------------------

export function __resetJwksCacheForTests(): void {
  jwksCache = null;
  jwksInFlight = null;
  lastForcedRefreshAt = Number.NEGATIVE_INFINITY;
}

export function extractUserInfo(payload: KeycloakJwtPayload): UserInfo {
  const roles = payload.realm_access?.roles ?? [];

  // Cast to access custom attributes that may not be in the base type
  const raw = payload as unknown as Record<string, unknown>;

  return {
    keycloakId: payload.sub,
    email: payload.email ?? '',
    name: payload.name ?? payload.preferred_username ?? '',
    preferredUsername: payload.preferred_username ?? '',
    emailVerified: payload.email_verified ?? false,
    roles,
    avatarUrl: typeof raw['avatar_url'] === 'string' ? raw['avatar_url'] : undefined,
    preferences: typeof raw['preferences'] === 'string' ? raw['preferences'] : undefined,
  };
}
