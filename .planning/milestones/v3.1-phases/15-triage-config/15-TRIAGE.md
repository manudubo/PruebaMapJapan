# Phase 15 Triage — Full Suite Run

**Date:** 2026-06-21
**Config:** Post-SETUP-02 (passkeys scoped to chromium-passkeys)
**Command:** `npx playwright test --trace retain-on-failure --retries 1 --reporter=list`
**Traces:** `tests/test-results/` (not committed)
**Summary:** 89 passed, 139 failed, 39 did not run (4.6 min)

> **Critical env prerequisite not satisfied:** webkit browser binary is missing.
> Run `npx playwright install` in `tests/` before the next triage to unblock webkit.
> All 63 webkit failures below are binary-missing errors — not real test failures.
> All 69 firefox failures are systemic (detailed errors not captured in this excerpt;
> re-run after `npx playwright install` to isolate real firefox failures from env noise).

## Failure Table

| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |
|------|-----------|-----------------|--------------|-----------------|
| accessibility.spec.ts | chromium | Pass | N/A | N/A |
| accessibility.spec.ts | firefox | Fail | env | N/A |
| accessibility.spec.ts | webkit | Fail | env | N/A |
| auth.spec.ts | chromium | Pass | N/A | N/A |
| auth.spec.ts | firefox | Fail | env | N/A |
| auth.spec.ts | webkit | Fail | env | N/A |
| city-pages.spec.ts | chromium | Pass | N/A | N/A |
| city-pages.spec.ts | firefox | Fail | env | N/A |
| city-pages.spec.ts | webkit | Fail | env | N/A |
| geocoder.spec.ts | chromium | Pass | N/A | N/A |
| geocoder.spec.ts | firefox | Fail | env | N/A |
| geocoder.spec.ts | webkit | Fail | env | N/A |
| idp-theme.spec.ts | chromium | Fail | unknown | Phase 18 |
| idp-theme.spec.ts | firefox | Fail | env | N/A |
| idp-theme.spec.ts | webkit | Fail | env | N/A |
| landing.spec.ts | chromium | Pass | N/A | N/A |
| landing.spec.ts | firefox | Fail | env | N/A |
| landing.spec.ts | webkit | Fail | env | N/A |
| new-user-trip-creation.spec.ts | chromium | Pass | N/A | N/A |
| new-user-trip-creation.spec.ts | firefox | Fail | env | N/A |
| new-user-trip-creation.spec.ts | webkit | Fail | env | N/A |
| otp.spec.ts | chromium | Fail | contract-mismatch | Phase 17 |
| otp.spec.ts | firefox | Fail | env | N/A |
| otp.spec.ts | webkit | Fail | env | N/A |
| passkeys.spec.ts | chromium-passkeys | Fail | missing-fixture | Phase 17 |
| passkeys.spec.ts | chromium / firefox / webkit | Skip(testIgnore) | N/A | N/A |
| public-sharing.spec.ts | chromium | Pass | N/A | N/A |
| public-sharing.spec.ts | firefox | Fail | env | N/A |
| public-sharing.spec.ts | webkit | Fail | env | N/A |
| pwa.spec.ts | chromium | Pass | N/A | N/A |
| pwa.spec.ts | firefox | Fail | env | N/A |
| pwa.spec.ts | webkit | Fail | env | N/A |
| search.spec.ts | chromium | Pass | N/A | N/A |
| search.spec.ts | firefox | Fail | env | N/A |
| search.spec.ts | webkit | Fail | env | N/A |
| session-management.spec.ts | chromium | Fail | env | Phase 18 |
| session-management.spec.ts | firefox | Fail | env | N/A |
| session-management.spec.ts | webkit | Fail | env | N/A |
| trip-edit-integration.spec.ts | chromium | Fail | env | Phase 16 |
| trip-edit-integration.spec.ts | firefox | Fail | env | N/A |
| trip-edit-integration.spec.ts | webkit | Fail | env | N/A |
| trip-edit.spec.ts | chromium | Pass | N/A | N/A |
| trip-edit.spec.ts | firefox | Fail | env | N/A |
| trip-edit.spec.ts | webkit | Fail | env | N/A |
| trips.spec.ts | chromium | Pass | N/A | N/A |
| trips.spec.ts | firefox | Fail | env | N/A |
| trips.spec.ts | webkit | Fail | env | N/A |
| ui-consistency.spec.ts | chromium | Pass | N/A | N/A |
| ui-consistency.spec.ts | firefox | Fail | env | N/A |
| ui-consistency.spec.ts | webkit | Fail | env | N/A |

## Chromium Failure Detail

These are the 4 real (non-env) chromium failures plus the passkeys failure:

