# QA — Backend as a system: migrations, upgrade path, deploy order, Neon HTTP

**Date:** 2026-10-07
**Base:** `claude/focused-lovelace-cryssy` @ `be13cef`, then merged with that branch's later head and with `origin/main` @ `ed49639` (PR #23: schema guard, `db:preflight`, migrate-before-deploy).
**Branch:** `worktree-agent-a858e9433fae45138` (not pushed).
**Database:** PostgreSQL 16.13 from `/usr/lib/postgresql/16/bin`, run as `postgres` via `setpriv`, `max_connections=200`, port 58431, UTF8 cluster.
**Suite:** new `backend/tests/system/` has 5 files and 92 tests. It uses the shared ARCH-06 harness (`globalSetup`, one scratch DB per file or per scenario) plus the adversarial harness (real JWT verifier, fake JWKS and Mailpit).

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:58431/postgres npm test --workspace=backend
PROP_SEEDS=1,2,3 npx vitest run tests/system/property.test.ts   # search more seeds locally
```

Final run: backend `tsc` clean, `tsc -p tests/system` clean, `tsc -p tests/adversarial` clean. Vitest: **48 files, 1619 tests, all pass.** `drizzle-kit generate`: no drift.
The suite needs `pg_dump` 16 for one comparison. It looks in `$PG_DUMP`, then `/usr/lib/postgresql/16/bin`, then `PATH`.

## What is new in the harness

- **Neon HTTP fake** (`installNeonHttpFake`). It wraps `fetch` and answers `@neondatabase/serverless` `/sql` calls by running each statement on the real Postgres:
  - one statement per HTTP call, in autocommit;
  - raw text output, so the driver's own type parsers run;
  - errors come back as HTTP 400 with the Postgres fields, so the driver builds a real `NeonDbError`.

  With this fake the app runs with **`DB_DRIVER=neon`, the production driver**, against real Postgres. Every statement is logged, so tests can assert that nothing relied on BEGIN/COMMIT or session state.
- **`schemaFingerprint`**: a catalog-based description of the schema (columns and defaults, constraints, indexes, triggers, function bodies, sequences). It is used together with a `pg_dump --schema-only` diff.
- **Production-shaped 0003 databases**, built three ways:
  - `handAppliedScratch`: SQL files applied by hand, no journal;
  - `migratorScratch`: built with the migrator;
  - `fixtures/push-0003-schema.sql`: a real `drizzle-kit push --force` of `schema.ts` as it was before Phase 24.
- **Seeded PRNG** (mulberry32) with fixed seeds.

## Matrix

| Area | File | Scenarios | Result |
|---|---|---|---|
| Journal consistency | `upgrade-path` | `idx` is 0..n; tags match the files on disk one to one; `when` strictly increasing (the migrator skips older entries); 0000–0003 are all `IF NOT EXISTS` (production has no journal rows for them) | ✅ |
| Upgrade 0003 → latest on ugly data (×2: hand-built and migrator-built) | `upgrade-path` | **0005**: the run aborts on a case-variant duplicate email, names `users_email_unique_idx` and `dup@example.test`, and rolls back the whole run (0004 too; data byte-identical; journal 0 or 4 rows). The documented pre-check finds exactly that pair; empty emails are not flagged. The non-destructive remedy (blank the newer email) lets the run complete. **0006**: both coordinates are nulled for lat 95, NaN, lng −200 and swapped pairs; valid rows are kept. **0007**: only the highest-id hotel is kept. **0008**: no retro-validation; all five violation kinds survive. Row counts are unchanged. **Re-run**: no-op for data, schema and journal. **Schema**: identical to a fresh DB, by catalog fingerprint and by `pg_dump`. **App on neon-http afterwards**: list, nested and public reads; renaming legacy incoherent rows works; new writes are validated; hotel PUT updates the kept row; the blanked duplicate signs in with 200; `otp_issue` honours legacy pending codes (429 `otp_pending`), the cap (429 `otp_rate_limited`, retryAfter ≈ 600) and the stale cleanup | ✅ |
| Upgrade from a **push-built** 0003 | `upgrade-path` | Catalog schema equals a fresh DB. A trip from before the slug existed can be shared. NULL preferences read as `{}` | ❌ → **fixed (F1)** |
| Clean and empty databases | `upgrade-path` | 0003 with clean data and an empty DB both reach the fresh fingerprint | ✅ |
| Deploy pipeline (`deploy-backend.yml`) | `deploy-pipeline` | On both 0003 shapes: the guard answers 503 `schema_not_migrated` before migrating; preflight reports only the duplicate email; after the fix, preflight passes, `db:migrate` succeeds and `/api/health/ready` answers 200 (neon driver). A journal-less DB that already has 0004+ objects is blocked by preflight, and `db:migrate` really fails on it | ❌ → **fixed (F2)** |
| Readiness probe | `schema-guard.test` | DB unreachable must not report "ready" | ❌ → **fixed (F3)** |
| Neon HTTP driver | `neon-http` | Full owner flow with no session-only statement and no batch. BIZ-07 `DC001`, its COLUMN and the message survive `NeonDbError` → 422 with the right `issues[].path`. 20 parallel identical destination creates → 1. 20 parallel `otp-request` → 1 code, 1 email, 19 `otp_pending`. 5 parallel verifies → one 200. 24 mixed first requests → one user row. Two subjects racing for one (case-variant) email → one owner; the loser gets only 409 `email_conflict`. A static audit of `src/` finds no transaction, batch, session lock or `FOR UPDATE`. Every SQL lock is `pg_advisory_xact_lock` (namespaces 7001 and 7002) | ✅ |
| Cross-phase (×2 drivers) | `cross-phase` | BIZ-07 × SEC-22: a foreign write that would also break a date rule answers 404 with no date or city leak (7 routes, also on a public trip; DB byte-identical). The owner gets the 422 and the public page is unchanged. Unshare during a reorder. A trip DELETE races 10 kinds of child write (2xx/400/404/409 only, no orphans, no BIZ-07 violation). 10 rounds of trip shrink vs destination edit vs 4 day creates (invariants hold). A new user firing GET me + PATCH me + 6 OTP requests + trips at once gets one row and one code. Two tokens without email. A Keycloak email moved onto another account. The 1 MiB cap counts bytes (600k CJK → 413, nothing written; 600k ASCII → 201). Preferences: 64 levels of unicode keys round-trip; 65 levels → 422; 20k-deep body → 422. 255 CJK / combining / RTL names round-trip; 255 astral emoji → 422. Unicode and quotes in BIZ-07 messages | ✅ (5 runs, no flake) |
| Property / fuzz | `property` | **BIZ-07 model check**: 3 seeds × 250 random trip/destination/day ops; an independent TS model predicts 2xx vs 422 for every request; the violation query stays empty; at least 50 accepts and 30 rejects per seed. **Coordinates**: whatever Zod accepts, `numeric(10,7)` stores within range. **Dates**: Zod-accepted ⇒ Postgres round-trips; well-formed Postgres dates ⇒ Zod accepts; string order = calendar order. **Time**: Zod-accepted ⇒ Postgres `time` stores it; every valid HH:MM is accepted. **URL**: accepted ⇔ WHATWG http(s) with no NUL, over 1500 hostile scheme mixes | ✅ fixed seeds plus 41 extra seeds |
| Pool resilience | `db/index.test` | An idle pg client killed by the server crashes the process | ❌ → **fixed (F4)** |

## Findings fixed (one commit each, test first)

| # | Commit | Finding | Severity |
|---|---|---|---|
| F1 | `297dba5` (test `1f8c9e0`) | **Push-built databases are inconsistent.** The pre-Phase-24 docs created databases with `drizzle-kit push`, which has no SQL default on `trips.public_slug`. Trips that existed when the column was added keep a NULL slug, so sharing sets `is_public` but no public URL can ever exist. `users.preferences` can also be NULL. **Migration 0010** backfills slugs and sets the default, backfills preferences and sets them `NOT NULL`, and renames Drizzle-style FK names. It is a no-op on migrator-built DBs. A push-built 0003 now upgrades to the exact fresh fingerprint | High if production was pushed (SETUP.md said so) |
| F2 | `e8b2d5a` (test `4964118`) | **`db:preflight` blocked production's most likely state.** It treated *every* journal-less DB as push-created and sent the operator to a dump-and-restore rebuild. Production predates the journal, so the first deploy would have stopped there. The tests show the plain migrator handles journal-less 0003 DBs, both hand-built and 0003-era push. Preflight now blocks only a journal-less DB that already has 0004+ objects, where `db:migrate` really fails at 0004. README updated. *Side note*: the rebuild procedure itself copies data into a DB that has the BIZ-07 triggers and CHECKs, so legacy incoherent rows would be rejected row by row. Avoiding that procedure for the common case matters | High (blocks or complicates the first deploy) |
| F3 | `ad852aa` | `GET /api/health/ready` answered **200 ready while the DB was unreachable**: the guard's "unverified" verdict was treated as ready. It now answers 503 `db_unreachable` | Medium |
| F4 | `f2a3edb` | The cached node-postgres pools had **no `'error'` listener**. A server-side disconnect of an idle client (DB restart, idle timeout) killed the dev server or seed process. This was also the intermittent unhandled `57P01` in the adversarial reorder suite. Workers are unaffected (HTTP driver) | Low (dev and tests) |

My own schema guard (`1919b1e`, 503 `schema_out_of_date`) was **reverted** (`d335705`) in favour of PR #23's equivalent guard (`schema_not_migrated`, `/api/health/ready`). My deploy-order and upgrade tests now validate PR #23's guard, with F2 and F3 on top.

## Deploy order and rollback: what breaks, precisely

Measured with the current Worker and **no guard**, before PR #23 (probe on databases at each level):

| DB at | `users/me`, trips, destinations | day outside its destination | `PUT …/hotel` | `otp-request` | 2nd account with a case-variant email |
|---|---|---|---|---|---|
| 0003 | 201 | **201 (BIZ-07 silently off)** | **500** (42P10: no unique index for `ON CONFLICT`) | **500** (42883: `otp_issue` missing) | **201 (duplicate accepted)** |
| 0006 | 201 | **201** | **500** | **500** | 409 |
| 0007 | 201 | **201** | 200 | **500** | 409 |

With PR #23's guard, every DB route on these databases answers 503 `schema_not_migrated`, and `/api/health/ready` answers 503. The guard heals within 30 s of `db:migrate` (tested on both drivers).

**Old Worker on the new schema** (rollback of the Worker only; analysis, not executed):
- Date writes hit the 0008 triggers (`DC001`). The old handler has no `DC001` mapping, so these become 500.
- The old Worker inserts users without the email-conflict path, so a duplicate email becomes 23505 and then 500 (or 409 after M-09).
- OTP and the hotel upsert still work: the old code does not use `otp_issue`, and the old hotel code is delete-then-insert, compatible with the unique index except under a race (23505).

Rollback is safe for reads; some writes degrade to 500. **Never roll the schema back** (no down-migrations exist).

## Neon HTTP driver: evidence

- `drizzle-orm` 0.45.2, `node_modules/drizzle-orm/neon-http/session.js`:
  - `transaction()` throws `"No transactions support in neon-http driver"` (lines 152 and 158);
  - only `batch()` (line 117) exists. It sends a non-interactive array to `client.transaction(builtQueries)` (line 131): no reads between statements.
- `@neondatabase/serverless` 0.10.4 sends each query as one `POST https://<host>/sql {query, params}`. `NeonDbError` carries `code`, `column` and `constraint`, copied from the 400 body (`index.mjs` around lines 1514–1520). `pg-errors.ts` reads these, so the 422/409 mappings work on Neon. Verified end to end via the fake.
- `src/` (static audit, enforced by a test) has no `.transaction(`, `.batch(`, `BEGIN`, `FOR UPDATE`, `SET LOCAL/SESSION`, or session-level advisory lock.
- All atomicity lives inside single statements, which is correct on Neon HTTP:

  | Mechanism | Single statement |
  |---|---|
  | BIZ-07 | triggers with `pg_advisory_xact_lock(7002, trip)` and `FOR SHARE` on the destination (0008) |
  | OTP issuance | `otp_issue()` with `pg_advisory_xact_lock(7001, user)` (0009) |
  | Hotel | `INSERT … ON CONFLICT` |
  | OTP verify | `UPDATE … WHERE attempts < 5 RETURNING` and `markOtpUsedIfUnused` |
  | Provisioning | `ON CONFLICT (keycloak_id) DO NOTHING` + re-select |
  | Schema guard | one catalog `SELECT` |

  Transaction-scoped advisory locks are released at statement end and are also safe behind Neon's pgbouncer in transaction mode. Session-level locks would not be; there are none.
