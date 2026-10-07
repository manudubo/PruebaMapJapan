import type { Context, Next } from 'hono';
import { getDb, parseDbDriver, type Db, type DbDriver } from '../db';
import { checkSchemaReady, SCHEMA_NOT_MIGRATED } from '../db/schema-guard';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { log } from '../observability/logger';

/**
 * Build the DB handle from the Worker env, or return null when the
 * configuration is unusable (already logged). Shared by dbMiddleware and the
 * readiness probe.
 */
export function dbFromEnv(env: Partial<Env> | undefined): Db | null {
  if (!env?.DATABASE_URL) {
    log.error('db.not_configured', { reason: 'DATABASE_URL is not set' });
    return null;
  }
  let driver: DbDriver;
  try {
    // Workers default to the Neon HTTP driver; Node entry points pass "pg".
    driver = parseDbDriver(env.DB_DRIVER, 'neon');
  } catch (err) {
    log.error('db.bad_driver', { error: err });
    return null;
  }
  return getDb(env.DATABASE_URL, driver);
}

/**
 * Validates DB configuration once and exposes a typed handle as `c.get('db')`
 * (M-01). Replaces the `if (!c.env.DATABASE_URL) return 500` + `getDb()`
 * block that was copy-pasted into every DB-backed handler.
 *
 * Also refuses to serve (503 schema_not_migrated) when the database lacks
 * objects this code needs, i.e. a Worker deployed before `db:migrate`
 * (review M1). The check is cached per isolate; see db/schema-guard.ts.
 *
 * Mount after authMiddleware so unauthenticated requests still get a 401
 * without depending on server configuration.
 */
export async function dbMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  const db = dbFromEnv(c.env);
  if (!db) {
    const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
    return c.json(response, 500);
  }

  const verdict = await checkSchemaReady(db, c.env.DATABASE_URL);
  if (!verdict.ok) {
    log.error('db.schema_not_migrated', {
      request_id: c.get('requestId'),
      method: c.req.method,
      route: c.req.routePath,
      status: 503,
      code: SCHEMA_NOT_MIGRATED,
    });
    const response: ApiResponse<never> = {
      success: false,
      error: 'Service unavailable',
      code: SCHEMA_NOT_MIGRATED,
    };
    return c.json(response, 503);
  }

  c.set('db', db);
  await next();
}
