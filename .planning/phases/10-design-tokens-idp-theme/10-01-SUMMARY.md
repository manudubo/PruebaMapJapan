---
phase: 10-design-tokens-idp-theme
plan: "01"
subsystem: frontend/styles
tags: [design-tokens, css, refactor]
dependency_graph:
  requires: []
  provides: [jp-token-vocabulary, zero-hardcoded-component-values]
  affects: [frontend/src/styles/main.css]
tech_stack:
  added: []
  patterns: [css-custom-properties, semantic-tokens, jp-namespace]
key_files:
  created: []
  modified:
    - frontend/src/styles/main.css
decisions:
  - "Collapsed --bg-glass and --bg-secondary into single --jp-surface token per D-01 spec"
  - "Kept --jp-optional-bg at 1 replacement (rgba(175,82,222,0.05) appeared once, not twice as plan table suggested)"
  - ".widget-error [data-theme=dark] override uses var(--jp-danger) which resolves to the dark-mode danger token via cascade"
  - "Task 3 produced no file changes — no commit made for that task (pure verification)"
metrics:
  duration: ~20min
  completed: "2026-05-30"
requirements: [DESIGN-01, DESIGN-02, DESIGN-04]
---

# Phase 10 Plan 01: Rename CSS Tokens to --jp-* + D-03 Semantic Tokens Summary

Renamed all 39 CSS custom properties in main.css from legacy generic names to the --jp-* namespace, added 8 new D-03 semantic tokens to eliminate residual hardcoded values, and replaced all ~30 component-rule hardcoded hex/rgba values with var(--jp-*) references.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rename all token definitions (D-01) | 1543605 | frontend/src/styles/main.css |
| 2 | Replace all hardcoded values in component rules (D-01 + D-03) | 35b57a2 | frontend/src/styles/main.css |
| 3 | Regression guard — DESIGN-02 and DESIGN-04 still intact | (no commit — verification only) | none |

## Verification Results

- `rg -o "var\(--[a-z]..." | rg -v "var\(--jp-"` — empty output (all var() references renamed)
- `rg "--jp-hotel-subtle|..."` — all 8 D-03 tokens found in :root
- `npm run typecheck` — exits 0
- `npm run test:run` — 79/79 tests pass
- `npm run build` — exits 0
- 13 HTML files retain `localStorage.getItem` anti-FOUC script
- `login.css` DESIGN-02 rules (`kc-logo`, `border-radius: 0 !important`) untouched
- No HTML file git diff

## Deviations from Plan

### Auto-identified discrepancy (not a fix)

**Plan table counted 2 instances of rgba(175,82,222,0.05) — actual count is 1.**

- **Found during:** Task 2 acceptance verification
- **Issue:** Plan table listed `.legend-item.is-optional background` twice. Only one instance of `rgba(175, 82, 222, 0.05)` exists in main.css (line ~960).
- **Action:** Replaced the single existing instance with `var(--jp-optional-bg)`. Did not fabricate a second replacement.
- **Impact:** `rg "var\(--jp-optional-bg\)"` returns 1 match instead of plan's expected 2. The must_have criterion ("no hardcoded rgba in component rules") is fully satisfied.

None — plan executed as written. All must_have truths satisfied.

## Known Stubs

None. All component rules reference var(--jp-*) tokens exclusively (outside print blocks per spec).

## Threat Flags

No new security surface introduced. This plan is a pure CSS rename — no network endpoints, auth paths, or schema changes.

## Self-Check

Files exist:
- [x] FOUND: frontend/src/styles/main.css

Commits exist:
- [x] FOUND: 1543605 — feat(10-01): rename CSS tokens to --jp-* prefix
- [x] FOUND: 35b57a2 — feat(10-01): replace all var(--old) and hardcoded hex/rgba

## Self-Check: PASSED
