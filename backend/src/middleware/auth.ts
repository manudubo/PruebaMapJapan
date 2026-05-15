import type { Context, Next } from 'hono';
import type { Env, ContextVariables } from '../types';
import { verifyJwt } from '../auth/keycloak';

/**
 * JWT auth middleware — Keycloak JWKS verification.
 *
 * Behaviour:
 *  1. Reads the `Authorization: Bearer <token>` header.
 *  2. Fetches Keycloak JWKS (cached for 1 hour) and verifies the RS256 signature.
 *  3. Validates: signature, expiry (exp), not-before (nbf), issuer (iss), audience (aud).
 *  4. Stores the verified payload in `c.var.user` for downstream handlers.
 *
 * Uses only the Web Crypto API — compatible with Cloudflare Workers.
 * Keycloak JWKS endpoint: {KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyJwt(token, c.env);
    c.set('user', payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'JWT verification failed';
    return c.json({ success: false, error: message }, 401);
  }

  await next();
}
