import { Hono, type Context } from 'hono';
import type { Env } from '../types';

const health = new Hono<{ Bindings: Env }>();

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

export default health;
