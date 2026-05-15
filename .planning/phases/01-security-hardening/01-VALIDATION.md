---
phase: 1
slug: security-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-26
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (frontend), native Node test runner (backend) |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `cd frontend && npm run test:run` |
| **Full suite command** | `cd frontend && npm run test:coverage` |
| **Backend test command** | `cd backend && npx vitest run` (or `npm test`) |
| **Estimated runtime** | ~15 seconds (both suites combined) |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test:run` AND `cd backend && npm test`
- **After every plan wave:** Run `cd frontend && npm run test:coverage`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-dom | TBD | 1 | SEC-01 | Stored/Reflected XSS | `setText` sets `textContent`; `setStyle` calls `style.setProperty` | unit | `cd frontend && npm run test:run -- --reporter=verbose` | ❌ W0 | ⬜ pending |
| 1-dashboard | TBD | 1 | SEC-01 | Stored XSS | No `innerHTML` with user string in dashboard.ts | unit | `cd frontend && npm run test:run` | ❌ W0 | ⬜ pending |
| 1-tripdetail | TBD | 1 | SEC-01+SEC-02 | XSS+HTML injection | `buildPopup`/`buildHotelPopup` call `DOMPurify.sanitize` | unit (light) | `cd frontend && npm run test:run` | ❌ W0 | ⬜ pending |
| 1-map | TBD | 1 | SEC-01+SEC-02 | XSS+HTML injection | `createPopupContent`/`createHotelPopup` call `DOMPurify.sanitize` | unit (light) | `cd frontend && npm run test:run` | ❌ W0 | ⬜ pending |
| 1-cors | TBD | 2 | SEC-03 | CORS credential bypass | null origin → `null` header; `credentials` key absent | unit | `cd backend && npm test` | ❌ W0 | ⬜ pending |
| 1-jwt | TBD | 2 | SEC-04 | JWT audience confusion | `validateAudience(['japan-trip-frontend'])` rejects `'account'` | unit | `cd backend && npm test` | ❌ W0 | ⬜ pending |
| 1-wrangler | TBD | 2 | SEC-05 | Stale D1 binding | `grep -c 'd1_databases' backend/wrangler.toml` returns 0 | static check | `grep -c 'd1_databases' backend/wrangler.toml` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `frontend/tests/dom.test.ts` — unit stubs for SEC-01: `setText` sets `textContent`, `setStyle` calls `style.setProperty`
- [ ] `frontend/tests/popup.test.ts` — light unit stubs for SEC-02: DOMPurify called before `bindPopup` in popup builder functions
- [ ] `backend/src/middleware/cors.test.ts` — unit stub for SEC-03: null origin returns `null` header value
- [ ] `backend/src/auth/keycloak.test.ts` — unit stub for SEC-04: extracted `validateAudience` pure helper rejects `'account'`, accepts `'japan-trip-frontend'`

*Note: SEC-04 testing requires extracting a pure `validateAudience(audiences: string[], expected: string)` helper from the monolithic `verifyJwt` function. This refactor must be included in the SEC-04 implementation task.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Keycloak realm re-import | SEC-04 | Requires Keycloak admin console UI; cannot be scripted in a plan task | After editing `realm-export.json`: Keycloak admin → Realm Settings → Import → uncheck "Skip if exists" → import file. Verify token contains `aud: japan-trip-frontend` in JWT debugger. |
| Popup SVG icons render after DOMPurify | SEC-02 | Visual regression; DOMPurify may strip SVG `<use>` or `xlink:href` depending on config | Open a trip detail page, click a map marker. Verify popup shows location-pin icon glyphs. If glyphs are missing, DOMPurify default config stripped SVG — widen `ALLOWED_TAGS`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
