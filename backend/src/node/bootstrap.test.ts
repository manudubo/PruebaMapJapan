/**
 * Startup wiring of the self-hosted Node server (node/bootstrap.ts, used by
 * server.ts): the env contract reaches the real app, LOG_LEVEL and the pool
 * are applied, the OTP mail check stops the boot, and the adapter's `incoming`
 * peer reaches the rate limiter. Ends with the compose file: every variable the
 * app reads must be settable in deploy/selfhost/docker-compose.prod.yml.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import app from '../index';
import { prepareServer } from './bootstrap';
import { SERVER_ENV_CONTRACT, ServerConfigError, type RawEnv } from './config';
import { getMinLogLevel, setMinLogLevel } from '../observability/logger';
import { resolveEmailConfig } from '../auth/otp-email';
import { allowedAuthorizedParties, keycloakEndpoints } from '../auth/keycloak';
import { __setRateLimitingEnabledForTests, MemoryRateLimitStore, setRateLimitStore, type RateLimitStore } from '../middleware/rate-limit';

/** The single-host self-host stack (docs/SELF-HOSTING.md), every contract name set. */
const SELFHOST: RawEnv = {
  ENVIRONMENT: 'production',
  DATABASE_URL: 'postgresql://travelmap:s3cret@postgres:5432/travelmap',
  DB_DRIVER: 'pg',
  KEYCLOAK_URL: 'https://legion-server.tailad4a36.ts.net/auth',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KEYCLOAK_ISSUER: 'https://legion-server.tailad4a36.ts.net/auth/realms/japan-trip',
  KEYCLOAK_JWKS_URL: 'http://keycloak:8080/auth/realms/japan-trip/protocol/openid-connect/certs',
  ALLOWED_AZP: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'unused-id',
  KC_ADMIN_CLIENT_SECRET: 'unused-secret',
  OTP_SECRET: 'o'.repeat(64),
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'TravelMap <owner@gmail.com>',
  SMTP_FROM: 'other@gmail.com',
  RESEND_API_KEY: 're_unused_with_explicit_smtp',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'starttls',
  SMTP_USER: 'owner@gmail.com',
  SMTP_PASS: 'abcd efgh ijkl mnop',
  ALLOWED_ORIGINS: 'https://manudubo.github.io',
  TRUSTED_PROXY_HOPS: '2',
  CLIENT_IP_HEADER: 'x-forwarded-for',
  REQUIRE_VERIFIED_EMAIL: 'true',
  KEYCLOAK_ADMIN_URL: 'http://keycloak:8080/auth',
  KEYCLOAK_RECOVERY_CLIENT_ID: 'travelmap-recovery',
  KEYCLOAK_RECOVERY_CLIENT_SECRET: 'r'.repeat(32),
  NOMINATIM_CONTACT: 'owner@example.com',
  NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
  NOMINATIM_USER_AGENT: 'TravelMap-selfhost/1.0',
  LOG_LEVEL: 'warn',
  LOG_REQUESTS: 'false',
  PORT: '8787',
  HOST: '0.0.0.0',
  PG_POOL_MAX: '10',
  PG_IDLE_TIMEOUT_MS: '30000',
  PG_CONNECT_TIMEOUT_MS: '5000',
  SHUTDOWN_TIMEOUT_MS: '10000',
};

const noPool = () => {};

afterEach(() => {
  setMinLogLevel(process.env.TEST_LOG_LEVEL ?? 'warn'); // the suite default (test-utils/setup.ts)
  setRateLimitStore(new MemoryRateLimitStore());
  __setRateLimitingEnabledForTests(false);
});

describe('prepareServer', () => {
  it('the fixture sets every name of the contract (so the checks below cover all of them)', () => {
    expect(Object.keys(SELFHOST).sort()).toEqual([...SERVER_ENV_CONTRACT].sort());
  });

  it('forwards every contract variable to the bindings unchanged', () => {
    const { config } = prepareServer(app, SELFHOST, { configurePgPool: noPool });
    for (const name of SERVER_ENV_CONTRACT) {
      expect(config.bindings[name], name).toBe(SELFHOST[name]);
    }
  });

  it('the app reads them as intended: issuer/JWKS/azp and the Gmail SMTP transport', () => {
    const { config } = prepareServer(app, SELFHOST, { configurePgPool: noPool });
    expect(keycloakEndpoints(config.bindings)).toEqual({
      issuer: SELFHOST.KEYCLOAK_ISSUER,
      jwksUrl: SELFHOST.KEYCLOAK_JWKS_URL,
    });
    expect(allowedAuthorizedParties(config.bindings)).toEqual(['japan-trip-frontend']);
    expect(resolveEmailConfig(config.bindings)).toEqual({
      provider: 'smtp',
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        security: 'starttls',
        from: 'TravelMap <owner@gmail.com>',
        user: 'owner@gmail.com',
        pass: 'abcd efgh ijkl mnop',
      },
    });
  });

  it('applies LOG_LEVEL to the app logger and the pool limits', () => {
    const pools: unknown[] = [];
    setMinLogLevel('info');
    prepareServer(app, { ...SELFHOST, LOG_LEVEL: 'error', PG_POOL_MAX: '4' }, { configurePgPool: (p) => pools.push(p) });
    expect(getMinLogLevel()).toBe('error');
    expect(pools).toEqual([{ max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }]);
  });

  it('an unusable OTP mail setup stops the boot before any global state changes', () => {
    const setLevel = vi.fn();
    const setPool = vi.fn();
    const attempt = () =>
      prepareServer(app, { ...SELFHOST, SMTP_SECURE: 'none' }, { configurePgPool: setPool, setMinLogLevel: setLevel });
    expect(attempt).toThrow(ServerConfigError);
    try {
      attempt();
    } catch (err) {
      expect((err as ServerConfigError).problems).toEqual([
        'OTP email transport: SMTP_SECURE=none is only allowed when ENVIRONMENT=development',
      ]);
    }
    expect(setLevel).not.toHaveBeenCalled();
    expect(setPool).not.toHaveBeenCalled();
  });
});

