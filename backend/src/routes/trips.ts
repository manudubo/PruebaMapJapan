import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import {
  getTripsByUser,
  getTripById,
  createTrip,
  updateTrip,
  deleteTrip,
  getDestinationsByTrip,
  createDestination,
  updateDestination,
  deleteDestination,
  upsertHotel,
  deleteHotel,
  getDaysByDestination,
  createDay,
  updateDay,
  deleteDay,
  getActivitiesByDay,
  createActivity,
  updateActivity,
  deleteActivity,
  reorderActivities,
} from '../db';
import { destinations, days, hotels, activities, trips } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { ensureUserProvisioned } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import {
  CreateTripSchema,
  UpdateTripSchema,
  CreateDestinationSchema,
  UpdateDestinationSchema,
  CreateDaySchema,
  UpdateDaySchema,
  CreateActivitySchema,
  UpdateActivitySchema,
  ReorderActivitiesSchema,
  UpsertHotelSchema,
} from '../validation/schemas';

const tripsRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// Apply auth + user-provisioning to every route in this router.
tripsRoute.use('*', authMiddleware, ensureUserProvisioned);

// ---------------------------------------------------------------------------
// Helper — verify that a destination belongs to a trip (and the trip belongs
// to the user). Returns the destination row or an error code.
// ---------------------------------------------------------------------------
async function resolveDestination(
  db: ReturnType<typeof getDb>,
  tripId: number,
  destId: number,
  userId: number,
) {
  // Verify trip ownership first
  const tripRows = await db
    .select({ id: trips.id, user_id: trips.user_id })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  const trip = tripRows[0];
  if (!trip) return { error: 'not_found' as const };
  if (trip.user_id !== userId) return { error: 'forbidden' as const };

  const destRows = await db
    .select()
    .from(destinations)
    .where(eq(destinations.id, destId))
    .limit(1);

  const dest = destRows[0];
  if (!dest || dest.trip_id !== tripId) return { error: 'not_found' as const };

  return { dest };
}

// ---------------------------------------------------------------------------
// Helper — verify that a day belongs to a destination (and the destination to
// the right trip / user). Returns the day row or an error code.
// ---------------------------------------------------------------------------
async function resolveDay(
  db: ReturnType<typeof getDb>,
  tripId: number,
  destId: number,
  dayId: number,
  userId: number,
) {
  const destResult = await resolveDestination(db, tripId, destId, userId);
  if ('error' in destResult) return destResult;

  const dayRows = await db
    .select()
    .from(days)
    .where(eq(days.id, dayId))
    .limit(1);

  const day = dayRows[0];
  if (!day || day.destination_id !== destId) return { error: 'not_found' as const };

  return { dest: destResult.dest, day };
}

// ---------------------------------------------------------------------------
// Helper — verify that an activity belongs to a day (which belongs to the
// right destination / trip / user).
// ---------------------------------------------------------------------------
async function resolveActivity(
  db: ReturnType<typeof getDb>,
  tripId: number,
  destId: number,
  dayId: number,
  actId: number,
  userId: number,
) {
  const dayResult = await resolveDay(db, tripId, destId, dayId, userId);
  if ('error' in dayResult) return dayResult;

  const actRows = await db
    .select()
    .from(activities)
    .where(eq(activities.id, actId))
    .limit(1);

  const act = actRows[0];
  if (!act || act.day_id !== dayId) return { error: 'not_found' as const };

  return { dest: dayResult.dest, day: dayResult.day, act };
}

// ===========================================================================
// TRIPS
// ===========================================================================

/**
 * GET /api/trips
 * Returns all trips belonging to the authenticated user.
 */
tripsRoute.get('/', async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');

  try {
    const userTrips = await getTripsByUser(db, userId);
    const response: ApiResponse<typeof userTrips> = { success: true, data: userTrips };
    return c.json(response);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to fetch trips' };
    return c.json(response, 500);
  }
});

