import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  isCompleteOrdering,
  reorderActivities,
  InvalidActivityOrderError,
} from './activities';
import { activities } from '../schema';
import {
  closeTestPool,
  insertActivity,
  insertDay,
  insertTripTree,
  resetDb,
  testDb,
} from '../../test-utils/db';

describe('isCompleteOrdering (BUG-05)', () => {
  it('accepts a permutation of the full id set', () => {
    expect(isCompleteOrdering([1, 2, 3], [3, 1, 2])).toBe(true);
  });

  it('accepts the empty ordering for a day with no activities', () => {
    expect(isCompleteOrdering([], [])).toBe(true);
  });

  it('rejects a partial set', () => {
    expect(isCompleteOrdering([1, 2, 3], [2, 1])).toBe(false);
  });

  it('rejects duplicates even when the length matches', () => {
    expect(isCompleteOrdering([1, 2, 3], [1, 1, 2])).toBe(false);
  });

  it('rejects ids from another day', () => {
    expect(isCompleteOrdering([1, 2, 3], [1, 2, 99])).toBe(false);
  });

  it('rejects extra ids', () => {
    expect(isCompleteOrdering([1, 2], [1, 2, 3])).toBe(false);
  });
});

// Real Postgres (ARCH-06) — asserts what is actually persisted.
describe('reorderActivities (BUG-05)', () => {
  beforeEach(resetDb);
  afterAll(closeTestPool);

  async function dayWith(n: number) {
    const tree = await insertTripTree();
    const ids = [tree.act.id];
    for (let i = 1; i < n; i++) ids.push((await insertActivity(tree.day.id, { order_index: i })).id);
    return { ...tree, ids };
  }

  async function storedOrder(dayId: number) {
    const rows = await testDb()
      .select({ id: activities.id, order_index: activities.order_index })
      .from(activities)
      .where(eq(activities.day_id, dayId))
      .orderBy(asc(activities.id));
    return rows;
  }

  it('persists order_index = position for a full permutation and returns rows in that order', async () => {
    const { day, ids } = await dayWith(3);
    const [a, b, c] = ids as [number, number, number];

    const result = await reorderActivities(testDb(), day.id, [c, a, b]);

    expect(result.map((r) => r.id)).toEqual([c, a, b]);
    expect(result.map((r) => r.order_index)).toEqual([0, 1, 2]);
    const stored = new Map((await storedOrder(day.id)).map((r) => [r.id, r.order_index]));
    expect([stored.get(c), stored.get(a), stored.get(b)]).toEqual([0, 1, 2]);
  });

  it('rejects a partial set and writes nothing', async () => {
    const { day, ids } = await dayWith(3);
    const before = await storedOrder(day.id);

    await expect(reorderActivities(testDb(), day.id, [ids[1]!, ids[0]!])).rejects.toBeInstanceOf(
      InvalidActivityOrderError,
    );
    expect(await storedOrder(day.id)).toEqual(before);
  });

  it('rejects duplicate ids of the right length', async () => {
    const { day, ids } = await dayWith(3);
    await expect(
      reorderActivities(testDb(), day.id, [ids[0]!, ids[0]!, ids[1]!]),
    ).rejects.toBeInstanceOf(InvalidActivityOrderError);
  });

  it('rejects an empty list when the day has activities', async () => {
    const { day } = await dayWith(2);
    await expect(reorderActivities(testDb(), day.id, [])).rejects.toBeInstanceOf(
      InvalidActivityOrderError,
    );
  });

  it('accepts an empty list for an empty day', async () => {
    const { dest } = await insertTripTree();
    const emptyDay = await insertDay(dest.id);
    await expect(reorderActivities(testDb(), emptyDay.id, [])).resolves.toEqual([]);
  });

  it("rejects smuggling another day's activity id and leaves both days untouched", async () => {
    const mine = await dayWith(2);
    const other = await dayWith(1);
    const beforeMine = await storedOrder(mine.day.id);
    const beforeOther = await storedOrder(other.day.id);

    await expect(
      reorderActivities(testDb(), mine.day.id, [mine.ids[0]!, other.ids[0]!]),
    ).rejects.toBeInstanceOf(InvalidActivityOrderError);
    expect(await storedOrder(mine.day.id)).toEqual(beforeMine);
    expect(await storedOrder(other.day.id)).toEqual(beforeOther);
  });

  it('two concurrent full reorders leave a consistent permutation (last writer wins)', async () => {
    const { day, ids } = await dayWith(4);
    const reversed = [...ids].reverse();

    await Promise.all([
      reorderActivities(testDb(), day.id, ids),
      reorderActivities(testDb(), day.id, reversed),
    ]);

    const indices = (await storedOrder(day.id)).map((r) => r.order_index).sort();
    expect(indices).toEqual([0, 1, 2, 3]);
  });
});
