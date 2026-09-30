import { Hono } from 'hono';
import { getTripBySlug } from '../db/queries/trips';
import { dbMiddleware } from '../middleware/db';
import type { Env, ContextVariables, ApiResponse } from '../types';

const publicRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

publicRoute.use('*', dbMiddleware);

/** Canonical 8-4-4-4-12 hex UUID (public_slug is a Postgres uuid column). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// PUBLIC ROUTES — no authentication required
// ===========================================================================

/**
 * GET /api/public/trips/:slug
 * Returns the full nested details of a trip that has is_public = true.
 * No authentication is required. Slug must be a valid UUID.
 */
publicRoute.get('/trips/:slug', async (c) => {
  const db = c.get('db');
  const slug = c.req.param('slug');

  if (!slug || !UUID_RE.test(slug)) {
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
