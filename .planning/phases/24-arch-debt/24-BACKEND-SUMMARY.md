---
phase: 24-arch-debt
part: backend / DB half
subsystem: backend test infra, DB layer, routes, migrations, PWA manifest
requirements: [ARCH-01, ARCH-02, ARCH-03, ARCH-06, M-01, M-02, M-09, DATA-01, DATA-02, DATA-03, PWA-01]
not-in-scope: [ARCH-05, ARCH-07, ARCH-08, ARCH-09]  # other agents
base: 1e48552 (Merge Phase 22 — worktree fast-forwarded onto it; main did not contain Phase 22)
completed: 2026-09-30
---

# Phase 24 — Backend / DB half: Summary

## Per-ID status

| ID | Status | What changed | Commit |
|----|--------|--------------|--------|
| ARCH-06 | Done | Vitest `globalSetup` creates a uniquely named DB on `TEST_DATABASE_URL`, applies all migrations with Drizzle's migrator, drops it on teardown; no server → run fails with instructions (never skips). Files run sequentially, `TRUNCATE` between tests. Drizzle journal + baseline snapshot added for 0000–0003. All `toContain([200,500])`/`[404,500]` removed; fake-Drizzle query tests rewritten on real SQL. CI `test-backend` (already existed from Phase 21) now has a `postgres:16-alpine` service. | 1d1eeb9 |
| ARCH-01 | Done | `createDb` returns `PgDb \| NeonDb` (no `any`); `c.get('db')` typed via `ContextVariables.db`. node-postgres pools cached per URL (previously a new Pool per request → connection leak). | e7de9f8 |
| ARCH-03 | Done | `routes/trips.test.ts`: authorization matrix over all 16 nested endpoints + 3 trip endpoints (401 / 403 / 404 missing / 404 cross-parent / IDOR mixes / 400 ids), each asserting the DB is unchanged, plus owner CRUD. | f1c16c5 |
| M-01 | Done | `middleware/db.ts` `dbMiddleware` replaces 22 guard+`getDb` blocks; mounted after `authMiddleware` on trips/auth/users/public. `GET /api/users/me` now has the config guard and error handling. | 6e77f9c |
| ARCH-02 | Done | `DB_DRIVER` = `neon` \| `pg`, explicit. `wrangler.toml [vars] DB_DRIVER="neon"` (also Workers fallback); dev server/seed default `pg`; anything else → 500 config error (never guessed). | 7ef225e |
| M-09 | Done | 21 swallow-and-500 `catch {}` blocks removed (bodies dedented only); `errorHandler` logs method+path+original error, returns a generic body, keeps `HTTPException` status (malformed JSON was 500 → 400), maps client-caused SQLSTATEs (22P02/22003/22007/22008/22001/22021/22P05/23514 → 400, 23505/23503 → 409). `updateTrip` returns `undefined` instead of throwing; `ensureUserProvisioned` no longer echoes DB messages. | 229fdd2, 5441e5d |
| M-02 | Done | `db/queries/ownership.ts`: trip LEFT JOIN dest/day/activity each constrained to its parent — one statement, identical not_found/forbidden semantics (asserted by query counting + the ARCH-03 matrix). | b22fe08 |
| DATA-01 | Done | Migration 0004: index `(user_id, expires_at)`. `otp-request` best-effort deletes codes that are expired AND older than the 1 h cap window (so BUG-16's cap is never weakened); failure is logged, never blocks. | bb4a8b3 |
| DATA-02 | Done | Migration 0005: `UNIQUE (lower(email)) WHERE email <> ''`. New subject with a taken email → `EmailConflictError` → 409 `email_conflict` (never auto-relinked). Existing user whose Keycloak email now collides keeps the stored email and can still sign in. | 9550f3e |
| DATA-03 | Done | Migration 0006: `CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)` on destinations/hotels/activities. Violations → 400 `constraint_violation`. | 23fc348 |
| PWA-01 | Done | First-party 192/512(+maskable)/180 PNGs in `frontend/public/icons/` from a committed dependency-free generator; manifest + 5 app-shell pages use them; SW precaches them; flaticon removed from CSP `img-src`. | 89f060a |
| (new) hotel race | Done | Found by the new tests: concurrent hotel PUTs left several rows. `upsertHotel` is now one `INSERT … ON CONFLICT (destination_id) DO UPDATE`; migration 0007 dedupes (keeps newest) then adds a unique index. | 623917b |

Deferred: none of the assigned IDs. Items owned by other agents (ARCH-05, ARCH-07, ARCH-09, SEC-*, BIZ-*) untouched.

## Real database — choice and how CI gets it

- Engine: **real PostgreSQL 16** (not PGlite/pg-mem). In this sandbox the local cluster could not be started (`su`/`runuser` blocked), so a `postgres:16-alpine` container was run via Docker (Docker Hub rate-limited; pulled from `public.ecr.aws/docker/library/postgres`).
- Locally: `docker compose -f keycloak/docker-compose.yml up -d postgres` (default `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres`) or any server whose role may `CREATE DATABASE`.
- CI: `test-backend` job in `.github/workflows/ci.yml` has a `postgres:16-alpine` service + `TEST_DATABASE_URL`. Not yet observed running in GitHub Actions (no push from this worktree).

## Migration behaviour on existing data

| Migration | Existing data edge case | Behaviour (tested) |
|-----------|------------------------|--------------------|
| 0004 OTP index | 500 existing rows | Applies; rows kept. |
| 0005 email unique | Exact or case-only duplicate emails | **Fails**; Postgres names the key (`Key (lower(email))=(…) is duplicated`); the migrator's single transaction rolls back the whole run (0004 too). Remedy: resolve duplicates manually, re-run. Empty `''` emails never conflict. |
| 0006 lat/lng CHECK | Out-of-range, swapped, NaN, null-lat + bad-lng | Hand-added UPDATE first sets **both** coordinates of such rows to NULL (pin undisplayable anyway), then constraints are added fully validated. Valid/NULL rows untouched. |
| 0007 hotel unique | Several hotels per destination | Hand-added DELETE keeps the highest id (last write) per destination, then unique index. |

Duplicate-email pre-check for production: `SELECT lower(email), array_agg(id) FROM users WHERE email <> '' GROUP BY 1 HAVING count(*) > 1;`

## Scenarios covered by tests (backend 20 files / 472 tests, frontend +1 file / 29 tests)

- **Authorization (ARCH-03):** every nested endpoint × {unauthenticated 401, foreign resources 403, missing trip 404, missing destination 404, child under another parent 404, IDOR with intruder's own ids + owner's child ids 404, non-numeric id 400}, each with a byte-for-byte DB snapshot check; trip endpoints return 404 (not 403) for foreign trips; client-supplied `user_id`/`trip_id`/`id` ignored; concurrent owner/intruder writes to one activity.
- **Provisioning / users:** first login 201 → 200; 10 concurrent upserts (one row, one `created`); 8 concurrent `GET /me` (one 201); email/name refresh; empty email claim; unicode; 255 vs 256 chars; PATCH for unprovisioned (404) / invalid body (400) / `\u0000` in jsonb (400) / deeply nested prefs; unreachable DB → JSON 500.
- **Email uniqueness:** conflict on insert (409, no row), case-insensitive, many empty emails, refresh collision keeps old email, three subjects racing for one email (exactly one wins), direct SQL rejected by name.
- **Config (M-01/ARCH-02):** missing `DATABASE_URL` on every DB router → 500 + log; auth still first (401); health needs no DB; invalid `DB_DRIVER` values (case/whitespace/unknown) rejected; Neon URL containing "localhost" still gets Neon; pool reuse; 60-request burst stays within one pool.
- **Errors (M-09):** generic 500 with original error logged and message not leaked; HTTPException status kept; each SQLSTATE mapping; cyclic `cause`; ids `1.5`/`99999999999`/`Infinity` → 400; missing table mid-request → 500 logged; provisioning failure not leaked; PATCH missing trip is a clean 404.
- **Ownership query (M-02):** one SQL statement per resolver; identical rows; cross-parent, wrong-intermediate, sentinel/0/-1/INT_MAX ids.
- **OTP (DATA-01):** index present and chosen by the planner; cleanup keeps live/in-window codes, deletes stale ones for all users, idempotent, concurrent-safe, cap intact after cleanup; route: hashed storage, TTL, pending 429, cap 429, no-email 422, email failure 500, consume-once, 5-attempt burn, cross-user, expiry, 7 malformed-code shapes; cleanup failure does not block issuance.
- **Coordinates (DATA-03):** poles/antimeridian boundaries, 1e-7 past each edge, swapped pair, NaN, Infinity/1000 overflow, null-lat + bad lng, on create destination / PUT hotel / create activity / PATCH, no write on rejection; direct SQL rejected per table.
- **Hotel:** 20 concurrent PUTs → one row with a stable id; PUT replaces all fields; recreate after delete; idempotent delete.
- **Hostile input:** multi-byte names at the limit, ~200 KB unicode note, SQL-looking strings, NUL bytes (400), 10k-char / unicode / injection slugs on the public route, malformed JSON, schema-invalid bodies with no write.
- **Races:** destination deleted while days are created (no 500, no orphans), concurrent reorders, concurrent cleanups.
- **Migrations:** journal order, re-run no-op, each of 0004–0007 applied over populated data (see table above).
- **PWA-01:** icons relative, exist, PNG of declared size, 192/512/maskable present, SW install precaches them, no CDN reference in any page or the CSP.

## Test / build results (final commit)

- Backend: `tsc --noEmit` clean; Vitest 20 files / 472 tests pass (was 10 / 63) against real Postgres 16; `wrangler deploy --dry-run` OK (shows `DB_DRIVER: "neon"` var).
- Frontend: `tsc --noEmit` clean; Vitest 14 files / 165 tests pass; `vite build` OK (`dist/icons/*` emitted).
- `drizzle-kit generate` reports no drift between `schema.ts` and the snapshots; `drizzle-kit migrate` + `seed.ts` run clean on a fresh DB with the new constraints.

## Open concerns / findings for other owners

1. **OTP issuance race (SEC-07 area):** 8 concurrent `otp-request` for one user issued 2 codes (pending check is check-then-insert). Not fixed here (auth.ts OTP atomicity belongs to SEC-05..08).
2. **Email-send partial failure:** if email delivery fails after the code row is inserted, the user gets 500 and then `429 otp_pending` for 10 min with no email. Suggest deleting/marking the row on send failure (same owner as 1).
3. **`z.string().url()` accepts `javascript:` URLs** (`cover_image_url`, `maps_url`, hotel `url`, `avatar_url`) — for ARCH-05/schemas owner; any `href` rendering is a stored-XSS vector.
4. **`drizzle-kit push` vs SQL migrations drift (pre-existing):** DBs created with the documented `push --force` differ from `db:migrate` ones (FK names, FK indexes from 0000, `preferences NOT NULL`, `public_slug` default). `push` against a migrated DB wants to drop those FK indexes. New constraints/indexes from this phase are *not* in that drift. Recommend standardising on `db:migrate` (DEVELOPMENT.md still says `push --force`) and reconciling `schema.ts` in a follow-up.
5. **Path ids:** `Number()` parsing still accepts `0x10`/`1e1` (→ 16/10); harmless for authz (ownership still enforced) but sloppy. Non-integers/overflow now give 400 via SQLSTATE mapping.
6. **Behaviour changes to note for merges:** error bodies for unexpected failures are now `{ error: 'Internal server error', code: 'internal_error' }` instead of per-route "Failed to X"; hotel id is stable across PUTs; unknown `/api/users/*` paths now 401 before 404; ensureUserProvisioned requires `dbMiddleware` before it.
7. CI Postgres service job not yet exercised on GitHub (no push from this worktree).
