# Phase 15: Triage + Config — Discussion Log

**Session date:** 2026-06-21
**Workflow:** /gsd-discuss-phase 15

## Gray Areas Identified

Three implementation decisions were open before writing CONTEXT.md.

---

## Decision 1: Triage config method

**Question:** Should `trace: 'retain-on-failure'` and `retries: 1` be applied via (A) CLI flags, (B) committing a config change and reverting, or (C) an env-var guard in `playwright.config.ts`?

**Decision: CLI flags only.**

Command: `npx playwright test --trace retain-on-failure --retries 1`

Rationale: Triage is a one-time diagnostic run. Committing ephemeral settings and reverting adds noise to git history. The existing local values (`trace: 'on-first-retry'`, `retries: 0`) are correct for normal development and should not be changed.

---

## Decision 2: Failure list format

**Question:** What form does the "written failure list" take — a phase-dir markdown file, inline REQUIREMENTS.md annotations, or just the HTML report?

**Decision: `15-TRIAGE.md` in the phase directory.**

File: `.planning/milestones/v3.1-phases/15-triage-config/15-TRIAGE.md`

Per-spec table with columns: Spec | Project(s) | Pass/Fail/Flaky | Failure Mode | Suggested Phase

Rationale: A standalone file is self-contained, survives future REQUIREMENTS.md restructuring, and gives downstream phases a single authoritative source to reference.

---

## Decision 3: Order of operations (SETUP-02 before SETUP-01)

**Question:** Should the passkeys scoping fix (SETUP-02) be applied before or after the triage run?

**Decision: Fix SETUP-02 first, then run SETUP-01.**

Order: (1) add `testIgnore: ['**/passkeys.spec.ts']` to chromium/firefox/webkit, commit; (2) run full triage; (3) write 15-TRIAGE.md.

Rationale: Passkeys false-positives under firefox/webkit are a known config artifact, not an app failure. Running triage with this bug present would contaminate the failure list with noise that the planner/fixer would have to filter out manually. Fix first, get clean signal.
