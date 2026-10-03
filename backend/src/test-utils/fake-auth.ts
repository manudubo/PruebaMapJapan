import type { Context, Next } from 'hono';
import type { ContextVariables, Env, KeycloakJwtPayload } from '../types';

/**
 * Test double for middleware/auth.ts: the `x-test-sub` header is the
 * authenticated Keycloak subject; no header → the real middleware's 401.
 * Optional `x-test-email` / `x-test-name` override the derived claims
 * (`x-test-email: ""` simulates a token without an email claim).
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
  c.set('user', user);
  await next();
}
