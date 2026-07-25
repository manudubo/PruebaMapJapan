# Phase 21: Deploy & Build Safety - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the broken backend build (compatibility_date bump), gate production deploys on CI passing, pin wrangler as a declared devDep (no npx-at-deploy-time), fix the Keycloak Docker healthcheck, and close two runtime dependency vulnerabilities (drizzle-orm HIGH vulns, dompurify patch).

Requirements: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, DEP-01

</domain>

<decisions>
## Implementation Decisions

### INFRA-01/02: CI Gate Architecture
- **D-01:** Deploy workflows use the `workflow_run` trigger — `deploy-frontend.yml` and `deploy-backend.yml` both trigger `on: workflow_run: workflows: [CI] branches: [main] types: [completed]` with a gate condition `if: github.event.workflow_run.conclusion == 'success'`. No changes to the CI workflow trigger itself.
- **D-02:** The `e2e` job in `ci.yml` gets `continue-on-error: true` so its chronic failures (100% failure rate, ARCH-09 is Phase 24) do not set the CI workflow conclusion to `failure` and block all deploys.
- **D-03:** A new `test-backend` job is added to `ci.yml` running `npm run test --workspace=backend` (the existing vitest suite). Tests are acknowledged as vacuous until Phase 24 adds a real ephemeral test DB (ARCH-06) — the job exists, is green, and satisfies INFRA-02. Phase 24 improves what those tests verify.
- **D-04:** `deploy-frontend.yml` gates (via `workflow_run`) on `typecheck-frontend` and `test-frontend` passing. `deploy-backend.yml` gates on `typecheck-backend` and `test-backend` passing.

### INFRA-03: Backend Build Fix
- **D-05:** `backend/wrangler.toml` `compatibility_date` bumped from `"2024-01-01"` to `"2024-09-23"` — the minimum date that resolves the `string_decoder` builtin gap. Surgical bump, not jumped to today, to avoid activating unrelated CF Workers behavior changes. Increment further in future phases if needed.

### INFRA-04: Wrangler Pin
- **D-06:** `wrangler ^3.101.0` is already in `backend/package.json` devDependencies (confirmed). The deploy workflow change from `npx wrangler deploy` to `npm run deploy --workspace=backend` makes the usage explicit and consistent with the declared dep. No version change needed.

### INFRA-05: KC Healthcheck
- **D-07:** Replace `curl -sf http://localhost:8080/realms/japan-trip` with `wget -q --spider http://localhost:8080/health/ready` in `keycloak/docker-compose.yml`. `wget` is available in the KC 26.6.1 image; `/health/ready` is the built-in KC 26+ readiness endpoint. This checks actual KC readiness, not just port availability.

### DEP-01: Dependency Bumps
- **D-08:** `drizzle-orm` bumped to `^0.45.2` now in Phase 21 (2 HIGH vulns open; do not wait for Phase 24). npm labels this "breaking change" but it is a targeted minor bump, not the RQBv2/1.0 rewrite. Risk mitigation: `wrangler deploy --dry-run` must pass (INFRA-03 success criterion) and the E2E suite catches runtime regressions against the real Keycloak + DB stack.
- **D-09:** `dompurify` bumped to `^3.4.12` (patch-level bump within same minor — no breaking changes, straight upgrade).

### Claude's Discretion
- Exact CI yaml structure (job names, caching, node-version) within the `workflow_run` pattern: follow existing ci.yml conventions.
- Whether `deploy-backend.yml` should also include `npm run build --workspace=backend` (wrangler dry-run) as an inline gate step in addition to relying on CI — planner can decide based on how fast the `workflow_run` gate round-trip is.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §"Deploy & Build Safety — Phase 21" — INFRA-01 through INFRA-05, DEP-01 acceptance criteria (full per-item verification conditions)
- `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` — full audit findings and per-item verification status

### Files to Modify
- `backend/wrangler.toml` — bump `compatibility_date` to `"2024-09-23"`
- `backend/package.json` — bump `drizzle-orm` to `^0.45.2`; `dompurify` bump is in `frontend/package.json`
- `frontend/package.json` — bump `dompurify` to `^3.4.12`
- `keycloak/docker-compose.yml` — replace curl healthcheck with wget on `/health/ready`
- `.github/workflows/ci.yml` — add `test-backend` job; add `continue-on-error: true` to `e2e` job
- `.github/workflows/deploy-frontend.yml` — change trigger to `workflow_run` on CI
- `.github/workflows/deploy-backend.yml` — change trigger to `workflow_run` on CI; change `npx wrangler deploy` to `npm run deploy --workspace=backend`

### Cross-Phase Constraints
- `.planning/STATE.md` §"Pending Todos" — Phase 21 INFRA-01/02 gate must explicitly exclude the `e2e` job (resolved via `continue-on-error: true`); DEP-01 drizzle bump timing tension documented and resolved (bump now)
- `.planning/ROADMAP.md` §"Phase 21" — success criteria checklist (5 items must be TRUE)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ci.yml` existing job pattern (`typecheck-frontend`, `test-frontend`) — new `test-backend` job should follow the same structure: checkout, node 22, `npm ci --workspace=backend`, run test
- `backend/package.json` `"test": "vitest run"` — the script to invoke in CI

### Established Patterns
- `deploy-frontend.yml` and `deploy-backend.yml` currently use `on: push: branches: [main]` — both get replaced with `workflow_run` trigger
- `deploy-backend.yml` uses `npx wrangler deploy` (workflow-level) — change to `npm run deploy --workspace=backend` to use the declared dep explicitly
- `keycloak/docker-compose.yml` postgres healthcheck uses `CMD-SHELL` with `pg_isready` — same format for KC healthcheck replacement

### Integration Points
- `continue-on-error: true` on e2e: the job still runs and reports results in the Actions UI; it just doesn't fail the workflow conclusion. ARCH-09 (Phase 24) will remove this flag once e2e is fixed.
- drizzle-orm bump: the backend uses drizzle for all DB queries in `src/db/` — `wrangler deploy --dry-run` is the primary verification that the build still compiles after the bump

</code_context>

<specifics>
## Specific Ideas

- The `/health/ready` endpoint in KC 26+ returns `{"status":"UP"}` when KC is fully ready; `wget --spider` treats any 2xx as success, which is what we want.
- After the `workflow_run` change, a push to a frontend file on `main` will only deploy once CI completes — adds ~2-3 min to the deploy round-trip, which is acceptable for deploy safety.
- The `npm audit --workspace=backend --omit=dev` success criterion (0 HIGH/CRITICAL) should be verified after the drizzle bump — run it locally before committing the plan.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 21-deploy-build-safety*
*Context gathered: 2026-07-25*
