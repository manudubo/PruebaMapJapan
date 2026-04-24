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

function base64urlDecode(base64url: string): string {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
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

// ---------------------------------------------------------------------------
// Fetch JWKS from Keycloak and cache imported CryptoKeys
// ---------------------------------------------------------------------------

export async function getKeycloakJwks(env: Env): Promise<Map<string, CryptoKey>> {
  const now = Date.now();

  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

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
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    throw new Error('JWT has expired');
  }

  // Validate not-before (nbf) if present
  if (payload.nbf !== undefined && payload.nbf > now) {
    throw new Error('JWT is not yet valid (nbf)');
  }

  // Validate issuer
  const expectedIssuer = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}`;
  if (!payload.iss || payload.iss !== expectedIssuer) {
    throw new Error(`JWT issuer mismatch: got "${payload.iss}", expected "${expectedIssuer}"`);
  }

  // Validate audience — must include japan-trip-api or japan-trip-frontend
  const validAudiences = ['japan-trip-api', 'japan-trip-frontend', 'account'];
  const aud = payload.aud;
  if (aud) {
    const audArray = Array.isArray(aud) ? aud : [aud];
    const hasValidAud = audArray.some((a) => validAudiences.includes(a));
    if (!hasValidAud) {
      throw new Error(`JWT audience not accepted: ${JSON.stringify(aud)}`);
    }
  }

  // Validate required claims
  if (!payload.sub) {
    throw new Error('JWT missing required sub claim');
  }

  // Get JWKS and find the matching key
  const keyMap = await getKeycloakJwks(env);
  let publicKey = keyMap.get(header.kid);

  if (!publicKey) {
    // Force a refresh in case the key was rotated
    jwksCache = null;
    const refreshedKeyMap = await getKeycloakJwks(env);
    publicKey = refreshedKeyMap.get(header.kid);
    if (!publicKey) {
      throw new Error(`JWT signing key not found: kid=${header.kid}`);
    }
  }

  // Verify RS256 signature using Web Crypto API
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signingInputBytes = new TextEncoder().encode(signingInput);
  const signatureBytes = base64urlToArrayBuffer(encodedSignature);

  const isValid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signatureBytes,
    signingInputBytes,
  );

  if (!isValid) {
    throw new Error('JWT signature verification failed');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Extract standardized user info from a verified Keycloak JWT payload
// ---------------------------------------------------------------------------

export function extractUserInfo(payload: KeycloakJwtPayload): UserInfo {
  const roles = payload.realm_access?.roles ?? [];

  // Cast to access custom attributes that may not be in the base type
  const raw = payload as Record<string, unknown>;

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
