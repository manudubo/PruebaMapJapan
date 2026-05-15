import { Hono } from 'hono';
import { getDb } from '../db';
import { getTripBySlug } from '../db/queries/trips';
import type { Env, ContextVariables, ApiResponse } from '../types';

const publicRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// ===========================================================================
// PUBLIC ROUTES — no authentication required
// ===========================================================================

/**
 * GET /api/public/trips/:slug
 * Returns the full nested details of a trip that has is_public = true.
 * No authentication is required. Slug must be a valid UUID.
 */
publicRoute.get('/trips/:slug', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const slug = c.req.param('slug');

  if (!slug || !/^[0-9a-f-]{36}$/.test(slug)) {
    const response: ApiResponse = { success: false, error: 'Invalid slug' };
    return c.json(response, 400);
  }

  const result = await getTripBySlug(db, slug);

  if (!result) {
    const response: ApiResponse = { success: false, error: 'Trip not found' };
    return c.json(response, 404);
  }

  const response: ApiResponse = { success: true, data: result };
  return c.json(response);
});

export default publicRoute;
