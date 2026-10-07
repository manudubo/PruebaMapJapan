/**
 * Harness for the system QA suite (backend/tests/system).
 *
 * Builds on the adversarial harness (real Hono app, real JWT verifier, real
 * Postgres per file; only JWKS and Mailpit faked) and adds:
 *
 *  - installNeonHttpFake(): a stand-in for Neon's HTTP `/sql` endpoint, so the
 *    app can run with DB_DRIVER="neon" (the PRODUCTION driver,
 *    @neondatabase/serverless over fetch) against the real local Postgres.
 *    Every HTTP call executes exactly ONE statement on a pooled connection in
 *    autocommit mode, which is what Neon's endpoint does: no session state and
 *    no interactive transaction survive between two calls. Errors come back as
 *    HTTP 400 with the Postgres error fields, the shape the real driver turns
 *    into NeonDbError. Every statement is logged, so a test can assert that a
 *    request never relied on BEGIN/COMMIT or a session-level lock.
 *  - schemaFingerprint(): a catalog-based description of the public schema
 *    (columns, defaults, constraints, indexes, triggers, functions), to compare
 *    an upgraded database with a freshly migrated one without depending on a
 *    pg_dump binary of the server's major version.
 *  - migration helpers that apply SQL files by hand, the way a database that
 *    predates the Drizzle journal (production at 0003) was built.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { inject, vi } from 'vitest';
import {
  MIGRATIONS_FOLDER,
  createDatabase,
  dropDatabase,
  uniqueDatabaseName,
} from '../../src/test-utils/global-setup';
import { closeDbPools } from '../../src/db';

export * from '../adversarial/harness';
export { MIGRATIONS_FOLDER };

// ---------------------------------------------------------------------------
// Scratch databases at a given migration
// ---------------------------------------------------------------------------

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

export function journal(): Journal {
  return JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as Journal;
}

export function journalTags(): string[] {
  return journal().entries.map((e) => e.tag);
}

/** Split a migration file on Drizzle's statement breakpoints. */
export function migrationStatements(tag: string): string[] {
  const text = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
  return text
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface Scratch {
  url: string;
  pool: pg.Pool;
  q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  /** The real Drizzle migrator over the full folder (what `npm run db:migrate` does). */
  migrateToLatest(): Promise<void>;
  drop(): Promise<void>;
}

/** Empty database (no tables, no Drizzle journal table). */
export async function emptyScratch(tag: string): Promise<Scratch> {
  const server = inject('serverDatabaseUrl');
  const name = uniqueDatabaseName(`sys_${tag}`);
  const url = await createDatabase(server, name);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  pool.on('error', () => {});
  return {
    url,
    pool,
    async q(text, params = []) {
      return (await pool.query(text, params)).rows;
    },
    migrateToLatest: () => migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
    async drop() {
      await pool.end();
      await closeDbPools();
      await dropDatabase(server, name);
    },
  };
}

/**
 * Database built the way production most likely was before Phase 24: the
 * SQL files up to `lastTag` applied by hand (psql / Neon SQL editor / push),
 * with NO drizzle.__drizzle_migrations table — the journal did not exist yet.
 */
export async function handAppliedScratch(lastTag: string, tag = 'hand'): Promise<Scratch> {
  const db = await emptyScratch(tag);
  for (const t of journalTags()) {
    for (const stmt of migrationStatements(t)) await db.q(stmt);
    if (t === lastTag) return db;
  }
  throw new Error(`unknown tag ${lastTag}`);
}

/** Database migrated with the Drizzle migrator, journal truncated after `lastTag`. */
export async function migratorScratch(lastTag: string, tag = 'mig'): Promise<Scratch> {
  const db = await emptyScratch(tag);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sys-mig-'));
  try {
    fs.mkdirSync(path.join(dir, 'meta'));
    const j = journal();
    const cut = j.entries.findIndex((e) => e.tag === lastTag);
    if (cut < 0) throw new Error(`unknown tag ${lastTag}`);
    j.entries = j.entries.slice(0, cut + 1);
    fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(j));
    for (const e of j.entries) {
      fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    }
    await migrate(drizzle(db.pool), { migrationsFolder: dir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return db;
}

// ---------------------------------------------------------------------------
// Schema fingerprint
// ---------------------------------------------------------------------------

/** Deterministic description of everything in schema `public`. */
export async function schemaFingerprint(db: Scratch): Promise<Record<string, string[]>> {
  const rows = async (text: string) => (await db.q<{ x: string }>(text)).map((r) => r.x);
  return {
    columns: await rows(`
      SELECT table_name || '.' || column_name || ' ' || data_type
             || coalesce('(' || character_maximum_length || ')', '')
             || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', '')
             || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-') AS x
        FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`),
    constraints: await rows(`
      SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS x
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`),
    indexes: await rows(`SELECT indexdef AS x FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`),
    triggers: await rows(`
      SELECT pg_get_triggerdef(t.oid) AS x FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal ORDER BY 1`),
    functions: await rows(`
      SELECT pg_get_functiondef(p.oid) AS x FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`),
    sequences: await rows(`
      SELECT sequencename || ' owned' AS x FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`),
  };
}

// ---------------------------------------------------------------------------
// Neon HTTP endpoint fake (production driver against local Postgres)
// ---------------------------------------------------------------------------

export interface NeonFake {
  /** Every statement received, in arrival order. */
  statements: string[];
  /** Batch (`sql.transaction([...])`) calls received — the app must never send one. */
  batches: number;
  close(): Promise<void>;
}

const RAW_TEXT_TYPES = { getTypeParser: () => (v: unknown) => v };
const ERROR_FIELDS = [
  'severity', 'code', 'detail', 'hint', 'position', 'internalPosition', 'internalQuery', 'where',
  'schema', 'table', 'column', 'dataType', 'constraint', 'file', 'line', 'routine',
] as const;

/**
 * Wrap the current global fetch (usually installFakeNetwork's stub) so that
 * requests carrying `Neon-Connection-String` are executed against the real
 * Postgres named in that string. Call AFTER installFakeNetwork.
 */
export function installNeonHttpFake(): NeonFake {
  const inner = globalThis.fetch;
  const pools = new Map<string, pg.Pool>();
  const fake: NeonFake = {
    statements: [],
    batches: 0,
    async close() {
      await Promise.all([...pools.values()].map((p) => p.end()));
      pools.clear();
    },
  };
  const poolFor = (cs: string) => {
    let p = pools.get(cs);
    if (!p) {
      p = new pg.Pool({ connectionString: cs, max: 40 });
      p.on('error', () => {}); // idle client killed by DROP DATABASE … WITH (FORCE)
      pools.set(cs, p);
    }
    return p;
  };
  const toResult = (r: pg.QueryResult) => ({
    command: r.command,
    rowCount: r.rowCount,
    rows: r.rows,
    fields: r.fields.map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: f.tableID,
      columnID: f.columnID,
      dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier,
      format: 'text',
    })),
    rowAsArray: true,
  });
  const errorResponse = (err: unknown) => {
    const e = err as Record<string, unknown> & { message?: string };
    if (typeof e?.code !== 'string') throw err;
    const body: Record<string, unknown> = { message: e.message };
    for (const f of ERROR_FIELDS) if (e[f] !== undefined) body[f] = e[f];
    return new Response(JSON.stringify(body), { status: 400, headers: { 'Content-Type': 'application/json' } });
  };
  type Q = { query: string; params: unknown[] };
  const run = (client: pg.PoolClient | pg.Pool, q: Q) =>
    client.query({ text: q.query, values: q.params, rowMode: 'array', types: RAW_TEXT_TYPES });

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const cs = headers.get('Neon-Connection-String');
    if (!cs) return inner(input, init);
    const body = JSON.parse(String(init?.body)) as Q | { queries: Q[] };
    const pool = poolFor(cs);
    if ('queries' in body) {
      fake.batches++;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const q of body.queries) {
          fake.statements.push(q.query);
          results.push(toResult(await run(client, q)));
        }
        await client.query('COMMIT');
        return Response.json({ results });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        return errorResponse(err);
      } finally {
        client.release();
      }
    }
    fake.statements.push(body.query);
    try {
      return Response.json(toResult(await run(pool, body)));
    } catch (err) {
      return errorResponse(err);
    }
  });
  return fake;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** Rows violating a BIZ-07 rule (empty = coherent), restricted to `tripIds` if given. */
export const BIZ07_VIOLATIONS_SQL = `
  SELECT 'dest-outside-trip' AS rule, d.id FROM destinations d JOIN trips t ON t.id = d.trip_id
   WHERE d.start_date < t.start_date OR d.start_date > t.end_date
      OR d.end_date < t.start_date OR d.end_date > t.end_date
  UNION ALL
  SELECT 'dest-reversed', d.id FROM destinations d WHERE d.start_date > d.end_date
  UNION ALL
  SELECT 'trip-reversed', t.id FROM trips t WHERE t.start_date > t.end_date
  UNION ALL
  SELECT 'day-outside-dest', y.id FROM days y JOIN destinations d ON d.id = y.destination_id
   WHERE y.date < d.start_date OR y.date > d.end_date
  UNION ALL
  SELECT 'overlap', a.id FROM destinations a JOIN destinations b
    ON a.trip_id = b.trip_id AND a.id < b.id
   WHERE a.start_date < b.end_date AND b.start_date < a.end_date`;

// ---------------------------------------------------------------------------
// Seeded PRNG (property / fuzz tests)
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, deterministic. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    bool: (p = 0.5) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;
