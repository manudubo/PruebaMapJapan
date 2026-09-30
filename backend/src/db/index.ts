import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Dual-driver database factory, selected explicitly by DB_DRIVER (ARCH-02):
// - "neon": @neondatabase/serverless over HTTP — Cloudflare Workers (default
//           there; wrangler.toml sets it)
// - "pg":   node-postgres over TCP — Node processes (dev server, seed, tests);
//           works for local Postgres and for Neon's TCP endpoint alike
// It used to be guessed from a "localhost" substring in the URL, which picks
// the wrong driver for a tunnel or any Neon URL mentioning localhost.
// ---------------------------------------------------------------------------

export type DbDriver = 'pg' | 'neon';

/** Thrown for a DB_DRIVER value other than "pg" / "neon". */
export class InvalidDbDriverError extends Error {
  constructor(value: string) {
    super(`Invalid DB_DRIVER "${value}": expected "pg" or "neon"`);
    this.name = 'InvalidDbDriverError';
  }
}

/** Parse DB_DRIVER; unset/empty → `fallback` (the runtime's natural driver). */
export function parseDbDriver(value: string | undefined, fallback: DbDriver): DbDriver {
  if (value === undefined || value === '') return fallback;
  if (value === 'pg' || value === 'neon') return value;
  throw new InvalidDbDriverError(value);
}

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

export function createDb(databaseUrl: string, driver: DbDriver): Db {
  if (driver === 'pg') {
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
