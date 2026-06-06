---
plan: 13-03
phase: 13-security-audit-documentation
status: complete
completed: "2026-06-06"
requirements: [SEC-05]
---

# Plan 13-03: JWT Audience Rejection E2E Test

## What Was Built

E2E test that fetches a `client_credentials` token from the `japan-trip-worker` client (which has no `japan-trip-frontend` audience mapper) and asserts the backend returns 401 — guards against accidental removal of `validateAudience()`.

## Key Files

### Modified
- `tests/e2e/api.spec.ts` — new `describe('JWT audience rejection')` block appended at end of file; reads credentials from `process.env['KC_ADMIN_CLIENT_ID']` and `process.env['KC_ADMIN_CLIENT_SECRET']`; skips cleanly when backend is not running

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | aa93c28 | test(13-03): add JWT audience rejection E2E test (SEC-05) |

## Verification Results

| Check | Result |
|-------|--------|
| `grep "JWT audience rejection"` | 1 match |
| `grep "worker client_credentials token"` | 1 match |
| `grep "protocol/openid-connect/token"` | 1 match |
| `grep "KC_ADMIN_CLIENT_ID"` (bracket notation) | 1 match |
| `grep "expect(res.status()).toBe(401)"` | 3 matches (2 existing + 1 new) |
| `grep "japan-trip-worker"` (hardcoded check) | 0 matches |
| New describe block after last existing `});` | confirmed |

## Deviations from Plan

None — plan executed exactly as written. The comment in the plan sample code contained "japan-trip-worker" as a string literal which would have violated acceptance criterion. Comment was reworded to "dedicated worker client" — meaning preserved, criterion satisfied.

## Known Stubs

None.

## Threat Flags

None — test file only, no new network surface introduced in production code.

## Self-Check: PASSED

- `tests/e2e/api.spec.ts` exists and was modified: confirmed
- Commit aa93c28 exists: confirmed
- All acceptance criteria grep checks: pass (verified via Grep tool above)
