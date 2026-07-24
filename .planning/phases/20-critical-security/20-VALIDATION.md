---
phase: 20
slug: critical-security
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (frontend)** | Vitest + jsdom |
| **Config file (frontend)** | `frontend/vitest.config.ts` |
| **Quick run command** | `npm run test:run` (in `frontend/`) |
| **Full suite command (frontend)** | `npm run typecheck && npm run test:run` (in `frontend/`) |
| **Framework (backend)** | Vitest (default config) |
| **Quick run command (backend)** | `npm run test` (in `backend/`) |
| **Estimated runtime** | ~15 seconds (frontend), ~5 seconds (backend) |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck && npm run test:run` in the changed tier (frontend/ or backend/)
- **After every plan wave:** Full suite in both frontend/ and backend/
- **Before `/gsd-verify-work`:** Full suite must be green + 0-violation manual CSP devtools check on preview build
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-W0-01 | W0 | 0 | SEC-01 | — | `Math.random` not called for OTP generation | unit | `npm run test -- --reporter=verbose` (backend/) | ❌ W0 | ⬜ pending |
| 20-W0-02 | W0 | 0 | SEC-02 | — | `renderList` with XSS payload produces no injected element in DOM | unit | `npm run test:run -- --reporter=verbose` (frontend/) | ❌ W0 | ⬜ pending |
| 20-W0-03 | W0 | 0 | SEC-02 | — | `renderList` with XSS payload renders raw string as `textContent` | unit | `npm run test:run -- --reporter=verbose` (frontend/) | ❌ W0 | ⬜ pending |
| 20-01-01 | 01 | 1 | SEC-01 | — | `crypto.getRandomValues` is used for OTP; `Math.random` absent in auth.ts | grep + unit | `grep -n "Math.random" backend/src/routes/auth.ts` (must be 0 matches) | ✅ | ⬜ pending |
| 20-02-01 | 02 | 1 | SEC-02 | — | `renderList` uses DOM API; no raw `innerHTML` on RSS-sourced data | grep + unit | `grep -n "container.innerHTML.*items\|innerHTML.*item" frontend/src/modules/widgets.ts` (0 matches) | ✅ | ⬜ pending |
| 20-03-01 | 03 | 2 | SEC-03/04 | — | All 13 dist HTML files contain CSP meta tag | build + grep | `npm run build && grep -c "Content-Security-Policy" dist/*.html` (all output `1`) | ✅ | ⬜ pending |
| 20-03-02 | 03 | 2 | SEC-04 | — | 0 CSP violations on city page load | manual | Preview build + devtools on `http://localhost:4173/PruebaMapJapan/tokyo.html` | manual | ⬜ pending |
| 20-03-03 | 03 | 2 | SEC-04 | — | 0 CSP violations on index.html with auth | manual | Preview build + devtools on `http://localhost:4173/PruebaMapJapan/` | manual | ⬜ pending |
| 20-01-T2-01 | 01 | 1 | SEC-14 | — | `terraform plan` shows `kc_admin_client_secret` to destroy | manual | `terraform plan -target=cloudflare_worker_secret.kc_admin_client_secret` (1 destroy) | manual | ⬜ pending |
| 20-01-T2-02 | 01 | 1 | SEC-14 | — | E2E admin fixture still passes after Terraform change | e2e | `npm run test:e2e` (in `tests/`) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/otp-csprng.test.ts` — SEC-01: verify `crypto.getRandomValues` is called; mock `Math.random` absent
- [ ] `frontend/tests/widgets-xss.test.ts` — SEC-02: inject malicious `<img src=x onerror=alert(1)>` title; assert `container.querySelector('img')` is null; assert `textContent` contains raw string

*Note: No framework install needed — Vitest already configured in both `frontend/` and `backend/`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 0 CSP violations on city page (map tiles, news widget, weather) | SEC-04 | Requires browser devtools; CSP violations are browser-reported | `npm run build && npm run preview`; open `http://localhost:4173/PruebaMapJapan/tokyo.html`; unregister SW + clear site data; check Console for CSP errors |
| 0 CSP violations on index.html with Keycloak auth | SEC-04 | Requires auth flow + iframe behavior observable only in browser | Open index.html on preview; observe Network/Console for `frame-src` violations during check-sso |
| `terraform plan` shows 1 destroy for `kc_admin_client_secret` | SEC-14 | Requires Terraform CLI + Cloudflare credentials | `cd terraform/cloudflare && terraform plan -target=cloudflare_worker_secret.kc_admin_client_secret` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
