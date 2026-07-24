# Architecture Research — v3.2 Integration

**Domain:** Brownfield integration (Hono/Cloudflare Workers backend, Drizzle dual-driver, Terraform-managed Keycloak, vanilla-TS MPA frontend)
**Researched:** 2026-07-24
**Confidence:** HIGH — every finding below is read directly from the current repo (file + line), not inferred from training data. The one place confidence drops to MEDIUM is flagged explicitly (Q1 union-type typecheck).

**Note:** this file previously held v3.1 E2E-test-architecture research (Playwright/Keycloak triage). That milestone is complete and its findings are superseded/closed (see `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` Cluster 0). This revision replaces it with v3.2 integration research — not ecosystem research, since v3.2 is a hardening milestone against an existing, audited architecture. This document answers the 5 integration questions the orchestrator posed, then derives a build order from real code dependencies for Phases 21/24/25/26.

---

## Q1 — `DATABASE_URL`/`getDb` middleware placement (M-01) and typing `c.get('db')` (ARCH-01)

### Current state (read directly)

- `backend/src/db/index.ts:16` — `export function createDb(databaseUrl: string): any` (eslint-disabled). `export const getDb = createDb` and `export type Db = ReturnType<typeof createDb>` (line 31) — `Db` is therefore also `any` today.
- The `if (!c.env.DATABASE_URL) { ... 500 ... } const db = getDb(c.env.DATABASE_URL)` guard is duplicated **19 times in `trips.ts`**, **2 times in `auth.ts`** (`auth.ts:97`, `auth.ts:141`), and **once more in `middleware/user.ts:16-21`** (`ensureUserProvisioned`).
- `users.ts` has **3 `getDb()` calls with no guard at all** (`users.ts:43,67,89`) — an absent `DATABASE_URL` there throws inside `createDb`/`Pool`/`neon()` construction and falls through to the global `app.onError` handler in `index.ts:42`, producing a *different* error shape (`{success:false, error:'Internal server error', code:'internal_error'}`) than the guarded routes' `{success:false, error:'Server configuration error'}`. This is the inconsistency M-01 describes, confirmed live.
- `public.ts:18` has **no guard, no try/catch at all** — same fallthrough-to-`onError` behavior.
- `health.ts` needs no DB at all and is mounted at `/api/health` with no auth.
- Root `index.ts:18` (`/`) also needs no DB and has no auth.

### Fix — two coupled changes, ARCH-01 first

**1. ARCH-01 fix (`backend/src/db/index.ts`), new/modified: MODIFIED**

Type `createDb`'s return properly. The two drivers share `PgDatabase<TQueryResult, TFullSchema>` as their common base (`node_modules/drizzle-orm/pg-core/db.d.ts:20`), and the concrete classes are `NeonHttpDatabase<TSchema>` (`drizzle-orm/neon-http/driver.d.ts:22`) and `NodePgDatabase<TSchema>` (`drizzle-orm/node-postgres/driver.d.ts:21`).

Preferred:
```typescript
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export function createDb(
  databaseUrl: string,
): NeonHttpDatabase<typeof schema> | NodePgDatabase<typeof schema> {
  ...
}
```
**Verify, don't assume:** run `tsc --noEmit` after this change against the query chains actually used in `trips.ts` (`.select({...}).from(trips).where(eq(...)).limit(1)`, etc). Both classes extend the same `PgDatabase` base so simple select/insert/update chains should unify, but if the union produces "not assignable" errors on any call site, **fall back to the shared base type** instead of the union:
```typescript
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
export function createDb(databaseUrl: string): PgDatabase<PgQueryResultHKT, typeof schema> { ... }
```
Either way, `export type Db = ReturnType<typeof createDb>` (line 31, unchanged) automatically propagates the new type everywhere `Db` or `ReturnType<typeof getDb>` is used — including the untouched helper signatures in `trips.ts` (`resolveDestination(db: ReturnType<typeof getDb>, ...)` etc. at lines 53-134) and the `dest: any`/`day: any` cast at `trips.ts:132` (BUG-13), which becomes narrowable once this lands. This is the main reason to land ARCH-01 first: one file change, blast radius handled by type inference, not by touching every call site.

**2. M-01 fix — new file `backend/src/middleware/db.ts` (NEW component)**

