/**
 * GET /api/health/ready, the one readiness implementation (routes/health.ts):
 * the cached schema verdict (review M1, schema_not_migrated), the unverified
 * check and the per-probe `SELECT 1` (db_unreachable, ad852aa + self-host S1),
 * and the per-IP probe limit (PROD-HARDENING #4), on a real Postgres.
 *
 * "Postgres killed" is simulated by a TCP relay in front of the test server:
 * killing it resets every open connection and refuses new ones, which is what
 * the backend sees when the postgres container dies (docker kill). Reviving it
 * on the same port is the container coming back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import net, { type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import app from '../index';
import { closeDbPools } from '../db';
import { resetSchemaGuardCache } from '../db/schema-guard';
import { testDatabaseUrl, testEnv } from '../test-utils/db';
import { scratchDbAt, type ScratchDb } from '../test-utils/migrations';
import { POLICIES, __resetRateLimitsForTests, __setRateLimitingEnabledForTests } from '../middleware/rate-limit';
import type { Env } from '../types';

class PostgresRelay {
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  port = 0;

  constructor(private readonly target: { host: string; port: number }) {}

  async start(): Promise<void> {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.target.port, this.target.host);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('close', () => this.sockets.delete(s));
        s.on('error', () => s.destroy());
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => this.server!.listen(this.port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Like `docker kill postgres`: open connections reset, new ones refused. */
  async kill(): Promise<void> {
    for (const s of this.sockets) s.resetAndDestroy();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}

let relay: PostgresRelay;
let scratch: ScratchDb | undefined;

function envVia(port: number, extra: Partial<Env> = {}): Env {
  const url = new URL(testDatabaseUrl());
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return testEnv({ DATABASE_URL: url.href, ENVIRONMENT: 'production', ...extra });
}

async function probe(env: Env, peer = '198.51.100.7', path = '/api/health/ready') {
  const res = await app.request(path, {}, { ...env, incoming: { socket: { remoteAddress: peer } } } as unknown as Env);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

beforeAll(async () => {
  const target = new URL(testDatabaseUrl());
  relay = new PostgresRelay({ host: target.hostname, port: Number(target.port || 5432) });
});

beforeEach(async () => {
  resetSchemaGuardCache();
  await relay.start();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  __setRateLimitingEnabledForTests(false);
  await closeDbPools();
  await relay.kill().catch(() => {});
  relay.port = 0;
  await scratch?.drop();
  scratch = undefined;
});

afterAll(async () => {
  await closeDbPools();
});

describe('GET /api/health/ready', () => {
  it('200 ready on a migrated, answering database (no-store)', async () => {
    const r = await probe(envVia(relay.port));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ready' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('503 schema_not_migrated on a database behind the code, naming nothing', async () => {
    scratch = await scratchDbAt('0003_add_email_otp_codes');
    const r = await probe(testEnv({ DATABASE_URL: scratch.url, ENVIRONMENT: 'production' }));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: 'unavailable', code: 'schema_not_migrated' });
  });

  it('Postgres killed after a cached "ready": 503 db_unreachable, liveness stays 200; back to 200 when it returns', async () => {
    const env = envVia(relay.port);
    expect((await probe(env)).status).toBe(200); // schema verdict now cached for the process

    await relay.kill();
    const down = await probe(env);
    expect(down.status).toBe(503);
    expect(down.body).toEqual({ status: 'unavailable', code: 'db_unreachable' });
    expect((await probe(env, undefined, '/api/health')).status).toBe(200);

    await relay.start(); // same port: the container is back
    await vi.waitFor(async () => expect((await probe(env)).status).toBe(200), { timeout: 5_000, interval: 100 });
  });

  it('Postgres down before the first check: 503 db_unreachable, never "ready" unverified', async () => {
    const env = envVia(relay.port);
    await relay.kill();
    const r = await probe(env);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: 'unavailable', code: 'db_unreachable' });
  });

  it('503 not_configured without DATABASE_URL', async () => {
    const r = await probe(testEnv({ DATABASE_URL: '' }));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: 'unavailable', code: 'not_configured' });
  });

  it('probes are rate limited per client before any database work', async () => {
    __setRateLimitingEnabledForTests(true);
    __resetRateLimitsForTests();
    const env = envVia(relay.port);
    const statuses: number[] = [];
    for (let i = 0; i < POLICIES.healthPerIp.limit; i++) statuses.push((await probe(env, '198.51.100.7')).status);
    expect(statuses.every((s) => s === 200)).toBe(true);

    // With the database gone, the next probe from that client is still refused by the
    // limiter (429), not by the database (503): a flood never reaches Postgres.
    await relay.kill();
    const limited = await probe(env, '198.51.100.7');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ success: false, error: 'rate_limited' });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('cache-control')).toBe('no-store');

    // Another client (e.g. the container healthcheck on loopback) keeps its own budget.
    await relay.start();
    // (Retried until the pool has dropped the connections the kill reset.)
    await vi.waitFor(async () => expect((await probe(env, '127.0.0.1')).status).toBe(200), { timeout: 5_000, interval: 100 });
  });
});
