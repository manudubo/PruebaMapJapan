---
phase: 21-deploy-build-safety
reviewed: 2026-07-30T02:14:02Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - .github/workflows/ci.yml
  - .github/workflows/deploy-backend.yml
  - .github/workflows/deploy-frontend.yml
  - backend/package.json
  - backend/wrangler.toml
  - frontend/package.json
  - keycloak/docker-compose.yml
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-07-30T02:14:02Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Phase 21 deploy/build-safety changes: `workflow_run`-gated deploys, new backend CI jobs, non-blocking e2e job, dependency bumps, wrangler compatibility_date, and the Keycloak healthcheck rewrite.

The core design is sound and verified correct:

- `workflow_run` + `if: conclusion == 'success'` gating works as intended. A `continue-on-error: true` job that fails still yields workflow conclusion `success`, so the chronically-failing `e2e` job does not block deploys — matching ARCH-09 intent.
- The `branches: [main]` filter on `workflow_run` filters by the triggering workflow's head branch, so PR-triggered and `feature/**` CI runs cannot trigger deploys. No fork/pwn-request vector: deployed refs are always commits on `main`.
- `checkout` with `ref: github.event.workflow_run.head_sha` correctly pins the deploy to the exact commit CI validated (including its `package-lock.json`).
- `npm run deploy --workspace=backend` uses the pinned `wrangler ^3.101.0` devDep — correct fix over `npx wrangler deploy`. `wrangler deploy --dry-run` as the `build` script requires no Cloudflare auth, so the CI `build-backend` job works without secrets.
- `compatibility_date = "2024-09-23"` with `nodejs_compat` correctly opts into the improved Node.js compatibility mode; wrangler 3.101+ supports this date.
- The bash `/dev/tcp` healthcheck is compatible with the Keycloak image (ubi-micro based, no curl/wget, but bash is present since `kc.sh` is a bash script). The escaped `\\r\\n` sequences survive YAML parsing correctly and `printf` expands them.
- Dependency bumps (drizzle-orm ^0.45.2, hono ^4.12.32, drizzle-kit ^0.31.10, dompurify ^3.4.12) are lockfile-consistent and carry no config-visible issues.

Three warnings found: a shell precedence bug in the e2e job that races Playwright against an unfinished build (likely a root cause of the 100% e2e failure rate), a missing `--import-realm` flag that makes the new healthcheck unsatisfiable on fresh environments, and missing concurrency control on backend deploys.

## Warnings

### WR-01: e2e job backgrounds the entire build-and-preview compound, racing Playwright against an unfinished build

**File:** `.github/workflows/ci.yml:82`
**Issue:** In `npm run build:frontend && npm run preview:frontend &`, the `&` operator has lower precedence than `&&`, so bash backgrounds the whole list as `(build && preview) &`. The step exits immediately with status 0, and the next step launches Playwright while `vite build` is still running and no preview server is listening. Even once the server starts, nothing waits for the port to open. This is very likely a primary cause of the 100% e2e failure rate cited in ARCH-09 — worth knowing before Phase 24 tries to fix the tests themselves.
**Fix:**
```yaml
- name: Build frontend
  run: npm run build:frontend
  env:
    VITE_API_URL: http://localhost:8787
    # ... other VITE_ vars
- name: Start preview server
  run: npm run preview:frontend &
- name: Wait for preview server
  run: npx wait-on --timeout 60000 http://localhost:4173
```
(Adjust the port to match the Playwright config's baseURL.)

### WR-02: Keycloak realm is never imported, so the new healthcheck can never pass on a fresh environment

**File:** `keycloak/docker-compose.yml:35,40`
**Issue:** The healthcheck probes `/realms/japan-trip`, which only returns 200 if the realm exists. `realm-export.json` is mounted into `/opt/keycloak/data/import/`, but the command is plain `start-dev` — Keycloak only imports from that directory when started with `--import-realm`. On any fresh volume (new clone, `docker compose down -v`, CI), the realm is never created, the endpoint returns 404 forever, and the container stays unhealthy, breaking anything using `depends_on: condition: service_healthy`. This was masked before because the old curl-based healthcheck always failed anyway (no curl in image); fixing the probe mechanism surfaces this latent issue.
**Fix:**
```yaml
command: start-dev --import-realm
```

### WR-03: deploy-backend has no concurrency control — rapid pushes can deploy concurrently or out of order

**File:** `.github/workflows/deploy-backend.yml:9-12`
**Issue:** Two pushes to `main` in quick succession produce two CI runs and two `workflow_run` deploy events. With no `concurrency` group, both `wrangler deploy` invocations can run simultaneously, and if the older commit's CI finishes last, the older code wins (last write). The frontend workflow already serializes via `concurrency: group: pages`; the backend has no equivalent.
**Fix:**
```yaml
concurrency:
  group: deploy-backend
  cancel-in-progress: false
```

## Info

### IN-01: Path filters lost in the workflow_run migration — every main push deploys both targets

**File:** `.github/workflows/deploy-backend.yml:3-7`, `.github/workflows/deploy-frontend.yml:3-7`
**Issue:** The old `push` triggers were scoped with `paths: backend/**` / `paths: frontend/**`. `workflow_run` does not support path filtering, so a docs-only or planning-only push to `main` now redeploys both the Worker and GitHub Pages. Harmless (deploys are idempotent) but noisy and slightly wasteful.
**Fix:** Acceptable tradeoff for CI gating; if it becomes noisy, add a `dorny/paths-filter` step inside each deploy job that checks the changed files of `workflow_run.head_sha` and skips deploy when nothing relevant changed.

### IN-02: typecheck-backend bypasses the package script, inconsistent with the rest of CI

**File:** `.github/workflows/ci.yml:30-31`
**Issue:** The job runs `npx tsc --noEmit` with `working-directory: backend` while `backend/package.json` already defines `"typecheck": "tsc --noEmit"`, and every other job (and this phase's own deploy fix) uses `npm run ... --workspace=...`. It resolves the same hoisted `typescript` binary today, but the inconsistency invites drift.
**Fix:** `run: npm run typecheck --workspace=backend`

### IN-03: Obsolete `version` attribute in docker-compose

**File:** `keycloak/docker-compose.yml:1`
**Issue:** `version: '3.8'` is deprecated in Compose v2 and emits a warning on every invocation.
**Fix:** Delete the line.

### IN-04: PRs from feature/** branches run CI twice

**File:** `.github/workflows/ci.yml:3-7`
**Issue:** `push: branches: [main, 'feature/**']` plus `pull_request: branches: [main]` means every commit on an open feature-branch PR triggers two full CI runs (push event and pull_request event).
**Fix:** Drop `'feature/**'` from the push trigger (PR trigger covers those commits), or keep as-is if pre-PR feedback on feature branches is desired.

---

_Reviewed: 2026-07-30T02:14:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
