---
phase: 17-otp-login-helper
plan: 02
subsystem: testing
tags: [playwright, keycloak, e2e, fixtures, refactor]

# Dependency graph
requires:
  - phase: 17-01
    provides: loginViaKcForm shared helper in tests/e2e/fixtures/kc-login-helper.ts
provides:
  - global-setup.ts delegating kcLogin/kcLoginNewUser to loginViaKcForm
  - session-management.spec.ts using loginViaKcForm at all call sites (loginViaBrowser deleted)
affects: [passkeys.spec.ts (potential future consumer), wave-gate Playwright run]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "KC form nav: single source in kc-login-helper.ts; all callers import and delegate"
    - "Post-login assertion ownership: callers assert #new-trip-btn after loginViaKcForm"

key-files:
  created: []
  modified:
    - tests/global-setup.ts
    - tests/e2e/session-management.spec.ts

key-decisions:
  - "kcLogin/kcLoginNewUser keep their post-login steps (reload, storageState, sessionStorage) — only the KC nav block is replaced"
  - "loginViaBrowser deleted entirely (not just wrapped) — avoids two-layer indirection"
  - "Pre-existing unused Page/Browser/BrowserContext/getUserSessions imports in session-management.spec.ts not touched (out of task scope)"

# Metrics
duration: 15min
completed: 2026-06-24
---

# Phase 17 Plan 02: Session Login Helper Wiring Summary

**Wire loginViaKcForm into global-setup.ts and session-management.spec.ts, eliminating all duplicate KC form navigation**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-24T02:05:00Z
- **Completed:** 2026-06-24T02:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `global-setup.ts` kcLogin and kcLoginNewUser now delegate KC form navigation to `loginViaKcForm` — 67 lines of duplicated KC nav code deleted, replaced with 2 single-line delegate calls
- `session-management.spec.ts` `loginViaBrowser` function deleted entirely; all 7 call sites replaced with `loginViaKcForm` + inline `#new-trip-btn` assertion; `Page` unused import removed
- All 4 SESSION-02 call sites (global-setup x2, session-management x1 replaced, otp.spec.ts test 4 from Plan 01) now import from `kc-login-helper.ts` — zero duplicate KC nav implementations remain

## Task Commits

1. **Task 1: Refactor global-setup.ts** - `2590aed` (refactor)
2. **Task 2: Remove loginViaBrowser from session-management.spec.ts** - `d042197` (refactor)

## Files Created/Modified

- `tests/global-setup.ts` — import added, KC nav block in kcLogin/kcLoginNewUser replaced with loginViaKcForm delegate
- `tests/e2e/session-management.spec.ts` — loginViaBrowser deleted, import added, 7 call sites replaced, Page import removed, JSDoc comment updated

## Decisions Made

- `loginViaBrowser` was deleted outright rather than refactored to call `loginViaKcForm` — the function existed only to wrap the KC nav, so one layer of indirection is cleaner
- `#new-trip-btn` assertion moved to each call site inline (was the last line inside `loginViaBrowser`) — plan explicitly required this
- The `tab1.locator`, `pageA.locator`, `tabA.locator` variants used at the multi-tab/context call sites so each assertion targets the correct page object

## Deviations from Plan

### Pre-existing Issues (not fixed — out of task scope)

**1. [Deferred] Pre-existing unused imports in session-management.spec.ts**
- **Found during:** Task 2
- **Issue:** `getUserSessions`, `Browser`, `BrowserContext` were already imported but not directly referenced in pre-existing code (used via fixture method `kcAdmin.getUserSessions`). These existed before any Plan 02 changes.
- **Action:** Not fixed — pre-existing, out of scope per deviation boundary rule. Will cause `noUnusedLocals` typecheck warning if run.
- **Note:** Same situation as Plan 01 — typecheck cannot run in the worktree environment (no node_modules). Verified correctness with rg-based acceptance criteria checks instead.

## Typecheck Status

Typecheck (npm run typecheck) not executable in worktree environment — `node_modules` is gitignored and not present. Verified correctness via:
- rg-based acceptance criteria checks (all passed)
- Structural inspection of modified files

The code changes are structurally correct TypeScript: import paths match Plan 01's exported function, function signatures match, types are consistent.

## Known Stubs

None — no placeholder values or hardcoded stubs introduced.

## Threat Flags

None — these are test-only files; no new network endpoints or auth paths introduced.

---

*Phase: 17-otp-login-helper*
*Completed: 2026-06-24*
