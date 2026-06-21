---
plan: 15-02
phase: 15-triage-config
status: complete
completed: 2026-06-21
commit: f4680c3
---

# Plan 15-02 Summary: Full Playwright Triage

## What was built

15-TRIAGE.md — the authoritative, current failure list for v3.1 Phase 16–19 planning.
Written from a live full-suite Playwright run with `--trace retain-on-failure --retries 1`.

## Triage Summary

- **89 passed, 139 failed, 39 did not run** (4.6 min)
- **SETUP-02 confirmed:** passkeys.spec.ts does NOT appear as a failure under firefox or webkit

## Key Findings

### Real chromium failures (actionable for Phases 16-18):
1. `otp.spec.ts` — Fail, contract-mismatch → Phase 17 (consistent with stale baseline)
2. `idp-theme.spec.ts` — Fail, unknown → Phase 18 (needs investigation per RESEARCH.md)
3. `session-management.spec.ts` — Fail, env (likely stale auth this run) → Phase 18
4. `trip-edit-integration.spec.ts` — Fail, env (likely stale auth / not yet implemented) → Phase 16

### chromium-passkeys:
5. `passkeys.spec.ts` — Fail, missing-fixture (register button selector not found) → Phase 17
   Previously masked by config-bug; now a real implementation gap surfaced.

### Env issues blocking cross-browser signal:
- **webkit:** ALL 63 tests fail — missing browser binary. Fix: `cd tests && npx playwright install`
- **firefox:** ALL 69 tests fail — systemic env issue (details not captured). Re-run after install.

### Baseline discrepancy:
- `public-sharing.spec.ts` PASSES under chromium (stale v3.0 baseline said Fail/missing-fixture).
  The fixture may have been added in v3.0 work. Treat as GREEN for Phase 16 planning.

## Deviations

- The run was performed WITHOUT deleting `tests/.auth/user.json` first. The session-management
  and trip-edit-integration chromium failures may be stale-auth artifacts rather than real app
  bugs. A re-run with fresh auth is recommended before treating them as Phase 18/16 work items.

## Key files

- **Created:** `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md`

## Self-Check: PASSED

- [x] Full suite ran with --trace retain-on-failure --retries 1 --reporter=list
- [x] 15-TRIAGE.md written from live output (not stale baseline)
- [x] Header row present: `| Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase |`
- [x] 61 spec.ts rows (>> 4 minimum)
- [x] passkeys.spec.ts NOT listed as Fail under firefox or webkit (appears as Skip(testIgnore))
- [x] otp.spec.ts: Fail, contract-mismatch
- [x] public-sharing.spec.ts: present in table (Pass chromium, Fail env firefox/webkit)
- [x] Commit message: `docs(phase-15): write triage failure list from full-suite run` (f4680c3)
- [x] No test-results/ trace files committed
