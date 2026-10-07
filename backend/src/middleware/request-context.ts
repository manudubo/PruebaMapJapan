import type { Context, MiddlewareHandler } from 'hono';
import { log } from '../observability/logger';

/** An upstream id is only recorded when it is short and boring. */
const UPSTREAM_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;

export function requestIdOf(c: Context): string | undefined {
  return (c.get as (k: string) => unknown)('requestId') as string | undefined;
}

/**
 * Route pattern for logs: `/api/public/trips/:slug` instead of the concrete
 * URL. Never logs the query string (it can carry search terms) or ids such as
 * a public share slug, which is a bearer capability for that trip.
 */
export function routeLabel(c: Context): string {
  const pattern = c.req.routePath;
  return pattern && pattern !== '*' && pattern !== '/*' ? pattern : 'unmatched';
}

/**
 * Assigns every request a server-generated id (returned as X-Request-Id and
 * attached to every log line of the request) and writes one structured access
 * log line. A client-supplied X-Request-Id is never adopted as our id (it
 * could be used to forge correlation); a well-formed one is recorded as
 * `upstream_request_id` for tracing through a proxy.
 */
export const requestContext: MiddlewareHandler = async (c, next) => {
  const id = crypto.randomUUID();
  (c.set as (k: string, v: unknown) => void)('requestId', id);
  const started = Date.now();
  const upstream = c.req.header('x-request-id');
  try {
    await next();
  } finally {
    c.header('X-Request-Id', id);
    const status = c.res?.status ?? 500;
    const fields: Record<string, unknown> = {
      request_id: id,
      method: c.req.method,
      route: routeLabel(c),
      status,
      duration_ms: Date.now() - started,
    };
    if (upstream && UPSTREAM_ID_RE.test(upstream)) fields['upstream_request_id'] = upstream;
    if (status >= 500) log.warn('http.request', fields);
    else log.info('http.request', fields);
  }
};
