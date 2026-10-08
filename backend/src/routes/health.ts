import { Hono, type Context } from 'hono';
import { sql } from 'drizzle-orm';
import { dbFromEnv } from '../middleware/db';
import { checkSchemaReady, SCHEMA_NOT_MIGRATED } from '../db/schema-guard';
import type { Env } from '../types';
import { POLICIES, rateLimit } from '../middleware/rate-limit';
import { log } from '../observability/logger';

const health = new Hono<{ Bindings: Env }>();

// Unauthenticated and cheap, but on a single home server every request still
// costs CPU, and /ready touches the database. The per-IP limit runs before any
// DB work, so a probe flood never reaches Postgres (health-ready.test.ts).
health.use('*', rateLimit(POLICIES.healthPerIp));

/**
 * Minimal liveness body (SEC-24). It deliberately carries no service name,
 * version, message or server clock: an unauthenticated probe learns only that
 * the server answers. Nothing here touches the DB or Keycloak. The per-IP limit
 * (POLICIES.healthPerIp) is exact on the single Node server and per isolate on
 * Workers, where edge-level abuse protection belongs to Cloudflare.
 */
export function healthResponse(c: Context) {
  c.header('Cache-Control', 'no-store');
  return c.json({ status: 'ok' as const });
}

/** GET /api/health */
health.get('/', healthResponse);

/**
 * GET /api/health/ready: readiness (review M1), the only implementation.
 *
 *   503 not_configured       no DATABASE_URL
 *   503 schema_not_migrated  the schema is behind this code (cached check shared
 *                            with dbMiddleware; re-checked every 30 s while behind)
 *   503 db_unreachable       the check could not run, or the database does not
 *                            answer `SELECT 1` now (the "ready" verdict is cached
 *                            for the process, so it alone says nothing about now)
 *   200 ready
 *
 * A probe costs one `SELECT 1` plus at most one catalog query per process. The
 * body names no schema objects; the log does.
 */
health.get('/ready', async (c) => {
  c.header('Cache-Control', 'no-store');
  const db = dbFromEnv(c.env);
  if (!db) return c.json({ status: 'unavailable' as const, code: 'not_configured' }, 503);
  const verdict = await checkSchemaReady(db, c.env.DATABASE_URL);
  if (!verdict.ok) return c.json({ status: 'unavailable' as const, code: SCHEMA_NOT_MIGRATED }, 503);
  // dbMiddleware lets a request through when the check cannot run (the query
  // then fails on its own); a readiness probe must not report that as ready.
  if (verdict.unverified) return c.json({ status: 'unavailable' as const, code: 'db_unreachable' }, 503);
  // Without this a probe kept reporting ready while Postgres was down (self-host S1).
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    log.warn('health.db_unreachable', { error: err });
    return c.json({ status: 'unavailable' as const, code: 'db_unreachable' }, 503);
  }
  return c.json({ status: 'ready' as const });
});

export default health;