/**
 * POST /api/trips
 * Creates a new trip for the authenticated user.
 */
tripsRoute.post('/', zValidator('json', CreateTripSchema), async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const body = c.req.valid('json');

  try {
    const trip = await createTrip(db, userId, body);
    const response: ApiResponse<typeof trip> = { success: true, data: trip };
    return c.json(response, 201);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to create trip' };
    return c.json(response, 500);
  }
});

/**
 * GET /api/trips/:tripId
 * Returns a single trip with full nested details (destinations → hotel, days → activities).
 */
tripsRoute.get('/:tripId', async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const tripId = Number(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  try {
    const trip = await getTripById(db, tripId, userId);
    if (!trip) {
      const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
      return c.json(response, 404);
    }
    const response: ApiResponse<typeof trip> = { success: true, data: trip };
    return c.json(response);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to fetch trip' };
    return c.json(response, 500);
  }
});

/**
 * PATCH /api/trips/:tripId
 * Updates a trip belonging to the authenticated user.
 */
tripsRoute.patch(
  '/:tripId',
  zValidator('json', UpdateTripSchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const body = c.req.valid('json');

    if (isNaN(tripId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
      return c.json(response, 400);
    }

    try {
      const updated = await updateTrip(db, tripId, userId, body);
      const response: ApiResponse<typeof updated> = { success: true, data: updated };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
      return c.json(response, 404);
    }
  },
);

/**
 * DELETE /api/trips/:tripId
 * Deletes a trip belonging to the authenticated user.
 */
tripsRoute.delete('/:tripId', async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const tripId = Number(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  try {
    // Verify the trip exists and belongs to this user before deleting.
    const trip = await getTripById(db, tripId, userId);
    if (!trip) {
      const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
      return c.json(response, 404);
    }

    await deleteTrip(db, tripId, userId);
    const response: ApiResponse<never> = { success: true, message: 'Trip deleted' };
    return c.json(response);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to delete trip' };
    return c.json(response, 500);
  }
});

// ===========================================================================
// DESTINATIONS
// ===========================================================================

/**
 * GET /api/trips/:tripId/destinations
 * Returns all destinations for a trip.
 */
tripsRoute.get('/:tripId/destinations', async (c) => {
  if (!c.env.DATABASE_URL) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }
  const db = getDb(c.env.DATABASE_URL);
  const userId = c.get('dbUserId');
  const tripId = Number(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  try {
    // Verify trip ownership.
    const tripRows = await db
      .select({ id: trips.id, user_id: trips.user_id })
      .from(trips)
      .where(eq(trips.id, tripId))
      .limit(1);

    if (!tripRows[0]) {
      const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
      return c.json(response, 404);
    }
    if (tripRows[0].user_id !== userId) {
      const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
      return c.json(response, 403);
    }

    const dests = await getDestinationsByTrip(db, tripId);
    const response: ApiResponse<typeof dests> = { success: true, data: dests };
    return c.json(response);
  } catch {
    const response: ApiResponse<never> = { success: false, error: 'Failed to fetch destinations' };
    return c.json(response, 500);
  }
});

/**
 * POST /api/trips/:tripId/destinations
 * Adds a destination to a trip.
 */
tripsRoute.post(
  '/:tripId/destinations',
  zValidator('json', CreateDestinationSchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const body = c.req.valid('json');

    if (isNaN(tripId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
      return c.json(response, 400);
    }

    try {
      const tripRows = await db
        .select({ id: trips.id, user_id: trips.user_id })
        .from(trips)
        .where(eq(trips.id, tripId))
        .limit(1);

      if (!tripRows[0]) {
        const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
        return c.json(response, 404);
      }
      if (tripRows[0].user_id !== userId) {
        const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
        return c.json(response, 403);
      }

      const dest = await createDestination(db, tripId, {
        ...body,
        zoom_level: body.zoom_level ?? undefined,
      });
      const response: ApiResponse<typeof dest> = { success: true, data: dest };
      return c.json(response, 201);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to create destination' };
      return c.json(response, 500);
    }
  },
);

/**
 * PATCH /api/trips/:tripId/destinations/:destId
 * Updates a destination.
 */
tripsRoute.patch(
  '/:tripId/destinations/:destId',
  zValidator('json', UpdateDestinationSchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      const updated = await updateDestination(db, destId, body);
      const response: ApiResponse<typeof updated> = { success: true, data: updated };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to update destination' };
      return c.json(response, 500);
    }
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId
 * Removes a destination (cascades to hotel, days, activities).
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      await deleteDestination(db, destId);
      const response: ApiResponse<never> = { success: true, message: 'Destination deleted' };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to delete destination' };
      return c.json(response, 500);
    }
  },
);

