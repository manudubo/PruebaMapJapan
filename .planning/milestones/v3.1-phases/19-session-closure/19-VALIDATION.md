---
phase: 19
slug: session-closure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-13
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.60.0 |
| **Config file** | `tests/playwright.config.ts` |
| **Quick run command** | `npx playwright test session-management.spec.ts --project=chromium --trace retain-on-failure` |
| **Full suite command** | `npx playwright test --trace retain-on-failure --retries 1` (from `tests/`) |
| **Estimated runtime** | ~10 min (full suite with live stack) |

---

## Sampling Rate

- **After every task commit:** `npx playwright test --list` to verify fixme annotations; `npm run typecheck` for type safety
- **After every plan wave:** Full suite run (D-05) — this is also the phase gate
- **Before `/gsd-verify-work`:** Full suite must be green (0 unexplained failures)
- **Max feedback latency:** ~2 seconds (`--list` + typecheck)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | DOC-02 | storageState on firefox/webkit matches chromium | code inspection | `grep -c "storageState" tests/playwright.config.ts` | ✅ | ⬜ pending |
| 19-01-02 | 01 | 1 | DOC-01 | fixme annotations present in both spec files | `--list` | `npx playwright test --list 2>/dev/null \| grep fixme` | ✅ | ⬜ pending |
| 19-02-01 | 02 | 2 | SESSION-01 | session-management passes live | E2E (live stack) | `npx playwright test session-management.spec.ts --trace retain-on-failure` | ✅ | ⬜ pending |
| 19-02-02 | 02 | 2 | DOC-02 | full suite: 0 unexplained failures | E2E full suite | `npx playwright test --trace retain-on-failure --retries 1` | ✅ | ⬜ pending |
| 19-02-03 | 02 | 2 | DOC-02 | 19-CLOSURE.md written with actual results | file existence + content | `test -f .planning/milestones/v3.1-phases/19-session-closure/19-CLOSURE.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.planning/milestones/v3.1-phases/19-session-closure/19-CLOSURE.md` — created by 19-02 Task 3 after D-05 run

*All other test infrastructure is pre-existing. No new spec files or framework installs required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live stack D-05 run (KC+backend+frontend) | DOC-02 | Requires running services outside automated test execution | Start `docker compose up` (KC:8080), `npm run dev:backend` (8787), `npm run dev` (5173), delete `.auth/user.json`, then run `npx playwright test --trace retain-on-failure --retries 1` from `tests/` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (quick checks); full suite is the wave gate
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
