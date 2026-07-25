---
phase: 20-critical-security
plan: "03"
subsystem: frontend/build
tags: [csp, security, vite, plugin]
dependency_graph:
  requires: [20-02]
  provides: [SEC-04]
  affects: [frontend/dist/*.html]
tech_stack:
  added: []
  patterns: [Vite transformIndexHtml plugin, CSP meta tag injection at build time]
key_files:
  created: []
  modified:
    - frontend/vite.config.ts
decisions:
  - fonts.googleapis.com added to style-src and connect-src after browser devtools
    revealed the CSS @import url() and <link rel="preconnect"> were silently blocked
  - frame-ancestors intentionally absent from meta CSP (unsupported in meta tags;
    requires HTTP response header — deferred per T-20-03-03)
  - "'unsafe-inline' accepted in script-src and style-src (all 13 pages use inline
    FOUC-prevention scripts; nonce-based approach deferred per T-20-03-02)"
metrics:
  duration: ~30min
  completed: "2026-07-24"
  tasks_completed: 2
  files_modified: 1
---

# Phase 20 Plan 03: CSP Meta Tag via Vite Plugin Summary

CSP meta tag injected into all 13 HTML entry points at build time via a Vite `transformIndexHtml` plugin, covering all external origins used at runtime (map tiles, news proxy, weather, geocoder, Keycloak, Google Fonts). Browser devtools confirmed 0 violations.

## Tasks Completed

### Task 1: Add cspPlugin to vite.config.ts

Three edits to `frontend/vite.config.ts`:

1. `import { defineConfig } from 'vite'` to `import { defineConfig, type Plugin } from 'vite'`
2. Inserted `cspPlugin(): Plugin` function between imports and `export default defineConfig()`
3. Added `plugins: [cspPlugin()]` to the defineConfig body after `base`

The plugin uses `transformIndexHtml` to replace `<head>` with `<head>\n  <meta http-equiv="Content-Security-Policy" content="...">` in every HTML entry point during the Vite build.

**Automated verification:**
- `npm run build` — exit 0
- All 13 rollup entry point `dist/*.html` files: CSP count = 1
- `silent-check-sso.html` (public/ static file, no `<head>` tag, not a Rollup entry) — 0, expected
- `npm run typecheck` — exit 0
- `npm run test:run` — 97/97 passed

### Task 2 (Checkpoint): Browser devtools verification

Preview build served at http://localhost:5173. Service worker unregistered and site data cleared before testing.

Pages tested:
- `tokyo.html` — 10 map tiles loaded (CartoDB), news widget, weather widget
- `index.html` — Keycloak init completed (login button rendered)
- `dashboard.html` — trip-edit.html redirected to auth (expected; Nominatim geocoder covered by policy)

Result: 0 CSP violation messages in Chrome DevTools Console.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing fonts.googleapis.com in style-src and connect-src**

- **Found during:** Task 2 (browser devtools checkpoint)
- **Issue:** `main.css` uses `@import url('https://fonts.googleapis.com/...')` and `index.html` has `<link rel="preconnect" href="https://fonts.googleapis.com">`. Both were silently blocked by the initial CSP which only allowed `https://fonts.gstatic.com` in `font-src`.
- **Fix:** Added `https://fonts.googleapis.com` to both `style-src` and `connect-src` directives. The stylesheet fetch requires `style-src`; the preconnect requires `connect-src`.
- **Files modified:** `frontend/vite.config.ts` lines 9 and 11
- **Applied by:** Coordinator directly in worktree before re-running build
- **Commit:** 4a16ff8

## Known Stubs

None.

## Threat Flags

No new security-relevant surface beyond the plan's threat model. `fonts.googleapis.com` is a trusted CDN; its addition to `style-src` and `connect-src` is consistent with the accepted `'unsafe-inline'` tradeoff (T-20-03-02).

## Self-Check: PASSED

- `frontend/vite.config.ts` modified and committed at 4a16ff8
- Commit 4a16ff8: `fix(20-03): inject CSP meta tag via Vite transformIndexHtml plugin (SEC-04)`
- 13/13 rollup entry point HTML files contain exactly 1 CSP meta tag
- typecheck: exit 0
- test:run: 97/97
- Browser: 0 CSP violations
