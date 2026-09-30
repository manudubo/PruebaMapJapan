import { describe, it, expect, vi } from 'vitest';
import { getTripById } from './trips';

// Scripted stand-in for Drizzle (no real test DB in the unit suite yet —
// ARCH-06, Phase 24). `select` is a spy so we can assert it is not used.
function fakeDb(findFirstResult: unknown) {
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => (findFirstResult ? [findFirstResult] : []) }) }),
  }));
  const findFirst = vi.fn(async () => findFirstResult);
  return { db: { select, query: { trips: { findFirst } } }, select, findFirst };
}

describe('getTripById (BUG-14)', () => {
  it('runs a single relational query (no redundant pre-select)', async () => {
    const trip = { id: 1, user_id: 2, destinations: [] };
    const { db, select, findFirst } = fakeDb(trip);

    await expect(getTripById(db, 1, 2)).resolves.toBe(trip);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns undefined when the trip is missing or not owned', async () => {
    const { db, select } = fakeDb(undefined);

    await expect(getTripById(db, 1, 2)).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });
});
