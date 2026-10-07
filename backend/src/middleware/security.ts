import type { Context, MiddlewareHandler } from 'hono';
import { clientIpConfig } from './client-ip';

/**
 * The API only ever returns JSON, so no browser feature is needed by any of
 * its responses. Deny the powerful ones explicitly (SEC-20).
 */
export const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

/**
 * JSON-only API: nothing may load, run, frame, or be framed. `sandbox` makes a
 * response opened directly in a tab an opaque, script-less document even if a
 * future bug reflected markup into it.
 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox";

export const HSTS = 'max-age=31536000; includeSubDomains';

/**
 * Was this request received over HTTPS by the edge? On Workers the request URL
 * is https. Behind our own proxies (TRUSTED_PROXY_HOPS > 0, e.g. Caddy
 * terminating TLS) the proxy's X-Forwarded-Proto is trusted; without trusted
 * proxies the header is client-controlled and ignored.
 */
export function isHttpsRequest(c: Context): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true;
  const { hops } = clientIpConfig(c.env as Record<string, string> | undefined);
  if (hops === 0) return false;
  // With N proxies the right-most value was written by the closest one.
  const xfp = c.req.header('x-forwarded-proto');
  const last = xfp?.split(',').pop()?.trim().toLowerCase();
  return last === 'https';
}

/**
 * Sets security headers on every response, including error responses from
 * app.onError/notFound and CORS preflights — register it before corsMiddleware
 * so it wraps responses that CORS short-circuits.
 *
 * HSTS is only sent on HTTPS: on plain HTTP it is ignored by browsers anyway,
 * and sending it from a dev server on http://localhost could pin a developer's
 * browser to HTTPS for every localhost app.
 */
export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Content-Security-Policy', API_CSP);
  c.header('X-Frame-Options', 'DENY');
  if (isHttpsRequest(c)) c.header('Strict-Transport-Security', HSTS);
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Permissions-Policy', PERMISSIONS_POLICY);
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  // Authenticated responses are per-user: never cache them in a shared cache.
  if (c.req.header('authorization') && !c.res.headers.has('Cache-Control')) {
    c.header('Cache-Control', 'no-store');
  }
};
