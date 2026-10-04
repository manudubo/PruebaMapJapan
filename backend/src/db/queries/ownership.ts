import { and, eq } from 'drizzle-orm';
import type { Db } from '../index';
import { activities, days, destinations, trips } from '../schema';
import type { Destination } from './destinations';
import type { Day } from './days';
import type { Activity } from './activities';

// ---------------------------------------------------------------------------
// Ownership cascade (trip → destination → day → activity) in ONE query (M-02).
//
// Previously each level was a separate SELECT, so resolving an activity cost
// four sequential round trips — real network latency on Workers + Neon HTTP.
// Now the trip row is LEFT JOINed to each child *constrained to its parent*,
// and the trip is matched on (id, owner) together:
//   - trip missing                          → not_found
//   - trip owned by someone else            → not_found (SEC-22)
//   - child missing or under another parent → not_found
//
// SEC-22: there is deliberately no "forbidden" outcome. A 403 for "exists but
// not yours" next to a 404 for "does not exist" let any signed-in user
// enumerate which ids exist. Filtering on the owner inside the query means a
// foreign trip is, to the caller, indistinguishable from a missing one — the
// route cannot leak the difference even by accident.
// ---------------------------------------------------------------------------

export type OwnershipError = { error: 'not_found' };

// Never matches a serial id; lets every level be joined unconditionally.
const NO_ID = -1;

async function resolveChain(
  db: Db,
  userId: number,
  tripId: number,
  destId?: number,
  dayId?: number,
  actId?: number,
) {
  const rows = await db
    .select({ tripId: trips.id, dest: destinations, day: days, act: activities })
    .from(trips)
    .leftJoin(
      destinations,
      and(eq(destinations.id, destId ?? NO_ID), eq(destinations.trip_id, trips.id)),
    )
    .leftJoin(days, and(eq(days.id, dayId ?? NO_ID), eq(days.destination_id, destinations.id)))
    .leftJoin(activities, and(eq(activities.id, actId ?? NO_ID), eq(activities.day_id, days.id)))
    .where(and(eq(trips.id, tripId), eq(trips.user_id, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return { error: 'not_found' as const };
  return row;
}

/** The trip exists and belongs to `userId`. */
export async function resolveTrip(
  db: Db,
  tripId: number,
  userId: number,
): Promise<OwnershipError | { tripId: number }> {
  const r = await resolveChain(db, userId, tripId);
  if ('error' in r) return r;
  return { tripId };
}

export async function resolveDestination(
  db: Db,
  tripId: number,
  destId: number,
  userId: number,
): Promise<OwnershipError | { dest: Destination }> {
  const r = await resolveChain(db, userId, tripId, destId);
  if ('error' in r) return r;
  if (!r.dest) return { error: 'not_found' };
  return { dest: r.dest };
}

export async function resolveDay(
  db: Db,
  tripId: number,
  destId: number,
  dayId: number,
  userId: number,
): Promise<OwnershipError | { dest: Destination; day: Day }> {
  const r = await resolveChain(db, userId, tripId, destId, dayId);
  if ('error' in r) return r;
  if (!r.dest || !r.day) return { error: 'not_found' };
  return { dest: r.dest, day: r.day };
}

export async function resolveActivity(
  db: Db,
  tripId: number,
  destId: number,
  dayId: number,
  actId: number,
  userId: number,
): Promise<OwnershipError | { dest: Destination; day: Day; act: Activity }> {
  const r = await resolveChain(db, userId, tripId, destId, dayId, actId);
  if ('error' in r) return r;
  if (!r.dest || !r.day || !r.act) return { error: 'not_found' };
  return { dest: r.dest, day: r.day, act: r.act };
}
