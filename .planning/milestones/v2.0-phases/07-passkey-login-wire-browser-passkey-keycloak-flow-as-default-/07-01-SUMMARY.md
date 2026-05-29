---
phase: 07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-
plan: 01
subsystem: auth
tags: [keycloak, jwt, cloudflare-workers, hono, typescript, env-vars]

# Dependency graph
requires: []
provides:
  - Env interface extended with VALID_AUDIENCES, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET
  - KeycloakJwtPayload.email typed as optional (email?: string)
  - verifyJwt reads valid audiences from env.VALID_AUDIENCES.split rather than hardcode
  - Both users.ts getOrCreateUser call sites use jwtUser.email ?? '' fallback
  - .dev.vars.example documents all 3 new required bindings
affects: [07-02, 07-03, 07-04, 07-05, 07-06, 07-07, 07-08, 07-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env bindings for KC Admin client: KC_ADMIN_CLIENT_ID + KC_ADMIN_CLIENT_SECRET (D-03)"
    - "Audience validation via env var split: env.VALID_AUDIENCES.split(',').map(s => s.trim())"
    - "Optional email claim pattern: email?: string + ?? '' fallback at call sites"

key-files:
  created: []
  modified:
    - backend/src/types/index.ts
    - backend/src/auth/keycloak.ts
    - backend/src/auth/keycloak.test.ts
    - backend/src/routes/users.ts
    - backend/.dev.vars.example
    - backend/src/index.test.ts
    - backend/src/routes/public.test.ts

key-decisions:
  - "VALID_AUDIENCES comma-separated env string — allows multiple KC clients without code changes"
  - ".dev.vars is gitignored (T-07-02); only .dev.vars.example is committed; prod secret via wrangler secret put"
  - "email ?? '' fallback at call sites only — getOrCreateUser signature stays string, sub is authoritative identity"

patterns-established:
  - "New Env bindings: always add to types/index.ts + .dev.vars.example + all test mockEnv objects"

requirements-completed: [BACK-01, BACK-02]

# Metrics
duration: 15min
completed: 2026-05-20
---

# Phase 07 Plan 01: Backend Hardening — Audience Env Var + Optional Email Summary

**VALID_AUDIENCES extracted from hardcode to env var; passkey-only tokens accepted via email?: string + ?? '' fallback at both users.ts call sites**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-20T20:00:00Z
- **Completed:** 2026-05-20T20:15:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Extracted hardcoded `['japan-trip-frontend']` audience to `env.VALID_AUDIENCES.split(',').map(s => s.trim())` — new KC clients added via env, not code
- Made `KeycloakJwtPayload.email` optional (`email?: string`); added `jwtUser.email ?? ''` fallback at both `getOrCreateUser` call sites in users.ts
- Extended `Env` interface with 3 new required bindings: `VALID_AUDIENCES`, `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET`
- Added 2 BACK-01 env extraction tests to keycloak.test.ts; all 22 tests pass; typecheck passes

## Task Commits

1. **Task 1: Extend Env interface and make email optional** - `a96fdb9` (feat)
2. **Task 2: Extract VALID_AUDIENCES in keycloak.ts and fix users.ts call sites** - `f2129ac` (feat)
3. **Task 3: Update keycloak.test.ts and extend .dev.vars** - `32eb424` (test)

## Files Created/Modified
- `backend/src/types/index.ts` - Added VALID_AUDIENCES, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET to Env; email?: string on KeycloakJwtPayload
- `backend/src/auth/keycloak.ts` - verifyJwt now reads validAudiences from env.VALID_AUDIENCES.split
- `backend/src/auth/keycloak.test.ts` - Added BACK-01 env extraction describe block with 2 tests
- `backend/src/routes/users.ts` - Both getOrCreateUser call sites use jwtUser.email ?? ''
- `backend/.dev.vars.example` - Added VALID_AUDIENCES, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET
- `backend/src/index.test.ts` - mockEnv updated with 3 new required fields (Rule 1 fix)
- `backend/src/routes/public.test.ts` - mockEnv updated with 3 new required fields (Rule 1 fix)

## Decisions Made
- `.dev.vars` is gitignored per T-07-02 (confirmed at .gitignore lines 48-49). Only `.dev.vars.example` committed. Prod secrets delivered via `wrangler secret put`.
- `getOrCreateUser` signature unchanged (`email: string`) — the `?? ''` fallback is applied at call sites. The `sub` (Keycloak ID) is the authoritative identity; empty email is acceptable for passkey-only users.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated mockEnv in index.test.ts and public.test.ts**
- **Found during:** Task 2 (typecheck after types/index.ts change)
- **Issue:** Both test files had `mockEnv: Env` objects missing the 3 new required Env fields, causing `tsc --noEmit` to fail with TS2739 errors
- **Fix:** Added `VALID_AUDIENCES`, `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET` with mock values to both mockEnv objects
- **Files modified:** backend/src/index.test.ts, backend/src/routes/public.test.ts
- **Verification:** `npm run typecheck` exits 0
- **Committed in:** f2129ac (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test mock objects incomplete after Env interface extension)
**Impact on plan:** Fix was necessary for typecheck to pass. No scope creep.

## Issues Encountered
- `npm run test:run` does not exist in backend package.json — the correct script is `npm test` (vitest run). Plan's acceptance criteria referenced `test:run`; adapted to use `npm test`.

## User Setup Required
None — `.dev.vars` is updated locally (gitignored). `.dev.vars.example` documents the 3 new bindings. `KC_ADMIN_CLIENT_SECRET` will be populated with the real UUID after Plan 07-08 retrieves it from Terraform output.

## Next Phase Readiness
- All downstream plans can reference `Env.VALID_AUDIENCES`, `Env.KC_ADMIN_CLIENT_ID`, `Env.KC_ADMIN_CLIENT_SECRET`
- `KeycloakJwtPayload.email` is now optional — passkey auth flow can proceed without email claim
- typecheck and full test suite pass — clean baseline for parallel Wave 1 plans

---
*Phase: 07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-*
*Completed: 2026-05-20*
