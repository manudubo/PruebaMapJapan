import type { Context, Next } from 'hono';
import type { Env, ContextVariables } from '../types';
import { verifyJwt } from '../auth/keycloak';
import { log } from '../observability/logger';

/** Upper bound on a logged rejection reason — the reason embeds token claims. */
const MAX_LOGGED_REASON = 300;

/**
 * Server-side log line for a rejected token. The reason can contain
 * attacker-controlled claim values (iss/aud/kid/alg), so it is JSON-encoded
 * (no raw newlines → no log-line forgery) and truncated.
 */
export function formatJwtRejection(err: unknown): string {
  const reason = err instanceof Error ? err.message : 'JWT verification failed';
  const clipped =
    reason.length > MAX_LOGGED_REASON ? `${reason.slice(0, MAX_LOGGED_REASON)}…` : reason;
  return `[auth] JWT rejected: ${JSON.stringify(clipped)}`;
}

/**
 * JWT auth middleware — Keycloak JWKS verification.
 *
 * Behaviour:
 *  1. Reads the `Authorization: Bearer <token>` header.
 *  2. Fetches Keycloak JWKS (cached for 1 hour) and verifies the RS256 signature.
 *  3. Validates: signature, expiry (exp), not-before (nbf), issuer (iss), audience (aud).
 *  4. Stores the verified payload in `c.var.user` for downstream handlers.
 *
 * Every verification failure returns the same generic `invalid_token` body
 * (SEC-06): the underlying reason names the expected issuer (Keycloak URL +
 * realm) and accepted audiences, so it is logged server-side only.
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
    log.warn('auth.jwt_rejected', { request_id: c.get('requestId'), reason: formatJwtRejection(err) });
    c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
    return c.json({ success: false, error: 'invalid_token' }, 401);
  }

  await next();
}
