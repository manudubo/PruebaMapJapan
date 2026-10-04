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
 *  2. A database built with `drizzle-kit push` has the app tables but no
 *     Drizzle migration journal; `db:migrate` would then re-run 0000.. and
 *     break at the first statement without IF NOT EXISTS (0004). We stop and
 *     point at the baselining procedure instead.
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

/** App tables present but no Drizzle journal rows: created by `drizzle-kit push`. */
export async function isPushCreatedDatabase(db: Queryable): Promise<boolean> {
  if (!(await exists(db, 'public.users'))) return false;
  if (!(await exists(db, 'drizzle.__drizzle_migrations'))) return true;
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
  return (rows[0]?.n ?? 0) === 0;
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
        'PRE-FLIGHT FAILED: this database has the app tables but no Drizzle migration journal',
        '(drizzle.__drizzle_migrations is missing or empty). It was most likely created with',
        '`drizzle-kit push`. `db:migrate` would re-run every migration and fail part-way.',
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
