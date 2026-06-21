---
phase: 15
slug: triage-config
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright 1.60.0 (used to verify config change, not new tests) |
| **Config file** | `tests/playwright.config.ts` |
| **Quick run command** | `npx playwright test tests/e2e/passkeys.spec.ts --project=firefox --reporter=list` |
| **Full suite command** | `npx playwright test --trace retain-on-failure --retries 1 --reporter=list` (from `tests/`) |
| **Estimated runtime** | ~2 seconds (quick — 0 tests for passkeys under firefox); ~5–10 min (full triage) |

---

## Sampling Rate

- **After SETUP-02 commit:** Run `npx playwright test tests/e2e/passkeys.spec.ts --project=firefox --reporter=list` → expect "0 tests" (testIgnore excludes the file)
- **After SETUP-01 triage:** Verify `15-TRIAGE.md` exists and has content
- **Before `/gsd-verify-work`:** SETUP-02 config verified + 15-TRIAGE.md committed
- **Max feedback latency:** ~2 seconds for SETUP-02 verify; manual triage run time varies

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | SETUP-02 | — | N/A | structural | `cd tests && npx playwright test tests/e2e/passkeys.spec.ts --project=firefox --reporter=list` → "0 tests" | ✅ | ⬜ pending |
| 15-02-01 | 02 | 2 | SETUP-01 | — | N/A | manual | User runs `cd tests && npx playwright test --trace retain-on-failure --retries 1 --reporter=list`; writes 15-TRIAGE.md | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

SETUP-02 uses `npx playwright test` (already installed). SETUP-01 is a user-run diagnostic — no new test stubs needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full-suite triage run produces authoritative failure list | SETUP-01 | Requires live KC + Mailpit + Postgres — services must be up; automated executor cannot run this with env down | 1. `npm run dev` from repo root (starts Docker + KC + backend + frontend). 2. Delete `.auth/user.json` if > 20 min old. 3. `cd tests && npx playwright test --trace retain-on-failure --retries 1 --reporter=list`. 4. Write `15-TRIAGE.md` from stdout output. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for SETUP-02; manual for SETUP-01
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
