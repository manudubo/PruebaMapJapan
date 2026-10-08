import { cors } from 'hono/cors';
import { resolveEnvironment, type AppEnvironment } from '../config/environment';
import { PAGES_ORIGIN } from '../config/deploy-defaults';
import { log } from '../observability/logger';

/** The deployed frontend (GitHub Pages) — config/deploy-defaults.json. */
export const PRODUCTION_ORIGINS: readonly string[] = [PAGES_ORIGIN];

/** Vite dev server / preview ports — only ever allowed in development (SEC-23). */
export const DEVELOPMENT_ONLY_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://localhost:5173',
];

/**
 * Browsers cap Access-Control-Max-Age (Chromium at 2 h, Firefox at 24 h), so
 * anything longer is ignored. 2 h keeps preflights rare without pinning a
 * stale policy for a day after an allow-list change.
 */
export const PREFLIGHT_MAX_AGE_S = 7200;

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Validate one configured origin. It must already be in the exact
 * serialisation browsers send in the Origin header (lower-case
 * scheme://host[:port], no default port, no path, no trailing slash), because
 * matching is an exact string comparison. https only, except loopback in
 * development. Returns null for anything else ("*", "null", paths, ...).
 */
export function normaliseConfiguredOrigin(entry: string, environment: AppEnvironment): string | null {
  if (entry === '*' || entry === 'null' || entry.length > 253 + 16) return null;
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return null;
  }
  if (url.origin !== entry) return null;
  if (url.protocol === 'https:') return entry;
  if (url.protocol === 'http:' && environment === 'development' && isLoopbackHost(url.hostname)) return entry;
  return null;
}

export interface OriginPolicy {
  origins: readonly string[];
  /** Configured entries that were dropped as invalid (already logged once). */
  rejected: readonly string[];
}

const policyCache = new Map<string, OriginPolicy>();

/**
 * Allowed origins for a request.
 *
 *  - `ALLOWED_ORIGINS` unset: the Pages origin from config/deploy-defaults.json.
 *  - `ALLOWED_ORIGINS` set (comma-separated exact origins): exactly those; an
 *    empty value allows no browser origin at all. Invalid entries are dropped
 *    and logged once, never widened.
 *  - development adds the Vite localhost ports on top (SEC-23); production
 *    never does, whatever ALLOWED_ORIGINS says about http://.
 */
export function originPolicy(environment: AppEnvironment, configured: string | undefined): OriginPolicy {
  const key = `${environment}\u0000${configured ?? '\u0001unset'}`;
  const cached = policyCache.get(key);
  if (cached) return cached;

  let base: string[];
  const rejected: string[] = [];
  if (configured === undefined) {
    base = [...PRODUCTION_ORIGINS];
  } else {
    base = [];
    for (const raw of configured.split(',')) {
      const entry = raw.trim();
      if (entry === '') continue;
      const ok = normaliseConfiguredOrigin(entry, environment);
      if (ok) base.push(ok);
      else rejected.push(entry);
    }
    if (rejected.length > 0) {
      log.error('cors.invalid_allowed_origins', {
        rejected: rejected.map((r) => r.slice(0, 120)),
        hint: 'use exact origins such as https://example.github.io (https, no path, no trailing slash)',
      });
    }
  }
  const origins = environment === 'development' ? [...base, ...DEVELOPMENT_ONLY_ORIGINS] : base;
  const policy: OriginPolicy = { origins: [...new Set(origins)], rejected };
  if (policyCache.size > 32) policyCache.clear();
  policyCache.set(key, policy);
  return policy;
}

export function allowedOrigins(environment: AppEnvironment, configured?: string): readonly string[] {
  return originPolicy(environment, configured).origins;
}

/**
 * CORS for the PruebaMapJapan frontend. The API authenticates with bearer
 * tokens only, so credentials mode is never enabled
 * (no Access-Control-Allow-Credentials), and an unlisted, absent or literal
 * "null" origin gets no Access-Control-Allow-Origin (never "*").
 */
export const corsMiddleware = cors({
  origin: (origin, c) => {
    const env = c.env as { ENVIRONMENT?: string; ALLOWED_ORIGINS?: string } | undefined;
    const list = allowedOrigins(resolveEnvironment(env?.ENVIRONMENT), env?.ALLOWED_ORIGINS);
    return origin && list.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'Retry-After', 'X-Request-Id'],
  maxAge: PREFLIGHT_MAX_AGE_S,
  credentials: false,
});
