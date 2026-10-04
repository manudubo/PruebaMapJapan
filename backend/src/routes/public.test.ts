import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import app from '../index';
import { closeTestPool, insertTripTree, resetDb, testEnv, testPool } from '../test-utils/db';

// Real Postgres (ARCH-06): every status below is exact — a DB failure (500)
// fails the test instead of being accepted as a pass.

beforeEach(resetDb);
afterAll(closeTestPool);

async function get(slug: string) {
  const res = await app.request(`/api/public/trips/${slug}`, {}, testEnv());
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function publicTrip() {
  const tree = await insertTripTree();
  await testPool().query('UPDATE trips SET is_public = true WHERE id = $1', [tree.trip.id]);
  return tree;
}

describe('GET /api/public/trips/:slug (SHARE-02, SHARE-04)', () => {
  it('public trip → 200 with the nested trip', async () => {
    const { trip, dest, day, act } = await publicTrip();

    const { res, body } = await get(trip.public_slug!);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        id: trip.id,
        is_public: true,
        destinations: [{ id: dest.id, days: [{ id: day.id, activities: [{ id: act.id }] }] }],
      },
    });
  });

  it('private trip → 404 even with the correct slug', async () => {
    const { trip } = await insertTripTree();

    const { res, body } = await get(trip.public_slug!);

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Trip not found' });
  });

  it('trip made private again → 404 (no stale exposure)', async () => {
    const { trip } = await publicTrip();
    await testPool().query('UPDATE trips SET is_public = false WHERE id = $1', [trip.id]);

    expect((await get(trip.public_slug!)).res.status).toBe(404);
  });

  it('well-formed UUID with no matching trip → 404', async () => {
    await publicTrip();
    const { res, body } = await get('00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Trip not found' });
  });

  it('upper-case form of a real public slug → 200 (uuid comparison is case-insensitive) (BUG-15)', async () => {
    const { trip } = await publicTrip();
    const { res, body } = await get(trip.public_slug!.toUpperCase());
    expect(res.status).toBe(200);
    expect((body['data'] as { id: number }).id).toBe(trip.id);
  });

  it('invalid UUID format → 400 "Invalid slug"', async () => {
    const { res, body } = await get('not-a-uuid');
    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Invalid slug' });
  });

  it.each([
    ['all dashes', '-'.repeat(36)],
    ['36 hex chars without dashes', 'a'.repeat(36)],
    ['dashes in the wrong places', 'a1b2c3d4e-5f6-7890-abcd-ef1234567890'],
    ['non-hex characters', 'g1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  ])('36-char non-UUID (%s) → 400 "Invalid slug" (BUG-15)', async (_label, slug) => {
    expect(slug).toHaveLength(36);
    const { res, body } = await get(slug);
    expect(res.status).toBe(400);
    expect(body['error']).toBe('Invalid slug');
  });

  it.each([
    ['SQL injection attempt', encodeURIComponent("' OR 1=1 --")],
    ['UUID with trailing junk', `00000000-0000-0000-0000-000000000000${encodeURIComponent("' OR 'a'='a")}`],
    ['unicode', encodeURIComponent('東京東京東京東京-東京-東京-東京-東京東京東京東京東京東京')],
    ['10k characters', 'a'.repeat(10_000)],
  ])('hostile slug (%s) → 400 and never reaches the DB', async (_label, slug) => {
    await publicTrip();
    const { res } = await get(slug);
    expect(res.status).toBe(400);
  });
});