// ===========================================================================
// DAYS
// ===========================================================================

/**
 * GET /api/trips/:tripId/destinations/:destId/days
 * Returns all days for a destination.
 */
tripsRoute.get(
  '/:tripId/destinations/:destId/days',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      const dayList = await getDaysByDestination(db, destId);
      const response: ApiResponse<typeof dayList> = { success: true, data: dayList };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to fetch days' };
      return c.json(response, 500);
    }
  },
);

/**
 * POST /api/trips/:tripId/destinations/:destId/days
 * Adds a day to a destination.
 */
tripsRoute.post(
  '/:tripId/destinations/:destId/days',
  zValidator('json', CreateDaySchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      const day = await createDay(db, destId, body);
      const response: ApiResponse<typeof day> = { success: true, data: day };
      return c.json(response, 201);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to create day' };
      return c.json(response, 500);
    }
  },
);

/**
 * PATCH /api/trips/:tripId/destinations/:destId/days/:dayId
 * Updates a day.
 */
tripsRoute.patch(
  '/:tripId/destinations/:destId/days/:dayId',
  zValidator('json', UpdateDaySchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDay(db, tripId, destId, dayId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Day not found' };
        return c.json(response, 404);
      }

      const updated = await updateDay(db, dayId, body);
      const response: ApiResponse<typeof updated> = { success: true, data: updated };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to update day' };
      return c.json(response, 500);
    }
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId/days/:dayId
 * Removes a day (cascades to activities).
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId/days/:dayId',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDay(db, tripId, destId, dayId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Day not found' };
        return c.json(response, 404);
      }

      await deleteDay(db, dayId);
      const response: ApiResponse<never> = { success: true, message: 'Day deleted' };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to delete day' };
      return c.json(response, 500);
    }
  },
);

// ===========================================================================
// ACTIVITIES
// ===========================================================================

/**
 * GET /api/trips/:tripId/destinations/:destId/days/:dayId/activities
 * Returns all activities for a day.
 */
tripsRoute.get(
  '/:tripId/destinations/:destId/days/:dayId/activities',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDay(db, tripId, destId, dayId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Day not found' };
        return c.json(response, 404);
      }

      const acts = await getActivitiesByDay(db, dayId);
      const response: ApiResponse<typeof acts> = { success: true, data: acts };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to fetch activities' };
      return c.json(response, 500);
    }
  },
);

/**
 * POST /api/trips/:tripId/destinations/:destId/days/:dayId/activities
 * Adds an activity to a day.
 */
tripsRoute.post(
  '/:tripId/destinations/:destId/days/:dayId/activities',
  zValidator('json', CreateActivitySchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDay(db, tripId, destId, dayId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Day not found' };
        return c.json(response, 404);
      }

      const act = await createActivity(db, dayId, body);
      const response: ApiResponse<typeof act> = { success: true, data: act };
      return c.json(response, 201);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to create activity' };
      return c.json(response, 500);
    }
  },
);

