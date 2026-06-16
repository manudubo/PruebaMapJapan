---
phase: 10
slug: design-tokens-idp-theme
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-29
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Playwright (E2E) |
| **Config file** | `frontend/vite.config.ts` (Vitest), `tests/playwright.config.ts` (Playwright) |
| **Quick run command** | `cd frontend && npm run typecheck && npm run test:run` |
| **Full suite command** | `cd tests && npx playwright test --project=chromium` |
| **Estimated runtime** | ~30 seconds (unit), ~2 min (E2E, KC required) |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run typecheck && npm run test:run`
- **After every plan wave:** Run full rg audit + `npx playwright test e2e/idp-theme.spec.ts --project=chromium`
- **Before `/gsd-verify-work`:** All verification commands below green
- **Max feedback latency:** 30 seconds (unit); 2 minutes (E2E)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-xx-01 | TBD | 1 | DESIGN-01 | — | No old token names in main.css or TS files | static | `rg -o "var\(--[a-z][a-z0-9-]*" frontend/src/styles/main.css \| rg -v "^var\(--jp-"` | N/A | ⬜ pending |
| 10-xx-02 | TBD | 1 | DESIGN-01 | — | No hardcoded hex/rgba in component rules | static | `rg "#[0-9a-fA-F]{3,8}\b\|rgba?" frontend/src/styles/main.css -n` | N/A | ⬜ pending |
| 10-xx-03 | TBD | 1 | DESIGN-02 | — | KC login: Inter font, radius 0, no logo | E2E | `cd tests && npx playwright test e2e/idp-theme.spec.ts --project=chromium` | ✅ | ⬜ pending |
| 10-xx-04 | TBD | 2 | DESIGN-03 | XSS-T01 | KC emails use kcSanitize(); no script in messages | manual | Manual Mailpit check (localhost:8025) | ✅ (after plan) | ⬜ pending |
| 10-xx-05 | TBD | 2 | DESIGN-04 | — | Theme persists across MPA nav | E2E | `cd tests && npx playwright test e2e/ui-consistency.spec.ts` | ✅ | ⬜ pending |
| 10-xx-06 | TBD | ALL | Regression | — | Passkey flows unaffected by KC theme | E2E | `cd tests && npx playwright test e2e/passkeys.spec.ts --project=chromium-passkeys` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- No new test files needed — existing `idp-theme.spec.ts` and `ui-consistency.spec.ts` cover DESIGN-02/04
- DESIGN-01 uses static grep analysis (no spec file), verified by rg commands
- DESIGN-03 (email templates) is manual-only (Mailpit UI) — no automated spec is feasible

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| KC email branded card layout | DESIGN-03 | Email clients can't be automated in CI; Mailpit required | 1. `cd keycloak && docker compose up -d` 2. KC → trigger email verification 3. Open localhost:8025 → verify "TravelMap" header, white card, Inter font, `#0071e3` links, `#f5f5f7` background |
| Theme mismatch on KC login (system light + app dark) | DESIGN-04 / D-05 | Accepted mismatch; no test for intentional non-sync | Manual: set system to light mode, set app to dark mode, verify KC login shows in light mode (expected behavior) |

---

## Verification Commands (DESIGN-01)

```bash
# 1. No old token names in main.css
rg -o "var\(--[a-z][a-z0-9-]*" "frontend/src/styles/main.css" | rg -v "^var\(--jp-"
# Expected: empty output

# 2. No old token names in TS component files
rg -o "var\(--[a-z][a-z0-9-]*" "frontend/src/" --type ts | rg -v "^var\(--jp-"
# Expected: empty output

# 3. No hardcoded hex/rgba in component rules (manual review per hit)
rg "#[0-9a-fA-F]{3,8}\b|rgba?\(" "frontend/src/styles/main.css" -n | grep -v "url(\|@import"
# Expected: only token definitions (lines 1–95) and @media/contrast blocks

# 4. All 9 HTML files retain anti-FOUC script
for f in index tokyo nagoya takayama kyoto osaka naoshima hakone tokyo2; do
  count=$(grep -c "localStorage.getItem" "frontend/$f.html" 2>/dev/null || echo 0)
  echo "$f.html: $count"
done
# Expected: all = 1

# 5. Build and typecheck
cd frontend && npm run typecheck && npm run build
# Expected: zero errors

# 6. Unit tests green
cd frontend && npm run test:run
# Expected: all pass

# 7. idp-theme.spec.ts (DESIGN-02 unchanged)
cd tests && npx playwright test e2e/idp-theme.spec.ts --project=chromium
# Expected: all pass

# 8. Passkey regression (requires KC up, no SKIP_REAL_AUTH)
cd tests && npx playwright test e2e/passkeys.spec.ts --project=chromium-passkeys
# Expected: all pass
```

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or manual-only justification
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0: N/A (existing infrastructure covers phase)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit path)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
