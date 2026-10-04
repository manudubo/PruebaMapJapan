import type { Context, Next } from 'hono';
import { getDb, parseDbDriver, type DbDriver } from '../db';
import { schemaStatus } from '../db/schema-check';
import type { Env, ContextVariables, ApiResponse } from '../types';

/** Body for requests refused because the database schema is behind the code. */
export const SCHEMA_OUT_OF_DATE_BODY: ApiResponse<never> = {
  success: false,
  error: 'Service temporarily unavailable',
  code: 'schema_out_of_date',
};

/**
 * Validates DB configuration once and exposes a typed handle as `c.get('db')`
 * (M-01). Replaces the `if (!c.env.DATABASE_URL) return 500` + `getDb()`
 * block that was copy-pasted into every DB-backed handler.
 *
 * Mount after authMiddleware so unauthenticated requests still get a 401
 * without depending on server configuration.
 */
export async function dbMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  if (!c.env.DATABASE_URL) {
    console.error('dbMiddleware: DATABASE_URL is not configured');
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }

  let driver: DbDriver;
  try {
    // Workers default to the Neon HTTP driver; Node entry points pass "pg".
    driver = parseDbDriver(c.env.DB_DRIVER, 'neon');
  } catch (err) {
    console.error('dbMiddleware:', err);
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }

  const db = getDb(c.env.DATABASE_URL, driver);

  // Refuse to serve on a schema older than this code needs (deploy before
  // `db:migrate`, restored backup): explicit 503 instead of silent 500s on
  // some routes and BIZ-07 rules silently off. Cached per isolate and URL.
  let missing: string[] = [];
  try {
    missing = await schemaStatus(c.env.DATABASE_URL, db);
  } catch (err) {
    // Could not check (e.g. DB unreachable): let the request fail on its own.
    console.warn('dbMiddleware: schema check failed:', err);
  }
  if (missing.length > 0) return c.json(SCHEMA_OUT_OF_DATE_BODY, 503);

  c.set('db', db);
  await next();
}
