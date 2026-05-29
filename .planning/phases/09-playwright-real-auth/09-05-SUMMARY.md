---
phase: 09-playwright-real-auth
plan: 05
status: complete
completed: 2026-05-28
---

# Plan 09-05 Summary — auth.spec.ts Real-Auth Migration + CI SKIP_REAL_AUTH

## What was done

**Task 1 — auth.spec.ts real-auth describe block:**
- Added `import * as fs` and `import * as path` at top of file
- Appended `'Auth flow — real session'` describe block after the existing 5 mocked tests
- Block contains: `test.skip(!!process.env.SKIP_REAL_AUTH)`, `sessionEntries` IIFE (try/catch safe), `test.use({ storageState: '.auth/user.json' })`, `addInitScript` in beforeEach for sessionStorage replay (#31108)
- Two real-auth tests: "authenticated dashboard does not show login prompt" + "authenticated dashboard renders trips grid"

**Task 2 — CI workflow:**
- Added `env: SKIP_REAL_AUTH: 'true'` to "Run E2E tests (chromium only)" step in `.github/workflows/ci.yml`
- No other CI steps modified

## Verification

All must_haves satisfied:
- Existing 5 mocked tests unchanged ✓
- Real-auth describe block with SKIP_REAL_AUTH guard ✓
- `addInitScript` wired in beforeEach ✓
- CI step has `SKIP_REAL_AUTH: 'true'` ✓
- 82 total tests listed (73 original + 9 new) ✓
