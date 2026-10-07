/**
 * Environment validation for the self-hosted Node server (backend/src/server.ts).
 *
 * The Worker gets its bindings from wrangler; the Node server builds the same
 * `Env` object from process.env. Every problem is collected and reported at
 * once, and the process exits before listening, so a half-configured server
 * never answers traffic (deploy/selfhost, docs/SELF-HOSTING.md).
 *
 * Pure module: no I/O, safe to unit test.
 */
import { parseDbDriver, type DbDriver, type PgPoolOptions } from '../db';
import { resolveEnvironment, type AppEnvironment } from '../config/environment';
import { assertEmailConfig, OtpEmailConfigError } from '../auth/otp-email';
import { CLIENT_IP_HEADERS, MAX_TRUSTED_PROXY_HOPS } from '../middleware/client-ip';
import { normaliseConfiguredOrigin } from '../middleware/cors';
import { parseLogLevel, type LogLevel } from '../observability/logger';
import { userAgentProduct } from '../routes/geocode';
import type { Env } from '../types';

/**
 * Every variable the Node server or the app reads from the environment. All of
 * them reach the bindings (unknown ones too); this list is what the self-host
 * stack must be able to set (docker-compose.prod.yml is checked against it in
 * bootstrap.test.ts). Keep it in sync with the Env interface.
 */
export const SERVER_ENV_CONTRACT = [
  // app (Env)
  'ENVIRONMENT', 'DATABASE_URL', 'DB_DRIVER',
  'KEYCLOAK_URL', 'KEYCLOAK_REALM', 'VALID_AUDIENCES', 'KEYCLOAK_ISSUER', 'KEYCLOAK_JWKS_URL', 'ALLOWED_AZP',
  'KC_ADMIN_CLIENT_ID', 'KC_ADMIN_CLIENT_SECRET',
  'OTP_SECRET', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'SMTP_FROM', 'RESEND_API_KEY',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
  'ALLOWED_ORIGINS', 'TRUSTED_PROXY_HOPS', 'CLIENT_IP_HEADER',
  'NOMINATIM_CONTACT', 'NOMINATIM_URL', 'NOMINATIM_USER_AGENT',
  // Node server only
  'LOG_LEVEL', 'LOG_REQUESTS', 'PORT', 'HOST', 'PG_POOL_MAX', 'PG_IDLE_TIMEOUT_MS', 'PG_CONNECT_TIMEOUT_MS',
  'SHUTDOWN_TIMEOUT_MS',
] as const;

export type RawEnv = Record<string, string | undefined>;

export class ServerConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid server configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ServerConfigError';
    this.problems = problems;
  }
}

export interface ServerConfig {
  /** Hono bindings passed to app.fetch — the Worker's `c.env` equivalent. */
  bindings: Env & Record<string, string | undefined>;
  environment: AppEnvironment;
  port: number;
  host: string;
  pool: Required<PgPoolOptions>;
  shutdownTimeoutMs: number;
  /** Origins the CORS middleware should allow (forwarded as ALLOWED_ORIGINS). */
  allowedOrigins: string[];
  /** OTP mail transport resolved by auth/otp-email.ts (resend | smtp | mailpit). */
  emailProvider: string;
  /** Threshold for the app logger (LOG_LEVEL, default info). */
  logLevel: LogLevel;
  /** One access-log line per request from the Node wrapper (LOG_REQUESTS=true). */
  logRequests: boolean;
}

const MIN_OTP_SECRET_LENGTH = 32;

function trimmed(raw: RawEnv, name: string): string {
  return (raw[name] ?? '').trim();
}

