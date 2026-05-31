---
phase: 11
slug: error-handling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + jsdom |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `cd frontend && npm run test:run` |
| **Full suite command** | `cd frontend && npm run test:run && npm run typecheck` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test:run && npm run typecheck`
- **After every plan wave:** Run `cd frontend && npm run test:run && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-W0-toast | Wave 0 | 0 | ERR-02, ERR-03 | — | textContent only (no innerHTML XSS) | unit | `cd frontend && npm run test:run` | ❌ W0 | ⬜ pending |
| 11-W0-client | Wave 0 | 0 | ERR-04, ERR-05 | — | 401 never-resolves (no double toast) | unit | `cd frontend && npm run test:run` | ❌ W0 | ⬜ pending |
| 11-toast-ts | 01 | 1 | ERR-02 | — | textContent only, no innerHTML | unit | `cd frontend && npm run test:run -- toast.test.ts` | ✅ W0 | ⬜ pending |
| 11-apierror | 01 | 1 | ERR-04 | — | ApiError.name='ApiError', status+code fields | unit | `cd frontend && npm run test:run -- client.test.ts` | ✅ W0 | ⬜ pending |
| 11-401-redirect | 01 | 1 | ERR-05 | — | 401 returns never-resolving promise; login() called after 1500ms | unit | `cd frontend && npm run test:run -- client.test.ts` | ✅ W0 | ⬜ pending |
| 11-unhandled | 02 | 2 | ERR-03 | — | N/A | unit | `cd frontend && npm run test:run -- toast.test.ts` | ✅ W0 | ⬜ pending |
| 11-dashboard | 03 | 2 | ERR-01, ERR-02 | — | N/A | smoke | Visual verification + typecheck | N/A | ⬜ pending |
| 11-trip-edit | 03 | 2 | ERR-01, ERR-02 | — | N/A | smoke | Visual verification + typecheck | N/A | ⬜ pending |
| 11-tripdetail | 03 | 2 | ERR-01, ERR-03 | — | N/A | smoke | Visual verification + typecheck | N/A | ⬜ pending |
| 11-backend | 04 | 3 | ERR-04 | — | N/A | smoke | `cd backend && npm run typecheck` | N/A | ⬜ pending |
| 11-e2e-smoke | Final | 3 | ERR-01 | — | No raw errors visible in any entry point | manual | Visual verification post-implementation | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/tests/toast.test.ts` — covers ERR-02 (showToast behavior, container injection, stacking, dismiss), ERR-03 (installGlobalErrorHandler fires showToast on unhandledrejection). Needs `document.body` cleanup in `beforeEach`, `vi.useFakeTimers()` for 4s dismiss and 200ms exit animation.
- [ ] `frontend/tests/client.test.ts` — covers ERR-04 (ApiError shape: name='ApiError', status, code), ERR-05 (401 path: mock fetch returning 401, assert showToast called + login scheduled at 1500ms + returned promise never resolves). Needs `vi.mock('@/auth/keycloak')` and `vi.spyOn(global, 'fetch')`.

**Note:** `frontend/tests/setup.ts` already mocks `matchMedia` — no additions needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No raw browser error in any entry point | ERR-01 | Requires browser DOM and visual inspection | Trigger an API error and unhandled rejection in each of the 4 entry points via browser devtools; confirm toast appears and no native browser error dialog fires |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
