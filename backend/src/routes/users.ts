import { Hono } from 'hono';
import { zValidator } from '../validation/validator';
import {
  getUserByKeycloakId,
  updateUser,
  upsertUser,
  getTripsByUser,
  getDb,
} from '../db';
import { authMiddleware } from '../middleware/auth';
import { userClaimsFromJwt } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { UpdateUserSchema } from '../validation/schemas';

const usersRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// ===========================================================================
// ROUTES
// ===========================================================================

/**
 * GET /api/users/me
 * Returns the authenticated user's profile.
 * If the user does not exist in the DB yet (first login) it is auto-created;
 * otherwise email/name are refreshed from the token when they changed.
 */
usersRoute.get('/me', authMiddleware, async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  // Race-safe auto-provision + Keycloak email/name refresh (BUG-03/BUG-08).
  const { user, created } = await upsertUser(db, userClaimsFromJwt(c.get('user')));

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
  // Auto-provision if needed (idempotent, race-safe on every call).
  const { user } = await upsertUser(db, userClaimsFromJwt(c.get('user')));

  const userTrips = await getTripsByUser(db, user.id);
  const response: ApiResponse = { success: true, data: userTrips };
  return c.json(response);
});

export default usersRoute;
