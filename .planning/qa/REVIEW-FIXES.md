# Review fixes (independent review of be13cef)

Branch: worktree branch based on `claude/focused-lovelace-cryssy` @ be13cef
(fast-forwarded from 3c147f6). Not pushed.

Each finding was checked against the code before any change.

| Finding | Verified? | Fix | Tests |
|---------|-----------|-----|-------|
| **M1** Worker can go live before its migrations; docs said `drizzle-kit push --force` | Yes. deploy-backend.yml had no migrate step. DEVELOPMENT.md (l.41, l.197) and SETUP.md (l.100) said `push --force`. `otp_issue()` (0009), the `ON CONFLICT (destination_id)` index (0007) and the 0008 triggers are only created by `db:migrate`. | **Deploy:** `deploy-backend.yml` runs a config gate, then `db:preflight`, then `db:migrate`, then `wrangler deploy`. Preflight and migrate get `DATABASE_URL` from the `MIGRATION_DATABASE_URL` secret. The gate has three outcomes: no `CLOUDFLARE_API_TOKEN` means the job is green and skipped with a notice (demo-only, today's state); token but no migration secret means the job **fails** before deploying; both set means it deploys. **Pre-flight (`npm run db:preflight`):** lists duplicate emails (case-insensitive, emails redacted unless `--show-emails`) that would break 0005, and detects push-created databases (tables present, no journal). **Schema guard:** dbMiddleware checks once per isolate, with a cached catalog query, for the 0007 unique index, the three 0008 triggers and `otp_issue(int,text,int,int,int)`. If any is missing, every DB route answers `503 {"code":"schema_not_migrated"}` and the log names the missing objects. A missing result is re-checked every 30 s; a failed check is not cached. `GET /api/health/ready` returns the same verdict. **Docs:** every doc now says `db:migrate` (DEVELOPMENT.md, SETUP.md, `backend/src/db/README.md`); the README also covers preflight, rebuilding push-created DBs and the schema guard. SETUP.md has a new beginner section, "Production backend (optional)". | `backend/src/db/schema-guard.test.ts`: real DBs migrated only to 0003, 0006 and 0008; wrong-table trigger; non-unique index; wrong `otp_issue` signature; caching, concurrency and recovery after migrate; DB-down. `backend/src/db/preflight.test.ts`: duplicates, CLI exit codes 0/1/2, redaction. `frontend/tests/workflows.test.ts`: step order, secret wiring, and the gate script executed for every secret combination. |
| **M2** Fork branch named `main` can trigger deploys | Yes. Both jobs used only `conclusion == 'success'`. | Both deploy jobs now also require `event == 'push'`, `head_branch == 'main'` and `head_repository.full_name == github.repository`. Checkout uses `persist-credentials: false`. `ci.yml` and `deploy-backend.yml` get `permissions: contents: read`. All actions are pinned to commit SHAs. The gitleaks tarball is checked with sha256 before it is extracted. `axe-core@4.12.1` and `wait-on@8.0.5` are pinned. | `frontend/tests/workflows.test.ts` parses the YAML and asserts the conditions (AND-only, no `\|\|`), permissions, SHA pins, checksum order and exact tool versions. |
| **S1** trip-edit redirects when Keycloak takes more than 4 s | Yes. The empty `catch` after `initKeycloak()` redirected. | trip-edit now uses `watchAuth`, like dashboard, trip and profile. Unavailable shows the error state with Retry and no redirect. A late or retried success loads the editor once. Only a genuine signed-out answer redirects. | `frontend/tests/trip-edit-auth.test.ts`: timeout, late success, hard failure followed by Retry, signed out, missing tripId, signed in. |
| **S2** Two round-trips and a sequence value burned per request | Yes. The code ran INSERT…ON CONFLICT first and then a SELECT. | `upsertUser` now SELECTs first and only INSERTs (ON CONFLICT on keycloak_id, then re-select) on a miss. BUG-03 race safety and DATA-02 email-conflict handling are kept. | `users.test.ts`: statement count per path (existing user is one SELECT; profile change is SELECT+UPDATE; new user is SELECT+INSERT; email taken is SELECT+INSERT+SELECT). `users_id_seq` does not advance across 20 sequential and concurrent requests. The race test was updated for the new order. |
| **S5** import.sh not production-safe | Yes, all four points. | The URL comes from `KC_URL` or `--url` (required, http(s) only). The password comes from `KC_ADMIN_PASSWORD` or a hidden prompt; it is never taken from argv and has no default. curl reads the password from stdin and the token header from a mode-600 file. The script fails on a null token or a missing or ambiguous id. `--remove-stale-flows` deletes the stale `password-forms` subflow and checks that it is gone; without the flag the script does a dry run that only reports it. shellcheck is clean. | `terraform/keycloak/tests/import.test.sh`: plain bash with stub curl and terraform, 48 checks. 34 of them fail against the old script. CI job `test-scripts` runs it together with shellcheck. |
| **N1** getHotel maps every 404 to "no hotel" | Yes. Note: `getHotel` currently has no caller in `src/`; hotels come nested in `getTrip`. | The backend adds `code: "hotel_not_found"` only when the caller owns the destination and it has no hotel. The SEC-22 404 for a missing or foreign destination is unchanged and indistinguishable. `getHotel` returns null only for that code. | Backend `trips.test.ts` (owned without hotel vs missing vs foreign destination); IDOR suite still green. Frontend `client.test.ts`: three other kinds of 404 now throw. |
| **N2** security.yml pins / ci.yml permissions | Yes | Fixed as part of M2. The Lighthouse public upload and security scans not gating deploys are left as they were. | See M2 |
| **N3** 0006 nulls swapped lat/lng | Yes | Documented only (`backend/src/db/README.md`, section "0006 and swapped coordinates"), with a query that lists candidate rows to fix by hand before migrating. Swapping back automatically is unsafe: a swap cannot be detected when both values are within ±90. | — |
| **N6** CSP warns instead of failing; no base-uri/form-action | Yes | A production build now **fails** in two cases: exactly one of `VITE_API_URL` / `VITE_KEYCLOAK_URL` is missing or empty, or both are missing and `CSP_ALLOW_MISSING_ORIGINS=true` is not set. `deploy-frontend.yml` sets that flag only when both secrets are empty, so the current demo-only Pages deploy keeps working. Added `base-uri 'self'; form-action 'self'`. | `csp-plugin.test.ts`; `workflows.test.ts` (CI builds set both origins and no opt-out). Real Chromium on the CI-env build: `csp.spec.ts`, `auth.spec.ts`, `landing.spec.ts`, `qa-sw.spec.ts`, `qa-followup.spec.ts` and `trip-edit.spec.ts` all pass, apart from one pre-existing unrelated failure (below). |
| **N7** SW caches every query variant; addAll is atomic | Yes | Navigations are cached and matched under the URL with query and hash removed, so there is one entry per page. The core shell (`./`, `index.html`, `manifest.json`) is still added atomically and fails the install if it cannot be fetched. Every other file goes through `cache.add` with `Promise.allSettled`, and failures are logged. | `frontend/tests/sw-resilience.test.ts` (50 variants give one key; offline fallback with a query string; one optional file missing; each core file missing; error and opaque responses not cached); `qa-sw.spec.ts` in Chromium. |
| S3 | Not in scope | Proposal below | — |
| S4 | Not in scope | Manual checklist: `.planning/qa/NEON-SMOKE-CHECKLIST.md` | — |

## Verification run

- Typecheck: frontend and backend clean.
- Backend: 43 files, 1524 tests passed on a real Postgres 16 (UTF8 cluster).
- Frontend: 43 files, 978 tests passed, both in the default timezone and with `TZ=America/Argentina/Buenos_Aires`.
- Frontend production build with the CI env: OK. Without env it fails as designed; with `CSP_ALLOW_MISSING_ORIGINS=true` it builds with a warning.
- `wrangler deploy --dry-run`: OK.
- `npm run db:preflight` and `db:migrate` against an empty local database: OK, 10 journal rows.

## Pre-existing issues seen, not fixed

- `tests/e2e/trip-edit.spec.ts:260` expects the destination POST body without `zoom_level`, but `destinations.ts` always sends it. Neither file was touched in this branch.
- The backend adversarial suites (`reorder`, `otp`) sometimes log "Unhandled error 57P01 terminating connection" on teardown: `DROP DATABASE ... WITH (FORCE)` kills idle pool clients. All tests still pass. This was already present at be13cef.
- The backend suite needs a UTF8 cluster. On a SQL_ASCII `initdb`, two multibyte length tests fail.

## S3 proposal (CI Keycloak job): not implemented

Add an `idp-flow` job to `ci.yml`, separate from `e2e` so it can run in parallel:
1. `docker compose -f keycloak/docker-compose.yml up -d`, then wait on `http://localhost:8080/realms/master` (wait-on, pinned).
2. Install a pinned Terraform (`hashicorp/setup-terraform` pinned by SHA). Run `terraform -chdir=terraform/keycloak init`, then `apply -auto-approve`. Pass the test-user passwords as `TF_VAR_*` values generated in the job (`openssl rand`), never stored.
3. Build the frontend with `VITE_KEYCLOAK_URL=http://localhost:8080`, run `npx playwright test e2e/idp-flow.spec.ts --project=chromium`, and remove the `test.skip` on a down Keycloak when `CI_KEYCLOAK=1` (fail instead of skip).
4. Add a regression case: a username-only submission must never reach a session. This is the KC-01 bypass.
5. Time budget is about 4 min. Run it on `pull_request` and `push` to main, and make it a required check before merge.

## Manual actions for the repository owner

None of these can be done from this session; they need the owner's accounts.

1. **Nothing is required for the current GitHub Pages demo.** With no backend secrets, the backend deploy job shows as green and skipped, and the frontend deploys as a demo-only build.
2. **When you deploy the backend to production**, follow SETUP.md, "Production backend (optional)":
   - Create the repository secret **`MIGRATION_DATABASE_URL`**. Use the direct Neon connection string with connection pooling OFF (no `-pooler` in the host) and the role that owns the tables. Path: GitHub → Settings → Secrets and variables → Actions → New repository secret. Make a Neon backup branch first.
   - Create `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Once the token exists, the deploy fails until `MIGRATION_DATABASE_URL` exists too.
   - Set **both** `VITE_API_URL` (Worker URL + `/api`) and `VITE_KEYCLOAK_URL`, plus `VITE_KEYCLOAK_REALM` and `VITE_KEYCLOAK_CLIENT_ID`. If only one of the two URLs is set, the Pages build fails.
   - If the production database was ever created with `drizzle-kit push`, rebuild it from migrations as described in `backend/src/db/README.md`. Preflight stops the deploy until you do.
   - If preflight reports duplicate emails, merge those accounts by hand. The fix is printed in the log.
   - Optionally run the swapped-coordinates query in the README before the first migration.
   - After the first deploy, check `GET <worker>/api/health/ready` returns `{"status":"ready"}`.
   - Run `.planning/qa/NEON-SMOKE-CHECKLIST.md` once against a Neon branch.
3. **For an existing production Keycloak realm configured before KC-01:** run `KC_URL=https://<kc> bash terraform/keycloak/import.sh` (you are prompted for the password; this is a dry run). Then run it again with `--remove-stale-flows`, then `terraform plan`. Treat the realm as exposed until this is done (see 26-IDP-SUMMARY).
4. Never paste `MIGRATION_DATABASE_URL`, the Cloudflare token or the Keycloak admin password into chat, issues or logs.
