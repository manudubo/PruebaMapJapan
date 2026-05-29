---
phase: 09-playwright-real-auth
plan: 03
status: complete
completed: 2026-05-28
---

# Plan 09-03 Summary — globalSetup OIDC Login + playwright.config.ts

## What was done

**Task 1 — global-setup.ts OIDC login block:**
- Added `dotenv.config()` at top to load `.env.test` before any env var access
- Added `isStorageStateFresh()`: checks `.auth/user.json` mtime vs 50-min MAX_AGE_MS
- Added `kcLogin()`: headless Chromium PKCE login via keycloak-js redirect, writes both `storageState` (user.json) and sessionStorage entries (session.json) for bug #31108 workaround
- Added `SKIP_REAL_AUTH` guard in globalSetup body — KC login skipped entirely in CI

**Task 2 — playwright.config.ts:**
- `chromium` project: conditional `storageState: '.auth/user.json'` only when `SKIP_REAL_AUTH` is absent
- Added `chromium-passkeys` project scoped to `testMatch: ['**/passkeys.spec.ts']` — no storageState (passkey tests manage auth per-test)

## Verification

All must_haves satisfied:
- `kcLogin` in global-setup.ts ✓
- `SKIP_REAL_AUTH` guard ✓
- `session.json` write via `Object.entries(sessionStorage)` ✓
- `chromium-passkeys` project in playwright.config.ts ✓
- conditional `storageState` on chromium project ✓

## Decisions / notes

- Agent hit session limit before committing; work was completed by orchestrator in same worktree
- `isStorageStateFresh()` uses mtime (50-min window) — simpler than KC token introspection, sufficient for local dev (D-02)
- `kcLogin()` uses `page.getByLabel` role selectors — KC login form uses standard `<label>` elements