- **Multi-statement sequences that are not atomic** (they behave the same on both drivers):
  - reorder: `SELECT` ids, then `UPDATE`. A concurrent create or delete makes it 400, or skips the new row.
  - `upsertUser`: insert, re-select, update.
  - `otp-request`: cleanup, issue, send, burn.

  Each is covered by race tests and never produces a 5xx or a broken invariant.
- Limitation: the fake is a faithful model of the `/sql` contract, not the real Neon proxy. A smoke test against a real Neon branch is still on the owner checklist (`a4a6775`).

## Open findings (design level, documented, not changed)

1. **Legacy incoherent rows cannot be edited from the UI.** The destination and trip edit forms always re-send `start_date`/`end_date`. `UPDATE OF start_date` fires the trigger even when the dates are unchanged, so any edit of a legacy out-of-range row answers 422 until its dates are fixed. The message says what to fix. API-only partial PATCHes still work. Tested. Suggestion: run the BIZ-07 violation query on production after migrating and fix rows by hand, or make the triggers compare `OLD` and `NEW`.
2. **0006 nulls swapped coordinates** instead of swapping them back. This is by design and documented in the README with a pre-migration query.
3. **The 0005 remedy in the README deletes the duplicate user after moving its trips.** That loses OTP history and preferences. Blanking the newer account's email is non-destructive, keeps both logins, and is tested here.
4. **The OTP goes to the email in the token**, not the stored one. After a Keycloak email moves onto another account, the stored email stays (DATA-02) but codes go to the token address. This is consistent with "Keycloak is the source of truth". Tested and documented.
5. **The reorder is two statements.** A concurrent activity create can leave duplicate `order_index` values, as a default `0` create already does. Cosmetic.
6. **0008/0009/0010 have no Drizzle snapshot.** `drizzle-kit generate` diffs against 0007. That is fine as long as those migrations stay function, trigger or data only.
7. **The guard's object list (0007–0009) must be extended by hand** for future migrations that code depends on.

