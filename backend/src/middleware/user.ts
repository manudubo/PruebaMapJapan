import type { Context, Next } from 'hono';
import type { Env, ContextVariables } from '../types';
import { getDb, getUserByKeycloakId, createUser } from '../db';

/**
 * Looks up the user by keycloak_id. If not found, creates them automatically
 * from JWT claims (auto-provision on first login).
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

  const jwtUser = c.get('user');
  const db = getDb(c.env.DATABASE_URL);

  try {
    let dbUser = await getUserByKeycloakId(db, jwtUser.sub);
    if (!dbUser) {
      dbUser = await createUser(db, {
        keycloak_id: jwtUser.sub,
        email: jwtUser.email ?? '',
        name: jwtUser.name ?? jwtUser.preferred_username ?? jwtUser.sub,
      });
    }
    c.set('dbUserId', dbUser.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision user';
    return c.json({ success: false, error: message }, 500);
  }

  await next();
}
