import { describe, it, expect } from 'vitest';
import {
  isCompleteOrdering,
  reorderActivities,
  InvalidActivityOrderError,
} from './activities';

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

// Scripted stand-in for the Drizzle chains used by reorderActivities
// (no real test DB in the unit suite yet — ARCH-06, Phase 24).
function fakeDb(dayActivityIds: number[]) {
  const calls = { update: 0 };
  const db = {
    select: () => ({
      from: () => ({ where: async () => dayActivityIds.map((id) => ({ id })) }),
    }),
    update: () => {
      calls.update++;
      return {
        set: () => ({
          where: () => ({
            returning: async () =>
              dayActivityIds.map((id, i) => ({ id, day_id: 1, order_index: i })),
          }),
        }),
      };
    },
  };
  return { db, calls };
}

describe('reorderActivities (BUG-05)', () => {
  it('throws InvalidActivityOrderError and writes nothing for a partial set', async () => {
    const { db, calls } = fakeDb([1, 2, 3]);
    await expect(reorderActivities(db, 1, [2, 1])).rejects.toBeInstanceOf(InvalidActivityOrderError);
    expect(calls.update).toBe(0);
  });

  it('throws for an empty list when the day has activities', async () => {
    const { db, calls } = fakeDb([1, 2]);
    await expect(reorderActivities(db, 1, [])).rejects.toBeInstanceOf(InvalidActivityOrderError);
    expect(calls.update).toBe(0);
  });

  it('updates when the full set is given', async () => {
    const { db, calls } = fakeDb([1, 2, 3]);
    const result = await reorderActivities(db, 1, [3, 2, 1]);
    expect(calls.update).toBe(1);
    expect(result.map((a) => a.id)).toEqual([3, 2, 1]);
  });
});
