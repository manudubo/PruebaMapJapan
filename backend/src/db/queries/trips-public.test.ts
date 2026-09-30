import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../schema';
import { getTripBySlug } from './trips';

// SEC-21 — public trip response exposure.

type FindFirstConfig = Parameters<ReturnType<typeof drizzle.mock<typeof schema>>['query']['trips']['findFirst']>[0];

async function capturedConfig(): Promise<FindFirstConfig> {
  let captured: FindFirstConfig;
  const fake = { query: { trips: { findFirst: async (cfg: FindFirstConfig) => { captured = cfg; return undefined; } } } };
  await getTripBySlug(fake, '00000000-0000-0000-0000-000000000000');
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

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('getTripBySlug against real Postgres (SEC-21)', () => {
  const schemaName = `pub_trip_${process.pid}_${Date.now()}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let publicSlug: string;
  let privateSlug: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path="${schemaName}",public` });
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      await pool.query(readFileSync(join(dir, f), 'utf8'));
    }
    db = drizzle(pool, { schema });

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

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin?.end();
  });

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
