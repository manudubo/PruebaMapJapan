import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Dual-driver database factory
// - Local dev (localhost/127.0.0.1): uses node-postgres (TCP)
// - Production (Neon URL):           uses @neondatabase/serverless (HTTP)
// ---------------------------------------------------------------------------

export type Schema = typeof schema;
/** node-postgres (TCP) handle — local dev and tests. */
export type PgDb = NodePgDatabase<Schema>;
/** Neon serverless (HTTP) handle — production Workers. */
export type NeonDb = NeonHttpDatabase<Schema>;
/**
 * Either driver. Both share Drizzle's PgDatabase query-builder API, so query
 * helpers accept this union and keep full column/row typing (ARCH-01).
 */
export type Db = PgDb | NeonDb;

// One pool per connection string: a Pool per request would leak TCP
// connections (each keeps idle clients open), exhausting the server.
const pgPools = new Map<string, pg.Pool>();

function pgPool(databaseUrl: string): pg.Pool {
  let pool = pgPools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
    pgPools.set(databaseUrl, pool);
  }
  return pool;
}

export function createDb(databaseUrl: string): Db {
  const isLocal =
    databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');

  if (isLocal) {
    return drizzlePg(pgPool(databaseUrl), { schema });
  }

  const sql = neon(databaseUrl);
  return drizzleNeon(sql, { schema });
}

export const getDb = createDb;

/** Close every cached node-postgres pool (tests / graceful shutdown). */
export async function closeDbPools(): Promise<void> {
  const pools = [...pgPools.values()];
  pgPools.clear();
  await Promise.all(pools.map((p) => p.end()));
}

export { schema };

// ---------------------------------------------------------------------------
// Query helpers — re-exported so callers only need one import
// ---------------------------------------------------------------------------

export * from './queries/users';
export * from './queries/trips';
export * from './queries/destinations';
export * from './queries/days';
export * from './queries/activities';
export * from './queries/otp';
