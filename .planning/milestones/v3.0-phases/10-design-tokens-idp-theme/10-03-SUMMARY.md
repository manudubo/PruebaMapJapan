---
phase: 10-design-tokens-idp-theme
plan: "03"
subsystem: keycloak-theme
tags: [design-tokens, css, keycloak, DESIGN-01]
dependency_graph:
  requires: []
  provides: [login.css-DESIGN01-complete, account.css-DESIGN01-complete]
  affects: [keycloak-login-theme, keycloak-account-theme]
tech_stack:
  added: []
  patterns: [KC-PatternFly-override, jp-token-namespace]
key_files:
  created: []
  modified:
    - keycloak/themes/japan-trip/login/resources/css/login.css
    - keycloak/themes/japan-trip/account/resources/css/account.css
decisions:
  - "Added --jp-bg-dark and --jp-white to login.css :root (independent per D-02)"
  - "Added --jp-accent-subtle and --jp-white to account.css :root (independent per D-02)"
  - "Preserved all !important declarations on modified lines per KC PatternFly override pattern"
  - "Passkey regression test deferred — KC not running at execution time"
metrics:
  duration: "~10m"
  completed: "2026-05-30T18:15:18Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
  files_created: 0
---

# Phase 10 Plan 03: Fix Residual Hardcoded KC CSS Values Summary

**One-liner:** Replaced 4 hardcoded hex/rgba values in login.css and 2 in account.css with `--jp-*` token references, adding `--jp-bg-dark`, `--jp-white`, `--jp-accent-subtle` to their respective `:root` blocks.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix login.css residual hardcoded values | 454ad5c | keycloak/themes/japan-trip/login/resources/css/login.css |
| 2 | Fix account.css residual hardcoded values + passkey guard | 3ccbb53 | keycloak/themes/japan-trip/account/resources/css/account.css |

## Changes Made

### Task 1 — login.css

**New tokens added to `:root`:**
- `--jp-bg-dark: #000000`
- `--jp-white: #ffffff`

**Component rule replacements (all `!important` preserved):**
1. `@media (prefers-color-scheme: dark)` body background: `#000000` → `var(--jp-bg-dark)`
2. `.card-pf, #kc-form-wrapper` background: `#ffffff` → `var(--jp-surface)` (token already in `:root`)
3. `.btn-primary` color: `#ffffff` → `var(--jp-white)`
4. `hr, .login-pf-signup` border-color: `rgba(0, 0, 0, 0.1)` → `var(--jp-border)` (token already in `:root`)

**DESIGN-02 regression guard:** `#kc-logo`, `.kc-logo-text`, and `border-radius: 0 !important` selectors verified untouched.

### Task 2 — account.css

**New tokens added to `:root`:**
- `--jp-accent-subtle: rgba(0, 113, 227, 0.08)`
- `--jp-white: #ffffff`

**Component rule replacements (all `!important` preserved):**
1. `.pf-v5-c-nav__link` active/hover background: `rgba(0, 113, 227, 0.08)` → `var(--jp-accent-subtle)`
2. `.pf-v5-c-button.pf-m-primary` color: `#ffffff` → `var(--jp-white)`

## Verification Results

### login.css acceptance criteria

- `rg "(--jp-bg-dark)"` returns 2 lines (definition + usage): PASS
- `rg "(--jp-white)"` returns 2 lines (definition + usage): PASS
- `rg "var\(--jp-surface\)"` has match in .card-pf: PASS
- `rg "var\(--jp-border\)"` has match in hr/divider: PASS
- `rg "#[0-9a-fA-F]{3,8}"` only `:root` block lines: PASS
- `rg "rgba\("` only `:root` block lines (lines 17, 19): PASS
- `rg "kc-logo"` selectors present: PASS
- `rg "border-radius.*0.*important"` 4 matches: PASS

### account.css acceptance criteria

- `rg "(--jp-accent-subtle)"` returns 2 lines (definition + usage): PASS
- `rg "(--jp-white)"` returns 2 lines (definition + usage): PASS
- `rg "rgba\(0, 113, 227"` only `:root` definition line: PASS
- `rg "#ffffff"` only `:root` lines (`--jp-surface`, `--jp-white`): PASS

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None.

## Passkeys Regression

**Deferred — KC not running at execution time.**

`docker ps | rg keycloak` returned no running containers. Per plan instructions:
"passkeys regression deferred — KC not running; to be verified with `docker-compose up` before phase gate."

The CSS changes are purely additive (new token definitions + var() substitutions with identical computed values). No FTL templates were modified. Risk of regression is low.

## Known Stubs

None. This plan replaces hardcoded values with token references — no data flow or UI stubs introduced.

## Threat Flags

None. The changes are purely token substitutions in static KC CSS files. No new network endpoints, auth paths, or trust boundaries introduced.

## Self-Check: PASSED

- keycloak/themes/japan-trip/login/resources/css/login.css exists and contains --jp-bg-dark and --jp-white
- keycloak/themes/japan-trip/account/resources/css/account.css exists and contains --jp-accent-subtle and --jp-white
- Commit 454ad5c exists (login.css fix)
- Commit 3ccbb53 exists (account.css fix)
