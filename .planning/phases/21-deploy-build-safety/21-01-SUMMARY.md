---
phase: 21-deploy-build-safety
plan: 01
subsystem: infra
tags: [wrangler, cloudflare-workers, drizzle-orm, hono, dompurify, npm-audit, nodejs_compat_v2]

# Dependency graph
requires: []
provides:
  - Working `wrangler deploy --dry-run` build (compatibility_date 2024-09-23 activates nodejs_compat_v2)
  - 0 HIGH/CRITICAL vulnerabilities in backend production dependencies (drizzle-orm + hono bumped)
  - dompurify patched to 3.4.12 in frontend
affects: [21-02, future deploy-gate work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "compatibility_date bump (not a code change) resolves CF Workers Node.js builtin polyfill errors when nodejs_compat flag is already present"

key-files:
  created: []
  modified:
    - backend/wrangler.toml
    - backend/package.json
    - frontend/package.json
    - package-lock.json

key-decisions:
  - "drizzle-orm 0.38.3 -> 0.45.2: RQBv1 relational query API (db.query.*.findFirst({ with: {...} })) confirmed unchanged through 0.45.x; closes GHSA-gpj5-g38j-94v9"
  - "hono 4.6.17 -> 4.12.32: closes 17 HIGH advisories via npm audit fix (no --force), none of the affected code paths (Lambda/ALB adapters, JSX SSR) are used by this CF Workers backend"

patterns-established: []

requirements-completed: [INFRA-03, DEP-01]

# Metrics
duration: ~20min
completed: 2026-07-29
---

# Phase 21 Plan 01: Fix Backend Build & Close HIGH Dependency Vulnerabilities Summary

**Bumped wrangler compatibility_date to activate nodejs_compat_v2 (fixing 25 unresolved-builtin build errors) and closed drizzle-orm/hono HIGH-severity CVEs — backend now builds and audits clean.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-29T22:45:00-03:00 (approx)
- **Completed:** 2026-07-29T22:51:13-03:00
- **Tasks:** 2
- **Files modified:** 4 (backend/wrangler.toml, backend/package.json, frontend/package.json, package-lock.json)

## Accomplishments
- `npm run build --workspace=backend` (`wrangler deploy --dry-run`) now exits 0 with no "Could not resolve" errors — previously failed with 25 unresolved Node.js builtin errors
- `npm audit --workspace=backend --omit=dev` reports "found 0 vulnerabilities" (was 1+ HIGH from drizzle-orm GHSA-gpj5-g38j-94v9 plus 17 HIGH hono advisories)
- `npm run typecheck --workspace=backend` and `npm run test --workspace=backend` both exit 0 after the drizzle-orm/hono bump — no type or test breakage from the version jump
- dompurify patched to `^3.4.12` in frontend

## Task Commits

Each task was committed atomically:

1. **Task 1: Bump compatibility_date and dependency version strings** - `5db0cee` (fix)
2. **Task 2: Install, verify build / typecheck / audit / tests** - `facc9ed` (chore)

_No plan metadata commit yet — this SUMMARY.md commit follows in worktree mode._

## Files Created/Modified
- `backend/wrangler.toml` - `compatibility_date` bumped 2024-01-01 -> 2024-09-23, activating nodejs_compat_v2 alongside the existing `nodejs_compat` flag
- `backend/package.json` - `drizzle-orm` ^0.38.3 -> ^0.45.2, `hono` ^4.6.17 -> ^4.12.32, `drizzle-kit` ^0.30.1 -> ^0.31.10
- `frontend/package.json` - `dompurify` ^3.4.1 -> ^3.4.12
- `package-lock.json` - regenerated via `npm install` to resolve the bumped versions (drizzle-orm 0.45.2, hono 4.12.32, drizzle-kit 0.31.10, dompurify 3.4.12 all confirmed via `npm ls`)

## Decisions Made
- No deviation from the plan's version targets — all four package versions and the compatibility_date matched the plan's interfaces block exactly, no investigation or escalation needed.
- Step 6 (drizzle relational query smoke test) was skipped per the plan's documented fallback: no local Postgres container running (`docker ps` showed no postgres container). Build + typecheck + tests (34 passing) all passed; RQBv1 API stability is confirmed via 21-RESEARCH.md changelog analysis (no RQBv1 removals between 0.38.x and 0.45.x) rather than a live query smoke test.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. All acceptance criteria (build, typecheck, test, audit, dompurify version) passed on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend is now deployable (`wrangler deploy --dry-run` green); INFRA-03 unblocked
- DEP-01's 0-HIGH audit criterion satisfied for backend prod deps
- Plan 21-02 (deploy/build-gate work) can proceed without a broken build blocking it
- Relational query smoke test against a live Postgres instance remains untested in this plan — recommend running it opportunistically once local Docker Postgres is available, though risk is low per RQBv1 API-stability research

---
*Phase: 21-deploy-build-safety*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: .planning/phases/21-deploy-build-safety/21-01-SUMMARY.md
- FOUND: 5db0cee (Task 1 commit)
- FOUND: facc9ed (Task 2 commit)
