---
phase: 09-playwright-real-auth
plan: 01
subsystem: testing
tags: [playwright, keycloak, mailpit, postgres, e2e, gitignore]

# Dependency graph
requires:
  - phase: 08-demo-trip-seed
    provides: email_otp_codes Postgres table (clearOtpCodes fixture target)
  - phase: 07-passkey-login
    provides: japan-trip-worker KC client (KC_ADMIN_CLIENT_ID/SECRET)
provides:
  - tests/.auth/ gitignored (no JWT token leaks)
  - tests/.env.test gitignored (no client secret leaks)
  - tests/.env.test.example documenting all 12 required env vars
  - @playwright/test@1.60.0 in tests workspace
  - @keycloak/keycloak-admin-client@26.6.2 in tests workspace
  - postgres npm package in tests workspace
  - mailpit-helpers.ts with verified field names: messages (list wrapper), ID (message id), Text (plain text body)
affects:
  - 09-02 through 09-07 (all depend on env template and upgraded deps)

# Tech tracking
tech-stack:
  added:
    - "@playwright/test@1.60.0 (upgraded from ^1.48.0)"
    - "@keycloak/keycloak-admin-client@26.6.2"
    - "postgres (porsager) for clearOtpCodes direct DB access"
  patterns:
    - "tests workspace npm install via --prefix flag"
    - "gitignore belt-and-suspenders: tests/.auth/ and tests/.env.test both excluded"

key-files:
  created:
    - tests/.env.test.example
    - tests/e2e/fixtures/mailpit-helpers.ts
  modified:
    - .gitignore (added tests/.auth/ and tests/.env.test)
    - tests/package.json (upgraded playwright, added kc-admin-client + postgres)
    - tests/package-lock.json

key-decisions:
  - "postgres (porsager) chosen over pg for clearOtpCodes — leaner, zero deps, idiomatic tagged templates"
  - "@keycloak/keycloak-admin-client goes in dependencies (not devDependencies) — npm install default behavior for tests workspace"

patterns-established:
  - "Pattern: tests workspace deps installed with npm install --prefix tests"

requirements-completed: []  # E2E-01 and E2E-04 partially addressed; full completion requires Task 2

# Metrics
duration: 15min
completed: 2026-05-27
---

# Phase 09 Plan 01: Gitignore + Env Template + Dependency Install Summary

**Playwright 1.60.0 + KC Admin client 26.6.2 + postgres installed in tests workspace; .auth/ and .env.test gitignored; 12-var env template committed; mailpit-helpers.ts written with verified field names (messages, ID, Text)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-27T00:00:00Z
- **Completed:** 2026-05-27T00:15:00Z
- **Tasks:** 2 of 2 complete
- **Files modified:** 4

## Accomplishments

- Added `tests/.auth/` and `tests/.env.test` to root `.gitignore` — closes security gap identified in RESEARCH.md Pitfall 3 (T-09-01, T-09-02)
- Created `tests/.env.test.example` with all 12 required env vars including `POSTGRES_URL` for `clearOtpCodes()`
- Upgraded `@playwright/test` from `^1.48.0` to `1.60.0` — verified with `--list` (219 tests, 0 parse errors)
- Installed `@keycloak/keycloak-admin-client@26.6.2` and `postgres` (porsager) in tests workspace

## Task Commits

1. **Task 1: Gitignore + env template + dependency install** - `43906df` (feat)
2. **Task 2: Spike Mailpit response shape + write mailpit-helpers.ts** - `62458cb` (feat) — field names verified by human: `messages` (list wrapper), `ID` (message id), `Text` (plain text body)

**Plan metadata:** (committed below with SUMMARY.md)

## Files Created/Modified

- `.gitignore` - Added `tests/.auth/` and `tests/.env.test` (after `tests/playwright-report/` line)
- `tests/.env.test.example` - All 12 required env vars with placeholder values (safe to commit)
- `tests/package.json` - @playwright/test ^1.60.0, @keycloak/keycloak-admin-client ^26.6.2, postgres ^3.4.9
- `tests/package-lock.json` - Lockfile updated for all three packages
- `tests/e2e/fixtures/mailpit-helpers.ts` - Created with verified Mailpit API types: `messages` list wrapper, `ID` per-message field, `Text` plain-text body

## Decisions Made

- Used `postgres` (porsager) over `pg` for clearOtpCodes — RESEARCH.md Pattern 7 recommended it; leaner for one-off queries with tagged template literals
- `@keycloak/keycloak-admin-client` landed in `dependencies` (not `devDependencies`) — npm default; acceptable for test workspace (private: true, never published)

## Deviations from Plan

None - plan executed exactly as written for Task 1.

Note: `tests/.auth/.gitkeep` was not committed — the directory is correctly gitignored, so the .gitkeep inside it is also gitignored. The gitignore entry itself is the artifact, not the directory placeholder.

## Issues Encountered

None for Task 1.

## Task 2: Mailpit Field Names Verified

Human verified Mailpit API response shapes via live API calls:

- `GET /api/v1/messages` returns `{ messages: [...] }` — lowercase `messages` key wrapping the array
- Each message object has `ID` (uppercase string) for the message identifier
- `GET /api/v1/message/{id}` returns object with `Text` field (uppercase) for plain text body

The OTP regex `msg.Text.match(/(\d{6})/)` is correct. `mailpit-helpers.ts` committed with these verified types.

## Known Stubs

None — `mailpit-helpers.ts` is now complete with verified field names.

## Threat Flags

No new threat surface introduced beyond what's documented in the plan's threat model (T-09-01 and T-09-02 are now mitigated by the gitignore additions).

## Self-Check

Files exist:
- [x] `.gitignore` contains `tests/.auth/` — verified
- [x] `.gitignore` contains `tests/.env.test` — verified
- [x] `tests/.env.test.example` exists with `POSTGRES_URL` — verified
- [x] `tests/package.json` contains all three deps — verified
- [x] `npx playwright test --list` exits 0 with SKIP_REAL_AUTH=true (219 tests) — verified
- [x] `tests/e2e/fixtures/mailpit-helpers.ts` exports `purgeInbox` and `fetchLatestOtp` — verified

Commits:
- [x] `62458cb` — feat(09-01) mailpit-helpers commit verified in git log

Commits:
- [x] `43906df` — feat(09-01) commit verified in git log

## Self-Check: PASSED

## Next Phase Readiness

- All Wave 1 deps are installed; Wave 2 plans (02, 03) can proceed in parallel once Task 2 is resolved
- `tests/.auth/` directory structure is gitignored and ready for globalSetup to create at runtime
- `.env.test.example` is the source of truth for all env vars needed by Phase 9 tests

---
*Phase: 09-playwright-real-auth*
*Completed: 2026-05-27*