```typescript
import type { Context, Next } from 'hono';
import type { Env, ContextVariables } from '../types';
import { getDb } from '../db';

export async function dbMiddleware(
  c: Context<{ Bindings: Env; Variables: ContextVariables }>,
  next: Next,
) {
  if (!c.env.DATABASE_URL) {
    return c.json({ success: false, error: 'Server configuration error' }, 500);
  }
  c.set('db', getDb(c.env.DATABASE_URL));
  await next();
}
```
Add `db: Db` to `ContextVariables` in `backend/src/types/index.ts:61-65` (MODIFIED — import `Db` from `../db`).

**Mounting — do not mount globally in `index.ts`.** `app.use('*', dbMiddleware)` in `index.ts` would run on `/` and `/api/health`, which have no `DATABASE_URL` need and would needlessly 500 if it's ever unset for a liveness-only deploy. Mount per-router instead, in the same place `authMiddleware`/`ensureUserProvisioned` are already mounted:
- `trips.ts:47` — currently `tripsRoute.use('*', authMiddleware, ensureUserProvisioned)`. Change to `tripsRoute.use('*', dbMiddleware, authMiddleware, ensureUserProvisioned)` (db first, since `ensureUserProvisioned` needs it — see below).
- `auth.ts:92` — currently `authRoute.use('*', authMiddleware, ensureUserProvisioned)`. Same change.
- `users.ts` — has **no router-level `.use('*', ...)`**; each route applies `authMiddleware` individually (`users.ts:42,64,88`). Add `usersRoute.use('*', dbMiddleware)` once, ahead of the individual `authMiddleware` calls, OR add `dbMiddleware` per-route alongside `authMiddleware` for consistency with the existing per-route style. Prefer the router-level `.use('*', dbMiddleware)` — it's the one router where per-route duplication is the actual smell to remove.
- `public.ts` — no auth at all today. Add `publicRoute.use('*', dbMiddleware)` as the router's first middleware.
- `health.ts` and the root `/` handler in `index.ts` — **do not** mount `dbMiddleware`; they don't touch the DB.

**Refactor `ensureUserProvisioned` (`middleware/user.ts`) to consume, not fetch — MODIFIED.** It currently re-implements the same guard+`getDb()` at lines 16-21. Once `dbMiddleware` runs first in the chain, change it to `const db = c.get('db')` and delete its own guard block. This also fixes the case where `ensureUserProvisioned` was previously the *only* thing standing between a missing `DATABASE_URL` and an unguarded `getDb()` call for any route composed with it.

**Route bodies — MODIFIED, one-line change per route.** Replace `const db = getDb(c.env.DATABASE_URL)` (+ its guard block) with `const db = c.get('db')` in all 19 `trips.ts` call sites, both `auth.ts` call sites, all 3 `users.ts` call sites, and the 1 `public.ts` call site. This is the ~20-blob mechanical part of M-01; ARCH-01 and the middleware itself are the actual design work.

**Test fixture impact:** `mockEnv` in `public.test.ts`, `auth.test.ts`, `index.test.ts`, `keycloak.test.ts` already sets `DATABASE_URL` to a (currently fake) value — no fixture change needed for M-01 itself, since `dbMiddleware` just calls the same `getDb()` those tests already exercise indirectly. ARCH-06 (Q5) is the piece that makes that URL point at something real.

---

## Q2 — Removing the `japan-trip-worker` service account (SEC-14) — two Terraform roots, manual secret bridge

### Current state (read directly)

