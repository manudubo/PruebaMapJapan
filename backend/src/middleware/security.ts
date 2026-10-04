import type { MiddlewareHandler } from 'hono';

/**
 * The API only ever returns JSON, so no browser feature is needed by any of
 * its responses. Deny the powerful ones explicitly (SEC-20).
 */
export const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

/**
 * Sets security headers on every response, including error responses from
 * app.onError/notFound and CORS preflights — register it before corsMiddleware
 * so it wraps responses that CORS short-circuits.
 */
export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "default-src 'none'");
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Permissions-Policy', PERMISSIONS_POLICY);
};
