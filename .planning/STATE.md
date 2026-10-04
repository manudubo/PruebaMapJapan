---
gsd_state_version: 1.0
milestone: v3.2
milestone_name: Security & Code Health Hardening
status: executed_pending_verification
stopped_at: Phases 20-26 executed and consolidated; waiting for PR review, push, first Actions run and owner actions
last_updated: "2026-10-04T00:00:00.000Z"
last_activity: 2026-10-04 -- Consolidated planning docs against code and tests
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 6
  completed_plans: 6
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-04 — v3.2 executed, pending verification)

**Core value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.
**Current focus:** v3.2 is code-complete on branch `claude/focused-lovelace-cryssy` (HEAD `33ab925`, base `3c147f6` = `main`). Nothing is pushed. Next step is review of the PR, then the first GitHub Actions run of this code.

## Current Position

Phase: 26 of 26 (all v3.2 phases executed)
Plan: n/a — Phases 22-26 ran from summaries, not PLAN.md files
Status: Executed, pending verification (not yet "shipped")
Last activity: 2026-10-04

Progress: [##########] 100% executed. Requirements: 75 Complete, 4 Partial, 1 Deferred, 2 Unverified (82 total, plus DATA-04 extra).

Verification as last run (2026-10-04, this worktree, real Postgres 16, UTF8):

| Check | Result |
|-------|--------|
| `npm run typecheck` backend and frontend | clean |
| `npm test --workspace=backend` | 43 files, 1524 tests passed |
| `npm run test:run --workspace=frontend` (default TZ and `America/Argentina/Buenos_Aires`) | 47 files, 1042 tests passed |
| `vite build` with API and Keycloak origins | OK; CSP meta in 13 of 14 pages (all except `silent-check-sso.html`) |
| Playwright e2e, Terraform, live Keycloak | not re-run in this consolidation (see `.planning/qa/QA-INDEX.md`) |

Git range `3c147f6..HEAD`: 151 non-merge commits plus 18 merges, 303 files changed (+30,798 / -4,212).

## Performance Metrics

**Velocity:**

- Total plans completed: 93 (v2.0: 62, v3.0: 19, v3.1: 4 recorded earlier, v3.2: 6 with PLAN.md; Phases 22-26 have summaries only)
- Average duration: ~15 min/plan (v2.0 baseline)

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. v3.2 decisions that affect how the code must be operated:

- **OSM tiles (QA-DEMO-FIXES):** CartoDB `basemaps.cartocdn.com` now answers every tile with a 200 "API KEY REQUIRED" placeholder. Maps use keyless `tile.openstreetmap.org`, dark mode is a CSS filter on the tile pane, attribution is visible, the service worker never caches tiles (OSM policy). `src/data/tiles.ts` is the single place to change provider; a large traffic increase needs a self-hosted or commercial source.
- **BIZ-07 as DB triggers (migration 0008), not route checks:** production uses the Neon HTTP driver, which has no interactive transactions, so a route cannot hold a lock between check and write. Triggers raise `DC001`, mapped to 422 `date_conflict`. Advisory-lock namespaces: 7001 (OTP, per user), 7002 (BIZ-07, per trip). Shrinking a parent that would orphan children is rejected, never cascaded.
- **OTP issuance in one SQL function (migration 0009, `otp_issue()`):** same reason (single statement works on Neon HTTP). Clock comes from the DB.
- **404, not 403 (SEC-22):** foreign and missing resources answer the same 404 body on all nested routes; there is no existence oracle.
- **Direct `MIGRATION_DATABASE_URL` secret:** migrations run in the deploy workflow with a direct (non-pooled) Neon URL, in the order config gate, `db:preflight`, `db:migrate`, `wrangler deploy`. No `CLOUDFLARE_API_TOKEN` means the job is green and skipped (demo-only today).
- **CSP strict origins:** the CSP meta is built from the resolved Vite env. A production build fails if exactly one of `VITE_API_URL` / `VITE_KEYCLOAK_URL` is missing, or if both are missing without `CSP_ALLOW_MISSING_ORIGINS=true` (the Pages workflow sets that only when both secrets are empty). IPv6 hosts, wildcards, credentials and non-loopback `http` are rejected.
- **Keycloak login flow:** passkey users always get WebAuthn; users without a passkey get the password form; no credential means no session. Trade-off: passkey users have no "Try another way" password fallback (recovery is "Forgot password" or an admin deleting the credential). Terraform is the only source of realm config.
- **Schema validation answers 422** (path-id, JSON syntax and reorder-permutation errors stay 400). Public trip responses omit `user_id`; numeric ids stay because the adapter needs them.
- **Keycloak is the source of truth for user name/email** (BUG-08); `PATCH /api/users/me` name is overwritten on the next request.
- **Test DB:** backend tests run on a real ephemeral Postgres 16 (`TEST_DATABASE_URL`), never skipped. `db:migrate` is the supported way to build the schema (`drizzle-kit push` produces a different schema; preflight stops a push-created DB).

### Pending Todos

- Push the branch and open the PR (not done: this work was told not to push).
- First Actions run decides ARCH-06 (Postgres service), ARCH-09 (e2e), DEP-03 (security.yml). Record the result in REQUIREMENTS.md.
- Owner actions are listed in `.planning/PR-DESCRIPTION.md`.

### Blockers/Concerns

- **Production Keycloak may be exposed (KC-01).** The pre-Phase-26 `browser-passkey` flow let a username alone produce a token (and passkey registration for that account). Locally this was masked by `apply-local-settings.sh`, which is now deleted. Treat any production Keycloak that ran this Terraform as exposed: apply the new Terraform, run `terraform/keycloak/import.sh` with `--remove-stale-flows`, review login events for credential-less LOGINs, list WebAuthn credentials for ones the owner did not register, and sign out all sessions.
- **Production Keycloak realm needs `import.sh --remove-stale-flows`.** Terraform does not notice stray executions or the old `password-forms` subflow. Run `KC_URL=https://<kc> bash terraform/keycloak/import.sh` (dry run), then again with `--remove-stale-flows`, then `terraform plan`.
- **Prod Keycloak image has no theme** (`keycloak/Dockerfile` never copies `themes/`), so the SEC-11 `error.ftl` fix only applies where the theme is mounted.
- **S3 not built: no CI job runs Keycloak.** `idp-flow.spec.ts` (the KC-01 regression tests) only ran by hand on a live Keycloak; CI uses `SKIP_REAL_AUTH=true`. The proposal is in `qa/REVIEW-FIXES.md`.
- **S4 not run: Neon HTTP smoke test.** Tests use node-postgres. The Neon paths (`db.execute().rows` for `otp_issue()`, the `code`/`message`/`column` fields behind 422 `date_conflict` and 409, the schema-guard query) have never run on the Neon driver. Checklist: `qa/NEON-SMOKE-CHECKLIST.md`.
- **Migration 0005 aborts on duplicate emails** (case-insensitive, non-empty). The migrator rolls the whole run back. `db:preflight` lists the offenders and runs before `db:migrate` in the deploy workflow; merge accounts by hand. Migration 0006 sets both coordinates to NULL on out-of-range rows and cannot detect swapped lat/lng (query in `backend/src/db/README.md`).
- **Deploy order matters.** Migrations 0004-0009 must be applied before the new Worker (the new `otp-request` calls `otp_issue()`, absent until 0009). The workflow enforces it; manual deploys must too. `GET /api/health/ready` returns 503 `schema_not_migrated` otherwise.
- **The e2e job now gates deploys.** `continue-on-error` was removed from the `e2e` job (2fa0560), so a red e2e run on `main` blocks both the Pages and Worker deploys. ARCH-09 has never been seen green on Actions.
- **Backend has never been deployed.** Actions history shows the backend deploy failing on `main` (2026-07-30; consistent with no Cloudflare secrets, cause not inspected); the frontend Pages deploy succeeds. The live demo is still built from `3c147f6` (CartoDB placeholder tiles, no overview map) until this branch is merged.
- **Leaked local Keycloak client secret** (`japan-trip-worker`, found by gitleaks in two planning docs) was redacted at HEAD but remains in git history; rotation not verified (DEP-02).
- **CSP is a second line of defence only:** `script-src` keeps `'unsafe-inline'`; `frame-ancestors` cannot be set by a meta tag.
- Residual test debt: 3 `waitForTimeout` and 6 `test.skip(` in newer e2e specs; `api.spec.ts` still has `expect([404, 500]).toContain(...)`; `trip-edit.spec.ts:260` expects a destination POST body without `zoom_level`; backend adversarial suites log `57P01` on teardown; the backend suite needs a UTF8 Postgres cluster.
- Local dev stack (Docker Keycloak/Postgres, backend, frontend) goes down between sessions. A git worktree's `backend/.dev.vars` is gitignored and not copied on worktree creation; missing it makes DB-backed tests fail silently.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| SEC | SEC-18 Nominatim proxied through the Worker | Deferred: low risk for a single-user tool; needed before public use | v3.2 Phase 26 |
| SEC | SEC-17 set `ssl_required = "all"` in prod after checking Railway proxy headers | Partial: variable and runbook done, Railway unverified | v3.2 Phase 26 |
| A11Y | A11Y-04 target-size on overlapping tokyo markers (needs clustering/spiderfy) | Partial | v3.2 Phase 23 |
| A11Y | A11Y-05 landing LCP (hero waits on fonts/load; compress `demo-hero.jpg`, 677 KB) | Partial | v3.2 Phase 23 |
| DEP | Rotate the `japan-trip-worker` Keycloak secret | Owner action, unverified | v3.2 Phase 23 |
| CI | S3: CI job running Keycloak + `idp-flow.spec.ts` | Not built (proposal in REVIEW-FIXES.md) | v3.2 review |
| QA | S4: Neon HTTP smoke test | Not run (checklist ready) | v3.2 review |
| BIZ | Day in an undated destination vs trip range; hotel dates vs destination dates; option groups "1/2/3" need an `option_label` column | Not enforced / not built | v3.2 Phase 25 |
| TECH | `AuthGuard.ts` unused; `drizzle-kit push` vs migrations drift in `schema.ts` | Cleanup candidates | v3.2 |
| DEPLOY | Production deployment (Cloudflare + Neon + Railway) | Deferred, unscoped; build, gating and migration order are now ready | v1.0 planning |
| DEMO | Landing demo experience | Shipped in practice (landing, overview map, countdown); formal closure pending | v1.0 planning |
| PASS | Rename passkey (PUT credentials/{id}/label) | Deferred, unscoped | v1.0 planning |
| PROD | prod rpId for passkeys (Railway hostname in Terraform) | Deferred, unscoped | Phase 09 |
| PROD | Real-auth E2E in CI (requires KC in CI environment) | Deferred; same item as S3 | Phase 09 |
| E2E | OTP brute-force lockout: add `attackDetection.del` to `beforeEach` | Deferred to future | v3.1 planning |
| E2E | Per-recipient Mailpit isolation (`search?query=to:...`) | Deferred to future | v3.1 planning |

## Session Continuity

Last session: 2026-10-04
Stopped at: Planning docs consolidated (REQUIREMENTS, ROADMAP, STATE, PROJECT, MILESTONES, phases/TRACEABILITY, qa/QA-INDEX, PR-DESCRIPTION)
Resume: Review and push the branch, open the PR, read the first Actions run, then update the Unverified requirements. Run `/gsd-complete-milestone` only after owner actions are done or consciously deferred.