- `terraform/keycloak/main.tf:109-119` defines `keycloak_openid_client.japan_trip_worker` (CONFIDENTIAL, `service_accounts_enabled = true`).
- `terraform/keycloak/main.tf:131-136` defines `keycloak_openid_client_service_account_role.worker_manage_users`, binding the service account to the **client role** `manage-users` on the built-in `realm-management` client (looked up via `data.keycloak_openid_client.realm_management`, `main.tf:122-125`).
- `terraform/keycloak/main.tf:149-152` outputs the secret: `output "worker_client_secret" { value = keycloak_openid_client.japan_trip_worker.client_secret; sensitive = true }`.
- **`terraform/cloudflare/` is a wholly separate Terraform root** (own `main.tf`, `variables.tf`, `versions.tf` — own state file). There is **no `terraform_remote_state` data source** linking it to `terraform/keycloak/`. `terraform/cloudflare/main.tf:8-13` defines `resource "cloudflare_worker_secret" "kc_admin_client_secret"` sourced from `var.kc_admin_client_secret` (`terraform/cloudflare/variables.tf:17-20`), which is a plain sensitive string variable — populated manually (tfvars/CI secret), not by cross-root reference.
- **The bridge is human, not Terraform.** `SETUP.md:71-76` instructs: run `terraform output -raw japan_trip_worker_secret` (already wrong — BUG-10, the real output name is `worker_client_secret`) and paste the value into `backend/.dev.vars` as `KC_ADMIN_CLIENT_SECRET`. There is no equivalent documented step wiring it into `terraform/cloudflare`'s `kc_admin_client_secret` var, meaning in practice this secret is manually propagated to up to 3 places: local `.dev.vars`, the Cloudflare Terraform var (prod), and CI if present.
- **Zero code consumers, confirmed by exhaustive grep** of `backend/src` for `KC_ADMIN`: every hit is in `types/index.ts:33-34` (the `Env` interface declaration), `dev.ts:22-23` (passthrough from `process.env`), and mock fixtures in `index.test.ts`, `auth.test.ts`, `public.test.ts`, `keycloak.test.ts`. No route, middleware, or query file reads `env.KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET`. No admin-API client code exists anywhere in `backend/src`.
- `deploy-backend.yml` does **not** set `KC_ADMIN_CLIENT_SECRET` via `wrangler secret put` — the only deployment path for that secret into the live Worker is the `cloudflare_worker_secret` Terraform resource, meaning `terraform/cloudflare` apply is the actual delivery mechanism to prod.

### Is it safe to remove? Yes — but it's a 2-root + app-code coordinated change, not a single `terraform destroy`

Removing `keycloak_openid_client_service_account_role.worker_manage_users` and `keycloak_openid_client.japan_trip_worker` from `terraform/keycloak/main.tf` alone leaves:
1. A dangling `output "worker_client_secret"` referencing a deleted resource (Terraform plan/apply will itself error — must delete the output too).
2. `terraform/cloudflare`'s `cloudflare_worker_secret.kc_admin_client_secret` still deploying an orphaned secret to the live Worker for a client that no longer exists in Keycloak — harmless functionally (nothing reads it) but leaves a stale/meaningless secret in Cloudflare and its `var.kc_admin_client_secret` declaration in the deploy tfvars/CI secrets store.
3. `backend/src/types/index.ts:33-34`'s `Env.KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` fields, `dev.ts:22-23`, and 4 test-fixture files still referencing fields that no longer correspond to anything real.

