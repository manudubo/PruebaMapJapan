import { cors } from 'hono/cors';
import { resolveEnvironment, type AppEnvironment } from '../config/environment';

/** The deployed frontend (GitHub Pages). */
export const PRODUCTION_ORIGINS: readonly string[] = ['https://manud.github.io'];

/** Vite dev server / preview ports — only ever allowed in development (SEC-23). */
export const DEVELOPMENT_ONLY_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://localhost:5173',
];

export function allowedOrigins(environment: AppEnvironment): readonly string[] {
  return environment === 'development'
    ? [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ONLY_ORIGINS]
    : PRODUCTION_ORIGINS;
}

/**
 * CORS for the PruebaMapJapan frontend. Origins are chosen per request from
 * the `ENVIRONMENT` binding; anything but "development" gets the production
 * list. Unlisted, absent and literal "null" origins get no
 * Access-Control-Allow-Origin header (never "*").
 */
export const corsMiddleware = cors({
  origin: (origin, c) => {
    const env = c.env as { ENVIRONMENT?: string } | undefined;
    const list = allowedOrigins(resolveEnvironment(env?.ENVIRONMENT));
    return origin && list.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
});
