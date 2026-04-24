import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db';
import { trips } from '../db/schema';
import type { Env, ContextVariables, ApiResponse } from '../types';

const publicRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// ===========================================================================
// PUBLIC ROUTES — no authentication required
// ===========================================================================

/**
 * GET /api/public/trips/:tripId
 * Returns the full nested details of a trip that has is_public = true.
 * No authentication is required.
 */
publicRoute.get('/trips/:tripId', async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const tripId = Number(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  // Only return the trip when it exists AND is_public is true.
  const result = await db.query.trips.findFirst({
    where: and(eq(trips.id, tripId), eq(trips.is_public, true)),
    with: {
      destinations: {
        orderBy: (d, { asc }) => [asc(d.order_index)],
        with: {
          hotel: true,
          days: {
            orderBy: (d, { asc }) => [asc(d.order_index)],
            with: {
              activities: {
                orderBy: (a, { asc }) => [asc(a.order_index)],
              },
            },
          },
        },
      },
    },
  });

  if (!result) {
    const response: ApiResponse = { success: false, error: 'Trip not found' };
    return c.json(response, 404);
  }

  const response: ApiResponse = { success: true, data: result };
  return c.json(response);
});

export default publicRoute;
