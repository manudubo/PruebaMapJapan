# Phase 19: Session + Closure — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 19-session-closure
**Areas discussed:** session-management status, outstanding failures (fix vs. fixme), closure document format

---

## Session Management

| Option | Description | Selected |
|--------|-------------|----------|
| No — just needs a live verification run | SESSION-01 is structurally done. Phase 19 plan: run the spec, confirm green, record the result. | ✓ |
| Yes — still failing, needs investigation | Something else is wrong beyond the selector fix. Phase 19 needs a debug step. | |
| Unknown — haven't run it since Phase 17 | Phase 19 starts with a fresh run. Investigate if it fails. | |

**User's choice:** No — just needs a live verification run
**Notes:** loginViaKcForm is already wired in from Phase 17. SESSION-01 is confirmed structurally done.

---

## trip-edit-integration.spec.ts Disposition

| Option | Description | Selected |
|--------|-------------|----------|
| test.fixme — mark as unimplemented, keep for future | test.fixme(true, 'trip-edit API integration not implemented in v3.1 — see Phase 2 backlog'). Preserves test for future. | ✓ |
| Delete the spec entirely | Remove trip-edit-integration.spec.ts. Clean but loses pre-written test intent. | |
| Keep failing, document in closure only | Leave as-is, note in closure doc. Not aligned with DOC-01. | |

**User's choice:** test.fixme — keep test, mark unimplemented
**Notes:** Pre-written Phase 2 integration test for unimplemented feature. Clear environment constraint — not an app bug.

---

## auth.spec.ts Real-Session [Firefox, WebKit] Disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Fix — add storageState to firefox and webkit projects | One line each in playwright.config.ts. Turns config-bug failure into green test. | ✓ |
| test.fixme — scope real-session tests to chromium only | Add test.use({ browserName: 'chromium' }) inside auth.spec.ts. Fewer cross-browser coverage. | |

**User's choice:** Fix — add storageState
**Notes:** Config-bug, not an app bug. One-liner fix; restores cross-browser coverage for auth.spec.ts real-session tests.

---

## new-user-trip-creation.spec.ts [WebKit] Disposition

| Option | Description | Selected |
|--------|-------------|----------|
| test.fixme for webkit — environment constraint | Spec passes on chromium and firefox; webkit KC redirect difference is environment constraint. | ✓ |
| Investigate and fix | Debug the webkit beforeAll failure. Could be new-user.json storageState or getToken() timing. | |

**User's choice:** test.fixme for webkit
**Notes:** Passes on chromium/firefox. Webkit handles KC redirects differently in this context — environment constraint, not app bug.

---

## Final Suite Run (DOC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — fresh full-suite run closes v3.1 | npx playwright test --trace retain-on-failure --retries 1. Results feed into closure doc. | ✓ |
| No — spec-by-spec targeted runs are enough | Run session-management, auth, and fixme'd specs individually. | |

**User's choice:** Full-suite run
**Notes:** Authoritative signal for DOC-02 zero-unexplained-failures claim.

---

## Closure Document Format

| Option | Description | Selected |
|--------|-------------|----------|
| 19-CLOSURE.md — standalone per-spec status table | Dedicated file with suite summary table and accepted deferrals list. | ✓ |
| Part of 19-VERIFICATION.md | Closure table folded into VERIFICATION.md. Mixes two concerns. | |
| Update 15-TRIAGE.md with final status column | Add 'Final Status' column to Phase 15 triage table. | |

**User's choice:** 19-CLOSURE.md standalone
**Notes:** Clean separation of concerns. Serves as the v3.1 milestone close artifact.

---

## Claude's Discretion

- Exact test.fixme message wording
- Whether webkit fixme is at describe block level or per-test
- Order of tasks within a plan file

## Deferred Ideas

- OTP brute-force lockout (attackDetection.del in beforeEach)
- Per-recipient Mailpit isolation
- Real-auth E2E in CI