/**
 * PATCH /api/trips/:tripId/destinations/:destId/days/:dayId/activities/:actId
 * Updates an activity.
 */
tripsRoute.patch(
  '/:tripId/destinations/:destId/days/:dayId/activities/:actId',
  zValidator('json', UpdateActivitySchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));
    const actId = Number(c.req.param('actId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId) || isNaN(actId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveActivity(db, tripId, destId, dayId, actId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Activity not found' };
        return c.json(response, 404);
      }

      const updated = await updateActivity(db, actId, body);
      const response: ApiResponse<typeof updated> = { success: true, data: updated };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to update activity' };
      return c.json(response, 500);
    }
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId/days/:dayId/activities/:actId
 * Deletes an activity.
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId/days/:dayId/activities/:actId',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));
    const actId = Number(c.req.param('actId'));

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId) || isNaN(actId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveActivity(db, tripId, destId, dayId, actId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Activity not found' };
        return c.json(response, 404);
      }

      await deleteActivity(db, actId);
      const response: ApiResponse<never> = { success: true, message: 'Activity deleted' };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to delete activity' };
      return c.json(response, 500);
    }
  },
);

/**
 * POST /api/trips/:tripId/destinations/:destId/days/:dayId/activities/reorder
 * Reorders activities within a day.
 */
tripsRoute.post(
  '/:tripId/destinations/:destId/days/:dayId/activities/reorder',
  zValidator('json', ReorderActivitiesSchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const dayId = Number(c.req.param('dayId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDay(db, tripId, destId, dayId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Day not found' };
        return c.json(response, 404);
      }

      const reordered = await reorderActivities(db, dayId, body.ordered_ids);
      const response: ApiResponse<typeof reordered> = { success: true, data: reordered };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to reorder activities' };
      return c.json(response, 500);
    }
  },
);

// ===========================================================================
// HOTEL
// ===========================================================================

/**
 * GET /api/trips/:tripId/destinations/:destId/hotel
 * Returns the hotel for a destination, if any.
 */
tripsRoute.get(
  '/:tripId/destinations/:destId/hotel',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      const hotelRows = await db
        .select()
        .from(hotels)
        .where(eq(hotels.destination_id, destId))
        .limit(1);

      if (!hotelRows[0]) {
        const response: ApiResponse<never> = { success: false, error: 'Hotel not found' };
        return c.json(response, 404);
      }

      const response: ApiResponse<typeof hotelRows[0]> = { success: true, data: hotelRows[0] };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to fetch hotel' };
      return c.json(response, 500);
    }
  },
);

/**
 * PUT /api/trips/:tripId/destinations/:destId/hotel
 * Creates or replaces the hotel for a destination.
 */
tripsRoute.put(
  '/:tripId/destinations/:destId/hotel',
  zValidator('json', UpsertHotelSchema),
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      const hotel = await upsertHotel(db, destId, body);
      const response: ApiResponse<typeof hotel> = { success: true, data: hotel };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to upsert hotel' };
      return c.json(response, 500);
    }
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId/hotel
 * Removes the hotel for a destination.
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId/hotel',
  async (c) => {
    if (!c.env.DATABASE_URL) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const db = getDb(c.env.DATABASE_URL);
    const userId = c.get('dbUserId');
    const tripId = Number(c.req.param('tripId'));
    const destId = Number(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDestination(db, tripId, destId, userId);
      if ('error' in result) {
        if (result.error === 'forbidden') {
          const response: ApiResponse<never> = { success: false, error: 'Forbidden' };
          return c.json(response, 403);
        }
        const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
        return c.json(response, 404);
      }

      await deleteHotel(db, destId);
      const response: ApiResponse<never> = { success: true, message: 'Hotel deleted' };
      return c.json(response);
    } catch {
      const response: ApiResponse<never> = { success: false, error: 'Failed to delete hotel' };
      return c.json(response, 500);
    }
  },
);

export default tripsRoute;
