import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inject } from 'vitest';
import { scratchDbAt, type ScratchDb } from '../test-utils/migrations';
import { createDatabase, dropDatabase, uniqueDatabaseName } from '../test-utils/global-setup';
import {
  findDuplicateEmails,
  formatProblems,
  isPushCreatedDatabase,
  redactEmail,
  runPreflight,
} from './preflight';

// Review M1: the deploy runs these checks before `db:migrate`, so a dirty
// production database stops the deploy with a readable list instead of a raw
// 23505 half-way through the migration run.

let db: ScratchDb | undefined;
afterEach(async () => {
  await db?.drop();
  db = undefined;
});

async function seedUser(email: string, kc: string) {
  const { rows } = await db!.pool.query(
    `INSERT INTO users (keycloak_id, email, name) VALUES ($1, $2, 'n') RETURNING id`,
    [kc, email],
  );
  return rows[0].id as number;
}

describe('findDuplicateEmails (0005 pre-check)', () => {
  it('finds exact and case-only duplicates, ignores empty emails, lists ids in order', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    const a1 = await seedUser('dup@example.com', 'kc-1');
    const a2 = await seedUser('DUP@Example.com', 'kc-2');
    const b1 = await seedUser('Other@x.io', 'kc-3');
    const b2 = await seedUser('other@x.io', 'kc-4');
    const b3 = await seedUser('OTHER@X.IO', 'kc-5');
    await seedUser('unique@example.com', 'kc-6');
    await seedUser('', 'kc-7');
    await seedUser('', 'kc-8');

    expect(await findDuplicateEmails(db.pool)).toEqual([
      { email: 'dup@example.com', userIds: [a1, a2] },
      { email: 'other@x.io', userIds: [b1, b2, b3] },
    ]);
  });

  it('is empty on a clean table and on a database with no tables at all', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    await seedUser('a@example.com', 'kc-1');
    expect(await findDuplicateEmails(db.pool)).toEqual([]);
    await db.pool.query('DROP TABLE users CASCADE');
    expect(await findDuplicateEmails(db.pool)).toEqual([]);
  });

  it('agrees with the migration: clean → 0005 applies; after fixing the listed rows → applies', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    const keep = await seedUser('dup@example.com', 'kc-1');
    await seedUser('Dup@example.com', 'kc-2');
    const problems = await runPreflight(db.pool);
    expect(problems).toHaveLength(1);
    await expect(db.migrateToLatest()).rejects.toThrow();

    const [dup] = await findDuplicateEmails(db.pool);
    await db.pool.query('DELETE FROM users WHERE id = ANY($1) AND id <> $2', [dup!.userIds, keep]);
    expect(await runPreflight(db.pool)).toEqual([]);
    await db.migrateToLatest();
  });
});

describe('isPushCreatedDatabase', () => {
  it('false for a migrated database and for an empty one', async () => {
    db = await scratchDbAt('0009_otp_issue_atomic');
    expect(await isPushCreatedDatabase(db.pool)).toBe(false);

    const server = inject('serverDatabaseUrl');
    const name = uniqueDatabaseName('travelmap_empty');
    const url = await createDatabase(server, name);
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      expect(await isPushCreatedDatabase(client)).toBe(false);
      expect(await runPreflight(client)).toEqual([]);
    } finally {
      await client.end();
      await dropDatabase(server, name);
    }
  });

  it('true when the app tables exist but the journal is missing or empty', async () => {
    db = await scratchDbAt('0009_otp_issue_atomic');
    await db.pool.query('DELETE FROM drizzle.__drizzle_migrations');
    expect(await isPushCreatedDatabase(db.pool)).toBe(true);
    await db.pool.query('DROP SCHEMA drizzle CASCADE');
    expect(await isPushCreatedDatabase(db.pool)).toBe(true);
    expect((await runPreflight(db.pool)).map((p) => p.kind)).toEqual(['push_created_database']);
  });
});

describe('runPreflight', () => {
  it('skips the duplicate scan once the unique index exists', async () => {
    db = await scratchDbAt('0009_otp_issue_atomic');
    expect(await runPreflight(db.pool)).toEqual([]);
  });
});

describe('formatting', () => {
  it.each([
    ['manu@example.com', 'm***@example.com'],
    ['a@b.c', 'a***@b.c'],
    ['weird@@x.io', 'w***@x.io'],
    ['no-at-sign', '***'],
    ['@x.io', '***'],
    ['', '***'],
  ])('redactEmail(%j) → %j', (input, out) => {
    expect(redactEmail(input)).toBe(out);
  });

  it('redacts by default and names ids', () => {
    const text = formatProblems(
      [{ kind: 'duplicate_emails', duplicates: [{ email: 'dup@example.com', userIds: [3, 9] }] }],
      { showEmails: false },
    );
    expect(text).toContain('d***@example.com: user ids 3, 9');
    expect(text).not.toContain('dup@example.com');
    expect(text).toContain('--show-emails');
  });

  it('shows full emails when asked', () => {
    const text = formatProblems(
      [{ kind: 'duplicate_emails', duplicates: [{ email: 'dup@example.com', userIds: [3, 9] }] }],
      { showEmails: true },
    );
    expect(text).toContain('dup@example.com: user ids 3, 9');
  });
});

describe('db:preflight CLI (exit codes used by the deploy workflow)', () => {
  const run = promisify(execFile);
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const tsx = path.resolve(backendDir, '../node_modules/.bin/tsx');

  async function cli(env: Record<string, string | undefined>, args: string[] = []) {
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) childEnv[k] = v;
    delete childEnv['DATABASE_URL'];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) childEnv[k] = v;
    try {
      const { stdout, stderr } = await run(tsx, ['src/db/preflight-cli.ts', ...args], {
        cwd: backendDir,
        env: childEnv,
      });
      return { code: 0, out: stdout + stderr };
    } catch (err) {
      const e = err as { code: number; stdout: string; stderr: string };
      return { code: e.code, out: e.stdout + e.stderr };
    }
  }

  it('exit 2 when DATABASE_URL is unset', async () => {
    const r = await cli({});
    expect(r.code).toBe(2);
    expect(r.out).toContain('DATABASE_URL is not set');
  }, 30_000);

  it('exit 2 when the database is unreachable', async () => {
    const r = await cli({ DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/nope' });
    expect(r.code).toBe(2);
    expect(r.out).toContain('cannot connect');
  }, 30_000);

  it('exit 1 with redacted emails on duplicates; --show-emails prints them', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    await seedUser('dup@example.com', 'kc-1');
    await seedUser('DUP@example.com', 'kc-2');
    const r = await cli({ DATABASE_URL: db.url });
    expect(r.code).toBe(1);
    expect(r.out).toContain('d***@example.com: user ids 1, 2');
    expect(r.out).not.toContain('dup@example.com');
    const full = await cli({ DATABASE_URL: db.url }, ['--show-emails']);
    expect(full.out).toContain('dup@example.com: user ids 1, 2');
  }, 30_000);

  it('exit 0 on a clean database', async () => {
    db = await scratchDbAt('0004_email_otp_codes_index');
    await seedUser('a@example.com', 'kc-1');
    const r = await cli({ DATABASE_URL: db.url });
    expect(r.code).toBe(0);
    expect(r.out).toContain('OK');
  }, 30_000);
});
