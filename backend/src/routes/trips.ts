import { Hono } from 'hono';
import { zValidator } from '../validation/validator';
import { eq } from 'drizzle-orm';
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
  InvalidActivityOrderError,
} from '../db';
import { hotels } from '../db/schema';
import { resolveActivity, resolveDay, resolveDestination, resolveTrip } from '../db/queries/ownership';
import { authMiddleware } from '../middleware/auth';
import { dbMiddleware } from '../middleware/db';
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
import { parseId } from '../validation/ids';

const tripsRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// Apply auth + DB handle + user-provisioning to every route in this router.
tripsRoute.use('*', authMiddleware, dbMiddleware, ensureUserProvisioned);

// Ownership checks (trip → destination → day → activity) are single-JOIN
// queries in db/queries/ownership.ts (M-02). A resource that exists but
// belongs to someone else answers the same 404 as one that does not exist
// (SEC-22); 401 (no/invalid token) is decided earlier by authMiddleware.

// ===========================================================================
// TRIPS
// ===========================================================================

/**
 * GET /api/trips
 * Returns all trips belonging to the authenticated user.
 */
tripsRoute.get('/', async (c) => {
  const db = c.get('db');
  const userId = c.get('dbUserId');

  const userTrips = await getTripsByUser(db, userId);
  const response: ApiResponse<typeof userTrips> = { success: true, data: userTrips };
  return c.json(response);
});

/**
 * POST /api/trips
 * Creates a new trip for the authenticated user.
 */
tripsRoute.post('/', zValidator('json', CreateTripSchema), async (c) => {
  const db = c.get('db');
  const userId = c.get('dbUserId');
  const body = c.req.valid('json');

  const trip = await createTrip(db, userId, body);
  const response: ApiResponse<typeof trip> = { success: true, data: trip };
  return c.json(response, 201);
});

/**
 * GET /api/trips/:tripId
 * Returns a single trip with full nested details (destinations → hotel, days → activities).
 */
