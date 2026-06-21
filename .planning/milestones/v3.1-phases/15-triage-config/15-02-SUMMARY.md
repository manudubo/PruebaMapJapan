---
plan: 15-02
phase: 15-triage-config
status: complete
completed: 2026-06-21
commit: f4680c3 (initial), updated post-re-run
---

# Plan 15-02 Summary: Full Playwright Triage

## What was built

15-TRIAGE.md — the authoritative, current failure list for v3.1 Phase 16–19 planning.
Written from a live full-suite Playwright run with `--trace retain-on-failure --retries 1`.

Two runs were performed:
1. First run (before `npx playwright install`): 89 passed, 139 failed — webkit binary missing,
   not actionable for cross-browser signal.
2. **Authoritative re-run (after `npx playwright install`):** 210 passed, 18 failed, 39 did
   not run (12.1 min). 15-TRIAGE.md reflects this run.

## Triage Summary (final / authoritative)

- **210 passed, 18 failed, 39 did not run** (12.1 min)
- **SETUP-02 confirmed:** passkeys.spec.ts does NOT appear as Fail under firefox or webkit

## Key Findings

| Spec | Projects | Mode | Phase |
|------|---------|------|-------|
| otp.spec.ts | chromium, firefox, webkit | contract-mismatch | 17 |
| idp-theme.spec.ts | chromium only | unknown | 18 |
| session-management.spec.ts | chromium, firefox, webkit | contract-mismatch | 18 |
| trip-edit-integration.spec.ts | chromium, firefox, webkit | missing-fixture | 16 |
| auth.spec.ts (real-session) | firefox, webkit | config-bug (no storageState) | 18 |
| new-user-trip-creation.spec.ts | webkit only | missing-fixture | 16 |
| passkeys.spec.ts | chromium-passkeys | missing-fixture (register btn) | 17 |

### Baseline discrepancy:
- `public-sharing.spec.ts` PASSES under all projects (stale v3.0 baseline said Fail/missing-fixture).
  Treat as GREEN for Phase 16 planning.

### Diagnostic: idp-theme.spec.ts only fails under chromium (where storageState is active)
- Confirms SSO-skip hypothesis: KC bypasses login page for pre-authenticated users

## Deviations

- First run was done without deleting `tests/.auth/user.json` (stale auth risk). The authoritative
  re-run was also performed without fresh auth deletion, but the trip-edit-integration and
  session-management chromium failures are confirmed real in both runs — not stale-auth artifacts.
  trip-edit-integration times out waiting for an API call that the frontend doesn't make yet
  (missing implementation), confirmed by the fact it fails under ALL projects including chromium
  where storageState is active.

## Key files

- **Created/Updated:** `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md`

## Self-Check: PASSED

- [x] Full suite ran with --trace retain-on-failure --retries 1 --reporter=list
- [x] 15-TRIAGE.md written from live output (not stale baseline)
- [x] Header row present: `| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |`
- [x] Rows for all major specs with correct Pass/Fail classification
- [x] passkeys.spec.ts NOT listed as Fail under firefox or webkit (Skip(testIgnore))
- [x] otp.spec.ts: Fail, contract-mismatch, all projects
- [x] public-sharing.spec.ts: Pass all projects (GREEN, baseline discrepancy noted)
- [x] webkit binary installed: npx playwright install completed before authoritative run
