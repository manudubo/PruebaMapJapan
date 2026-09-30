/**
 * Helpers to test migrations "up" on a populated database: build a scratch
 * database migrated only up to a given journal entry, fill it with data,
 * then run the real migrator over the full folder (it applies the rest).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { inject } from 'vitest';
import {
  MIGRATIONS_FOLDER,
  createDatabase,
  dropDatabase,
  uniqueDatabaseName,
} from './global-setup';

interface Journal {
  entries: { idx: number; tag: string }[];
}

export function journalTags(): string[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  return journal.entries.map((e) => e.tag);
}

/** Copy of the migrations folder whose journal stops after `lastTag`. */
function truncatedFolder(lastTag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut < 0) throw new Error(`unknown migration tag ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) {
    fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  }
  return dir;
}

export interface ScratchDb {
  pool: pg.Pool;
  /** Run the real migrator over the full migrations folder. */
  migrateToLatest(): Promise<void>;
  drop(): Promise<void>;
}

/** Fresh database migrated up to and including `lastTag`. */
export async function scratchDbAt(lastTag: string): Promise<ScratchDb> {
  const server = inject('serverDatabaseUrl');
  const name = uniqueDatabaseName('travelmap_mig');
  const url = await createDatabase(server, name);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const folder = truncatedFolder(lastTag);
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  return {
    pool,
    migrateToLatest: () => migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
    drop: async () => {
      await pool.end();
      await dropDatabase(server, name);
    },
  };
}
