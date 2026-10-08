import { describe, expect, it } from 'vitest';
import { describeConfig, loadServerConfig, ServerConfigError, type RawEnv } from './config';

const VALID: RawEnv = {
  ENVIRONMENT: 'production',
  DATABASE_URL: 'postgresql://travelmap:s3cret@postgres:5432/travelmap',
  DB_DRIVER: 'pg',
  KEYCLOAK_URL: 'https://box.tail1234.ts.net/auth',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  OTP_SECRET: 'x'.repeat(64),
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'TravelMap <login@example.com>',
  ALLOWED_ORIGINS: 'https://manudubo.github.io',
  NOMINATIM_USER_AGENT: 'TravelMap-selfhost/1.0',
  NOMINATIM_CONTACT: 'owner@example.com',
};

/** The Gmail app-password path from docs/SELF-HOSTING.md. */
const GMAIL: RawEnv = {
  EMAIL_PROVIDER: 'smtp',
  RESEND_API_KEY: '',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'starttls',
  SMTP_USER: 'owner@gmail.com',
  SMTP_PASS: 'abcd efgh ijkl mnop',
  EMAIL_FROM: 'TravelMap <owner@gmail.com>',
};

function problemsFor(overrides: RawEnv): readonly string[] {
  try {
    loadServerConfig({ ...VALID, ...overrides });
  } catch (err) {
    expect(err).toBeInstanceOf(ServerConfigError);
    return (err as ServerConfigError).problems;
  }
  return [];
}