**Full removal checklist (all MODIFIED, none NEW):**
- `terraform/keycloak/main.tf` — delete lines 108-119 (`japan_trip_worker` client), 121-136 (`realm_management` data source + `worker_manage_users` role, unless `realm_management` data source is reused elsewhere — grep confirms it's only referenced by this one role resource), 147-152 (`worker_client_secret` output).
- `terraform/cloudflare/main.tf` — delete the `cloudflare_worker_secret.kc_admin_client_secret` resource (lines 8-13).
- `terraform/cloudflare/variables.tf` — delete `kc_admin_client_secret` variable (lines 17-20).
- `terraform/cloudflare/local.tfvars.example` and any CI secret entry referencing `kc_admin_client_secret` — remove.
- `backend/src/types/index.ts:33-34` — delete `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` from `Env`.
- `backend/src/dev.ts:22-23,36` — delete passthrough + log line.
- `backend/.dev.vars.example:3-4` and any local `.dev.vars` — delete.
- `backend/src/routes/auth.test.ts`, `public.test.ts`, `index.test.ts`, `auth/keycloak.test.ts` — delete `KC_ADMIN_CLIENT_ID`/`KC_ADMIN_CLIENT_SECRET` from each `mockEnv` (they typecheck against `Env`, so this is a forced, not optional, cleanup once `Env` changes).
- `SETUP.md:42-43,71-76` — delete the setup step (also incidentally closes BUG-10, same document, no extra work).

**Apply order:** `terraform/keycloak` apply first (removes the KC client + role), **then** `terraform/cloudflare` apply (removes the now-pointless secret) — order doesn't matter for correctness (no live dependency between them once code no longer reads the env var), but doing `keycloak` first means if anything *did* unexpectedly depend on the worker client, it fails loud in the smaller, easier-to-diagnose root before touching prod Cloudflare state.

---

## Q3 — Phase 13 passkey-flow restructure (KC-01) integrating with `browser-passkey` (SEC-12)

### Current state (read directly, `terraform/keycloak/flows.tf`)

- `browser_passkey` (top-level flow, `flows.tf:1-6`) has three ALTERNATIVE-priority branches: `auth-cookie` (priority 10), `passkey-forms` subflow (priority 20), `password-forms` subflow (priority 30).
- `passkey-forms` (`flows.tf:16-45`) currently has `auth-username-form` as **REQUIRED** (priority 10) and `webauthn-authenticator-passwordless` as **ALTERNATIVE** (priority 20) — the flagged smell (SEC-12/KC-01): mixing REQUIRED and ALTERNATIVE at the same subflow level means Keycloak's own engine effectively ignores the ALTERNATIVE executor's alternation semantics (logged 819 times/2h per the audit), though empirically the fallthrough to `password-forms` still enforces a real credential today.
- `webAuthnPolicyPasswordlessRpId` (`localhost`) lives in `main.tf:37-44`, in the **realm resource**, not in `flows.tf`. It is a comment-flagged constraint ("MUST be preserved; changing to prod hostname requires full passkey re-registration by all users") — unrelated to which flow/subflow structure references the `webauthn-authenticator-passwordless` authenticator.

### Why the restructure is safe for existing sessions and doesn't require re-registration

1. **Credentials are user-scoped, not flow-scoped.** WebAuthn public-key credentials are stored against the Keycloak user record (`credential` table), keyed by the RP ID/policy, not by which authentication flow/subflow references the `webauthn-authenticator-passwordless` authenticator. Restructuring `passkey-forms` into a single REQUIRED credential-subflow with webauthn/password as internal ALTERNATIVEs still points at the *same* `webauthn-authenticator-passwordless` authenticator and the *same* `web_authn_passwordless_policy` block in `main.tf` (rpId=`localhost`, unchanged) — so a credential registered under the old subflow structure validates identically under the new one. The flow tree only decides *when/how* the authenticator is invoked during login, not what credential material it accepts.
2. **Active sessions don't re-run the browser flow.** `sso_session_idle_timeout = "30m"` / `sso_session_max_lifespan = "10h"` (`main.tf:16-17`) sessions are validated by the existing SSO cookie/session, not by re-executing `browser-passkey` on every request — a logged-in user is unaffected until their next fresh login (post-logout or session-expiry), at which point they simply see the restructured (but behaviorally equivalent for a passkey-holder) flow.
3. **Terraform mechanics:** the `keycloak` provider's `keycloak_authentication_execution`/`keycloak_authentication_subflow` resources are typically destroy-and-recreate on structural changes (changing `parent_flow_alias`/nesting isn't an in-place update for most fields) — plan the change, confirm via `terraform plan` that it doesn't touch `keycloak_realm.japan_trip.browser_flow` (`main.tf:26`, still `"browser-passkey"` — the top-level flow alias is unaffected) or the `web_authn_passwordless_policy` block.

### Concrete restructure (MODIFIED: `terraform/keycloak/flows.tf`)

Target shape (per KC-01/Phase 13 backlog): replace `passkey-forms`'s current REQUIRED-username + ALTERNATIVE-webauthn pair with a single REQUIRED credential-subflow whose *children* are the alternatives:
```hcl
resource "keycloak_authentication_subflow" "passkey_forms" {
  # unchanged: alias, parent_flow_alias, requirement = "ALTERNATIVE", priority = 20
}

resource "keycloak_authentication_execution" "username_form" {
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  authenticator      = "auth-username-form"
  requirement        = "REQUIRED"   # unchanged — still the entry step
  priority           = 10
}

# NEW: nested REQUIRED credential-subflow replacing the bare ALTERNATIVE executor
resource "keycloak_authentication_subflow" "passkey_credential" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-credential"
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  provider_id       = "basic-flow"
  requirement        = "REQUIRED"
  priority           = 20
}

resource "keycloak_authentication_execution" "webauthn_passwordless" {
  parent_flow_alias = keycloak_authentication_subflow.passkey_credential.alias  # re-parented
  authenticator      = "webauthn-authenticator-passwordless"
  requirement        = "ALTERNATIVE"   # now correctly nested under a REQUIRED parent
  priority           = 10
}
```
This is a NEW subflow resource (`passkey_credential`) plus a re-parent of the existing `webauthn_passwordless` execution resource (MODIFIED). Recommend pairing with the audit's suggested negative E2E test asserting username-only auth (no credential) is impossible, since today's safety relies on Keycloak's implicit same-level evaluation, not explicit structure.

