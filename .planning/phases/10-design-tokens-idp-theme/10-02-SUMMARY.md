---
phase: 10-design-tokens-idp-theme
plan: "02"
subsystem: frontend
tags: [design-tokens, css-custom-properties, dark-mode, web-components]
dependency_graph:
  requires: [10-01]
  provides: [DESIGN-01-ts-files]
  affects: [Navbar, SearchBar, AuthGuard, tripDetail, activities, days, map]
tech_stack:
  added: []
  patterns: [Shadow DOM CSS token references, imperative element.style token references]
key_files:
  created: []
  modified:
    - frontend/src/components/Navbar.ts
    - frontend/src/components/SearchBar.ts
    - frontend/src/auth/AuthGuard.ts
    - frontend/src/pages/tripDetail.ts
    - frontend/src/pages/trip-edit/activities.ts
    - frontend/src/pages/trip-edit/days.ts
    - frontend/src/modules/map.ts
decisions:
  - "Literal color:#fff / color:white replaced with var(--jp-white) in 3 places (Navbar login btn, SearchBar mark tag, AuthGuard retry btn) per D-03"
  - "SearchBar .result-icon.has-color { color: white } left as-is — not in plan rename list and not a dark-mode regression risk (it appears over a colored icon background with explicit inline style)"
  - "destinations.ts and hotels.ts contain old var(--text-secondary) refs — out of scope for plan 02; logged as deferred"
metrics:
  duration_minutes: 15
  tasks_completed: 2
  tasks_total: 2
  files_modified: 7
  completed_date: "2026-05-30T18:22:58Z"
---

# Phase 10 Plan 02: TS Token Rename (Web Components + Page Modules) Summary

Renamed all CSS custom property references in 7 TypeScript source files from old generic names to `--jp-*` prefixed equivalents, closing the dark-mode silent-fallthrough regression that plan 01's main.css rename would otherwise have introduced.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rename tokens in Web Component files | 342b3cd | Navbar.ts, SearchBar.ts, AuthGuard.ts |
| 2 | Rename tokens in page module files | 5f4992e | tripDetail.ts, activities.ts, days.ts, map.ts |

## Verification Results

- `rg -o "var\(--[a-z][a-z0-9-]*" src/components/Navbar.ts src/components/SearchBar.ts src/auth/AuthGuard.ts | rg -v "var\(--jp-"` → empty
- `rg -o "var\(--[a-z][a-z0-9-]*" src/pages/tripDetail.ts src/pages/trip-edit/activities.ts src/pages/trip-edit/days.ts src/modules/map.ts | rg -v "var\(--jp-"` → empty
- `npm run typecheck` → exit 0
- `npm run test:run` → 79/79 tests pass

## Deviations from Plan

### Out-of-Scope Discovery (not auto-fixed)

**[Deferred] Old token names in destinations.ts and hotels.ts**
- **Found during:** Task 2 src-wide verification sweep
- **Files:** `frontend/src/pages/trip-edit/destinations.ts`, `frontend/src/pages/trip-edit/hotels.ts`
- **Issue:** Both files contain `var(--text-secondary, ...)` references — old token names not yet renamed to `--jp-text-secondary`
- **Action:** Not fixed — these files are not in plan 02's `files_modified` scope
- **Impact on phase-gate:** The phase-gate must_have truth #1 ("No TypeScript file in `frontend/src/` references an old CSS token name") will NOT pass until these files are renamed. This is a pre-existing gap that plan 02 was not tasked to fix.
- **Logged to:** deferred-items.md for the phase orchestrator

**[Noted] SearchBar .result-icon.has-color { color: white }**
- **Found during:** Task 1 advisor review
- **Issue:** `.result-icon.has-color { color: white }` at ~line 211 is a literal `white` not converted to `var(--jp-white)` — not in the plan's rename list
- **Assessment:** Not a dark-mode regression risk — this rule applies when the icon background is an explicit inline color (the icon sits on a colored circle); the white text is correct foreground-on-color regardless of theme
- **Action:** Left as-is per plan scope; noted here for verifier awareness

## Known Stubs

None — all renames are structural changes to string literals, no data stubs introduced.

## Threat Flags

None — changes are purely CSS custom property name strings in developer-authored TypeScript. No new network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

Files exist:
- FOUND: frontend/src/components/Navbar.ts
- FOUND: frontend/src/components/SearchBar.ts
- FOUND: frontend/src/auth/AuthGuard.ts
- FOUND: frontend/src/pages/tripDetail.ts
- FOUND: frontend/src/pages/trip-edit/activities.ts
- FOUND: frontend/src/pages/trip-edit/days.ts
- FOUND: frontend/src/modules/map.ts

Commits exist:
- 342b3cd: feat(10-02): rename CSS tokens to --jp-* in Web Component files
- 5f4992e: feat(10-02): rename CSS tokens to --jp-* in page and module files
