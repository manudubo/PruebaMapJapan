---
plan: 15-01
phase: 15-triage-config
status: complete
completed: 2026-06-21
commit: 68cd447
---

# Plan 15-01 Summary: Scope passkeys spec to chromium-passkeys

## What was built

Added `testIgnore: ['**/passkeys.spec.ts']` to the chromium, firefox, and webkit project
entries in `tests/playwright.config.ts`. The chromium-passkeys project retains its existing
`testMatch: ['**/passkeys.spec.ts']` unchanged.

## Why

`passkeys.spec.ts` uses `page.context().newCDPSession()` and `WebAuthn.enable` — a
Chromium-only CDP API. Firefox and webkit cannot execute these calls. Before this fix, every
passkeys test appeared as a failure under all three general projects, polluting triage signal
with config-bug false positives.

## Outcome

- Smoke check: `npx playwright test tests/e2e/passkeys.spec.ts --project=firefox --reporter=list`
  → "No tests found" (expected; testIgnore active)
- 3 occurrences of `testIgnore` in playwright.config.ts (one per general project)
- `testMatch` on chromium-passkeys entry unchanged
- Commit: `fix(e2e): scope passkeys spec to chromium-passkeys project only` (68cd447)
- Only `tests/playwright.config.ts` in commit diff

## Key files

- **Modified:** `tests/playwright.config.ts` — added testIgnore to 3 project entries

## Self-Check: PASSED

All acceptance criteria verified:
- [x] 3 testIgnore occurrences (grep -c confirms 3)
- [x] testMatch on chromium-passkeys only
- [x] Smoke check exits with "No tests found" under firefox
- [x] Commit message matches exactly
- [x] Only playwright.config.ts in commit diff
