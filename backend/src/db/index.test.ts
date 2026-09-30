import { describe, it, expect, expectTypeOf, beforeEach, afterAll } from 'vitest';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { closeDbPools, createDb, getTripsByUser, type Db, type Trip } from './index';
import { users } from './schema';
import { closeTestPool, insertTrip, insertUser, resetDb, testDatabaseUrl, testPool } from '../test-utils/db';

beforeEach(resetDb);
afterAll(async () => {
  await closeDbPools();
  await closeTestPool();
});

describe('createDb typing (ARCH-01)', () => {
  it('is typed as the NeonDb | PgDb union, not any', () => {
    expectTypeOf(createDb).returns.toEqualTypeOf<Db>();
    expectTypeOf<Db>().not.toBeAny();
    // Row types flow through query helpers instead of collapsing to any.
    expectTypeOf(getTripsByUser).returns.resolves.toEqualTypeOf<Trip[]>();
  });
});

describe('createDb driver + pooling', () => {
  it('uses node-postgres for a local URL and actually queries the DB', async () => {
    const db = createDb(testDatabaseUrl());
    expect(db).toBeInstanceOf(NodePgDatabase);

    const me = await insertUser();
    const trip = await insertTrip(me.id);
    const rows = await getTripsByUser(db, me.id);
    expect(rows.map((t) => t.id)).toEqual([trip.id]);
  });

  it('uses the Neon HTTP driver for a remote URL without opening a connection', () => {
    const db = createDb('postgresql://u:p@ep-example-123.us-east-1.aws.neon.tech/neondb?sslmode=require');
    expect(db).toBeInstanceOf(NeonHttpDatabase);
  });

  it('reuses one pool per connection string across calls', () => {
    const a = createDb(testDatabaseUrl()) as unknown as { $client: unknown };
    const b = createDb(testDatabaseUrl()) as unknown as { $client: unknown };
    expect(a.$client).toBe(b.$client);
  });

  it('60 concurrent "requests" do not open more than one pool worth of connections', async () => {
    await closeDbPools();
    const url = testDatabaseUrl();
    const dbName = new URL(url).pathname.slice(1);

    await Promise.all(
      Array.from({ length: 60 }, () => createDb(url).select().from(users).limit(1)),
    );

    const { rows } = await testPool().query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`,
      [dbName],
    );
    // node-postgres default max is 10; + this helper's own pool (max 4).
    expect(rows[0].n).toBeLessThanOrEqual(14);
  });

  it('closeDbPools ends the pools; the next createDb opens a fresh one that works', async () => {
    const before = createDb(testDatabaseUrl()) as unknown as { $client: unknown };
    await closeDbPools();
    const after = createDb(testDatabaseUrl());
    expect((after as unknown as { $client: unknown }).$client).not.toBe(before.$client);
    await expect(after.select().from(users)).resolves.toEqual([]);
  });
});
