---
phase: 12-terraform-dev-script
plan: 01
subsystem: infra
tags: [nodejs, concurrently, docker, dev-script, orchestration]

# Dependency graph
requires:
  - phase: existing
    provides: root package.json with npm workspaces (frontend, backend)
provides:
  - scripts/dev.js — single-command local stack orchestrator (Docker detection, KC health poll, concurrently)
  - "dev" npm script at root (node scripts/dev.js)
  - concurrently@10.0.1 pinned in root devDependencies
affects: [12-02-terraform, 13-docs, 14-e2e-ux]

# Tech tracking
tech-stack:
  added: [concurrently@10.0.1]
  patterns:
    - CommonJS Node.js orchestration script using child_process + built-in fetch
    - Sequential startup gate: Docker ready → docker compose up -d → KC health poll → concurrently
    - concurrently programmatic API with per-process name/prefixColor for labeled output

key-files:
  created: [scripts/dev.js]
  modified: [package.json, package-lock.json]

key-decisions:
  - "concurrently@10.0.1 pinned exact (no caret) — newly published major; risk of undocumented API change"
  - "scripts/dev.js uses CommonJS (require) — root package.json has no type field, default is CJS"
  - "KC health poll uses built-in fetch + AbortSignal.timeout — Node 24 built-in, no dependency"
  - "docker compose logs -f keycloak is the [keycloak] labeled process, not a separate pre-step"
  - "Ctrl+C exits concurrently processes but containers persist (detached compose) — intentional, no auto-teardown"
  - "execSync dropped from destructure — it appeared in plan pattern but was unused; clean code"

patterns-established:
  - "Pattern: docker info exit-code check for Docker Desktop detection"
  - "Pattern: sequential startup gate before handing off to concurrently programmatic API"
  - "Pattern: waitForKeycloak uses 90s outer timeout with 3s poll interval and AbortSignal.timeout(2000) per request"

requirements-completed: [DEVENV-01, DEVENV-02]

# Metrics
duration: ~10min
completed: 2026-06-01
---

# Phase 12 Plan 01: Dev Script Summary

**Node.js dev orchestration script (scripts/dev.js) with Docker Desktop detection, KC health polling, and concurrently three-label process output ([keycloak]/[backend]/[frontend])**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-01T22:30:00Z
- **Completed:** 2026-06-01T22:40:16Z
- **Tasks:** 2
- **Files modified:** 3 (package.json, package-lock.json, scripts/dev.js)

## Accomplishments

- Single `npm run dev` from project root starts the entire local stack in correct order
- Docker Desktop detection via `docker info` exit code with cross-platform launch (macOS/Windows/Linux)
- Keycloak health poll at `http://localhost:8080/realms/japan-trip` with 90s timeout before starting backend/frontend
- Three labeled terminal streams: `[keycloak]` (cyan), `[backend]` (yellow), `[frontend]` (green) via concurrently programmatic API
- concurrently@10.0.1 pinned exact in root devDependencies; `node --check` passes; package importable

## Task Commits

1. **Task 1: Install concurrently and wire package.json** - `1f3eae6` (chore)
2. **Task 2: Create scripts/dev.js** - `52b78e7` (feat)

## Files Created/Modified

- `scripts/dev.js` — new; cross-platform dev orchestration script (CommonJS, 109 lines)
- `package.json` — added `"dev": "node scripts/dev.js"` as first scripts entry; concurrently@10.0.1 in devDependencies
- `package-lock.json` — updated with concurrently@10.0.1 and its transitive deps

## Decisions Made

- `execSync` omitted from `require('child_process')` destructure — present in plan pattern but unused; removed for clean code
- concurrently loaded lazily inside `main()` (after KC health passes), matching plan Pattern 3 exactly
- All three services (`keycloak` logs, `backend`, `frontend`) started via single `concurrently()` call after KC is healthy

## Deviations from Plan

None - plan executed exactly as written. (Minor: `execSync` dropped from unused destructure; does not affect behavior or any verification gate.)

## Issues Encountered

None. `concurrently@10.0.1` resolved from npm registry as expected.

## Runtime Smoke Test

Manual smoke test (full stack startup) is deferred to human verification — `npm run dev` spawns long-running processes that never exit by design. Automated gates confirmed:

1. `node -e "..."` — package.json has `"dev": "node scripts/dev.js"` and `"concurrently": "10.0.1"` ✓
2. `node --check scripts/dev.js` — no syntax errors ✓
3. `ls node_modules/concurrently` — package installed ✓
4. `node -e "require('concurrently')"` — importable ✓

## Known Stubs

None.

## Threat Flags

None — dev-only script. Threat model in plan covers T-12-01-01 through T-12-01-03 (all accepted, local dev only).

## User Setup Required

None — no external service configuration required for this plan.

## Next Phase Readiness

- Dev script is complete; `npm run dev` is the single-command startup for local development
- Phase 12-02 (Terraform expansion: test users + redirect URI hardening) is independent and ready to proceed
- Runtime validation of the full stack (KC + backend + frontend all healthy) is a manual step before 12-02 Terraform apply

## Self-Check: PASSED

- `scripts/dev.js` — FOUND
- `package.json` has `"dev": "node scripts/dev.js"` — VERIFIED (node -e check passed)
- `package.json` has `"concurrently": "10.0.1"` — VERIFIED
- Commit `1f3eae6` — FOUND
- Commit `52b78e7` — FOUND

---
*Phase: 12-terraform-dev-script*
*Completed: 2026-06-01*
