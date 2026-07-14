---
phase: 19-session-closure
plan: "01"
subsystem: e2e-tests
tags: [playwright, config, test-annotation, fixme]
dependency_graph:
  requires: []
  provides: [D-02-applied, D-03-applied, D-04-applied]
  affects: [19-02-full-suite-run]
tech_stack:
  added: []
  patterns: [playwright-fixme-file-scope, playwright-fixture-callback-fixme, playwright-project-storagestate]
key_files:
  modified:
    - tests/playwright.config.ts
    - tests/e2e/trip-edit-integration.spec.ts
    - tests/e2e/new-user-trip-creation.spec.ts
decisions:
  - "D-03: storageState conditional spread added to firefox/webkit mirrors chromium; idp-theme.spec.ts describe-level empty storageState override absorbs the change with no regression"
  - "D-02: test.fixme(true) at file scope in trip-edit-integration (before any test declaration) marks all 5 P2-V* tests unconditionally"
  - "D-04: test.fixme callback form ({ browserName }) => browserName === 'webkit' at file scope after test.use block — more reliable than process.env parsing per CONTEXT.md guidance"
  - "Playwright --list does not distinguish fixme from runnable tests in 1.60 output; fixme effect is confirmed at test-run time only"
metrics:
  duration: "~10 minutes"
  completed: "2026-07-13"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 19 Plan 01: Failure Disposition Config Fixes Summary

Apply the three pre-decided failure dispositions: storageState consistency fix for firefox/webkit (D-03), unconditional test.fixme for unimplemented backend integration tests (D-02), and webkit-scoped test.fixme for environment-constraint failure (D-04).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add storageState to firefox/webkit browser projects (D-03) | dff16ca | tests/playwright.config.ts |
| 2 | Add test.fixme annotations to trip-edit-integration and new-user-trip-creation (D-02, D-04) | 836fc25 | tests/e2e/trip-edit-integration.spec.ts, tests/e2e/new-user-trip-creation.spec.ts |

## Changes Made

### tests/playwright.config.ts (D-03)

Firefox and webkit project `use` blocks now carry the same storageState conditional spread as chromium:

```typescript
...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
```

`grep -c "storageState" tests/playwright.config.ts` → 3 (chromium, firefox, webkit).

The chromium-passkeys project is unchanged. The `idp-theme.spec.ts` describe-level `test.use({ storageState: { cookies: [], origins: [] } })` override remains active on firefox/webkit — no regression (verified per 19-RESEARCH.md Pitfall 5).

### tests/e2e/trip-edit-integration.spec.ts (D-02)

Inserted at file scope immediately after `test.setTimeout(90000)`, before any `test()` declaration:

```typescript
test.fixme(true, 'trip-edit API integration not implemented in v3.1 — pre-written for future Phase 2 integration');
```

Marks all 5 P2-V* tests unconditionally across all 3 browsers.

### tests/e2e/new-user-trip-creation.spec.ts (D-04)

Inserted after the `test.use({ storageState: ... })` closing `});` and before the sessionStorage replay comment:

```typescript
test.fixme(
  ({ browserName }) => browserName === 'webkit',
  'webkit handles KC redirect differently when building a fresh browser context from new-user.json — environment constraint',
);
```

Callback fixture injection form per CONTEXT.md and RESEARCH.md recommendation. webkit tests marked fixme; chromium/firefox remain runnable.

## Deviations from Plan

### Note: Playwright --list does not show fixme in listing output

The plan's acceptance criteria stated that `--list` output would show "zero tests listed as runnable" for trip-edit-integration. In practice, Playwright 1.60 `--list` enumerates all tests regardless of fixme status. The fixme annotations take effect at runtime (tests pass immediately and are reported as "fixme" in the HTML/JSON reporter, not counted as failures or as runnable tests). This is expected Playwright behavior — the plan's description of `--list` output was aspirational. The actual annotations are correctly placed and will produce the intended runtime behavior.

## Verification Results

- `grep -c "storageState" tests/playwright.config.ts` → 3
- `test.fixme(true, 'trip-edit API integration not implemented in v3.1` present at file scope in trip-edit-integration.spec.ts (before test declarations)
- `({ browserName }) => browserName === 'webkit'` present in new-user-trip-creation.spec.ts after test.use block
- `npm run typecheck` (frontend workspace) exits 0

## Known Stubs

None.

## Threat Flags

None — all changes are in tests/ only; no production code or auth boundaries modified.

## Self-Check: PASSED

- tests/playwright.config.ts exists and contains 3 storageState occurrences
- tests/e2e/trip-edit-integration.spec.ts contains test.fixme(true, ...) at file scope
- tests/e2e/new-user-trip-creation.spec.ts contains webkit-conditional test.fixme
- Commits dff16ca and 836fc25 exist in git log
