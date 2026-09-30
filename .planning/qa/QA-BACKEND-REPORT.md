# QA — Adversarial Backend API Report

**Date:** 2026-09-30
**Base:** `1e48552` (Merge Phase 22: reliability bugs) — worktree branch `worktree-agent-a769bd1685c6cfa13`
**Scope:** Hono API on Workers (`backend/src`), Drizzle/Postgres, Keycloak JWT auth. Frontend, terraform/keycloak and workflows untouched.
**Suite:** `backend/tests/adversarial/` — 8 test files, **269 test cases** (28 of them documented `it.fails` known bugs owned by Phases 24–26).

## Current status — after merging Phase 24 (`claude/focused-lovelace-cryssy` @ 48f20aa)

**Harness:** the adversarial suite now runs on the shared ARCH-06 harness. It uses `vitest.config.ts` globalSetup with `TEST_DATABASE_URL`, default `postgresql://postgres:postgres@localhost:5432/postgres`. `ADV_DATABASE_URL`, the skip gate and `start-postgres.sh` are gone, so `npm test --workspace=backend` always runs it; no Postgres means the run fails instead of skipping. Each adversarial file still creates its own scratch DB on the harness server (`inject('serverDatabaseUrl')`), migrated with Drizzle's migrator, because the race tests hold row locks and count lock waiters per database. The app's cached pools are closed with `closeDbPools()` before the drop.

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:57691/postgres npm test --workspace=backend
```

**Conflicts resolved:**
- `index.ts`: bodyLimit 413 kept; `app.onError(errorHandler)` is Phase 24's global handler, which keeps 4xx HTTPExceptions.
- `routes/trips.ts`: took Phase 24's rewrite (dbMiddleware, single-JOIN ownership, no catch blocks) and re-applied the `Number(...)` → `parseId(...)` swap on all 42 param reads.

**Reconciled with Phase 24 behaviour:**
- NUL bytes are rejected by validation (422) before Postgres. Phase 24's two DB-level NUL tests in `routes/trips.test.ts` and `routes/users.test.ts` were updated from 400 to 422; their "nothing written" checks are kept.
- The preferences depth cap was raised from 32 to 64, because Phase 24's round-trip test uses about 51 levels. The stack-overflow guard still applies: a 20k-deep payload returns 422.
- JWT fixtures now use a unique email per subject, since DATA-02 makes `users.email` UNIQUE.
- The OTP lock helper waits for at most 10 lock waiters, the cached pool's size.

| Run (post-Phase-24) | Files | Tests |
|---|---|---|
| backend `typecheck` + `tsc -p tests/adversarial` | clean | — |
| `npm test --workspace=backend` (shared harness, no skips) | 39 passed | 1354 passed |
| frontend `typecheck`; `TZ=America/Argentina/Buenos_Aires npm run test:run --workspace=frontend` | 33 passed | 757 passed |
| frontend `build`; backend `wrangler deploy --dry-run` | OK | — |

**Converted to regular tests (fixed by Phase 24, re-verified):**
- **M-09:** a parent deleted mid-request now answers **409** `conflict` (FK 23503 is mapped by the global handler) instead of 500, and nothing is written. The race test no longer tolerates 500s.
- **Hotel uniqueness:** a concurrent `PUT …/hotel` forced with a row lock now leaves exactly one row (migration 0007 unique index + atomic upsert).
- **M-01:** 40 sequential requests no longer leave 80 idle connections (one cached pool per URL).

**Still open (`it.fails`, each re-probed and failing for the documented reason):**

| Finding | Evidence | Owner |
|---|---|---|
| SEC-07 (issuance): parallel `otp-request` bypasses `otp_pending` and the BUG-16 hourly cap | 20 parallel → 20 codes/emails | Phase 26 SEC-07 follow-up |
| SEC-22: nested routes 403 (foreign) vs 404 (missing) | 403 ≠ 404 | Phase 26 |
| BIZ-07: day outside destination range accepted | 201 | Phase 25 follow-up (deferred) |

All other findings in the tables below are fixed. This section supersedes the open column of the next section, and its run instructions replace the `ADV_DATABASE_URL`/`start-postgres.sh` ones further down.

## Status after merging Phases 23/25/26 (superseded by the section above)

Merge conflicts resolved in `backend/src/index.ts` (kept `bodyLimit` 413 + a single HTTPException→4xx handler) and `backend/src/validation/schemas.ts` (both protection sets combined: this branch's `text()` NUL guard, `isoDate()` year-0000 guard, `orderIndex()` int4 cap, preferences depth/size/NUL guard, **plus** Phase 25's `coordinate()`, `dateOrder`, `atLeastOneField`, `clockTime`, `is_generic`; one `httpUrl` const = Phase 25 protocol check built on `text()`). Also: JWT missing/non-numeric exp message now reads "JWT treated as expired: …" so Phase 26's SEC-06 test (`/expired/` in the server log) and this branch's fix agree; adversarial `tsconfig.json` excludes `src/**/*.test.ts` (DOM lib clashed with a Phase 26 test's `fetch` typing).

Schema-validation failures are now **422** (Phase 25 `validator.ts`); path-id, malformed/empty JSON and reorder-permutation errors remain **400**. Adversarial expectations were updated accordingly. The OTP suite now opts into `ENVIRONMENT=development` (Mailpit), required by the SEC-08 gate.

| Run (post-merge) | Files | Tests |
|-----|-------|-------|
| `npm test --workspace=backend` (no DB) | 23 passed, 6 skipped | 696 passed, 217 skipped |
| `ADV_DATABASE_URL=… npm test --workspace=backend` | 29 passed | 904 passed, 9 skipped |
| `npm run test:run --workspace=frontend` | 30 passed | 671 passed |
| backend `typecheck` + `tsc -p tests/adversarial` | clean | — |
| `wrangler deploy --dry-run` | OK | — |

Adversarial suite: **270 cases, all passing; 6 remain `it.fails`** (still-open bugs).

### Current open / fixed table

| Finding | Status | By |
|---|---|---|
| F1–F11 (malformed-JSON 500, no body cap, path ids, JWT exp type, long/NUL name lockout, UTF-8 mojibake, URL schemes, NUL text, year 0000, int4 order_index, deep preferences) | **Fixed** (re-verified post-merge; statuses now 422 where schema-level) | this branch |
| BIZ-06 reversed trip / hotel date ranges | **Fixed** → 422 | Phase 25 |
| BIZ-08 coordinates (`"NaN"`, 91/181, `"null"`, `""`, bool, `{}`, `[]`, `1e400`, 1000, `"Infinity"`) | **Fixed** → 422 | Phase 25 |
| BIZ-09 `PATCH {}` / unknown-only keys / `text/plain` PATCH silent 200 | **Fixed** → 422, nothing updated | Phase 25 |
| SEC-05 JWKS refetch amplification (20 forged kids → ≤1 fetch) | **Fixed** | Phase 26 |
| SEC-06 generic `invalid_token` body | **Fixed** | Phase 26 |
| SEC-07 parallel wrong guesses (30→≤5) and double redemption (5→1) | **Fixed** | Phase 26 |
| SEC-08 failed send leaves user locked out; prod without RESEND fails loudly and issues no code (new regression test) | **Fixed** | Phase 26 |
| SEC-20 nosniff / Permissions-Policy | **Fixed** | Phase 26 |
| SEC-21 public payload `user_id` | **Fixed** | Phase 26 |
| SEC-23 localhost origins in production | **Fixed** | Phase 26 |
| **SEC-07 (issuance)** 20 parallel `otp-request` → 20 codes/emails, bypassing `otp_pending` and the BUG-16 5/h cap (forced with a user-row lock) | **OPEN** `it.fails` | Phase 26 SEC-07 follow-up |
| **SEC-22** nested routes 403 (foreign) vs 404 (missing) existence oracle | **OPEN** `it.fails` | Phase 26 |
| **BIZ-07** day outside destination date range accepted | **OPEN** `it.fails` (deferred by Phase 25) | Phase 25 follow-up |
| **M-09** parent deleted mid-request → FK 23503 → 500 instead of 404 | **OPEN** `it.fails` | Phase 24 |
| **Hotel uniqueness** concurrent `PUT …/hotel` → 2 rows per destination | **OPEN** `it.fails` | Phase 24 DB constraints (proposed DATA-04) |
| **M-01** per-request `pg.Pool` leak (40 requests → 80 idle connections, no `'error'` listener) | **OPEN** `it.fails` | Phase 24 M-01/ARCH-01 |

The sections below are the original (pre-merge) findings, kept for history.

## Result (pre-merge, base `1e48552`)

| Run | Files | Tests |
|-----|-------|-------|
| `npm test --workspace=backend` (no DB — DB suites skip) | 13 passed, 6 skipped | 143 passed, 207 skipped |
| `ADV_DATABASE_URL=… npm test --workspace=backend` | 19 passed | 350 passed |
| `npm run typecheck --workspace=backend` + `tsc -p tests/adversarial` | clean | — |
| `wrangler deploy --dry-run` | OK | — |

Bugs found: **26 distinct defects** — **11 fixed on this branch** (one commit each, test first, all newly discovered), **15 open** as `it.fails` mapped to the owning requirement (below). Of the open ones, 10 confirm already-planned requirements live (SEC-05/06/20/21/22/23, BIZ-06/07/08/09) and 5 are new or new facets (hotel duplicate rows, FK-race 500, per-request pool leak, OTP request flood bypassing the BUG-16 cap, OTP lockout after mail failure).

## Database used

Real **PostgreSQL 16.13 from the installed binaries** (`/usr/lib/postgresql/16/bin`), `initdb` + `pg_ctl` run as the `postgres` user via `setpriv`, on `127.0.0.1:57691` (5432/55432 were taken by other agents' Docker containers). Docker was available as the second choice; PGlite was not needed. The harness is multi-connection, so races are real.

### How to run

```bash
eval "$(backend/tests/adversarial/start-postgres.sh)"   # local binaries, else docker postgres:16-alpine
npm test --workspace=backend                            # or: cd backend && npx vitest run tests/adversarial
backend/tests/adversarial/start-postgres.sh stop
```

Each test file creates `adv_<file>_<pid>`, applies `src/db/migrations/*.sql` in order and drops it afterwards. Only the network edges are faked: a JWKS endpoint serving a per-file RSA key (the real `verifyJwt` runs) and the Mailpit API (captured to read OTP codes). Races are forced **deterministically** with side-transaction row locks + `waitForLockWaiters` (no sleeps).

### Folding into the Phase 24 shared harness (ARCH-06)

1. Replace `createTestDatabase` / `dropTestDatabase` in `harness.ts` with the shared globalSetup's URL (keep one DB per file, or truncate between files).
2. Delete the `ADV_DATABASE_URL` skip gate (`describeDb` → `describe`).
3. Once `getDb` shares one pool (M-01), drop the `pg.Pool.prototype.query` patch in `harness.ts` (it only exists to close the leaked per-request pools before `DROP DATABASE`), and flip the M-01 `it.fails`.
4. Nothing else depends on how the DB is created; the `buildTree`/`makeUser`/`client` helpers are reusable as-is.

## Scenario matrix

| Area (file) | Scenarios | Result |
|---|---|---|
| **Authorization header / JWT** (`auth-jwt`, 43) | missing/empty/`Bearer`/`Bearer `/Basic/no-scheme, 1- and 4-part tokens, non-JSON segments, lowercase `bearer`, duplicate Authorization (valid+garbage both orders); `alg=none`/`NONE`/`None`, `HS256` key confusion, missing kid, right kid + wrong key, tampered payload, expired / no exp / exp=0 / string exp / nbf future / string nbf, wrong/trailing-slash/other-realm/missing issuer, missing/wrong/empty aud, missing/empty sub, JWKS outage; success with aud array, no-email passkey user, two no-email users, 510-char name, NUL in name, non-ASCII name/email | all fail closed ✅; **3 bugs fixed** (string exp never expired, long/NUL name lockout, UTF-8 mojibake); SEC-05, SEC-06 open |
| **IDOR** (`idor`, 26) | Bob vs Alice on all 19 trip/destination/hotel/day/activity/reorder routes; Bob's trip id + Alice's child ids (14 mixes incl. reorder smuggling); mass-assignment of `user_id`/`id`/`public_slug`/`day_id`; list endpoints; Alice's tree byte-identical afterwards | no read/write/delete leak ✅; SEC-22 (403 vs 404 oracle) open |
| **Flows & cascades** (`flows`, 29) | create → destination → hotel (PUT replace) → days → activities → nested read order → private slug 404 → share → public read (no owner email/sub) → rename (slug stable, upper-case slug) → unshare 404 → delete day/trip cascades → every route on deleted trip 404; destination delete cascades only its subtree; idempotent hotel delete; double delete activity; double-submit create; parallel double delete; public slug near-UUID/braced/no-dash/urn/newline/space/SQL-ish/Arabic-digit/full-width/numeric/all-zero; public route ignores bad Authorization, rejects write verbs; users/me provision 201→200, PATCH before provision, identity fields immutable, preferences round-trip/non-object 400, NUL name/prefs; no orphans at end | ✅; NUL in users/me fixed; SEC-21 open |
| **Reorder** (`reorder`, 22) | valid permutation (response + DB = 0..n-1); empty on non-empty day, missing, duplicate, extra, foreign-day id, 10 000 ids → 400 with **no write**; zero/negative/float/string/null/nested/non-array/null/int4-overflow ids; missing key; empty day `[]`; `reorder` not captured as `:actId`; real 2 000-activity day; 20 concurrent permutations → one consistent permutation; reorder racing delete | all ✅ (BUG-05 holds under concurrency) |
| **Input fuzz** (`input-fuzz`, 91) | path ids: `1.5`, `-1`, `0`, `1e3`, `0x10`, `±Infinity`, `NaN`, `null`, >int4, >2^53, SQL-ish, `%00`, full-width digit, nested routes, PATCH, non-canonical aliases; bodies: malformed/empty JSON, array/scalar/null, text/plain create & PATCH, charset/`+json`, 2 MB, ~1 MB, 2 MB unauthenticated, 20k-deep JSON, preferences depth/size, prototype-pollution keys; strings: emoji/ZWJ/RTL/combining round-trip, 127/128 astral chars vs varchar(255), 255/256, empty, NUL in 10 fields, lone surrogate, SQL-ish; URLs: `javascript:`/`data:`/`vbscript:`/`file:`/scheme-relative in 4 fields; coords: numeric/string/null, `"null"`, `""`, bool, `{}`, `[]`, `1e400`, 1000, NaN, 91/181, Infinity; dates: `0000-00-00`, Feb 30, non-leap Feb 29, month 13, short/slash/ISO-datetime/empty, leap day 2028, `0001`, `9999-12-31`, year 0000 on trip/day/hotel/destination, reversed trip/hotel ranges, day outside destination; numerics: order_index −1/1.5/"1"/2^31 on 3 tables, zoom 0/21/12.5/−3, bad `color_hex` | **7 bugs fixed** (ids, malformed JSON 500, no body cap, deep JSON, NUL, URL schemes, year 0000, int4 order_index); BIZ-06/07/08/09 open |
| **Concurrency** (`concurrency`, 8) | 25 simultaneous first requests of a new user (BUG-03 on real multi-connection PG); 30 parallel trip creates (distinct ids/slugs); 20 parallel activity creates; create under trip deleted mid-request (forced); delete vs 15 creates (no orphans); concurrent hotel PUT (forced); 15 concurrent PATCHes; connection growth | BUG-03 holds ✅; M-09, hotel uniqueness, M-01 open |
| **OTP** (`otp`, 24) | happy path + replay; hash-at-rest; cross-user code; 5 wrong → `max_attempts` + code dead; 30 parallel wrong guesses; parallel correct verifies; expiry; pending 429 + retryAfter; 5-per-hour cap after request/burn cycles; cap reset after 61 min; per-user cap; 20 parallel requests; malformed codes (5/7 digits, letters, space, Arabic digits, number, null, SQL-ish) don't consume attempts; no active code; no-email 422; auth required; mail outage | sequential rules ✅ (BUG-16 holds); SEC-07 ×3, SEC-08 open |
| **CORS / headers** (`cors-headers`, 26) | allowed origin + Vary; `null`, suffix/prefix/other-pages/http/`:443`/trailing slash/upper-case/userinfo/`*`/empty/header-folding/punycode origins; no Origin; no credentials header; TRACE preflight; foreign-origin actual request; security headers on 200/401/404/400; JSON content type; health leaks nothing | ✅; SEC-20, SEC-23 open |

## Bugs fixed on this branch (test first; each flipped `it.fails` → `it`)

| # | Commit | Bug | Severity |
|---|--------|-----|----------|
| F1 | `0489b0a` | `app.onError` turned Hono's `HTTPException(400)` into 500 — malformed/empty JSON bodies returned 500 | Medium |
| F2 | `ff22d8e` | No request body limit — 2 MB (and larger) bodies stored in unbounded text columns → `bodyLimit` 1 MB, 413 | Medium |
| F3 | `18fc941` | Path ids parsed with `Number()`: `1.5`/`Infinity`/`99999999999` → 500 (PATCH → misleading 404); `0x1`, `1e0`, `01` aliased real rows → `parseId()` | Medium |
| F4 | `c878f04` | JWT with non-numeric `exp` (e.g. `"9999999999x"`) never expired; string `nbf` ignored | Low (needs KC-signed token) |
| F5 | `0267ea5` | Keycloak display name > 255 chars (first+last) or containing NUL → 500 on **every** request (user locked out) | High (availability) |
| F6 | `911882f` | JWT segments decoded with `atob()` without UTF-8 → every non-ASCII name/email ("José", "田中") stored as mojibake; self-heals on next request after fix | High (data correctness) |
| F7 | `288977f` | `z.string().url()` accepted `javascript:`/`data:`/`vbscript:`/`file:` in cover_image_url, maps_url, hotel url, avatar_url — latent stored XSS once BIZ-03 renders `maps_url` in shared views | High (latent) |
| F8 | `d2a0e9b` | NUL (`\u0000`) in any text field or `preferences` → 500 (PATCH trip → 404 "Trip not found") | Medium |
| F9 | `094d492` | Year `0000` dates pass `z.string().date()` but Postgres rejects them → 500 on trip/destination/day/hotel | Low |
| F10 | `b056553` | `order_index` ≥ 2^31 passed validation, failed int4 INSERT → 500 | Low |
| F11 | `758eddf` | `preferences` unbounded: 20k-deep JSON overflowed `JSON.stringify` stack → 500; now ≤ 32 levels / 16 384 chars | Medium |

Behaviour change to note: ids `0` and `-1` now answer **400** (were 404).

## Open bugs — kept as `it.fails`, owned by in-flight phases

| Test (file) | Finding | Owner |
|---|---|---|
| `concurrency` M-09 | Parent deleted between ownership check and INSERT → FK violation (23503) → 500 instead of 404 (forced with a held `DELETE`) | **Phase 24 — M-09** (catch blocks → propagate/map DB errors) |
| `concurrency` PHASE-24 hotel | Concurrent `PUT …/hotel` creates **2 hotel rows** for one destination (no unique index; DELETE-then-INSERT without tx) | **Phase 24 — DB constraints** (no ID yet; propose DATA-04: `UNIQUE(hotels.destination_id)` + `ON CONFLICT` upsert) |
| `concurrency` M-01 | Local driver opens a new `pg.Pool` per `getDb()` (2 per request), never ended, no `'error'` listener: 40 requests → 80 idle connections; a DB restart crashes `dev.ts` | **Phase 24 — M-01 / ARCH-01** (shared pool in `getDb`/`dbMiddleware`) |
| `input-fuzz` BIZ-08 (×10) | lat/lng `z.coerce.string()`: `"NaN"` stored as NaN; 91/181 stored; `"null"`, `""`, bool, `{}`, `[]`, `1e400`, `1000`, `"Infinity"` → 500 | **Phase 25 — BIZ-08** (+ DATA-03 CHECK constraint, Phase 24) |
| `input-fuzz` BIZ-06 (×2) | trip end < start and hotel check-out < check-in accepted | **Phase 25 — BIZ-06** |
| `input-fuzz` BIZ-07 | day dated 1999-01-01 accepted in a 2026-03-01..05 destination | **Phase 25 — BIZ-07** |
| `input-fuzz` BIZ-09 (×2) | `PATCH {}` → 200 no-op; `PATCH` with `text/plain` JSON → **200 success but nothing updated** (validator ignores non-JSON content type) | **Phase 25 — BIZ-09** |
| `otp` SEC-07 (×3) | 30 parallel wrong guesses → **30** evaluated (limit 5); one code redeemed **5×** in parallel; 20 parallel requests → **20 codes/emails**, bypassing both `otp_pending` and the 5/h cap (BUG-16) | **Phase 26 — SEC-07** (atomic `UPDATE … WHERE attempts < 5 RETURNING`; also make issue atomic, e.g. advisory lock or partial unique index on active code) |
| `otp` SEC-08 | Mail send fails → 500, but the code row is already inserted → user locked out by `otp_pending` for 10 min with a code never delivered | **Phase 26 — SEC-08** |
| `auth-jwt` SEC-05 | 20 forged tokens with random kids → 20 extra JWKS fetches (unauthenticated amplification) | **Phase 26 — SEC-05** |
| `auth-jwt` SEC-06 | 401 body echoes expected issuer URL/realm | **Phase 26 — SEC-06** |
| `idor` SEC-22 | Nested routes: foreign trip → 403, missing trip → 404 (existence oracle). No data leak. | **Phase 26 — SEC-22** |
| `flows` SEC-21 | Public payload exposes owner `user_id` and internal ids | **Phase 26 — SEC-21** |
| `cors-headers` SEC-20 | No `X-Content-Type-Options: nosniff` / `Permissions-Policy` | **Phase 26 — SEC-20** |
| `cors-headers` SEC-23 | `localhost` origins allowed in production | **Phase 26 — SEC-23** |

## Observations (not failing tests — suggestions)

- **Per-field length caps** (suggestion, Phase 25): `description`, `notes`, `time`, URLs have no `max()`; only the new 1 MB body cap bounds them. `time` is free text (no `HH:MM` format).
- **DATA-02 caution** (Phase 24): tokens without an email provision users with `email = ''`; a plain `UNIQUE(email)` would 500 the second such user. `auth-jwt` "two different subjects without email" guards this — use a partial unique index (`WHERE email <> ''`).
- **Reorder ceiling:** one UPDATE binds 3 params per id, so a day with > ~21 800 activities would exceed Postgres' 65 535-parameter limit (500). Unrealistic; a per-day cap would make it explicit.
- `GET /api/users/me` answers **201** on first call (a GET creating a resource); harmless but unusual.
- JWKS outage → 401 (fails closed, correct), though 503 would let clients distinguish "Keycloak down" from "bad token".
- Double-submit `POST /api/trips` creates two trips — expected without an idempotency key; the frontend should disable the button while pending.
- Concurrent `PATCH` of one trip is last-writer-wins (no `updated_at` precondition); acceptable for a single-owner app.
- `PATCH /api/users/me` `name` is overwritten by the Keycloak claim on the next request (BUG-08 decision, re-confirmed).

## Files

- `backend/tests/adversarial/harness.ts` — DB lifecycle, fake JWKS/Mailpit, signer, HTTP client, `buildTree`, `waitForLockWaiters`
- `backend/tests/adversarial/{auth-jwt,idor,flows,reorder,input-fuzz,concurrency,otp,cors-headers}.test.ts`
- `backend/tests/adversarial/start-postgres.sh`, `tsconfig.json` (typechecks the suite against `src/`)
- Fixes: `backend/src/index.ts`, `backend/src/validation/{ids.ts,ids.test.ts,schemas.ts}`, `backend/src/routes/trips.ts` (one-token `parseId` swaps), `backend/src/auth/keycloak.ts`, `backend/src/middleware/user.ts`