describe('the real app behind @hono/node-server', () => {
  let server: Server;
  let base: string;
  let keys: string[];

  async function start(env: RawEnv) {
    const { fetchHandler } = prepareServer(app, env, { configurePgPool: noPool });
    server = serve({ fetch: (req, nodeEnv) => fetchHandler(req, nodeEnv as Record<string, unknown>), port: 0, hostname: '127.0.0.1' }) as Server;
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    keys = [];
    const memory = new MemoryRateLimitStore();
    const recording: RateLimitStore = { hit: (key, windowMs, now) => (keys.push(key), memory.hit(key, windowMs, now)) };
    setRateLimitStore(recording);
    __setRateLimitingEnabledForTests(true);
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  it('CORS follows ALLOWED_ORIGINS: the Pages origin is allowed, others are not', async () => {
    await start(SELFHOST);
    const preflight = (origin: string) =>
      fetch(`${base}/api/trips`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
      });
    expect((await preflight('https://manudubo.github.io')).headers.get('access-control-allow-origin')).toBe('https://manudubo.github.io');
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rate limits key on the TCP peer (incoming) when no proxy is trusted', async () => {
    await start({ ...SELFHOST, TRUSTED_PROXY_HOPS: '0' });
    await fetch(`${base}/api/health`, { headers: { 'X-Forwarded-For': '6.6.6.6' } });
    expect(keys).toContain('api-ip|ip:127.0.0.1');
    expect(keys.some((k) => k.includes('unknown') || k.includes('6.6.6.6'))).toBe(false);
  });

  it('with TRUSTED_PROXY_HOPS=2 (Funnel → Caddy) the client is the entry the first proxy appended', async () => {
    await start(SELFHOST);
    await fetch(`${base}/api/health`, { headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9, 172.19.0.1' } });
    expect(keys).toContain('api-ip|ip:203.0.113.9');
    expect(keys.some((k) => k.includes('6.6.6.6'))).toBe(false);
  });
});

describe('deploy/selfhost/docker-compose.prod.yml', () => {
  // The backend service's `environment:` keys (a map, 6-space indent). A tiny
  // scanner instead of a YAML dependency; scripts.test.sh validates the file itself.
  const lines = readFileSync(resolve(__dirname, '../../../deploy/selfhost/docker-compose.prod.yml'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === '  backend:');
  const end = lines.findIndex((l, i) => i > start && /^  \S/.test(l));
  const service = lines.slice(start, end === -1 ? undefined : end);
  const envAt = service.findIndex((l) => l === '    environment:');
  const backendEnv: string[] = [];
  for (const l of service.slice(envAt + 1)) {
    if (/^\s*#/.test(l)) continue;
    const m = /^      ([A-Z][A-Z0-9_]*):/.exec(l);
    if (!m) break;
    backendEnv.push(m[1]!);
  }

  it('finds the backend environment block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(envAt).toBeGreaterThan(-1);
    expect(backendEnv).toContain('DATABASE_URL');
  });

  // Not used by the app on the Node server: the worker admin client does not exist in
  // the production realm; the listener and pool settings have working defaults.
  const NOT_FORWARDED = new Set(['KC_ADMIN_CLIENT_ID', 'KC_ADMIN_CLIENT_SECRET', 'PORT', 'HOST', 'PG_IDLE_TIMEOUT_MS', 'PG_CONNECT_TIMEOUT_MS', 'SHUTDOWN_TIMEOUT_MS']);

  it('lets the operator set every variable the app reads', () => {
    const missing = SERVER_ENV_CONTRACT.filter((n) => !NOT_FORWARDED.has(n) && !backendEnv.includes(n));
    expect(missing).toEqual([]);
  });

  it('passes nothing the server does not know about (typos would be silently ignored)', () => {
    const unknown = backendEnv.filter((n) => !(SERVER_ENV_CONTRACT as readonly string[]).includes(n) && n !== 'NODE_OPTIONS');
    expect(unknown).toEqual([]);
  });
});
