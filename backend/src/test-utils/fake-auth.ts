import type { Context, Next } from 'hono';
import type { ContextVariables, Env, KeycloakJwtPayload } from '../types';

/**
 * Test double for middleware/auth.ts: the `x-test-sub` header is the
 * authenticated Keycloak subject; no header → the real middleware's 401.
 * Optional `x-test-email` / `x-test-name` override the derived claims
 * (`x-test-email: ""` simulates a token without an email claim).
 * `x-test-email-verified` sets the claim: "true" (default) | "false" |
 * "string" (the STRING "true") | "missing" (no claim) | "1" (the number 1).
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  const sub = c.req.header('x-test-sub');
  if (!sub) {
    return c.json({ success: false, error: 'Missing or invalid Authorization header' }, 401);
  }
  const email = c.req.header('x-test-email');
  const user: KeycloakJwtPayload = {
    sub,
    iss: 'http://localhost:8080/realms/japan-trip',
    email: email === undefined ? `${sub}@example.com` : email || undefined,
    name: c.req.header('x-test-name') ?? sub,
    preferred_username: sub,
    email_verified: true,
    iat: 0,
    exp: 0,
  };
  const verified = c.req.header('x-test-email-verified');
  if (verified !== undefined) {
    const claim = { true: true, false: false, string: 'true', '1': 1 }[verified as 'true'];
    if (verified === 'missing') delete (user as Partial<KeycloakJwtPayload>).email_verified;
    else (user as unknown as Record<string, unknown>).email_verified = claim;
  }
  c.set('user', user);
  await next();
}
