import type { Context, Next } from 'hono';
import type { Env, ContextVariables, KeycloakJwtPayload } from '../types';
import { upsertUser, type UserClaims } from '../db';

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
 * This middleware MUST run after authMiddleware (which sets c.var.user) and
 * dbMiddleware (which sets c.var.db).
 */
export async function ensureUserProvisioned(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  const db = c.get('db');

  // Failures propagate to the global onError handler, which logs them and
  // answers a generic 500 — the raw DB message is never sent to the client.
  const { user } = await upsertUser(db, userClaimsFromJwt(c.get('user')));
  c.set('dbUserId', user.id);
  c.set('emailVerifiedAt', user.email_verified_at);

  await next();
}
