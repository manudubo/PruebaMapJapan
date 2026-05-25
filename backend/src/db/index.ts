import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Dual-driver database factory
// - Local dev (localhost/127.0.0.1): uses node-postgres (TCP)
// - Production (Neon URL):           uses @neondatabase/serverless (HTTP)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDb(databaseUrl: string): any {
  const isLocal =
    databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');

  if (isLocal) {
    const pool = new Pool({ connectionString: databaseUrl });
    return drizzlePg(pool, { schema });
  }

  const sql = neon(databaseUrl);
  return drizzleNeon(sql, { schema });
}

export const getDb = createDb;

export type Db = ReturnType<typeof createDb>;

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
