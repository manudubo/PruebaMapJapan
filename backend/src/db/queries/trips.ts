import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../index';
import { activities, days, destinations, trips } from '../schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Trip = typeof trips.$inferSelect;

export type CreateTripData = {
  name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  cover_image_url?: string | null;
  is_public?: boolean;
};

export type UpdateTripData = Partial<CreateTripData>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all trips belonging to `userId`, newest first.
 */
export async function getTripsByUser(db: Db, userId: number): Promise<Trip[]> {
  return db
    .select()
    .from(trips)
    .where(eq(trips.user_id, userId))
    .orderBy(desc(trips.created_at));
}

/**
 * Return a single trip with its full nested structure:
 * destinations → hotels + days → activities.
 * Enforces ownership by requiring `userId`.
 */
export async function getTripById(
  db: Db,
  tripId: number,
  userId: number,
) {
  // Fetch the trip row first so we can return undefined when not found.
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.user_id, userId)))
    .limit(1);

  if (!trip) return undefined;

  // Fetch the full nested tree using Drizzle's relational query API.
  const result = await db.query.trips.findFirst({
    where: and(eq(trips.id, tripId), eq(trips.user_id, userId)),
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

  return result;
}

/**
 * Create a new trip for `userId` and return the created row.
 */
export async function createTrip(
  db: Db,
  userId: number,
  data: CreateTripData,
): Promise<Trip> {
  const [created] = await db
    .insert(trips)
    .values({
      user_id: userId,
      name: data.name,
      description: data.description ?? null,
      start_date: data.start_date ?? null,
      end_date: data.end_date ?? null,
      cover_image_url: data.cover_image_url ?? null,
      is_public: data.is_public ?? false,
    })
    .returning();

  if (!created) throw new Error('createTrip: insert returned no rows');
  return created;
}

/**
 * Update fields on a trip. Ownership is verified via `userId`.
 * Returns the updated row.
 */
export async function updateTrip(
  db: Db,
  tripId: number,
  userId: number,
  data: UpdateTripData,
): Promise<Trip> {
  const [updated] = await db
    .update(trips)
    .set({ ...data, updated_at: new Date() })
    .where(and(eq(trips.id, tripId), eq(trips.user_id, userId)))
    .returning();

  if (!updated) throw new Error(`updateTrip: no trip found for id=${tripId}, userId=${userId}`);
  return updated;
}

/**
 * Delete a trip (cascades to destinations → days → activities).
 * Ownership is verified via `userId`.
 */
export async function deleteTrip(
  db: Db,
  tripId: number,
  userId: number,
): Promise<void> {
  await db
    .delete(trips)
    .where(and(eq(trips.id, tripId), eq(trips.user_id, userId)));
}

// (Sub-table types are exported from their own query files.)
