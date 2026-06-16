---
phase: 13
slug: security-audit-documentation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-06
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.8 (unit) + Playwright ^1.59.1 (E2E) |
| **Config file** | `backend/vitest.config.ts` / `tests/playwright.config.ts` |
| **Quick run command** | `cd backend && npm test` |
| **Full suite command** | `cd backend && npm test && cd ../tests && npx playwright test e2e/api.spec.ts` |
| **Estimated runtime** | ~30 seconds (unit) + ~20 seconds (E2E with backend running) |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && npm test`
- **After every plan wave:** Run `cd backend && npm test && cd ../tests && npx playwright test e2e/api.spec.ts`
- **Before `/gsd-verify-work`:** Full suite must be green + `curl -I http://localhost:8787/api/health` shows all three security headers
- **Max feedback latency:** ~50 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | SEC-04 | 1 | SEC-04 | Clickjacking/XSS/HTTPS downgrade | CSP + X-Frame-Options + HSTS set on every response | unit | `cd backend && npm test` | ✅ extend index.test.ts | ⬜ pending |
| 13-01-02 | SEC-02 | 1 | SEC-02 | Stale JWKS → valid token rejected | Retry on signature failure refetches JWKS and succeeds | unit | `cd backend && npm test` | ✅ extend keycloak.test.ts | ⬜ pending |
| 13-02-01 | SEC-05 | 2 | SEC-05 | Wrong audience token accepted | Worker token lacking japan-trip-frontend aud → 401 | E2E | `cd tests && npx playwright test e2e/api.spec.ts` | ✅ add describe block | ⬜ pending |
| 13-03-01 | SEC-01 | 2 | SEC-01 | — | rfc9700-checklist.md exists and is non-empty | smoke | `test -f docs/security/rfc9700-checklist.md && wc -l docs/security/rfc9700-checklist.md` | ❌ W0 | ⬜ pending |
| 13-04-01 | DOC-01 | 3 | DOC-01 | — | README no longer references `docker compose up` in quick start | smoke | `grep -c "docker compose up" README.md` returns 0 | ✅ verify after edit | ⬜ pending |
| 13-04-02 | DOC-02 | 3 | DOC-02 | — | SETUP.md exists with terraform apply step | smoke | `grep -c "terraform apply" SETUP.md` returns > 0 | ❌ W0 | ⬜ pending |
| 13-04-03 | DOC-03 + DEVENV-03 | 3 | DOC-03, DEVENV-03 | — | docs/use-cases.md exists with Coverage Status column | smoke | `grep -c "Coverage Status" docs/use-cases.md` returns > 0 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `backend/src/auth/keycloak.test.ts` — stub/test case for JWKS retry on signature failure (SEC-02)
- [ ] Extend `backend/src/index.test.ts` — test that security headers are present on responses (SEC-04)

*Existing infrastructure covers the rest — no new test files or framework installation needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Security headers visible via curl | SEC-04 | Requires running backend | `curl -I http://localhost:8787/api/health` — verify `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` headers present |
| SEC-05 E2E with live KC + backend | SEC-05 | Requires Keycloak + backend running | `cd tests && npx playwright test e2e/api.spec.ts` with `npm run dev` active |
| README setup guide accuracy | DEVENV-03 | Human judgment | Read README.md prerequisites + quick start; verify instructions are accurate and complete end-to-end |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 50s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
