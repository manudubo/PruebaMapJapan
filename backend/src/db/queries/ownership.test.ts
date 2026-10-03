import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../schema';
import { resolveActivity, resolveDay, resolveDestination, resolveTrip } from './ownership';
import {
  closeTestPool,
  insertActivity,
  insertDay,
  insertTripTree,
  resetDb,
  testDb,
  testPool,
} from '../../test-utils/db';

beforeEach(resetDb);
afterAll(closeTestPool);

function countingDb() {
  const queries: string[] = [];
  const db = drizzle(testPool(), { schema, logger: { logQuery: (q) => queries.push(q) } });
  return { db, queries };
}

async function world() {
  const a = await insertTripTree();
  const b = await insertTripTree(); // different owner
  const otherDayOfA = await insertDay(a.dest.id);
  const actOnOtherDay = await insertActivity(otherDayOfA.id);
  return { a, b, otherDayOfA, actOnOtherDay };
}

describe('single-query ownership cascade (M-02)', () => {
  it('resolveActivity runs exactly one SQL statement and returns dest/day/act rows', async () => {
    const { a } = await world();
    const { db, queries } = countingDb();

    const r = await resolveActivity(db, a.trip.id, a.dest.id, a.day.id, a.act.id, a.user.id);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/left join/i);
    expect(r).toEqual({ dest: a.dest, day: a.day, act: a.act });
  });

  it.each(['trip', 'dest', 'day'] as const)('resolve %s is also a single statement', async (level) => {
    const { a } = await world();
    const { db, queries } = countingDb();
    if (level === 'trip') await resolveTrip(db, a.trip.id, a.user.id);
    if (level === 'dest') await resolveDestination(db, a.trip.id, a.dest.id, a.user.id);
    if (level === 'day') await resolveDay(db, a.trip.id, a.dest.id, a.day.id, a.user.id);
    expect(queries).toHaveLength(1);
  });

  it('returns rows that are deep-equal to what is stored (numeric/date columns intact)', async () => {
    const { a } = await world();
    await testPool().query("UPDATE destinations SET lat = '35.6812362', lng = '139.7671248', start_date = '2026-02-22' WHERE id = $1", [a.dest.id]);
    const r = await resolveDestination(testDb(), a.trip.id, a.dest.id, a.user.id);
    expect(r).toMatchObject({ dest: { lat: '35.6812362', lng: '139.7671248', start_date: '2026-02-22' } });
  });

  describe('semantics identical to the old 4-query cascade', () => {
    it('missing trip → not_found', async () => {
      const { a } = await world();
      expect(await resolveActivity(testDb(), 999_999, a.dest.id, a.day.id, a.act.id, a.user.id)).toEqual({ error: 'not_found' });
    });

    // SEC-22: a foreign trip is reported exactly like a missing one.
    it("someone else's trip → not_found (never 'forbidden'), with bogus or real child ids", async () => {
      const { a, b } = await world();
      expect(await resolveActivity(testDb(), a.trip.id, 1_000, 2_000, 3_000, b.user.id)).toEqual({ error: 'not_found' });
      expect(await resolveActivity(testDb(), a.trip.id, a.dest.id, a.day.id, a.act.id, b.user.id)).toEqual({ error: 'not_found' });
      expect(await resolveDay(testDb(), a.trip.id, a.dest.id, a.day.id, b.user.id)).toEqual({ error: 'not_found' });
      expect(await resolveDestination(testDb(), a.trip.id, a.dest.id, b.user.id)).toEqual({ error: 'not_found' });
      expect(await resolveTrip(testDb(), a.trip.id, b.user.id)).toEqual({ error: 'not_found' });
    });

    it('destination of another trip → not_found', async () => {
      const { a, b } = await world();
      expect(await resolveDestination(testDb(), a.trip.id, b.dest.id, a.user.id)).toEqual({ error: 'not_found' });
    });

    it('day of another destination → not_found', async () => {
      const { a, b } = await world();
      expect(await resolveDay(testDb(), a.trip.id, a.dest.id, b.day.id, a.user.id)).toEqual({ error: 'not_found' });
    });

    it('activity of another day in the same destination → not_found', async () => {
      const { a, actOnOtherDay } = await world();
      expect(
        await resolveActivity(testDb(), a.trip.id, a.dest.id, a.day.id, actOnOtherDay.id, a.user.id),
      ).toEqual({ error: 'not_found' });
    });

    it('the right child under the wrong intermediate parent → not_found', async () => {
      const { a, otherDayOfA } = await world();
      // act belongs to a.day, but the path names otherDayOfA.
      expect(
        await resolveActivity(testDb(), a.trip.id, a.dest.id, otherDayOfA.id, a.act.id, a.user.id),
      ).toEqual({ error: 'not_found' });
    });

    it.each([0, -1, 2_147_483_647])('id %i that cannot exist → not_found, never a match on the sentinel', async (id) => {
      const { a } = await world();
      expect(await resolveDestination(testDb(), a.trip.id, id, a.user.id)).toEqual({ error: 'not_found' });
      expect(await resolveDay(testDb(), a.trip.id, a.dest.id, id, a.user.id)).toEqual({ error: 'not_found' });
    });

    it('owner, full valid chain at every level', async () => {
      const { a } = await world();
      expect(await resolveTrip(testDb(), a.trip.id, a.user.id)).toEqual({ tripId: a.trip.id });
      expect(await resolveDestination(testDb(), a.trip.id, a.dest.id, a.user.id)).toEqual({ dest: a.dest });
      expect(await resolveDay(testDb(), a.trip.id, a.dest.id, a.day.id, a.user.id)).toEqual({ dest: a.dest, day: a.day });
    });
  });
});
