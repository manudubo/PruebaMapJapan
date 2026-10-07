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
import type { Env } from '../types';

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

/** An exact browser origin: scheme://host[:port], nothing else. */
function isExactOrigin(value: string, requireHttps: boolean): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  if (url.protocol !== 'https:' && (requireHttps || url.protocol !== 'http:')) return false;
  return url.origin === value;
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
  // give a contact). Required in production for /api/geocode.
  if (production && trimmed(raw, 'NOMINATIM_USER_AGENT') === '') {
    problems.push('NOMINATIM_USER_AGENT is not set (e.g. "TravelMap-selfhost/1.0")');
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

  // OTP email transport (contract shared with the app's email module):
  // EMAIL_PROVIDER=resend|smtp, EMAIL_FROM (alias SMTP_FROM), RESEND_API_KEY or
  // SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS. The app refuses to
  // send without a transport in production (SEC-08); fail at boot instead of
  // on the first sign-in.
  const provider = trimmed(raw, 'EMAIL_PROVIDER').toLowerCase();
  const hasResend = trimmed(raw, 'RESEND_API_KEY') !== '';
  const hasSmtp = trimmed(raw, 'SMTP_HOST') !== '';
  if (provider !== '' && provider !== 'resend' && provider !== 'smtp') {
    problems.push(`EMAIL_PROVIDER must be "resend" or "smtp" (got "${provider}")`);
  } else if (provider === 'resend' && !hasResend) {
    problems.push('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set');
  } else if (provider === 'smtp' && !hasSmtp) {
    problems.push('EMAIL_PROVIDER=smtp but SMTP_HOST is not set');
  } else if (production && !hasResend && !hasSmtp) {
    problems.push('No OTP email transport: set RESEND_API_KEY, or SMTP_HOST (+ SMTP_USER/SMTP_PASS)');
  }
  if (production && trimmed(raw, 'EMAIL_FROM') === '' && trimmed(raw, 'SMTP_FROM') === '') {
    problems.push('EMAIL_FROM is not set (sender of OTP emails, e.g. "TravelMap <login@yourdomain>")');
  }
  const smtpSecure = trimmed(raw, 'SMTP_SECURE').toLowerCase();
  if (smtpSecure !== '' && !['starttls', 'tls', 'none'].includes(smtpSecure)) {
    problems.push(`SMTP_SECURE must be starttls, tls or none (got "${smtpSecure}")`);
  }
  if (trimmed(raw, 'SMTP_PORT') !== '') parseIntInRange(raw, 'SMTP_PORT', 587, 1, 65535, problems);

  // Client IP behind the reverse proxy (read by the app's rate limiter).
  parseIntInRange(raw, 'TRUSTED_PROXY_HOPS', 0, 0, 10, problems);
  const ipHeader = trimmed(raw, 'CLIENT_IP_HEADER').toLowerCase();
  if (ipHeader !== '' && !['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'].includes(ipHeader)) {
    problems.push(`CLIENT_IP_HEADER must be x-forwarded-for, x-real-ip or cf-connecting-ip (got "${ipHeader}")`);
  }

  // CORS origins.
  const allowedOrigins = trimmed(raw, 'ALLOWED_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  if (production && allowedOrigins.length === 0) {
    problems.push('ALLOWED_ORIGINS is not set (e.g. https://manudubo.github.io)');
  }
  for (const origin of allowedOrigins) {
    if (!isExactOrigin(origin, production)) {
      problems.push(
        `ALLOWED_ORIGINS entry "${origin}" is not an exact ${production ? 'https ' : ''}origin ` +
          '(scheme://host, no path or trailing slash)',
      );
    }
  }

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
    otpEmail:
      config.bindings['EMAIL_PROVIDER'] ||
      (config.bindings.RESEND_API_KEY ? 'resend' : config.bindings['SMTP_HOST'] ? 'smtp' : 'none'),
    trustedProxyHops: Number(config.bindings['TRUSTED_PROXY_HOPS'] || 0),
  };
}
