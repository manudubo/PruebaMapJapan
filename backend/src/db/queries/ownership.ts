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
// which preserves the exact semantics of the old cascade:
//   - trip missing                          → not_found
//   - trip owned by someone else            → forbidden (before child checks)
//   - child missing or under another parent → not_found
// ---------------------------------------------------------------------------

export type OwnershipError = { error: 'not_found' | 'forbidden' };

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
    .select({ tripUserId: trips.user_id, dest: destinations, day: days, act: activities })
    .from(trips)
    .leftJoin(
      destinations,
      and(eq(destinations.id, destId ?? NO_ID), eq(destinations.trip_id, trips.id)),
    )
    .leftJoin(days, and(eq(days.id, dayId ?? NO_ID), eq(days.destination_id, destinations.id)))
    .leftJoin(activities, and(eq(activities.id, actId ?? NO_ID), eq(activities.day_id, days.id)))
    .where(eq(trips.id, tripId))
    .limit(1);

  const row = rows[0];
  if (!row) return { error: 'not_found' as const };
  if (row.tripUserId !== userId) return { error: 'forbidden' as const };
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
