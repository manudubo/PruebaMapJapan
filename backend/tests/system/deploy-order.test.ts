/**
 * System: deploy-order / rollback hazards — the CURRENT Worker code running
 * against an OLDER schema (migrations not applied yet, or the database
 * restored from a backup).
 *
 * Without a guard, what breaks depends on the missing migration:
 *   - before 0009: every POST /api/auth/otp-request → 500 (42883, otp_issue
 *     does not exist); verify still works.
 *   - before 0008: nothing errors — BIZ-07 date rules are silently OFF
 *     (a day outside its destination is accepted with 201).
 *   - before 0007: every PUT …/hotel → 500 (42P10, no unique index for
 *     ON CONFLICT (destination_id)).
 *   - before 0005: duplicate emails are silently accepted (no 409).
 *   - before 0004/0006/0010: no visible error (slower OTP cleanup; CHECKs
 *     are backed by Zod; push-built NULL slugs stay unshareable).
 * The guard (dbMiddleware schema check, once per isolate and URL) turns all
 * of these into an explicit 503 { code: 'schema_out_of_date' } on every
 * DB-backed route, plus one console.error naming the missing migrations;
 * it re-checks so applying the migrations heals the running Worker.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { _resetSchemaCheckForTests } from '../../src/db/schema-check';
import {
  client,
  createSigner,
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

const DB_ROUTES: [string, string, unknown?][] = [
  ['GET', '/api/trips'],
  ['POST', '/api/trips', { name: 'x' }],
  ['GET', '/api/users/me'],
  ['POST', '/api/auth/otp-request'],
  ['GET', '/api/public/trips/00000000-0000-4000-8000-000000000000'],
];

describe.each([
  ['0003 (production today, hand-built)', '0003_add_email_otp_codes', ['0004_email_otp_codes_index', '0005_users_email_unique', '0006_lat_lng_range_checks', '0007_hotels_one_per_destination', '0008_date_coherence', '0009_otp_issue_atomic']],
  ['0006 (before the hotel index)', '0006_lat_lng_range_checks', ['0007_hotels_one_per_destination', '0008_date_coherence', '0009_otp_issue_atomic']],
  ['0007 (before BIZ-07 and otp_issue)', '0007_hotels_one_per_destination', ['0008_date_coherence', '0009_otp_issue_atomic']],
] as const)('new Worker on a database at %s', (_label, lastTag, missing) => {
  let db: Scratch;

  beforeAll(async () => {
    db = lastTag === '0003_add_email_otp_codes' ? await handAppliedScratch(lastTag, 'deploy') : await migratorScratch(lastTag, 'deploy');
  }, 60_000);
  afterAll(async () => {
    await db.drop();
  });

  it.each(['pg', 'neon'] as const)('%s driver: every DB-backed route answers 503 schema_out_of_date and the log names the missing migrations', async (driver) => {
    _resetSchemaCheckForTests();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const req = client(makeEnv(db.url, { DB_DRIVER: driver, ENVIRONMENT: 'development' }));
      const u = await makeUser(signer);
      for (const [method, path, body] of DB_ROUTES) {
        const r = await req(method, path, { token: u.token, body });
        expect(r.status, `${method} ${path}: ${r.text}`).toBe(503);
        expect(r.body).toEqual({ success: false, error: 'Service temporarily unavailable', code: 'schema_out_of_date' });
      }
      const logged = error.mock.calls.map((c) => c.join(' ')).join('\n');
      for (const tag of missing) expect(logged).toContain(tag);
      expect(logged).toContain('db:migrate');
      // Nothing was written by the refused requests.
      expect(await db.q('SELECT count(*)::int AS n FROM users')).toEqual([{ n: 0 }]);
      // Health stays a pure liveness probe.
      expect((await req('GET', '/api/health')).status).toBe(200);
    } finally {
      error.mockRestore();
    }
  });
});

describe('the guard heals once migrations are applied', () => {
  it('503 before, normal answers after `db:migrate`, without restarting the Worker', async () => {
    const db = await migratorScratch('0007_hotels_one_per_destination', 'heal');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      _resetSchemaCheckForTests();
      const req = client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
      const u = await makeUser(signer);
      expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(503);
      await db.migrateToLatest();
      _resetSchemaCheckForTests(); // stands in for MISSING_RECHECK_MS elapsing
      expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(200);
      expect((await req('POST', '/api/auth/otp-request', { token: u.token })).status).toBe(201);
    } finally {
      error.mockRestore();
      await db.drop();
    }
  });

  it('a fully migrated database pays the check once per URL, not per request', async () => {
    const db = await migratorScratch('0010_reconcile_push_built_schema', 'once');
    try {
      _resetSchemaCheckForTests();
      const req = client(makeEnv(db.url, { DB_DRIVER: 'neon', ENVIRONMENT: 'development' }));
      const u = await makeUser(signer);
      const start = neon.statements.length;
      for (let i = 0; i < 5; i++) expect((await req('GET', '/api/trips', { token: u.token })).status).toBe(200);
      const checks = neon.statements.slice(start).filter((s) => s.includes('to_regprocedure'));
      expect(checks).toHaveLength(1);
    } finally {
      await db.drop();
    }
  });
});