---

## Q4 — Cross-level date coherence (BIZ-07): schema layer vs. route handler

### Answer: both, at different levels — and the cross-level part reuses existing authz queries almost for free

**Own-record coherence (BIZ-06 — `start_date ≤ end_date` on trip/destination/hotel) belongs in `backend/src/validation/schemas.ts`**, via Zod `.refine()`. This only needs the request body itself — no DB read:
```typescript
export const CreateTripSchema = z.object({ ... }).refine(
  (data) => !data.start_date || !data.end_date || data.start_date <= data.end_date,
  { message: 'start_date must be before end_date', path: ['end_date'] },
);
```
Same pattern for `CreateDestinationSchema` and `UpsertHotelSchema` (both already have `start_date`/`end_date` or `check_in_date`/`check_out_date` fields). Note: `.refine()` on a base schema breaks `.partial()` chaining (`UpdateTripSchema = CreateTripSchema.partial()`, `schemas.ts:16`) — `.partial()` must be called on the object schema *before* `.refine()`, or the refine re-applied separately to the partial schema. Plan accordingly; this is a real Zod mechanics constraint, not a design choice.

**Cross-level coherence (day-within-destination, destination-within-trip, destination-overlap) must live in the route handler**, because it requires reading persisted parent/sibling rows that don't exist in the request body. This is the case the question anticipated correctly — **the authz-ownership queries already fetch exactly the rows needed**:

- `resolveDestination(db, tripId, destId, userId)` (`trips.ts:53-80`) already does `.select().from(destinations).where(eq(destinations.id, destId))` and returns the **full destination row** (`dest`), including `start_date`/`end_date`. Any handler that calls `resolveDay` (which calls `resolveDestination` internally, `trips.ts:93`) to create/update a `day` **already has `dest.start_date`/`dest.end_date` in scope** — checking "day date within destination range" is a 2-line addition at the call site, not a new query.
- The trip-ownership check inside `POST /:tripId/destinations` (`trips.ts:356-360`) currently only selects `{id: trips.id, user_id: trips.user_id}` — **narrower than what BIZ-07 needs**. Widen the `select({...})` to also include `trips.start_date, trips.end_date` (same query, one extra column, no new round-trip) to check "destination range within trip range" at `trips.ts:341-382` (POST) and the equivalent PATCH handler (`trips.ts:388-426`, via `resolveDestination`, which would need the same column-widening in its own trip-ownership `.select()` at `trips.ts:60-64`).
- "No destination-date-overlap within a trip" needs one additional query per create/update: `getDestinationsByTrip(db, tripId)` **already exists** (imported in `trips.ts:11`, used elsewhere e.g. line 324) — call it before insert/update and check the incoming range against the returned rows' ranges (excluding the row being updated, by id).

**No new schema-layer machinery needed** — this is entirely "widen 2 existing `.select()` column lists + call 1 existing query function + add a validation branch in the handler," landing in the same helper functions (`resolveDestination`/`resolveDay`) and route bodies (`trips.ts` POST/PATCH for destinations and days) that already do ownership resolution. MODIFIED: `trips.ts` (helper functions + ~6 route handlers), `validation/schemas.ts` (own-record `.refine()`s).

---

## Q5 — Minimal path to a real ephemeral test DB (ARCH-06)

### Current state (read directly)