tripsRoute.get('/:tripId', async (c) => {
  const db = c.get('db');
  const userId = c.get('dbUserId');
  const tripId = parseId(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  const trip = await getTripById(db, tripId, userId);
  if (!trip) {
    const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
    return c.json(response, 404);
  }
  const response: ApiResponse<typeof trip> = { success: true, data: trip };
  return c.json(response);
});

/**
 * PATCH /api/trips/:tripId
 * Updates a trip belonging to the authenticated user.
 */
tripsRoute.patch(
  '/:tripId',
  zValidator('json', UpdateTripSchema),
  async (c) => {
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const body = c.req.valid('json');

    if (isNaN(tripId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
      return c.json(response, 400);
    }

    const updated = await updateTrip(db, tripId, userId, body);
    if (!updated) {
      const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
      return c.json(response, 404);
    }
    const response: ApiResponse<typeof updated> = { success: true, data: updated };
    return c.json(response);
  },
);

/**
 * DELETE /api/trips/:tripId
 * Deletes a trip belonging to the authenticated user.
 */
tripsRoute.delete('/:tripId', async (c) => {
  const db = c.get('db');
  const userId = c.get('dbUserId');
  const tripId = parseId(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  // Verify the trip exists and belongs to this user before deleting.
  const trip = await getTripById(db, tripId, userId);
  if (!trip) {
    const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
    return c.json(response, 404);
  }

  await deleteTrip(db, tripId, userId);
  const response: ApiResponse<never> = { success: true, message: 'Trip deleted' };
  return c.json(response);
});

// ===========================================================================
// DESTINATIONS
// ===========================================================================

/**
 * GET /api/trips/:tripId/destinations
 * Returns all destinations for a trip.
 */
tripsRoute.get('/:tripId/destinations', async (c) => {
  const db = c.get('db');
  const userId = c.get('dbUserId');
  const tripId = parseId(c.req.param('tripId'));

  if (isNaN(tripId)) {
    const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
    return c.json(response, 400);
  }

  // SEC-22: a foreign trip is reported exactly like a missing one.
  if ('error' in (await resolveTrip(db, tripId, userId))) {
    const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
    return c.json(response, 404);
  }

  const dests = await getDestinationsByTrip(db, tripId);
  const response: ApiResponse<typeof dests> = { success: true, data: dests };
  return c.json(response);
});

/**
 * POST /api/trips/:tripId/destinations
 * Adds a destination to a trip.
 */
tripsRoute.post(
  '/:tripId/destinations',
  zValidator('json', CreateDestinationSchema),
  async (c) => {
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const body = c.req.valid('json');

    if (isNaN(tripId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid trip id' };
      return c.json(response, 400);
    }

    if ('error' in (await resolveTrip(db, tripId, userId))) {
      const response: ApiResponse<never> = { success: false, error: 'Trip not found' };
      return c.json(response, 404);
    }

    const dest = await createDestination(db, tripId, {
      ...body,
      zoom_level: body.zoom_level ?? undefined,
    });
    const response: ApiResponse<typeof dest> = { success: true, data: dest };
    return c.json(response, 201);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }

    const updated = await updateDestination(db, destId, body);
    if (!updated) {
      // Deleted (e.g. with its trip) between the ownership check and the write.
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }
    const response: ApiResponse<typeof updated> = { success: true, data: updated };
    return c.json(response);
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId
 * Removes a destination (cascades to hotel, days, activities).
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId',
  async (c) => {
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }

    await deleteDestination(db, destId);
    const response: ApiResponse<never> = { success: true, message: 'Destination deleted' };
    return c.json(response);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }

    const dayList = await getDaysByDestination(db, destId);
    const response: ApiResponse<typeof dayList> = { success: true, data: dayList };
    return c.json(response);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }

    const day = await createDay(db, destId, body);
    const response: ApiResponse<typeof day> = { success: true, data: day };
    return c.json(response, 201);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDay(db, tripId, destId, dayId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Day not found' };
      return c.json(response, 404);
    }

    const updated = await updateDay(db, dayId, body);
    if (!updated) {
      // Deleted (e.g. with its trip) between the ownership check and the write.
      const response: ApiResponse<never> = { success: false, error: 'Day not found' };
      return c.json(response, 404);
    }
    const response: ApiResponse<typeof updated> = { success: true, data: updated };
    return c.json(response);
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId/days/:dayId
 * Removes a day (cascades to activities).
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId/days/:dayId',
  async (c) => {
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDay(db, tripId, destId, dayId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Day not found' };
      return c.json(response, 404);
    }

    await deleteDay(db, dayId);
    const response: ApiResponse<never> = { success: true, message: 'Day deleted' };
    return c.json(response);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDay(db, tripId, destId, dayId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Day not found' };
      return c.json(response, 404);
    }

    const acts = await getActivitiesByDay(db, dayId);
    const response: ApiResponse<typeof acts> = { success: true, data: acts };
    return c.json(response);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDay(db, tripId, destId, dayId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Day not found' };
      return c.json(response, 404);
    }

    const act = await createActivity(db, dayId, body);
    const response: ApiResponse<typeof act> = { success: true, data: act };
    return c.json(response, 201);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));
    const actId = parseId(c.req.param('actId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId) || isNaN(actId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveActivity(db, tripId, destId, dayId, actId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Activity not found' };
      return c.json(response, 404);
    }

    const updated = await updateActivity(db, actId, body);
    if (!updated) {
      // Deleted (e.g. with its trip) between the ownership check and the write.
      const response: ApiResponse<never> = { success: false, error: 'Activity not found' };
      return c.json(response, 404);
    }
    const response: ApiResponse<typeof updated> = { success: true, data: updated };
    return c.json(response);
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId/days/:dayId/activities/:actId
 * Deletes an activity.
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId/days/:dayId/activities/:actId',
  async (c) => {
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));
    const actId = parseId(c.req.param('actId'));

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId) || isNaN(actId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveActivity(db, tripId, destId, dayId, actId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Activity not found' };
      return c.json(response, 404);
    }

    await deleteActivity(db, actId);
    const response: ApiResponse<never> = { success: true, message: 'Activity deleted' };
    return c.json(response);
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const dayId = parseId(c.req.param('dayId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId) || isNaN(dayId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    try {
      const result = await resolveDay(db, tripId, destId, dayId, userId);
      if ('error' in result) {
        const response: ApiResponse<never> = { success: false, error: 'Day not found' };
        return c.json(response, 404);
      }

      const reordered = await reorderActivities(db, dayId, body.ordered_ids);
      const response: ApiResponse<typeof reordered> = { success: true, data: reordered };
      return c.json(response);
    } catch (err) {
      if (err instanceof InvalidActivityOrderError) {
        const response: ApiResponse<never> = { success: false, error: err.message };
        return c.json(response, 400);
      }
      throw err; // M-09: logged by the global onError handler
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
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
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));
    const body = c.req.valid('json');

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }

    const hotel = await upsertHotel(db, destId, body);
    const response: ApiResponse<typeof hotel> = { success: true, data: hotel };
    return c.json(response);
  },
);

/**
 * DELETE /api/trips/:tripId/destinations/:destId/hotel
 * Removes the hotel for a destination.
 */
tripsRoute.delete(
  '/:tripId/destinations/:destId/hotel',
  async (c) => {
    const db = c.get('db');
    const userId = c.get('dbUserId');
    const tripId = parseId(c.req.param('tripId'));
    const destId = parseId(c.req.param('destId'));

    if (isNaN(tripId) || isNaN(destId)) {
      const response: ApiResponse<never> = { success: false, error: 'Invalid id' };
      return c.json(response, 400);
    }

    const result = await resolveDestination(db, tripId, destId, userId);
    if ('error' in result) {
      const response: ApiResponse<never> = { success: false, error: 'Destination not found' };
      return c.json(response, 404);
    }

    await deleteHotel(db, destId);
    const response: ApiResponse<never> = { success: true, message: 'Hotel deleted' };
    return c.json(response);
  },
);

export default tripsRoute;
