/**
 * Harness for the adversarial API suite (backend/tests/adversarial).
 *
 * What is real:  the Hono app (src/index.ts) with every middleware, the real
 *                JWT verifier (src/auth/keycloak.ts), Zod validation, the
 *                real Drizzle queries and a REAL Postgres database.
 * What is faked: only the network edges — Keycloak's JWKS endpoint (we sign
 *                tokens with an RSA key generated per test file) and the
 *                Mailpit HTTP API (we capture the OTP email to read the code).
 *
 * Database: runs on the shared ARCH-06 harness (vitest.config.ts globalSetup,
 * TEST_DATABASE_URL — see src/test-utils/global-setup.ts). Unlike the unit
 * suites, which share one database and TRUNCATE it between tests, each
 * adversarial file creates its own scratch database on the same server
 * (`inject('serverDatabaseUrl')`), migrated with Drizzle's migrator, and
 * drops it afterwards: the race tests hold row locks from side transactions
 * and count lock waiters per database, which needs an isolated database.
 * Nothing is skipped — no Postgres means the run fails (global-setup).
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describe, inject, vi } from 'vitest';
import app from '../../src/index';
import { closeDbPools } from '../../src/db';
import {
  MIGRATIONS_FOLDER,
  createDatabase,
  dropDatabase,
  uniqueDatabaseName,
} from '../../src/test-utils/global-setup';
import type { Env } from '../../src/types';

/** Kept for readability of the suites: every DB-backed block always runs. */
export const describeDb = describe;

/** Fresh, fully migrated database for one test file. */
export async function createTestDatabase(tag: string): Promise<string> {
  const server = inject('serverDatabaseUrl');
  const url = await createDatabase(server, uniqueDatabaseName(`adv_${tag}`));
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  return url;
}

export async function dropTestDatabase(url: string): Promise<void> {
  // The app caches one pg.Pool per URL (M-01); close it before the forced
  // drop so its idle clients are not killed under it.
  await closeDbPools();
  await dropDatabase(inject('serverDatabaseUrl'), new URL(url).pathname.slice(1));
}

/** Run raw SQL against the test DB (for arranging state the API cannot reach). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  url: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Wait until `n` backends in the test DB are blocked on a heavyweight lock.
 * Used to force a specific interleaving (hold a lock in a side transaction,
 * fire requests, wait until they queue behind it, then release).
 */
export async function waitForLockWaiters(url: string, n: number, timeoutMs = 10_000): Promise<void> {
  const db = new URL(url).pathname.slice(1);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await sql<{ n: number }>(
      url,
      `select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'`,
      [db],
    );
    if (rows[0]!.n >= n) return;
    if (Date.now() > deadline) throw new Error(`waitForLockWaiters: only ${rows[0]!.n}/${n} waiting`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

export const KC_URL = 'http://kc.test';
export const KC_REALM = 'japan-trip';
export const ISSUER = `${KC_URL}/realms/${KC_REALM}`;
export const AUDIENCE = 'japan-trip-frontend';
const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;
const MAILPIT_URL = 'http://localhost:8025/api/v1/send';

export function makeEnv(databaseUrl: string, extra: Record<string, string> = {}): Env {
  return {
    DATABASE_URL: databaseUrl,
    DB_DRIVER: 'pg',
    KEYCLOAK_URL: KC_URL,
    KEYCLOAK_REALM: KC_REALM,
    VALID_AUDIENCES: AUDIENCE,
    KC_ADMIN_CLIENT_ID: 'unused',
    KC_ADMIN_CLIENT_SECRET: 'unused',
    OTP_SECRET: 'adversarial-otp-secret-0123456789abcdef0123456789abcdef',
    ...extra,
  } as Env;
}

// ---------------------------------------------------------------------------
// JWT signing + fake JWKS / Mailpit
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
export function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? enc.encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Signer {
  kid: string;
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
  publicJwk: JsonWebKey & { kid: string; use: string; alg: string };
}

export async function createSigner(kid = 'adv-key-1'): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    kid,
    publicJwk: { ...jwk, kid, use: 'sig', alg: 'RS256' },
    async sign(payload, header = {}) {
      const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid, ...header }));
      const p = b64url(JSON.stringify(payload));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(`${h}.${p}`));
      return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
    },
  };
}

export interface FakeNetwork {
  jwksFetches: number;
  mails: { to: string; text: string }[];
  /** Make Mailpit calls fail while true. */
  failMail: boolean;
  /** Make the JWKS endpoint answer 503 while true. */
  failJwks: boolean;
  lastCodeFor(email: string): string | undefined;
}