- `backend/package.json` scripts: `"test": "vitest run"` — **no `vitest.config.ts` exists in `backend/`**, so there's no `globalSetup`/`setupFiles` hook today.
- `backend/src/routes/public.test.ts:5-13` (`mockEnv`) sets `DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb'` — a connection string that resolves to `localhost`, so `createDb`'s `isLocal` branch (`db/index.ts:17-18`) picks `node-postgres`/`Pool`, which then fails to connect (no such DB/host reachable) → every DB-touching call throws → caught nowhere in `public.ts` (no try/catch) → falls through to `app.onError` → 500. That 500 is why `expect([200, 500]).toContain(res.status)` (`public.test.ts:20,31,46`) "passes" vacuously — confirmed exactly as ARCH-06/TQ-01/TQ-02 describe.
- **A real Postgres is already running locally**: `keycloak/docker-compose.yml:4-18` — `postgres:16-alpine`, port 5432, `POSTGRES_DB: japan_trip`, user/pass `postgres`/`postgres`, with a `pg_isready` healthcheck. **This same instance/database is also used as Keycloak's own storage** (`KC_DB_URL: jdbc:postgresql://postgres:5432/japan_trip`, same DB name) — meaning app tables and Keycloak's internal tables coexist in one logical database today. Migrations live in `backend/src/db/migrations/*.sql` (4 files, `0000` through `0003`), driven by `drizzle-kit` (`backend/drizzle.config.ts`, `dialect: 'postgresql'`, `out: './src/db/migrations'`).
- `ci.yml` has **no backend test job at all** — only `typecheck-backend` (`tsc --noEmit`) and `test-frontend`. `npm run test:run --workspace=backend`/`npm test` for the backend is not invoked anywhere in CI today. This means ARCH-06's payoff (real assertions, and DEP-01's premise that a `drizzle-orm` upgrade regression would be "catchable") is currently **local-only** — the audit doc's framing ("blocked in practice... fixing that first turns this from 'write new tests' into 'point existing infra at real data'") is accurate for local dev but doesn't extend to CI without a second change.

### Recommended integration — reuse the container, isolate via a separate database, wire migrations in `globalSetup`

**Don't point tests at the `japan_trip` dev/KC-shared database directly** — that risks tests writing/deleting rows a developer is actively using locally, and risks collision with Keycloak's own tables if migrations or `drizzle-kit push` ever ran against the wrong target. Instead:

1. **NEW: `backend/vitest.config.ts`** — add `test.globalSetup` pointing at a new setup script.
2. **NEW: `backend/tests/global-setup.ts`** (or `src/db/test-setup.ts`) — in `setup()`:
   - Connect to the existing container's default `postgres` admin DB (`postgresql://postgres:postgres@localhost:5432/postgres`) and run `CREATE DATABASE japan_trip_test` (idempotent: `DROP DATABASE IF EXISTS ... ; CREATE DATABASE ...`, or catch the "already exists" error).
   - Run Drizzle's programmatic migrator (`drizzle-orm/node-postgres/migrator`'s `migrate(db, { migrationsFolder: './src/db/migrations' })`) against `japan_trip_test` to apply all 4 existing SQL migrations.
   - Export/set `process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/japan_trip_test'` (or write to a fixture file `vitest` test files import) so `mockEnv` in each `*.test.ts` can reference it instead of the fake `mockdb` string.
   - In `teardown()`, either drop the test DB or leave it (idempotent recreate next run) — but **must call `pool.end()`/close any `node-postgres` `Pool` opened during setup**, or vitest hangs on an open TCP handle after the run completes (vitest does not exit cleanly with a live `pg.Pool` connection).
3. **MODIFIED: `public.test.ts`, `auth.test.ts`, `index.test.ts`, `auth/keycloak.test.ts`** — replace the hardcoded fake `DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb'` with the real test-DB URL (from an env var or shared test-fixture constant), and **replace the `toContain([200, 500])` / `toContain([404, 500])` assertions with exact status codes** now that a real DB backs the call — this is the actual "vacuous → real" fix TQ-01/TQ-02 describe, and it's a no-op without step 1-2 landing first.
4. **Seed data, minimal:** tests need at least one `is_public = true` trip with a known slug to exercise `public.test.ts`'s "valid slug + public trip → 200" case meaningfully. Either seed it in `globalSetup` (simplest, matches "ephemeral" framing) or have `public.test.ts` create its own fixture row in a `beforeAll` and clean it up in `afterAll` — prefer per-file `beforeAll`/`afterAll` fixtures over a shared global seed once `ARCH-03` (trips.ts unit tests) also lands, so tests stay independent and parallel-safe.
5. **CI gap — add a `test-backend` job to `ci.yml` (MODIFIED), not optional.** Use GitHub Actions' native `services: postgres: image: postgres:16-alpine` with a healthcheck, run migrations, then `npm run test --workspace=backend`. Without this, ARCH-06's local fix doesn't change what CI actually verifies, and the audit's assumption that the `drizzle-orm@0.45.2` bump (DEP-01) is "regression-catchable" only holds for whoever remembers to run backend tests locally before merging.

