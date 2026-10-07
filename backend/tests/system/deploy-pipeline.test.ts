/**
 * System: the deploy pipeline (deploy-backend.yml) on the database shapes
 * production can be in:  db:preflight → db:migrate → Worker with the schema
 * guard (dbMiddleware + GET /api/health/ready).
 *
 * Production was created before the Drizzle journal existed (Phase 24), so it
 * most likely has the 0000–0003 objects and NO journal rows. The migrator
 * re-runs 0000–0003 (all IF NOT EXISTS) and applies 0004+ — that path is
 * proven safe by upgrade-path.test.ts. Only a journal-less database that
 * already holds objects from 0004 or later (e.g. pushed from a newer
 * schema.ts) breaks the migrator.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runPreflight } from '../../src/db/preflight';
import { resetSchemaGuardCache } from '../../src/db/schema-guard';
import {
  client,
  createSigner,
  emptyScratch,
  handAppliedScratch,
  installFakeNetwork,
  installNeonHttpFake,
  makeEnv,
  makeUser,
  migratorScratch,
  type NeonFake,
  type Scratch,
  type Signer,
} from './harness';
import fs from 'node:fs';

let signer: Signer;
let neon: NeonFake;

beforeAll(async () => {
  signer = await createSigner();
  installFakeNetwork([signer]);
  neon = installNeonHttpFake();
});
afterAll(async () => {
  await neon.close();
});

async function readyStatus(db: Scratch) {
  resetSchemaGuardCache();
  const req = client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
  return (await req('GET', '/api/health/ready')).status;
}

describe.each([
  ['hand-applied 0000–0003, no journal', () => handAppliedScratch('0003_add_email_otp_codes', 'pipehand')],
  [
    'drizzle-kit push of the 0003-era schema.ts, no journal',
    async () => {
      const db = await emptyScratch('pipepush');
      await db.q(fs.readFileSync(new URL('./fixtures/push-0003-schema.sql', import.meta.url), 'utf8'));
      return db;
    },
  ],
])('production-like 0003 database (%s)', (_label, make) => {
  let db: Scratch;
  beforeAll(async () => {
    db = await make();
    await db.q(`INSERT INTO users (keycloak_id, email, name) VALUES ('a', 'Dup@x.test', 'a'), ('b', 'dup@x.test', 'b'), ('c', '', 'c')`);
  }, 60_000);
  afterAll(async () => {
    await db.drop();
  });

  it('guard: the new Worker refuses with 503 before migrating', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readyStatus(db)).toBe(503);
    const u = await makeUser(signer);
    resetSchemaGuardCache();
    const r = await client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }))('GET', '/api/trips', { token: u.token });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('schema_not_migrated');
    error.mockRestore();
  });

  it('preflight reports only the real blocker (duplicate emails), not the missing journal', async () => {
    expect((await runPreflight(db.pool)).map((p) => p.kind)).toEqual(['duplicate_emails']);
  });

  it('after fixing the duplicate: preflight passes, db:migrate succeeds, the guard reports ready', async () => {
    await db.q(`UPDATE users SET email = '' WHERE keycloak_id = 'b'`);
    expect(await runPreflight(db.pool)).toEqual([]);
    await db.migrateToLatest();
    expect(await runPreflight(db.pool)).toEqual([]);
    expect(await readyStatus(db)).toBe(200);
  });
});

describe('journal-less database that already has post-0003 objects', () => {
  it('preflight blocks it, and indeed db:migrate would fail on it', async () => {
    const db = await migratorScratch('0007_hotels_one_per_destination', 'pipenewer');
    try {
      await db.q('DROP SCHEMA drizzle CASCADE');
      expect((await runPreflight(db.pool)).map((p) => p.kind)).toEqual(['push_created_database']);
      await expect(db.migrateToLatest()).rejects.toThrow();
    } finally {
      await db.drop();
    }
  });
});