### otp.spec.ts [chromium] — contract-mismatch → Phase 17
Consistent with the v3.0 stale baseline. `otp-request` and `otp-verify` routes are gated
behind `authMiddleware` (`backend/src/routes/auth.ts:92`). The spec calls them unauthenticated
with `{email, code}` via bare `request` fixture, which cannot carry a Bearer JWT.
Resolution requires a product decision: step-up auth (intentional) vs regression (fix route
to be public).

### idp-theme.spec.ts [chromium] — unknown → Phase 18
"login theme hides default header and renders app exit action" — detailed error not captured
in excerpt. Candidates from RESEARCH.md: SSO session skip (storageState causes KC to bypass
login page), PKCE `code_challenge=aaa...` rejection by KC 26, or `#kc-header-wrapper` absent
in KC 26 login template. Low-risk spec; see RESEARCH.md §Additional Stack Findings for
pre-emptive fixes.

### session-management.spec.ts [chromium] — env → Phase 18
"login creates a KC server-side session" (90 s timeout). KC log shows
`"error":"user_session_not_found"` — KC rejected the token lookup. Likely caused by stale
`tests/.auth/user.json` (the auth file was NOT deleted before this run). Re-run with a
fresh auth file before classifying as a real failure. If it still fails, likely the fragile
`loginViaKcForm()` KC-form navigation pattern (see RESEARCH.md §Structural Risk).

### trip-edit-integration.spec.ts [chromium] — env → Phase 16
"P2-V1: trip-edit page loads; metadata form pre-fills from API @integration" — timed out
at 90 s waiting for `waitForRequest(url includes /api/ AND header Authorization: Bearer)`.
Likely caused by stale auth (same run, same user.json issue as session-management).
Also possibly a spec testing functionality not yet wired (Phase 16 scope).
NEWLY INTRODUCED: not in v3.0 stale failure list.

### passkeys.spec.ts [chromium-passkeys] — missing-fixture → Phase 17
All 3 passkey tests timeout waiting for:
`[data-action="register-passkey"], #register-passkey-btn, button:has-text("Register passkey")`
The register passkey button does not exist or does not match any of these selectors on the
profile page. This is a newly surfaced failure — SETUP-02 removed the config-bug (firefox/
webkit false failures) and exposed the underlying implementation gap. RESEARCH.md flags
`waitForTimeout` usage (passkeys.spec.ts:44,79,156) should be replaced with
`expect(locator).toBeEnabled({ timeout: 15_000 })`.

## Notes

### webkit: ALL 63 tests fail — env (missing binary)
```
Error: browserType.launch: Executable doesn't exist at
  C:\Users\manud\AppData\Local\ms-playwright\webkit-2287\Playwright.exe
```
Fix: `cd tests && npx playwright install`
This unblocks all webkit tests. webkit failures in this run carry ZERO signal about
application correctness.

### firefox: ALL 69 tests fail — env (systemic, cause unknown)
All firefox tests fail, including trivially public tests (landing page h1, skip link,
countdown timer) that cannot be auth-related. The detailed error messages for firefox
failures were not captured in the output excerpt provided. Candidates:
- Missing or broken firefox binary (run `npx playwright install` to verify)
- Firefox connectivity to localhost:5173 blocked on this machine
- Cascading failure from global-setup.ts (if beforeAll fails, all tests in a file may not run)
Re-run after `npx playwright install` and include the full output to classify.

### SETUP-02 confirmed: passkeys.spec.ts NOT in firefox/webkit failures
passkeys.spec.ts does not appear as a failure under firefox or webkit in this run.
SETUP-02 (`fix(e2e): scope passkeys spec to chromium-passkeys project only`) is confirmed
working. testIgnore exclusion is active.

### BASELINE DISCREPANCY: public-sharing.spec.ts passes under chromium
The v3.0 stale baseline listed `public-sharing.spec.ts` as Fail (missing-fixture).
This run shows it PASSES under chromium. Either the fixture was added during v3.0 work or
the stale baseline entry was inaccurate. Phase 16 planners should treat public-sharing.spec.ts
chromium as GREEN until a real failure is observed.

### 39 tests did not run
Playwright reports 39 tests as "did not run". These are likely tests skipped by
`test.skip()` / `test.fixme()` calls, or tests whose `beforeAll` hook failed causing
the remaining tests in that file to be aborted. Requires full output inspection to classify.

### Stale auth (tests/.auth/user.json) — re-run recommendation
This triage run did NOT delete `tests/.auth/user.json` before starting. The session-management
and trip-edit-integration chromium failures are likely `env` artifacts of stale auth rather
than real app bugs. Before treating these as Phase 18/16 work items, re-run with a fresh
auth file:
```powershell
Remove-Item tests\.auth\user.json
cd tests
$env:PLAYWRIGHT_HTML_OPEN='never'; npx playwright test --trace retain-on-failure --retries 1 --reporter=list
```
If session-management and trip-edit-integration still fail, escalate to real triage items.
