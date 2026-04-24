import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// ---------------------------------------------------------------------------
// Database factory
// ---------------------------------------------------------------------------

/**
 * Creates a Drizzle ORM instance connected to Neon.
 *
 * Call this once per request inside your Worker handler so that the connection
 * string is read from the live binding:
 *
 * ```ts
 * const db = createDb(env.DATABASE_URL);
 * ```
 */
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

/**
 * Convenience alias — identical to `createDb` but named to be self-documenting
 * in contexts where the URL is already in scope.
 */
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