function parseIntInRange(
  raw: RawEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const value = trimmed(raw, name);
  if (value === '') return fallback;
  if (!/^\d+$/.test(value)) {
    problems.push(`${name} must be a whole number (got "${value}")`);
    return fallback;
  }
  const n = Number(value);
  if (n < min || n > max) {
    problems.push(`${name} must be between ${min} and ${max} (got ${n})`);
    return fallback;
  }
  return n;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Validate process.env for the Node server. Throws ServerConfigError listing
 * every problem. Unknown variables are passed through to the bindings
 * unchanged, so settings read by app code (or added later) reach `c.env` just
 * as wrangler [vars]/secrets would.
 */
export function loadServerConfig(raw: RawEnv): ServerConfig {
  const problems: string[] = [];

  // ENVIRONMENT: explicit, so a missing value cannot silently mean anything.
  const envValue = trimmed(raw, 'ENVIRONMENT');
  let environment: AppEnvironment = 'production';
  if (envValue === '') {
    problems.push('ENVIRONMENT is not set (use "production"; "development" only on a laptop)');
  } else if (!['production', 'development'].includes(envValue.toLowerCase())) {
    problems.push(`ENVIRONMENT must be "production" or "development" (got "${envValue}")`);
  } else {
    environment = resolveEnvironment(envValue);
  }
  const production = environment === 'production';

  // Database.
  const databaseUrl = trimmed(raw, 'DATABASE_URL');
  if (databaseUrl === '') {
    problems.push('DATABASE_URL is not set');
  } else {
    const url = parseUrl(databaseUrl);
    if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)) {
      problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL');
    }
  }
  let dbDriver: DbDriver = 'pg';
  try {
    dbDriver = parseDbDriver(trimmed(raw, 'DB_DRIVER'), 'pg');
  } catch (err) {
    problems.push((err as Error).message);
  }

  // Keycloak.
  let keycloakUrl = trimmed(raw, 'KEYCLOAK_URL').replace(/\/+$/, '');
  if (keycloakUrl === '') {
    problems.push('KEYCLOAK_URL is not set (public Keycloak URL, e.g. https://host/auth)');
  } else {
    const url = parseUrl(keycloakUrl);
    if (!url || !['http:', 'https:'].includes(url.protocol)) {
      problems.push('KEYCLOAK_URL must be an http(s) URL');
    } else if (production && url.protocol !== 'https:') {
      problems.push('KEYCLOAK_URL must use https:// in production (it is the token issuer browsers see)');
    } else if (url.search || url.hash) {
      problems.push('KEYCLOAK_URL must not contain a query or fragment');
    }
  }
  const keycloakRealm = trimmed(raw, 'KEYCLOAK_REALM');
  if (keycloakRealm === '') problems.push('KEYCLOAK_REALM is not set (e.g. japan-trip)');
  const validAudiences = trimmed(raw, 'VALID_AUDIENCES');
  if (validAudiences.split(',').every((a) => a.trim() === '')) {
    problems.push('VALID_AUDIENCES is not set (e.g. japan-trip-frontend)');
  }

  // Optional overrides read by the app's JWT verifier: the public issuer (when
  // it differs from KEYCLOAK_URL/realms/<realm>) and an internal JWKS URL so
  // the server does not hairpin through the public tunnel for signing keys.
  for (const name of ['KEYCLOAK_ISSUER', 'KEYCLOAK_JWKS_URL']) {
    const value = trimmed(raw, name);
    if (value === '') continue;
    const url = parseUrl(value);
    if (!url || !['http:', 'https:'].includes(url.protocol)) problems.push(`${name} must be an http(s) URL`);
  }

  // Geocoding proxy (OSM Nominatim usage policy: identify the application and
  // give a contact). The contact is required in production for /api/geocode;
  // the product name is optional (routes/geocode.ts has a default).
  const agent = trimmed(raw, 'NOMINATIM_USER_AGENT');
  if (agent !== '' && userAgentProduct(agent) === null) {
    problems.push('NOMINATIM_USER_AGENT must be product tokens such as "TravelMap-selfhost/1.0" (no spaces inside a token, no parentheses)');
  }
  if (production && trimmed(raw, 'NOMINATIM_CONTACT') === '') {
    problems.push('NOMINATIM_CONTACT is not set (an email or URL where OSM can reach you)');
  }

  // OTP.
  const otpSecret = raw['OTP_SECRET'] ?? '';
  if (otpSecret.trim() === '') {
    problems.push('OTP_SECRET is not set (generate one with deploy/selfhost/scripts/gen-secrets.sh)');
  } else if (production && otpSecret.length < MIN_OTP_SECRET_LENGTH) {
    problems.push(`OTP_SECRET must be at least ${MIN_OTP_SECRET_LENGTH} characters in production`);
  }

  // OTP email transport: the app's own resolver (auth/otp-email.ts) is the one
  // validation, run here at boot instead of on the first sign-in (SEC-08). It
  // reads the raw strings exactly as the app will see them in the bindings.
  let emailProvider = 'none';
  try {
    emailProvider = assertEmailConfig({ ...raw, ENVIRONMENT: environment });
  } catch (err) {
    if (!(err instanceof OtpEmailConfigError)) throw err;
    problems.push(`OTP email transport: ${err.message}`);
  }

  // Client IP behind the reverse proxy (read by the app's rate limiter, which
  // would silently fall back to the TCP peer on a bad value).
  parseIntInRange(raw, 'TRUSTED_PROXY_HOPS', 0, 0, MAX_TRUSTED_PROXY_HOPS, problems);
  const ipHeader = trimmed(raw, 'CLIENT_IP_HEADER').toLowerCase();
  if (ipHeader !== '' && !(CLIENT_IP_HEADERS as readonly string[]).includes(ipHeader)) {
    problems.push(`CLIENT_IP_HEADER must be ${CLIENT_IP_HEADERS.join(', ')} (got "${ipHeader}")`);
  }

  // CORS origins: the CORS middleware's own rule (it would drop a bad entry and
  // lock the SPA out; here it stops the boot instead).
  const allowedOrigins = trimmed(raw, 'ALLOWED_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  if (production && allowedOrigins.length === 0) {
    problems.push('ALLOWED_ORIGINS is not set (e.g. https://manudubo.github.io)');
  }
  for (const origin of allowedOrigins) {
    if (normaliseConfiguredOrigin(origin, environment) === null) {
      problems.push(
        `ALLOWED_ORIGINS entry "${origin}" is not an exact ${production ? 'https ' : ''}origin ` +
          '(scheme://host, no path or trailing slash; http only for localhost in development)',
      );
    }
  }

  // Log threshold for the app's structured logger.
  const logLevelRaw = trimmed(raw, 'LOG_LEVEL');
  const logLevel = logLevelRaw === '' ? 'info' : parseLogLevel(logLevelRaw);
  if (logLevel === null) problems.push(`LOG_LEVEL must be debug, info, warn or error (got "${logLevelRaw}")`);

  // Server and pool.
  const port = parseIntInRange(raw, 'PORT', 8787, 1, 65535, problems);
  const host = trimmed(raw, 'HOST') || '0.0.0.0';
  const pool = {
    max: parseIntInRange(raw, 'PG_POOL_MAX', 10, 1, 100, problems),
    idleTimeoutMillis: parseIntInRange(raw, 'PG_IDLE_TIMEOUT_MS', 30_000, 1_000, 600_000, problems),
    connectionTimeoutMillis: parseIntInRange(raw, 'PG_CONNECT_TIMEOUT_MS', 5_000, 500, 60_000, problems),
  };
  const shutdownTimeoutMs = parseIntInRange(raw, 'SHUTDOWN_TIMEOUT_MS', 10_000, 0, 120_000, problems);

  if (problems.length > 0) throw new ServerConfigError(problems);

  const passthrough: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') passthrough[k] = v;

  return {
    bindings: {
      ...passthrough,
      DATABASE_URL: databaseUrl,
      DB_DRIVER: dbDriver,
      KEYCLOAK_URL: keycloakUrl,
      KEYCLOAK_REALM: keycloakRealm,
      VALID_AUDIENCES: validAudiences,
      KC_ADMIN_CLIENT_ID: trimmed(raw, 'KC_ADMIN_CLIENT_ID'),
      KC_ADMIN_CLIENT_SECRET: trimmed(raw, 'KC_ADMIN_CLIENT_SECRET'),
      OTP_SECRET: otpSecret,
      RESEND_API_KEY: trimmed(raw, 'RESEND_API_KEY') || undefined,
      ENVIRONMENT: environment,
      ALLOWED_ORIGINS: allowedOrigins.join(','),
    },
    environment,
    port,
    host,
    pool,
    shutdownTimeoutMs,
    allowedOrigins,
    emailProvider,
    logLevel: logLevel ?? 'info',
    logRequests: trimmed(raw, 'LOG_REQUESTS') === 'true',
  };
}

/** Config summary safe to log: no secrets, no credentials in URLs. */
export function describeConfig(config: ServerConfig): Record<string, unknown> {
  const db = parseUrl(config.bindings.DATABASE_URL);
  return {
    environment: config.environment,
    listen: `${config.host}:${config.port}`,
    db: db ? `${db.protocol}//${db.hostname}${db.port ? `:${db.port}` : ''}${db.pathname}` : '(invalid)',
    dbDriver: config.bindings.DB_DRIVER,
    pool: config.pool,
    keycloak: `${config.bindings.KEYCLOAK_URL}/realms/${config.bindings.KEYCLOAK_REALM}`,
    keycloakJwks: config.bindings['KEYCLOAK_JWKS_URL'] || '(derived from KEYCLOAK_URL)',
    allowedOrigins: config.allowedOrigins,
    otpEmail: config.emailProvider,
    trustedProxyHops: Number(config.bindings['TRUSTED_PROXY_HOPS'] || 0),
    logLevel: config.logLevel,
  };
}
