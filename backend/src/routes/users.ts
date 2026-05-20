import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  getUserByKeycloakId,
  createUser,
  updateUser,
  getTripsByUser,
  getDb,
} from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { UpdateUserSchema } from '../validation/schemas';

const usersRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// ---------------------------------------------------------------------------
// Helper — look up the DB user by Keycloak subject; auto-provision on first
// login. Returns the user row (existing or freshly created).
// ---------------------------------------------------------------------------
async function getOrCreateUser(
  db: ReturnType<typeof getDb>,
  keycloakId: string,
  email: string,
  name: string,
) {
  const existing = await getUserByKeycloakId(db, keycloakId);
  if (existing) return { user: existing, created: false };

  const created = await createUser(db, { keycloak_id: keycloakId, email, name });
  return { user: created, created: true };
}

// ===========================================================================
// ROUTES
// ===========================================================================

/**
 * GET /api/users/me
 * Returns the authenticated user's profile.
 * If the user does not exist in the DB yet (first login) it is auto-created.
 */
usersRoute.get('/me', authMiddleware, async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const jwtUser = c.get('user');

  const { user, created } = await getOrCreateUser(
    db,
    jwtUser.sub,
    jwtUser.email ?? '',
    jwtUser.name ?? jwtUser.preferred_username,
  );

  const response: ApiResponse = { success: true, data: user };
  return c.json(response, created ? 201 : 200);
});

/**
 * PATCH /api/users/me
 * Updates mutable fields (name, avatar_url, preferences) on the authenticated
 * user's profile.
 */
usersRoute.patch(
  '/me',
  authMiddleware,
  zValidator('json', UpdateUserSchema),
  async (c) => {
    const db = getDb(c.env.DATABASE_URL);
    const jwtUser = c.get('user');
    const body = c.req.valid('json');

    // Ensure the user exists before updating.
    const existing = await getUserByKeycloakId(db, jwtUser.sub);
    if (!existing) {
      const response: ApiResponse = { success: false, error: 'User not found' };
      return c.json(response, 404);
    }

    const updated = await updateUser(db, jwtUser.sub, body);
    const response: ApiResponse = { success: true, data: updated };
    return c.json(response);
  },
);

/**
 * GET /api/users/me/trips
 * Shortcut — returns the same trip list as GET /api/trips.
 */
usersRoute.get('/me/trips', authMiddleware, async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const jwtUser = c.get('user');

  // Auto-provision if needed (idempotent on every call).
  const { user } = await getOrCreateUser(
    db,
    jwtUser.sub,
    jwtUser.email ?? '',
    jwtUser.name ?? jwtUser.preferred_username,
  );

  const userTrips = await getTripsByUser(db, user.id);
  const response: ApiResponse = { success: true, data: userTrips };
  return c.json(response);
});

export default usersRoute;