## Production risks, ranked

1. **First deploy against the real production DB.** Expect 0005 to stop on duplicate emails (preflight lists them). If production was push-built, 0010 is needed for old trips to be shareable. With F2, the pipeline is `preflight → fix duplicates → migrate → deploy`, with no rebuild. Run the BIZ-07 violation query (`BIZ07_VIOLATIONS_SQL` in `tests/system/harness.ts`) afterwards to find rows that open finding 1 makes uneditable.
2. **Real Neon behaviour not exercised in CI.** Everything relies on single-statement atomicity, which the evidence supports, but only the emulator ran it. Do the Neon smoke checklist once.
3. **Worker rollback after migrating** turns date-rule and email-conflict writes into 500s (see above). Prefer roll-forward.
4. **Guard list drift** (open finding 7).
5. Low: push-built FK names and column order are cosmetic after 0010. Pool crashes are only possible on the dev server (fixed).

## Commits on this branch (no push)

`b4a4807` Neon HTTP system harness and tests · `1f8c9e0` upgrade-path tests · `297dba5` 0010 (F1) · `1919b1e` guard (reverted by `d335705`) · `f2a3edb` pool listener (F4) · `80a4951` cross-phase tests · `3ec45fd` property tests · `4964118` deploy-pipeline test (WIP-titled, test-first for F2) · `e8b2d5a` preflight (F2) · `ad852aa` readiness (F3) · merges of the base branch and `origin/main`.