describe('loadServerConfig', () => {
  it('accepts a complete production environment', () => {
    const config = loadServerConfig(VALID);
    expect(config.environment).toBe('production');
    expect(config.port).toBe(8787);
    expect(config.host).toBe('0.0.0.0');
    expect(config.pool).toEqual({ max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    expect(config.bindings.DB_DRIVER).toBe('pg');
    expect(config.bindings.ENVIRONMENT).toBe('production');
    expect(config.allowedOrigins).toEqual(['https://manudubo.github.io']);
  });

  it('reports every problem of an empty environment at once', () => {
    const problems = (() => {
      try {
        loadServerConfig({});
      } catch (err) {
        return (err as ServerConfigError).problems;
      }
      return [];
    })();
    for (const name of [
      'ENVIRONMENT',
      'DATABASE_URL',
      'KEYCLOAK_URL',
      'KEYCLOAK_REALM',
      'VALID_AUDIENCES',
      'OTP_SECRET',
      'email transport',
      'EMAIL_FROM',
      'ALLOWED_ORIGINS',
      'NOMINATIM_CONTACT',
    ]) {
      expect(problems.some((p) => p.includes(name)), name).toBe(true);
    }
  });

  it.each([
    ['ENVIRONMENT missing', { ENVIRONMENT: '' }, 'ENVIRONMENT is not set'],
    ['ENVIRONMENT misspelled', { ENVIRONMENT: 'prod' }, 'ENVIRONMENT must be'],
    ['DATABASE_URL not postgres', { DATABASE_URL: 'mysql://x@y/z' }, 'DATABASE_URL must be'],
    ['DATABASE_URL garbage', { DATABASE_URL: 'not a url' }, 'DATABASE_URL must be'],
    ['DB_DRIVER invalid', { DB_DRIVER: 'sqlite' }, 'Invalid DB_DRIVER'],
    ['KEYCLOAK_URL http in production', { KEYCLOAK_URL: 'http://box/auth' }, 'https:// in production'],
    ['KEYCLOAK_URL not a URL', { KEYCLOAK_URL: 'auth' }, 'KEYCLOAK_URL must be'],
    ['KEYCLOAK_URL with query', { KEYCLOAK_URL: 'https://box/auth?x=1' }, 'query or fragment'],
    ['KEYCLOAK_JWKS_URL invalid', { KEYCLOAK_JWKS_URL: 'keycloak:8080' }, 'KEYCLOAK_JWKS_URL must be'],
    ['KEYCLOAK_ISSUER invalid', { KEYCLOAK_ISSUER: 'ftp://x' }, 'KEYCLOAK_ISSUER must be'],
    ['short OTP_SECRET', { OTP_SECRET: 'short' }, 'at least 32'],
    ['blank VALID_AUDIENCES', { VALID_AUDIENCES: ' , ' }, 'VALID_AUDIENCES'],
    ['unknown EMAIL_PROVIDER', { EMAIL_PROVIDER: 'ses' }, 'EMAIL_PROVIDER must be'],
    ['resend without key', { RESEND_API_KEY: '' }, 'RESEND_API_KEY is not set'],
    ['smtp without host', { EMAIL_PROVIDER: 'smtp' }, 'SMTP_HOST is not set'],
    ['no transport', { EMAIL_PROVIDER: '', RESEND_API_KEY: '' }, 'No OTP email provider'],
    // Same messages as the app's resolver (auth/otp-email.ts): one validation, run at boot.
    ['SMTP without a sender', { ...GMAIL, EMAIL_FROM: '' }, 'SMTP needs EMAIL_FROM'],
    ['bad SMTP_SECURE', { ...GMAIL, SMTP_SECURE: 'ssl' }, 'SMTP_SECURE must be'],
    ['bad SMTP_PORT', { ...GMAIL, SMTP_PORT: '99999' }, 'SMTP_PORT must be an integer'],
    ['plaintext SMTP in production', { ...GMAIL, SMTP_SECURE: 'none' }, 'SMTP_SECURE=none is only allowed'],
    ['SMTP user without password', { ...GMAIL, SMTP_PASS: '' }, 'SMTP_USER and SMTP_PASS must be set together'],
    ['malformed sender', { ...GMAIL, EMAIL_FROM: 'TravelMap <not an address>' }, 'EMAIL_FROM is not a valid address'],
    ['header injection in SMTP_HOST', { ...GMAIL, SMTP_HOST: 'smtp.gmail.com\r\nX: y' }, 'SMTP_HOST must be'],
    ['unknown LOG_LEVEL', { LOG_LEVEL: 'verbose' }, 'LOG_LEVEL must be'],
    ['unsafe NOMINATIM_USER_AGENT', { NOMINATIM_USER_AGENT: 'a\r\nX: y' }, 'NOMINATIM_USER_AGENT must be'],
    ['origin with path', { ALLOWED_ORIGINS: 'https://manudubo.github.io/PruebaMapJapan' }, 'not an exact'],
    ['origin with trailing slash', { ALLOWED_ORIGINS: 'https://manudubo.github.io/' }, 'not an exact'],
    ['http origin in production', { ALLOWED_ORIGINS: 'http://manudubo.github.io' }, 'not an exact https'],
    ['wildcard origin', { ALLOWED_ORIGINS: '*' }, 'not an exact'],
    ['upper-case origin', { ALLOWED_ORIGINS: 'https://ManuDubo.github.io' }, 'not an exact'],
    ['default port spelled out', { ALLOWED_ORIGINS: 'https://manudubo.github.io:443' }, 'not an exact'],
    ['no origins', { ALLOWED_ORIGINS: ' ' }, 'ALLOWED_ORIGINS is not set'],
    ['bad TRUSTED_PROXY_HOPS', { TRUSTED_PROXY_HOPS: '-1' }, 'TRUSTED_PROXY_HOPS must be a whole number'],
    ['too many hops', { TRUSTED_PROXY_HOPS: '11' }, 'TRUSTED_PROXY_HOPS must be between'],
    ['bad CLIENT_IP_HEADER', { CLIENT_IP_HEADER: 'forwarded' }, 'CLIENT_IP_HEADER must be'],
    ['bad PORT', { PORT: 'eighty' }, 'PORT must be a whole number'],
    ['PG_POOL_MAX zero', { PG_POOL_MAX: '0' }, 'PG_POOL_MAX must be between'],
    ['missing Nominatim contact', { NOMINATIM_CONTACT: '' }, 'NOMINATIM_CONTACT'],
  ])('rejects %s', (_label, overrides, expected) => {
    const problems = problemsFor(overrides);
    expect(problems.join('\n')).toContain(expected);
  });

  it('accepts SMTP instead of Resend', () => {
    expect(
      problemsFor({ EMAIL_PROVIDER: 'smtp', RESEND_API_KEY: '', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_SECURE: 'starttls' }),
    ).toEqual([]);
  });

  it('accepts SMTP_FROM as the sender alias', () => {
    expect(problemsFor({ ...GMAIL, EMAIL_FROM: '', SMTP_FROM: 'login@example.com' })).toEqual([]);
  });

  it('accepts the Gmail app-password path and reports the resolved transport', () => {
    const config = loadServerConfig({ ...VALID, ...GMAIL });
    expect(config.emailProvider).toBe('smtp');
    expect(config.bindings['SMTP_PASS']).toBe('abcd efgh ijkl mnop'); // never trimmed or rewritten
    expect(loadServerConfig(VALID).emailProvider).toBe('resend');
  });

  it('Resend without EMAIL_FROM uses the app default sender (no boot-only rule)', () => {
    expect(problemsFor({ EMAIL_FROM: '' })).toEqual([]);
  });

  it('NOMINATIM_USER_AGENT is optional; LOG_LEVEL defaults to info', () => {
    const config = loadServerConfig({ ...VALID, NOMINATIM_USER_AGENT: '' });
    expect(config.logLevel).toBe('info');
    expect(loadServerConfig({ ...VALID, LOG_LEVEL: ' WARN ' }).logLevel).toBe('warn');
  });

  it('relaxes production-only rules in development', () => {
    const config = loadServerConfig({
      ENVIRONMENT: 'development',
      DATABASE_URL: 'postgres://localhost/dev',
      KEYCLOAK_URL: 'http://localhost:8080/',
      KEYCLOAK_REALM: 'japan-trip',
      VALID_AUDIENCES: 'japan-trip-frontend',
      OTP_SECRET: 'dev',
    });
    expect(config.environment).toBe('development');
    expect(config.bindings.KEYCLOAK_URL).toBe('http://localhost:8080');
    expect(config.allowedOrigins).toEqual([]);
  });

  it('parses pool, port and shutdown settings', () => {
    const config = loadServerConfig({
      ...VALID,
      PORT: '9000',
      HOST: '127.0.0.1',
      PG_POOL_MAX: '4',
      PG_IDLE_TIMEOUT_MS: '10000',
      PG_CONNECT_TIMEOUT_MS: '2000',
      SHUTDOWN_TIMEOUT_MS: '0',
    });
    expect(config.port).toBe(9000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.pool).toEqual({ max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 2_000 });
    expect(config.shutdownTimeoutMs).toBe(0);
  });

  it('passes every other variable through to the bindings unchanged', () => {
    const config = loadServerConfig({
      ...VALID,
      TRUSTED_PROXY_HOPS: '2',
      CLIENT_IP_HEADER: 'x-forwarded-for',
      KEYCLOAK_JWKS_URL: 'http://keycloak:8080/auth/realms/japan-trip/protocol/openid-connect/certs',
      ALLOWED_AZP: 'japan-trip-frontend',
      SMTP_USER: 'u',
      SOME_FUTURE_SETTING: 'kept',
    });
    expect(config.bindings['TRUSTED_PROXY_HOPS']).toBe('2');
    expect(config.bindings['CLIENT_IP_HEADER']).toBe('x-forwarded-for');
    expect(config.bindings['KEYCLOAK_JWKS_URL']).toContain('http://keycloak:8080');
    expect(config.bindings['ALLOWED_AZP']).toBe('japan-trip-frontend');
    expect(config.bindings['NOMINATIM_CONTACT']).toBe('owner@example.com');
    expect(config.bindings['EMAIL_FROM']).toBe('TravelMap <login@example.com>');
    expect(config.bindings['SOME_FUTURE_SETTING']).toBe('kept');
  });

  it('normalises ALLOWED_ORIGINS lists', () => {
    const config = loadServerConfig({ ...VALID, ALLOWED_ORIGINS: ' https://a.example , https://b.example:8443 ' });
    expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example:8443']);
    expect(config.bindings['ALLOWED_ORIGINS']).toBe('https://a.example,https://b.example:8443');
  });
});

describe('describeConfig', () => {
  it('never prints secrets or DB credentials', () => {
    const text = JSON.stringify(
      describeConfig(loadServerConfig({ ...VALID, SMTP_PASS: 'smtp-pass', KC_ADMIN_CLIENT_SECRET: 'kc-secret' })),
    );
    for (const secret of ['s3cret', 'x'.repeat(64), 're_123', 'smtp-pass', 'kc-secret', 'travelmap:']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('postgres:5432/travelmap');
  });
});
