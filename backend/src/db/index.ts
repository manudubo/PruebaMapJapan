import * as schema from './schema';

// ---------------------------------------------------------------------------
// Dual-driver database factory
// Connects to local PostgreSQL (pg) or Neon serverless (neon-http) based on URL
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDb(databaseUrl: string): any {
  const isLocal =
    databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');

  if (isLocal) {
    // Local dev: use node-postgres (works in Node.js / wrangler dev with nodejs_compat)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/node-postgres');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    return drizzle(pool, { schema });
  }

  // Production: Neon serverless HTTP (Cloudflare Workers compatible)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { neon } = require('@neondatabase/serverless');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/neon-http');
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
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
