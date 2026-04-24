import { eq } from 'drizzle-orm';
import type { Db } from '../index';
import { destinations, hotels } from '../schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Destination = typeof destinations.$inferSelect;
export type Hotel = typeof hotels.$inferSelect;

export type CreateDestinationData = {
  city_name: string;
  country: string;
  start_date?: string | null;
  end_date?: string | null;
  lat?: string | null;
  lng?: string | null;
  zoom_level?: number | null;
  order_index?: number;
};

export type UpdateDestinationData = Partial<CreateDestinationData>;

export type CreateHotelData = {
  name: string;
  lat?: string | null;
  lng?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all destinations for a given trip, ordered by order_index.
 */
export async function getDestinationsByTrip(
  db: Db,
  tripId: number,
): Promise<Destination[]> {
  return db
    .select()
    .from(destinations)
    .where(eq(destinations.trip_id, tripId))
    .orderBy(destinations.order_index);
}

/**
 * Create a new destination inside a trip.
 */
export async function createDestination(
  db: Db,
  tripId: number,
  data: CreateDestinationData,
): Promise<Destination> {
  const [created] = await db
    .insert(destinations)
    .values({
      trip_id: tripId,
      city_name: data.city_name,
      country: data.country,
      start_date: data.start_date ?? null,
      end_date: data.end_date ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      zoom_level: data.zoom_level ?? 12,
      order_index: data.order_index ?? 0,
    })
    .returning();

  if (!created) throw new Error('createDestination: insert returned no rows');
  return created;
}

/**
 * Update mutable fields on a destination.
 */
export async function updateDestination(
  db: Db,
  destId: number,
  data: UpdateDestinationData,
): Promise<Destination> {
  const [updated] = await db
    .update(destinations)
    .set(data)
    .where(eq(destinations.id, destId))
    .returning();

  if (!updated) throw new Error(`updateDestination: no destination found for id=${destId}`);
  return updated;
}

/**
 * Delete a destination (cascades to hotels, days, and activities).
 */
export async function deleteDestination(db: Db, destId: number): Promise<void> {
  await db.delete(destinations).where(eq(destinations.id, destId));
}

/**
 * Return a destination with its hotel, days, and activities fully populated.
 */
export async function getFullDestination(db: Db, destId: number) {
  return db.query.destinations.findFirst({
    where: eq(destinations.id, destId),
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
  });
}

// ---------------------------------------------------------------------------
// Hotel helpers (used during destination creation)
// ---------------------------------------------------------------------------

/**
 * Create or replace the hotel for a destination.
 */
export async function upsertHotel(
  db: Db,
  destinationId: number,
  data: CreateHotelData,
): Promise<Hotel> {
  // Delete any existing hotel first (one-to-one relationship enforced by app)
  await db.delete(hotels).where(eq(hotels.destination_id, destinationId));

  const [created] = await db
    .insert(hotels)
    .values({
      destination_id: destinationId,
      name: data.name,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      check_in_date: data.check_in_date ?? null,
      check_out_date: data.check_out_date ?? null,
    })
    .returning();

  if (!created) throw new Error('upsertHotel: insert returned no rows');
  return created;
}