/** Stub global fetch: serve the JWKS for `signers`, capture Mailpit sends. */
export function installFakeNetwork(signers: Signer[]): FakeNetwork {
  const net: FakeNetwork = {
    jwksFetches: 0,
    mails: [],
    failMail: false,
    failJwks: false,
    lastCodeFor(email) {
      const m = [...net.mails].reverse().find((x) => x.to === email);
      return m?.text.match(/code is: (\d{6})/)?.[1];
    },
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === JWKS_URL) {
      net.jwksFetches++;
      if (net.failJwks) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify({ keys: signers.map((s) => s.publicJwk) }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === MAILPIT_URL) {
      if (net.failMail) throw new TypeError('fetch failed (fake mail outage)');
      const body = JSON.parse(String(init?.body)) as { To: { Email: string }[]; Text: string };
      net.mails.push({ to: body.To[0]!.Email, text: body.Text });
      return new Response('{}', { status: 200 });
    }
    throw new Error(`adversarial harness: unexpected fetch to ${url}`);
  });
  return net;
}

let userSeq = 0;
export interface TestUser {
  sub: string;
  email: string;
  token: string;
}

/** A valid access token for a fresh Keycloak subject. */
export async function makeUser(
  signer: Signer,
  overrides: Record<string, unknown> = {},
): Promise<TestUser> {
  const n = ++userSeq;
  const sub = `kc-${process.pid}-${n}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `user${n}-${sub}@example.test`;
  const now = Math.floor(Date.now() / 1000);
  const token = await signer.sign({
    sub,
    iss: ISSUER,
    aud: AUDIENCE,
    email,
    name: `User ${n}`,
    preferred_username: `user${n}`,
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...overrides,
  });
  return { sub, email: (overrides.email as string | undefined) ?? email, token };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export interface ApiResult {
  status: number;
  headers: Headers;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

export interface ReqOpts {
  token?: string;
  /** Serialised with JSON.stringify unless it is already a string. */
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string | null;
}

export function client(env: Env) {
  return async function req(method: string, path: string, opts: ReqOpts = {}): Promise<ApiResult> {
    const headers = new Headers(opts.headers);
    if (opts.token !== undefined) headers.set('Authorization', `Bearer ${opts.token}`);
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      if (opts.contentType !== null) headers.set('Content-Type', opts.contentType ?? 'application/json');
    }
    const res = await app.request(path, { method, headers, body }, env);
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  };
}

export type Req = ReturnType<typeof client>;

// ---------------------------------------------------------------------------
// Fixtures built through the public API
// ---------------------------------------------------------------------------

export interface Tree {
  tripId: number;
  destId: number;
  dayId: number;
  actIds: number[];
  base: string;
}

/** trip → destination → day → `nActs` activities, all via the API. */
export async function buildTree(req: Req, token: string, nActs = 3, isPublic = false): Promise<Tree> {
  const trip = await req('POST', '/api/trips', { token, body: { name: 'Adv trip', is_public: isPublic } });
  if (trip.status !== 201) throw new Error(`buildTree trip: ${trip.status} ${trip.text}`);
  const tripId = trip.body.data.id as number;
  const dest = await req('POST', `/api/trips/${tripId}/destinations`, {
    token,
    body: { city_name: 'Kyoto', country: 'Japan', start_date: '2026-03-01', end_date: '2026-03-05' },
  });
  if (dest.status !== 201) throw new Error(`buildTree dest: ${dest.status} ${dest.text}`);
  const destId = dest.body.data.id as number;
  const day = await req('POST', `/api/trips/${tripId}/destinations/${destId}/days`, {
    token,
    body: { date: '2026-03-02', label: 'Day 1' },
  });
  if (day.status !== 201) throw new Error(`buildTree day: ${day.status} ${day.text}`);
  const dayId = day.body.data.id as number;
  const actIds: number[] = [];
  for (let i = 0; i < nActs; i++) {
    const a = await req('POST', `/api/trips/${tripId}/destinations/${destId}/days/${dayId}/activities`, {
      token,
      body: { name: `Act ${i}`, order_index: i },
    });
    if (a.status !== 201) throw new Error(`buildTree act: ${a.status} ${a.text}`);
    actIds.push(a.body.data.id as number);
  }
  return { tripId, destId, dayId, actIds, base: `/api/trips/${tripId}/destinations/${destId}/days/${dayId}` };
}
