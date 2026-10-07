import { Hono, type Context } from 'hono';
import { dbFromEnv } from '../middleware/db';
import { checkSchemaReady, SCHEMA_NOT_MIGRATED } from '../db/schema-guard';
import type { Env } from '../types';
import { POLICIES, rateLimit } from '../middleware/rate-limit';

const health = new Hono<{ Bindings: Env }>();

// Unauthenticated and cheap, but on a single home server every request still
// costs CPU; /ready also runs a (cached) catalog query.
health.use('*', rateLimit(POLICIES.healthPerIp));

/**
 * Minimal liveness body (SEC-24). It deliberately carries no service name,
 * version, message or server clock: an unauthenticated probe learns only that
 * the Worker answers. Nothing here touches the DB or Keycloak, so the endpoint
 * is as cheap as a 404 and is not worth an in-isolate rate limiter (which would
 * be per-isolate and trivially bypassed anyway); edge-level abuse protection
 * belongs to Cloudflare.
 */
export function healthResponse(c: Context) {
  c.header('Cache-Control', 'no-store');
  return c.json({ status: 'ok' as const });
}

/** GET /api/health */
health.get('/', healthResponse);

/**
 * GET /api/health/ready: readiness (review M1). Is the database migrated far
 * enough for this code? Uses the same cached check as dbMiddleware, so a probe
 * costs at most one catalog query per isolate (plus one every 30 s while the
 * schema is behind). The body names no schema objects; the log does.
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
  return c.json({ status: 'ready' as const });
});

export default health;
