import type { Context, Next } from 'hono';
import { getDb, parseDbDriver, type DbDriver } from '../db';
import type { Env, ContextVariables, ApiResponse } from '../types';

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

  c.set('db', getDb(c.env.DATABASE_URL, driver));
  await next();
}
