import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../schema';
import type { Db } from '../index';
import { getTripBySlug } from './trips';
import { closeTestPool, resetDb, testDb } from '../../test-utils/db';

// SEC-21 — public trip response exposure.

type FindFirstConfig = Parameters<ReturnType<typeof drizzle.mock<typeof schema>>['query']['trips']['findFirst']>[0];

async function capturedConfig(): Promise<FindFirstConfig> {
  let captured: FindFirstConfig;
  const fake = { query: { trips: { findFirst: async (cfg: FindFirstConfig) => { captured = cfg; return undefined; } } } };
  await getTripBySlug(fake as unknown as Db, '00000000-0000-0000-0000-000000000000');
  return captured;
}

describe('getTripBySlug projection (SEC-21)', () => {
  it('excludes user_id from the selected trip columns', async () => {
    const cfg = await capturedConfig();
    expect(cfg?.columns).toEqual({ user_id: false });
  });

  it('generated SQL selects no trips.user_id but keeps the rest of the itinerary', async () => {
    const cfg = await capturedConfig();
    const { sql } = drizzle.mock({ schema }).query.trips.findFirst(cfg).toSQL();
    expect(sql).not.toContain('"trips"."user_id"');
    for (const col of ['"trips"."id"', '"trips"."name"', '"trips"."public_slug"', '"trips"."is_public"']) {
      expect(sql).toContain(col);
    }
    // Hotel sharing is intentional (documented on getTripBySlug).
    expect(sql).toContain('"trips_destinations_hotel"."name"');
    expect(sql).toContain('"trips_destinations_hotel"."check_in_date"');
    // Visibility filter is still enforced in SQL, not in JS.
    expect(sql).toMatch(/"trips"\."public_slug" = \$\d+ and "trips"\."is_public" = \$\d+/);
  });
});

describe('getTripBySlug against real Postgres (SEC-21)', () => {
  const db = testDb();
  let publicSlug: string;
  let privateSlug: string;

  beforeAll(async () => {
    await resetDb();
    const [u] = await db.insert(schema.users).values({ keycloak_id: 'kc-owner', email: 'o@x', name: 'Owner' }).returning();
    const mk = async (is_public: boolean) => {
      const [t] = await db.insert(schema.trips).values({ user_id: u!.id, name: is_public ? 'Pub' : 'Priv', is_public }).returning();
      const [d] = await db.insert(schema.destinations).values({ trip_id: t!.id, city_name: 'Kyoto', country: 'JP', lat: '35', lng: '135', order_index: 0 }).returning();
      await db.insert(schema.hotels).values({ destination_id: d!.id, name: 'Hotel K', lat: '35', lng: '135' });
      return t!.public_slug!;
    };
    publicSlug = await mk(true);
    privateSlug = await mk(false);
  });

  afterAll(closeTestPool);

  it('public trip: no user_id anywhere in the payload, hotel included', async () => {
    const trip = await getTripBySlug(db, publicSlug);
    expect(trip).toBeDefined();
    expect(trip).not.toHaveProperty('user_id');
    expect(JSON.stringify(trip)).not.toContain('user_id');
    expect(trip!.destinations[0]!.hotel!.name).toBe('Hotel K');
  });

  it('private trip is not returned even with the right slug', async () => {
    expect(await getTripBySlug(db, privateSlug)).toBeUndefined();
  });
});
