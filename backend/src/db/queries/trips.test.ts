import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../schema';
import { deleteTrip, getTripById, getTripBySlug, getTripsByUser, updateTrip } from './trips';
import {
  closeTestPool,
  insertActivity,
  insertDay,
  insertDestination,
  insertTrip,
  insertTripTree,
  insertUser,
  resetDb,
  testDb,
  testPool,
} from '../../test-utils/db';

// Real Postgres (ARCH-06).

beforeEach(resetDb);
afterAll(closeTestPool);

/** Drizzle handle that records every SQL statement it sends. */
function countingDb() {
  const queries: string[] = [];
  const db = drizzle(testPool(), { schema, logger: { logQuery: (q) => queries.push(q) } });
  return { db, queries };
}

async function count(table: string): Promise<number> {
  const { rows } = await testPool().query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

describe('getTripById (BUG-14)', () => {
  it('returns the owner the full nested tree in a single SQL statement', async () => {
    const { user, trip, dest, hotel, day, act } = await insertTripTree();
    const { db, queries } = countingDb();

    const result = await getTripById(db, trip.id, user.id);

    expect(queries).toHaveLength(1);
    expect(result).toMatchObject({
      id: trip.id,
      destinations: [
        { id: dest.id, hotel: { id: hotel.id }, days: [{ id: day.id, activities: [{ id: act.id }] }] },
      ],
    });
  });

  it('orders destinations, days and activities by order_index, not insertion order', async () => {
    const user = await insertUser();
    const trip = await insertTrip(user.id);
    const d2 = await insertDestination(trip.id, { order_index: 2 });
    const d1 = await insertDestination(trip.id, { order_index: 1 });
    const day2 = await insertDay(d1.id, { order_index: 5 });
    const day1 = await insertDay(d1.id, { order_index: 0 });
    const a2 = await insertActivity(day1.id, { order_index: 9 });
    const a1 = await insertActivity(day1.id, { order_index: 3 });

    const result = await getTripById(testDb(), trip.id, user.id);

    expect(result!.destinations.map((d: { id: number }) => d.id)).toEqual([d1.id, d2.id]);
    expect(result!.destinations[0]!.days.map((d: { id: number }) => d.id)).toEqual([day1.id, day2.id]);
    expect(result!.destinations[0]!.days[0]!.activities.map((a: { id: number }) => a.id)).toEqual([a1.id, a2.id]);
    expect(result!.destinations[1]!.hotel).toBeNull();
  });

  it("returns undefined for another user's trip", async () => {
    const { trip } = await insertTripTree();
    const intruder = await insertUser();
    expect(await getTripById(testDb(), trip.id, intruder.id)).toBeUndefined();
  });

  it('returns undefined for a missing trip', async () => {
    const user = await insertUser();
    expect(await getTripById(testDb(), 999_999, user.id)).toBeUndefined();
  });
});

describe('getTripsByUser', () => {
  it("returns only the caller's trips, newest first", async () => {
    const me = await insertUser();
    const other = await insertUser();
    const old = await insertTrip(me.id, { created_at: new Date('2026-01-01T00:00:00Z') });
    const recent = await insertTrip(me.id, { created_at: new Date('2026-06-01T00:00:00Z') });
    await insertTrip(other.id);

    const result = await getTripsByUser(testDb(), me.id);
    expect(result.map((t) => t.id)).toEqual([recent.id, old.id]);
  });

  it('returns [] for a user with no trips', async () => {
    const me = await insertUser();
    expect(await getTripsByUser(testDb(), me.id)).toEqual([]);
  });
});

describe('updateTrip / deleteTrip ownership', () => {
  it('updates an owned trip and bumps updated_at', async () => {
    const user = await insertUser();
    const trip = await insertTrip(user.id);
    const updated = await updateTrip(testDb(), trip.id, user.id, { name: 'Renamed' });
    expect(updated).toMatchObject({ id: trip.id, name: 'Renamed' });
    expect(updated!.updated_at.getTime()).toBeGreaterThan(trip.updated_at.getTime());
  });

  it("does not update another user's trip", async () => {
    const owner = await insertUser();
    const intruder = await insertUser();
    const trip = await insertTrip(owner.id, { name: 'Original' });

    await expect(updateTrip(testDb(), trip.id, intruder.id, { name: 'Hacked' })).rejects.toThrow();
    const { rows } = await testPool().query('SELECT name FROM trips WHERE id = $1', [trip.id]);
    expect(rows[0].name).toBe('Original');
  });

  it("deleteTrip by a non-owner is a no-op", async () => {
    const { trip } = await insertTripTree();
    const intruder = await insertUser();
    await deleteTrip(testDb(), trip.id, intruder.id);
    expect(await count('trips')).toBe(1);
  });

  it('deleteTrip by the owner cascades to destinations, hotel, days and activities', async () => {
    const { user, trip } = await insertTripTree();
    await deleteTrip(testDb(), trip.id, user.id);
    for (const t of ['trips', 'destinations', 'hotels', 'days', 'activities']) {
      expect(await count(t)).toBe(0);
    }
    expect(await count('users')).toBe(1);
  });
});

describe('getTripBySlug', () => {
  it('returns a public trip with its nested tree', async () => {
    const { trip, dest } = await insertTripTree();
    await testPool().query('UPDATE trips SET is_public = true WHERE id = $1', [trip.id]);

    const result = await getTripBySlug(testDb(), trip.public_slug!);
    expect(result).toMatchObject({ id: trip.id, destinations: [{ id: dest.id }] });
  });

  it('hides a private trip even with the right slug', async () => {
    const { trip } = await insertTripTree();
    expect(await getTripBySlug(testDb(), trip.public_slug!)).toBeUndefined();
  });

  it('returns undefined for an unknown slug', async () => {
    expect(await getTripBySlug(testDb(), '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  });
});
