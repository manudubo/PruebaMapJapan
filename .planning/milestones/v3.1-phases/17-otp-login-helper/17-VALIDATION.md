---
phase: 17
slug: otp-login-helper
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright `^1.60.0` |
| **Config file** | `tests/playwright.config.ts` |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `cd tests && npx playwright test e2e/otp.spec.ts --project=chromium` |
| **Estimated runtime** | ~5s typecheck / ~90s full OTP spec (full stack required) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `cd tests && npx playwright test e2e/otp.spec.ts --project=chromium` (requires KC + backend + frontend + Mailpit + Postgres)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5s (typecheck)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 0 | SESSION-02 | — | N/A | structural | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | OTP-01 | — | N/A | structural | `npm run typecheck` | ✅ | ⬜ pending |
| 17-01-03 | 01 | 1 | OTP-02 | — | N/A | structural | `npm run typecheck` | ✅ | ⬜ pending |
| 17-01-04 | 01 | 1 | OTP-03, SESSION-02 | — | N/A | structural | `npm run typecheck` | ✅ | ⬜ pending |
| 17-02-01 | 02 | 1 | SESSION-02 | — | N/A | structural | `npm run typecheck` | ✅ | ⬜ pending |
| 17-02-02 | 02 | 1 | SESSION-02 | — | N/A | structural | `npm run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/fixtures/kc-login-helper.ts` — new file exporting `loginViaKcForm`; must exist before any call site is wired in Wave 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OTP spec passes with live KC + backend + Mailpit | OTP-01, OTP-02, OTP-03 | Full stack not available in automated CI without KC | `cd tests && npx playwright test e2e/otp.spec.ts --project=chromium --reporter=list` |
| Session-management spec passes with `loginViaKcForm` | SESSION-02 | KC browser flow required | `cd tests && npx playwright test e2e/session-management.spec.ts --project=chromium --reporter=list` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s (typecheck)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
