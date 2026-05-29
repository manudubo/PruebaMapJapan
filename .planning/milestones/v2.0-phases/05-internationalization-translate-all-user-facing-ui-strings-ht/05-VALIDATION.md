---
phase: 5
slug: internationalization-translate-all-user-facing-ui-strings-ht
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E) + Vitest (unit) |
| **Config file** | `playwright.config.ts` / `vitest.config.ts` |
| **Quick run command** | `rg "[áéíóúñ¿¡]" frontend/src frontend/*.html --files-with-matches` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~15 seconds (regex audit) / ~60 seconds (full Playwright) |

---

## Sampling Rate

- **After every task commit:** Run `rg "[áéíóúñ¿¡]" <changed-files>` — accent-char spot check on edited files
- **After every plan wave:** Run `rg "[áéíóúñ¿¡]" frontend/src frontend/*.html --files-with-matches` — full tree check
- **Before `/gsd-verify-work`:** Full Playwright suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 0 | I18N-HTML | — | N/A | audit | `rg 'lang="es"' frontend/*.html` returns zero | ✅ | ⬜ pending |
| 5-01-02 | 01 | 1 | I18N-HTML | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/index.html frontend/dashboard.html frontend/profile.html frontend/trip.html frontend/trip-edit.html` returns zero | ✅ | ⬜ pending |
| 5-02-01 | 02 | 2 | I18N-HTML | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/tokyo.html frontend/kyoto.html frontend/osaka.html frontend/hiroshima.html frontend/nara.html frontend/nikko.html frontend/kamakura.html frontend/hakone.html` returns zero | ✅ | ⬜ pending |
| 5-03-01 | 03 | 3 | I18N-TS | — | N/A | audit + E2E | `rg "[áéíóúñ¿¡]" frontend/src/components/` returns zero | ✅ | ⬜ pending |
| 5-04-01 | 04 | 4 | I18N-PASSKEY | — | N/A | E2E | `npx playwright test uat-passkeys.spec.ts` passes | ✅ | ⬜ pending |
| 5-05-01 | 05 | 4 | I18N-TS | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/src/pages/dashboard.ts` returns zero | ✅ | ⬜ pending |
| 5-06-01 | 06 | 4 | I18N-TS | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/src/pages/tripDetail.ts frontend/src/modules/map.ts` returns zero | ✅ | ⬜ pending |
| 5-07-01 | 07 | 5 | I18N-TS | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/src/pages/trip-edit/` returns zero | ✅ | ⬜ pending |
| 5-08-01 | 08 | 5 | I18N-TS | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/src/modules/widgets.ts frontend/src/modules/search.ts` returns zero | ✅ | ⬜ pending |
| 5-09-01 | 09 | 6 | I18N-TS | — | N/A | audit | `rg "[áéíóúñ¿¡]" frontend/src/data/itinerary.ts frontend/public/manifest.json` returns zero | ✅ | ⬜ pending |
| 5-10-01 | 10 | 7 | I18N-LOCALE | — | N/A | audit | `rg "es-ES" frontend/src` returns zero | ✅ | ⬜ pending |
| 5-10-02 | 10 | 7 | I18N-ACCENT | — | N/A | audit + E2E | Full accent audit returns zero; `npx playwright test` passes | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files need to be created — `uat-passkeys.spec.ts` needs a string update (not creation), handled in the profile.ts plan.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| City page date strings display in en-US format | I18N-HTML | Hardcoded HTML strings, not runtime-verified | Open any city HTML page (e.g. `/tokyo.html`), verify date shows "Feb 22 – Mar 1, 2026 · 8 days" not "22 Febrero – 1 Marzo" |
| Dashboard date cards show English month names | I18N-LOCALE | Requires live KC session | Log in, open dashboard, verify dates render as "January 1, 2026" not "1 de enero de 2026" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
