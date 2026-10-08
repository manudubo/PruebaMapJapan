/**
 * Pre-flight checks run before `db:migrate` in the deploy workflow (review M1).
 *
 * A migration that fails half-way through a deploy is the expensive case: the
 * operator learns about it from a red deploy log and a raw Postgres error.
 * These checks look for the known blockers first and explain the fix.
 *
 *  1. Migration 0005 creates a unique index on lower(users.email). Rows that
 *     share an email (case-insensitively) make it fail with 23505. We list the
 *     offending emails and user ids so they can be merged by hand.
 *  2. A database with no Drizzle migration journal but objects from 0004+
 *     (e.g. `drizzle-kit push` of a recent schema.ts): `db:migrate` would
 *     re-run 0000.. and break at 0004, the first statement without IF NOT
 *     EXISTS. We stop and point at the rebuild procedure instead. A
 *     journal-less database still at the 0003 shape (production before the
 *     journal existed) migrates normally and is not flagged.
 *
 * Node-only (uses `pg`); never imported by the Worker.
 */
import type pg from 'pg';

export interface DuplicateEmail {
  email: string;
  userIds: number[];
}

export type PreflightProblem =
  | { kind: 'duplicate_emails'; duplicates: DuplicateEmail[] }
  | { kind: 'push_created_database' };

type Queryable = Pick<pg.ClientBase, 'query'>;

async function exists(db: Queryable, regclass: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [regclass]);
  return rows[0]?.ok === true;
}

/** Emails held by more than one user, compared like the 0005 index does. */
export async function findDuplicateEmails(db: Queryable): Promise<DuplicateEmail[]> {
  if (!(await exists(db, 'public.users'))) return [];
  const { rows } = await db.query<{ email: string; user_ids: number[] }>(
    `SELECT lower(email) AS email, array_agg(id ORDER BY id) AS user_ids
       FROM users
      WHERE email <> ''
      GROUP BY lower(email)
     HAVING count(*) > 1
      ORDER BY lower(email)`,
  );
  return rows.map((r) => ({ email: r.email, userIds: r.user_ids }));
}

/**
 * True if any object created by migration 0004 or later already exists.
 * 0000–0003 are written with IF NOT EXISTS, so the migrator can safely re-run
 * them over a journal-less database; 0004+ are not.
 */
async function hasPost0003Objects(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ found: boolean }>(
    `SELECT to_regclass('public.email_otp_codes_user_id_expires_at_idx') IS NOT NULL
         OR to_regclass('public.users_email_unique_idx') IS NOT NULL
         OR to_regclass('public.hotels_destination_id_idx') IS NOT NULL
         OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname LIKE '%\\_lat\\_lng\\_range')
         OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%\\_biz07\\_date\\_coherence')
         OR to_regprocedure('public.otp_issue(integer, text, integer, integer, integer)') IS NOT NULL AS found`,
  );
  return rows[0]?.found === true;
}

/**
 * App tables present, no Drizzle journal rows, AND objects from 0004+ already
 * there (typically `drizzle-kit push` from a post-Phase-24 schema.ts): the
 * migrator would re-run 0004 and fail. A journal-less database at the 0003
 * shape (production built before the journal existed, by hand or by pushing
 * the 0003-era schema) is NOT a blocker: 0000–0003 re-run as no-ops and
 * 0004+ apply normally (tests/system/upgrade-path.test.ts).
 */
export async function isPushCreatedDatabase(db: Queryable): Promise<boolean> {
  if (!(await exists(db, 'public.users'))) return false;
  if (await exists(db, 'drizzle.__drizzle_migrations')) {
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    if ((rows[0]?.n ?? 0) > 0) return false;
  }
  return hasPost0003Objects(db);
}

async function uniqueEmailIndexExists(db: Queryable): Promise<boolean> {
  return exists(db, 'public.users_email_unique_idx');
}

/** Every blocker found, in the order an operator should fix them. */
export async function runPreflight(db: Queryable): Promise<PreflightProblem[]> {
  const problems: PreflightProblem[] = [];
  if (await isPushCreatedDatabase(db)) problems.push({ kind: 'push_created_database' });
  // Once 0005 is in, duplicates cannot exist; skip the scan.
  if (!(await uniqueEmailIndexExists(db))) {
    const duplicates = await findDuplicateEmails(db);
    if (duplicates.length > 0) problems.push({ kind: 'duplicate_emails', duplicates });
  }
  return problems;
}

/** `manu@example.com` → `m***@example.com` — safe for public CI logs. */
export function redactEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function formatProblems(problems: PreflightProblem[], opts: { showEmails: boolean }): string {
  const lines: string[] = [];
  for (const p of problems) {
    if (p.kind === 'push_created_database') {
      lines.push(
        'PRE-FLIGHT FAILED: this database has no Drizzle migration journal',
        '(drizzle.__drizzle_migrations is missing or empty) but already has objects from',
        'migration 0004 or later; it was most likely created with `drizzle-kit push`.',
        '`db:migrate` would re-run every migration and fail at 0004.',
        'Fix: follow "Databases created with drizzle-kit push" in backend/src/db/README.md.',
      );
    } else {
      lines.push(
        `PRE-FLIGHT FAILED: migration 0005 (unique email) would fail. ${p.duplicates.length} email(s) are shared by several users:`,
      );
      for (const d of p.duplicates) {
        const email = opts.showEmails ? d.email : redactEmail(d.email);
        lines.push(`  - ${email}: user ids ${d.userIds.join(', ')}`);
      }
      lines.push(
        'Fix: keep one account per email (move its trips with UPDATE trips SET user_id = <kept id>',
        'WHERE user_id = <other id>, then DELETE the other user), then re-run the deploy.',
      );
      if (!opts.showEmails) {
        lines.push('Emails are redacted for CI logs; run locally with --show-emails to see them in full.');
      }
    }
  }
  return lines.join('\n');
}
