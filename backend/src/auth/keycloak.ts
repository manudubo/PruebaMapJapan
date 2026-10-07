import type { Env, KeycloakJwtPayload } from '../types';
import { log } from '../observability/logger';

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

/**
 * Where tokens come from, derived once from the env. Works for both layouts:
 *
 *  - split hosts:  KEYCLOAK_URL=https://auth.example.org
 *  - single host:  KEYCLOAK_URL=https://host.tailnet.ts.net/auth  (KC_HTTP_RELATIVE_PATH=/auth)
 *
 * The issuer is `${KEYCLOAK_URL}/realms/${realm}` (trailing slashes on
 * KEYCLOAK_URL ignored) unless KEYCLOAK_ISSUER overrides it. KEYCLOAK_JWKS_URL
 * lets a self-hosted backend fetch keys over the internal network
 * (http://keycloak:8080/auth/...) while still requiring the PUBLIC issuer in
 * `iss` — the issuer is what the browser's token says, the JWKS URL is only
 * where we read keys from.
 */
export interface KeycloakEndpoints {
  issuer: string;
  jwksUrl: string;
}

function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function keycloakEndpoints(env: Pick<Env, 'KEYCLOAK_URL' | 'KEYCLOAK_REALM' | 'KEYCLOAK_ISSUER' | 'KEYCLOAK_JWKS_URL'>): KeycloakEndpoints {
  const base = trimSlashes(env.KEYCLOAK_URL ?? '');
  const realmPath = `/realms/${encodeURIComponent((env.KEYCLOAK_REALM ?? '').trim())}`;
  const issuer = env.KEYCLOAK_ISSUER?.trim() ? trimSlashes(env.KEYCLOAK_ISSUER) : `${base}${realmPath}`;
  const jwksUrl = env.KEYCLOAK_JWKS_URL?.trim()
    ? env.KEYCLOAK_JWKS_URL.trim()
    : `${base}${realmPath}/protocol/openid-connect/certs`;
  return { issuer, jwksUrl };
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Clients whose access tokens this API accepts (`azp`). Defaults to VALID_AUDIENCES. */
export function allowedAuthorizedParties(env: Pick<Env, 'ALLOWED_AZP' | 'VALID_AUDIENCES'>): string[] {
  const explicit = csv(env.ALLOWED_AZP);
  return explicit.length > 0 ? explicit : csv(env.VALID_AUDIENCES);
}

/** Tolerated clock skew for iat in the future. */
const MAX_IAT_SKEW_S = 60;

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
  const { jwksUrl } = keycloakEndpoints(env);

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
        log.warn('auth.jwk_import_failed', { kid: String(jwk.kid).slice(0, 64) });
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
  let header: { kid?: string; alg?: string; typ?: unknown };
  try {
    header = JSON.parse(base64urlDecode(encodedHeader)) as { kid?: string; alg?: string; typ?: unknown };
  } catch {
    throw new Error('Failed to parse JWT header');
  }
  if (header === null || typeof header !== 'object') {
    throw new Error('Failed to parse JWT header');
  }
  // Keycloak signs every token with header typ "JWT"; anything else (e.g.
  // "at+jwt" from another IdP, or a JWE) is not one of ours.
  if (header.typ !== undefined && header.typ !== 'JWT') {
    throw new Error('Unexpected JWT header typ');
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

  if (payload === null || typeof payload !== 'object') {
    throw new Error('Failed to parse JWT payload');
  }

  if (typeof payload.iat === 'number' && payload.iat > now + MAX_IAT_SKEW_S) {
    throw new Error('JWT issued in the future (iat)');
  }

  // Validate issuer (exact string match, so a path prefix such as /auth is significant)
  const expectedIssuer = keycloakEndpoints(env).issuer;
  if (!payload.iss || payload.iss !== expectedIssuer) {
    throw new Error(`JWT issuer mismatch: got "${payload.iss}", expected "${expectedIssuer}"`);
  }

  // Token type: only access tokens. Keycloak's ID tokens are signed with the
  // same realm key, carry the same issuer and have aud = the frontend client
  // id, so without this check an ID token (e.g. leaked from a URL fragment or
  // from logs) would be accepted as an API credential. Keycloak puts the type
  // in the `typ` claim: "Bearer" (access), "ID", "Refresh", "Logout", ...
  if (payload.typ !== 'Bearer') {
    throw new Error(`JWT is not an access token (typ=${JSON.stringify(payload.typ)})`);
  }

  const validAudiences = csv(env.VALID_AUDIENCES);
  const aud = payload.aud;
  if (!validateAudience(aud, validAudiences)) {
    throw new Error(`JWT audience not accepted: ${JSON.stringify(aud)}`);
  }

  // Authorized party: the client the token was issued TO. A service-account
  // token of another client in the realm (e.g. japan-trip-worker) can carry
  // our audience through a mapper, but its azp gives it away.
  if (typeof payload.azp !== 'string' || !allowedAuthorizedParties(env).includes(payload.azp)) {
    throw new Error(`JWT azp not accepted: ${JSON.stringify(payload.azp)}`);
  }

  // Validate required claims
  if (typeof payload.sub !== 'string' || payload.sub === '') {
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
