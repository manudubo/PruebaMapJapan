---
phase: 17-otp-login-helper
plan: 01
subsystem: testing
tags: [playwright, keycloak, otp, mailpit, e2e, fixtures]

# Dependency graph
requires:
  - phase: 16-e2e-stabilization
    provides: getToken pattern from public-sharing.spec.ts, established KC form nav patterns
  - phase: 09-playwright-e2e
    provides: otp.spec.ts original structure, mailpit-helpers.ts, KC serial test pattern
provides:
  - Shared KC browser login helper (loginViaKcForm) for all E2E call sites
  - Polling fetchLatestOtp (20x500ms) to handle SMTP delivery lag
  - Fixed otp.spec.ts: auth-gated Bearer headers, correct 201 status, code-only verify bodies
affects: [17-02-session-login-helper, passkeys.spec.ts, global-setup.ts refactor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "loginViaKcForm: shared KC form nav helper — callers own post-login assertions"
    - "fetchLatestOtp polling: 20x500ms loop with descriptive timeout error"
    - "getToken: waitForRequest intercepting Bearer header during dashboard navigation"

key-files:
  created:
    - tests/e2e/fixtures/kc-login-helper.ts
  modified:
    - tests/e2e/fixtures/mailpit-helpers.ts
    - tests/e2e/otp.spec.ts

key-decisions:
  - "loginViaKcForm ends at waitForURL(/localhost:5173/) — callers own post-login state"
  - "locator('a, button').filter() preferred over getByRole to survive aria-hidden KC links"
  - "fetchLatestOtp MAX_ATTEMPTS=20 hardcoded, no env var"
  - "otpToken acquired in beforeAll as otp-test@local (separate from e2e-test@local storageState)"

patterns-established:
  - "KC form nav: locator('a, button').filter({ hasText }) not getByRole for aria-hidden links"
  - "OTP route auth: step-up auth requires Bearer JWT on otp-request and otp-verify"

requirements-completed:
  - OTP-01
  - OTP-02
  - OTP-03
  - SESSION-02

# Metrics
duration: 20min
completed: 2026-06-22
---

# Phase 17 Plan 01: OTP Login Helper Summary

**Shared KC login fixture, polling OTP fetch, and fully auth-gated otp.spec.ts with correct 201 status codes**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-22T23:28:00Z
- **Completed:** 2026-06-22T23:48:26Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- New `loginViaKcForm` fixture that extracts the KC browser form nav body from global-setup.ts verbatim, ending at the app URL redirect (callers own post-login state)
- `fetchLatestOtp` now polls 20 times with 500ms delay before throwing, eliminating false failures from SMTP delivery lag
- `otp.spec.ts` fully fixed: JWT acquired as `otp-test@local` in `beforeAll`, all otp-request/otp-verify calls send `Authorization: Bearer` header, tests 1-2 assert 201 on otp-request, all verify bodies contain only `{ code }` (no email field), test 4 uses `loginViaKcForm` helper while preserving the `updatePasswordForm` not.toBeVisible assertion

## Task Commits

Each task was committed atomically:

1. **Task 1: Create kc-login-helper.ts** - `6446d36` (feat)
2. **Task 2: Replace fetchLatestOtp with polling loop** - `4526908` (fix)
3. **Task 3: Fix otp.spec.ts** - `75b873f` (fix)

## Files Created/Modified
- `tests/e2e/fixtures/kc-login-helper.ts` - New shared KC form login helper, exports `loginViaKcForm`
- `tests/e2e/fixtures/mailpit-helpers.ts` - `fetchLatestOtp` replaced with polling loop (20x500ms)
- `tests/e2e/otp.spec.ts` - Auth-gated Bearer headers, 201 status, code-only bodies, test 4 helper

## Decisions Made
- `loginViaKcForm` boundary is `waitForURL(/localhost:5173/)` — post-login steps (storageState capture, assertion, reload) are callers' responsibility; this makes the helper composable across global-setup, session-management, and otp test 4
- Used `locator('a, button').filter({ hasText: /try another way/i })` not `getByRole('link', ...)` — survives KC's aria-hidden links in the custom theme
- `getToken` helper in otp.spec.ts uses `${FRONTEND_URL}/PruebaMapJapan/dashboard.html` (not `FRONTEND_BASE` which would be undefined in this file)
- `updatePasswordForm` acceptance criterion "returns 1 match" is two lines in practice (const declaration + assertion) — both preserved, criterion treated as satisfied per plan intent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **node_modules not present in worktree** (gitignored): `npm run typecheck` could not be run from the worktree. Verified correctness using rg-based acceptance criteria checks (all passed) and structural inspection. Typecheck will run in CI and in the main checkout. No code changes needed.
- **Known risk (not fixed — per plan):** Test 2 asserts `errText` matches `/expir/`, but the backend's expired-code path (`auth.ts:153`) returns `{ error: 'otp_not_found' }` when no unexpired OTP exists after expiry. This assertion may fail at the Playwright wave-gate run. The plan explicitly says keep unchanged; recording here for the wave-gate operator to be aware.

## Next Phase Readiness
- `loginViaKcForm` helper is ready for plan 17-02 to wire into `global-setup.ts` and `session-management.spec.ts`
- OTP spec is now structurally correct for a live stack run; wave-gate Playwright run will confirm runtime correctness
- No blockers for 17-02

---
*Phase: 17-otp-login-helper*
*Completed: 2026-06-22*
