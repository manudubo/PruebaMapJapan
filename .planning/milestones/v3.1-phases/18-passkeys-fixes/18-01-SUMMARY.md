---
plan: 18-01
phase: 18
status: complete
self_check: PASSED
completed_at: "2026-07-06"
---

# Plan 18-01 Summary — Passkeys Spec: Selector Fixes + afterEach Cleanup

## What Was Built

Two targeted fixes to `tests/e2e/passkeys.spec.ts` — no production code changed.

**Task 1 — Selector alignment** (`a189ff2`):
- Register button locator: added `#btn-add-passkey, button:has-text("Add passkey")` to the existing fallback list (3 occurrences). The actual profile.html button has `id="btn-add-passkey"` — the spec's original selectors never matched it.
- Guard message locator: added `[data-passkey-guard]` to the fallback list (1 occurrence). The profile.ts `openDeleteConfirm` already sets this attribute on the guard button when `credentialCount === 1`.

**Task 2 — afterEach cleanup registry** (`a0872b7`, PASS-01):
- Added `import type { BrowserContext } from '@playwright/test'`
- Added `cdpCleanups` array + `test.afterEach` hook inside `test.describe('Passkey flows')`. The hook drains the registry unconditionally with try/catch, so a mid-test failure cannot leave a stale virtual authenticator for the next test.
- All 3 tests push `{ cdp, authenticatorId[, context] }` after each `addVirtualAuthenticator` call.
- Removed inline `removeVirtualAuthenticator` calls from all 3 test bodies.
- Test 2 keeps `await cleanContext.close()` in the test body for the success path; the afterEach entry with `context: cleanContext` handles the failure path.

## Key Files

- `tests/e2e/passkeys.spec.ts` — modified

## Commits

- `a189ff2` — fix(18-01): add #btn-add-passkey and [data-passkey-guard] selector fallbacks
- `a0872b7` — fix(18-01): move removeVirtualAuthenticator to afterEach (PASS-01)

## Verification

- `npm run typecheck --workspace=frontend` → exit 0
- `rg "removeVirtualAuthenticator" tests/e2e/passkeys.spec.ts` → 1 match (afterEach only)
- `rg "cdpCleanups.push" tests/e2e/passkeys.spec.ts` → 4 matches (3 tests × 1 push each, plus 1 extra in test 2 for cleanContext)
- `rg "btn-add-passkey" tests/e2e/passkeys.spec.ts` → 3 matches
- `rg "data-passkey-guard" tests/e2e/passkeys.spec.ts` → 2 matches (type annotation + locator)

## Self-Check: PASSED