This is the correct build-order anchor for Phase 24: **ARCH-06 (real test DB + CI job) must land before ARCH-03 (trips.ts unit tests)** — writing `trips.ts` coverage against the current vacuous-mock setup would just add more `toContain([2xx, 500])` tests. It should also land before attempting the `drizzle-orm` bump in DEP-01, for the same reason.

---

## Build order (derived from real code/config dependencies, not phase-number order)

```
INFRA-03 (compatibility_date fix, unblocks any build)
     │
     ├──► ARCH-09 (CI e2e job — separately debug why it's never passed;
     │        must be green BEFORE INFRA-01/02 can safely gate deploys on CI)
     │
     └──► INFRA-01 / INFRA-02 (gate deploy workflows on ci.yml passing)

ARCH-01 (createDb return type: union or PgDatabase base fallback — VERIFY typecheck)
     │
     └──► M-01 (db middleware; c.get('db') needs ARCH-01's real type first)
              │
              └──► BUG-13 (dest:any/day:any cast in trips.ts:132 — becomes narrowable for free)

ARCH-06 (real ephemeral test DB: globalSetup + migrations + CI test-backend job)
     │
     ├──► ARCH-03 (trips.ts unit tests — meaningless without ARCH-06)
     ├──► DEP-01 (drizzle-orm 0.38→0.45 bump — needs ARCH-03/real tests to catch regressions)
     └──► TQ-01/TQ-02 (public.test.ts exact-status assertions replace toContain([2xx,500]))

BIZ-06 (own-record Zod .refine(), schemas.ts)
     │
     └──► BIZ-07 (cross-level coherence in trips.ts handlers — reuses resolveDestination/
              resolveDay's already-fetched parent rows; needs BIZ-06's .refine()-on-partial
              mechanics sorted first since both touch the same schemas)

SEC-14 (remove japan-trip-worker) — independent, but touches 2 Terraform roots + 7 app files;
     sequence keycloak-root apply before cloudflare-root apply (fails loud/small first)

KC-01 (passkey flow restructure) — independent of the above; safe re: sessions/re-registration
     per Q3's mechanism (credentials + rpId policy are orthogonal to flow structure)
```

**Practical grouping for phase planning:**
- Phase 21 (deploy/build safety): INFRA-03 first, then ARCH-09 as its own debugging session, then INFRA-01/02 last (gate only once ARCH-09 is green).
- Phase 24 (architecture/test debt): ARCH-01 → M-01 → ARCH-06 → ARCH-03/DEP-01, in that literal order — this phase has the longest internal dependency chain of the whole milestone.
- Phase 25 (business logic): BIZ-06 before BIZ-07, same file (`schemas.ts`) touched by both, avoids rework.
- Phase 26 (remaining security/IdP): SEC-14 and KC-01 have no dependency on each other or on Phases 21/24/25 — schedulable independently, but SEC-14 is the more mechanically involved of the two (2 Terraform roots + app code) so budget accordingly.

---

## Sources

All findings above are drawn directly from repo inspection (HIGH confidence, no external doc lookup needed for a brownfield-integration research pass):
- `backend/src/db/index.ts`, `backend/src/index.ts`, `backend/src/middleware/{auth,user}.ts`, `backend/src/types/index.ts`
- `backend/src/routes/{trips,users,auth,public,health,index}.ts`, `backend/src/routes/public.test.ts`
- `backend/src/validation/schemas.ts`, `backend/drizzle.config.ts`, `backend/package.json`, `backend/.dev.vars.example`
- `terraform/keycloak/main.tf`, `terraform/keycloak/flows.tf`, `terraform/cloudflare/main.tf`, `terraform/cloudflare/variables.tf`
- `keycloak/docker-compose.yml`, `SETUP.md`, `.github/workflows/{ci,deploy-backend,deploy-frontend}.yml`
- `node_modules/drizzle-orm/{neon-http,node-postgres,pg-core}/*.d.ts` (verified exact exported type names for the ARCH-01 fix)
- `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` (finding IDs/severities), `.planning/PROJECT.md` (constraints, current state)

---
*Architecture integration research for: TravelMap v3.2 Security & Code Health Hardening*
*Researched: 2026-07-24*
