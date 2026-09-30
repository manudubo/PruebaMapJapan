import type { Context, Next } from 'hono';
import type { Env, ContextVariables, KeycloakJwtPayload } from '../types';
import { upsertUser, type UserClaims } from '../db';

/**
 * Map verified Keycloak JWT claims to the fields stored on the app user row.
 */
export function userClaimsFromJwt(jwtUser: KeycloakJwtPayload): UserClaims {
  return {
    keycloak_id: jwtUser.sub,
    email: jwtUser.email ?? '',
    name: jwtUser.name ?? jwtUser.preferred_username ?? jwtUser.sub,
  };
}

/**
 * Provisions the app user from JWT claims (race-safe on first login) and
 * refreshes email/name when they changed in Keycloak — see upsertUser.
 * Sets c.set('dbUserId', user.id) for use in downstream route handlers.
 *
 * This middleware MUST run after authMiddleware (which sets c.var.user) and
 * dbMiddleware (which sets c.var.db).
 */
export async function ensureUserProvisioned(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  const db = c.get('db');

  try {
    const { user } = await upsertUser(db, userClaimsFromJwt(c.get('user')));
    c.set('dbUserId', user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision user';
    return c.json({ success: false, error: message }, 500);
  }

  await next();
}
