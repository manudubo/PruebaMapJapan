/**
 * `npm run db:preflight --workspace=backend` (review M1).
 *
 * Reads DATABASE_URL (the same variable drizzle.config.ts uses for
 * `db:migrate`), runs the checks in ./preflight.ts and exits:
 *   0 — safe to migrate
 *   1 — a blocker was found (details on stderr)
 *   2 — not configured / cannot connect
 * Pass --show-emails to print offending emails unredacted (local use only;
 * CI logs of a public repository are public).
 */
import pg from 'pg';
import { formatProblems, runPreflight } from './preflight';

async function main(): Promise<number> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('db:preflight: DATABASE_URL is not set.');
    return 2;
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    console.error(`db:preflight: cannot connect to the database: ${(err as Error).message}`);
    return 2;
  }
  try {
    const problems = await runPreflight(client);
    if (problems.length === 0) {
      console.log('db:preflight: OK, no known migration blockers.');
      return 0;
    }
    console.error(formatProblems(problems, { showEmails: process.argv.includes('--show-emails') }));
    return 1;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('db:preflight: unexpected error:', err);
    process.exit(2);
  },
);
