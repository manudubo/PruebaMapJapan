---
phase: 21-deploy-build-safety
plan: 02
subsystem: ci-cd
tags: [github-actions, deploy-gating, keycloak, wrangler]
dependency-graph:
  requires:
    - 21-01 (backend build fix — build-backend job depends on wrangler deploy --dry-run succeeding)
  provides:
    - CI-gated production deploys (workflow_run + conclusion check)
    - backend CI coverage (test-backend, build-backend jobs)
    - working KC Docker healthcheck
    - pinned wrangler deploy (no npx)
  affects:
    - .github/workflows/deploy-frontend.yml
    - .github/workflows/deploy-backend.yml
tech-stack:
  added: []
  patterns:
    - "workflow_run trigger gated on conclusion == 'success', checkout pinned to head_sha"
    - "continue-on-error: true on a chronically-failing job to exclude it from workflow-level conclusion without deleting the job"
    - "bash /dev/tcp builtin as a curl-free Docker healthcheck"
key-files:
  created: []
  modified:
    - keycloak/docker-compose.yml
    - .github/workflows/ci.yml
    - .github/workflows/deploy-frontend.yml
    - .github/workflows/deploy-backend.yml
decisions:
  - "Skipped live docker compose up verification (Task 1) — shared dev-stack containers from another worktree were present and stopped; starting them risked interfering with other parallel wave agents. Verified via grep/config inspection only, matching the plan's documented fallback for 'if Docker is not running'."
metrics:
  duration: "~15 min"
  completed: 2026-07-30
---

# Phase 21 Plan 02: Deploy & Build Safety — Gate Deploys, Fix Backend CI, Fix KC Healthcheck Summary

Gated GitHub Pages and Cloudflare Workers deploys on CI success via `workflow_run` + `head_sha` checkout, added `test-backend`/`build-backend` CI jobs with `e2e` marked `continue-on-error`, fixed the permanently-`unhealthy` Keycloak Docker healthcheck (curl absent from image) with a bash `/dev/tcp` check, and switched backend deploy to the pinned `wrangler` devDep via `npm run deploy`.

## What Was Built

**Task 1 — Keycloak healthcheck (INFRA-05):** `keycloak/docker-compose.yml` healthcheck `test:` line replaced. The old `curl -sf http://localhost:8080/realms/japan-trip` could never succeed because `curl` is not present in `quay.io/keycloak/keycloak:26.6.1`. New check uses `["CMD", "bash", "-c", ...]` opening a raw TCP connection to port 8080 via the `/dev/tcp` bash builtin, sending a minimal HTTP/1.1 GET to `/realms/japan-trip`, and grepping the first response line for `200`. `interval`/`timeout`/`retries`/`start_period` unchanged (10s/5s/15/30s).

**Task 2 — Backend CI coverage + e2e exclusion (INFRA-01, INFRA-02):** Added `test-backend` (`npm run test --workspace=backend`, i.e. `vitest run`) and `build-backend` (`npm run build --workspace=backend`, i.e. `wrangler deploy --dry-run`) jobs to `.github/workflows/ci.yml`, mirroring the existing frontend job structure. Added `continue-on-error: true` to the `e2e` job with an `ARCH-09` comment documenting the 100% historical failure rate since April 2026 and that Phase 24 removes the flag once the job is fixed. Because `continue-on-error` is job-level, `e2e` failing no longer flips the workflow's overall `conclusion` to `failure` — only `typecheck-frontend`, `typecheck-backend`, `test-frontend`, `test-backend`, and `build-backend` (none of which have the flag) can block the workflow conclusion.

**Task 3 — Deploy gating + wrangler pin (INFRA-01, INFRA-04):** Both `deploy-frontend.yml` and `deploy-backend.yml` switched from `on: push: paths: [...]` to `on: workflow_run: workflows: [CI], branches: [main], types: [completed]`. Each job gained `if: ${{ github.event.workflow_run.conclusion == 'success' }}` and `ref: ${{ github.event.workflow_run.head_sha }}` on the checkout step, so deploys only run after a green CI run on `main`, and deploy exactly the SHA that CI validated (not whatever `main` HEAD happens to be at trigger time). `deploy-backend.yml`'s deploy step now runs `npm run deploy --workspace=backend` (invoking the `wrangler deploy` script in `backend/package.json`) instead of `npx wrangler deploy`, so the pinned `wrangler@^3.101.0` devDep is used rather than an npx-resolved arbitrary version. `working-directory: backend` was removed from that step since `--workspace=backend` already scopes it.

**Accepted trade-off (documented in plan, not a deviation):** `workflow_run` does not support `paths:` filtering, so every green CI run on `main` now triggers both deploy workflows regardless of which files changed (frontend-only commits will also attempt a backend deploy and vice versa). Accepted for this personal, low-push-frequency project — no `dorny/paths-filter` added.

## Deviations from Plan

None — plan executed exactly as written. Docker live-verification (task 1's optional step) was skipped in favor of grep-based verification because a shared dev-stack Keycloak/Postgres container pair from outside this worktree was present in a stopped state; starting it risked interfering with other parallel wave-2 agents' Docker state. This falls within the plan's own documented fallback ("If Docker is not running, verify via grep only").

## Verification Results

All 8 grep-based checks from the plan's `<verification>` block pass:

1. `workflow_run` present in both deploy workflow triggers — confirmed
2. `workflow_run.conclusion == 'success'` present in both `if:` gates — confirmed
3. `head_sha` present in both checkout `ref:` — confirmed
4. `deploy-backend.yml` deploy step is `npm run deploy --workspace=backend` — confirmed
5. `npx wrangler` absent from `deploy-backend.yml` — confirmed (empty grep)
6. `continue-on-error`, `test-backend`, `build-backend` all present in `ci.yml` — confirmed
7. `dev/tcp` present in `keycloak/docker-compose.yml` — confirmed
8. `curl` absent from `keycloak/docker-compose.yml` — confirmed (empty grep)
9. Live `docker inspect` health check — skipped (see Deviations)

All files also visually re-read post-edit to confirm YAML indentation matches the surrounding structure (no `js-yaml`/`PyYAML` available in this environment for automated parse validation).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `451beba` | fix(21-02): replace unusable curl KC healthcheck with bash /dev/tcp |
| 2 | `d692f0f` | feat(21-02): add backend CI jobs, exclude e2e from deploy gate |
| 3 | `d2434af` | fix(21-02): gate deploys on CI success, pin wrangler via npm run deploy |

## Self-Check: PASSED

- `keycloak/docker-compose.yml` — FOUND, contains `/dev/tcp/127.0.0.1/8080`, no `curl`
- `.github/workflows/ci.yml` — FOUND, contains `test-backend`, `build-backend`, `continue-on-error: true # ARCH-09`
- `.github/workflows/deploy-frontend.yml` — FOUND, contains `workflow_run`, `conclusion == 'success'`, `head_sha`
- `.github/workflows/deploy-backend.yml` — FOUND, contains `workflow_run`, `conclusion == 'success'`, `head_sha`, `npm run deploy --workspace=backend`, no `npx wrangler`
- Commit `451beba` — FOUND in git log
- Commit `d692f0f` — FOUND in git log
- Commit `d2434af` — FOUND in git log
