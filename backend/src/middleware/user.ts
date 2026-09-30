import type { Context, Next } from 'hono';
import type { Env, ContextVariables, KeycloakJwtPayload } from '../types';
import { getDb, upsertUser, type UserClaims } from '../db';

/**
 * Fit a claim into a varchar(255) column. Keycloak builds `name` from first +
 * last name (up to 255 chars each) and does not forbid NUL, while Postgres
 * rejects NUL and over-long values — which failed provisioning on every
 * request, locking the user out.
 */
function toVarchar255(value: string): string {
  return Array.from(value.replace(/\u0000/g, '')).slice(0, 255).join('');
}

/**
 * Map verified Keycloak JWT claims to the fields stored on the app user row.
 */
export function userClaimsFromJwt(jwtUser: KeycloakJwtPayload): UserClaims {
  return {
    keycloak_id: jwtUser.sub,
    email: toVarchar255(jwtUser.email ?? ''),
    name: toVarchar255(jwtUser.name ?? jwtUser.preferred_username ?? jwtUser.sub),
  };
}

/**
 * Provisions the app user from JWT claims (race-safe on first login) and
 * refreshes email/name when they changed in Keycloak — see upsertUser.
 * Sets c.set('dbUserId', user.id) for use in downstream route handlers.
 *
 * This middleware MUST run after authMiddleware (which sets c.var.user).
 */
export async function ensureUserProvisioned(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  if (!c.env.DATABASE_URL) {
    return c.json({ success: false, error: 'Server configuration error: missing DATABASE_URL' }, 500);
  }

  const db = getDb(c.env.DATABASE_URL);

  try {
    const { user } = await upsertUser(db, userClaimsFromJwt(c.get('user')));
    c.set('dbUserId', user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision user';
    return c.json({ success: false, error: message }, 500);
  }

  await next();
}
