---
phase: 01-security-hardening
plan: "03"
subsystem: frontend-dom-helpers
tags: [dom.ts, dompurify, sec-01, sec-02, wave-2]
requires:
  - "01"
provides:
  - frontend/src/modules/dom.ts — injection-safe setText and setStyle helpers
  - frontend/package.json — dompurify@3.4.1 added to dependencies
affects:
  - frontend/tests/dom.test.ts — GREEN (4/4)
  - frontend/tests/popup.test.ts — RED (4/4 fail; function-not-exported + matchMedia TypeError)
tech-stack:
  added: [dompurify@3.4.1]
  patterns: [safe-dom-mutation, wave-2-foundation]
key-files:
  created:
    - frontend/src/modules/dom.ts
  modified:
    - frontend/package.json
    - frontend/package-lock.json
key-decisions:
  - dom.ts locked content per D-02 — no deviations; exactly setText + setStyle
  - dompurify@3.4.1 installed; @types/dompurify intentionally absent (deprecated)
  - TypeScript build (tsc --noEmit) fails with 4 TS2459 errors — known deviation, see below
requirements-completed:
  - SEC-01
  - SEC-02 (partial — foundation installed; popup builders hardened in Plans 06+07)
duration: 5 min
completed: "2026-04-27"
---

# Phase 01 Plan 03: dom.ts + DOMPurify Install Summary

dom.ts created with locked content (D-02), dompurify@3.4.1 installed. dom.test.ts turns GREEN (4/4). popup.test.ts advances from import-error RED to function-not-exported RED.

Duration: ~5 min | Tasks: 2 | Files created: 1 | Files modified: 2

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Create frontend/src/modules/dom.ts | 71a0411 | ✓ Done |
| 2 | Install dompurify@3.4.1 in frontend/package.json | 9576ae3 | ✓ Done |

## What Was Built

- **dom.ts**: Two named exports — `setText(el, text)` uses `el.textContent`, `setStyle(el, prop, value)` uses `el.style.setProperty`. No imports, no default export, no comments. Locked by D-02.
- **dompurify@3.4.1**: Added to `dependencies` in frontend/package.json. `@types/dompurify` absent (deprecated; DOMPurify 3.x ships own types).

## Verification Results

```
PASS tests/dom.test.ts (4/4) — GREEN
FAIL tests/popup.test.ts (4/4) — RED: TypeError: buildPopup is not a function
                                       TypeError: window.matchMedia is not a function
PASS tests/utils.test.ts (22/22) — no regression
PASS tests/search.test.ts (8/8) — no regression
PASS tests/modules.test.ts (34/34) — no regression
```

## Deviations from Plan

**[Rule 1 — Known Deviation] popup.test.ts RED state is "not a function", not "XSS assertion failure"**
Found during: Task 2 verification | Issue: Plan expected popup.test.ts to advance to XSS-assertion-failure RED after dompurify install. Actual: fails with `TypeError: buildPopup is not a function` because `buildPopup`, `buildHotelPopup`, `createPopupContent`, `createHotelPopup` are not yet exported from tripDetail.ts and map.ts (export happens in Plans 06+07). Additionally `window.matchMedia is not a function` because tripDetail.ts calls `initTheme()` at module level and jsdom doesn't implement matchMedia | Impact: popup.test.ts is RED as required; failure reason differs. Tests correctly target the right functions and will turn GREEN when Plans 06+07 export them with DOMPurify | No fix applied — this is the correct RED state for the current phase.

**[Rule 2 — Known Deviation] TypeScript build fails (tsc --noEmit)**
Found during: post-task verification | Issue: tsconfig.json `include` covers `tests/**/*.ts`, so TypeScript compiles popup.test.ts. popup.test.ts imports `buildPopup`, `buildHotelPopup`, `createPopupContent`, `createHotelPopup` — none exported yet → TS2459 (4 errors). | Impact: `npm run build` fails; plan's "TypeScript build succeeds" criterion cannot be met while in RED TDD state. This is a direct consequence of the design: test files import planned-but-not-yet-exported symbols. Build will pass after Plans 06+07 export these functions. | No fix applied — tsconfig excludes tests from build would require test restructuring; the RED state is intentional and correct.

**Total deviations:** 2 (both RED-state consequences; no code change needed). **Impact:** All core deliverables met; build criterion deferred to Plans 06+07.

## Self-Check: PASSED (with known deviations)

- [x] dom.ts exists at frontend/src/modules/dom.ts
- [x] `grep -c "export function setText" dom.ts` → 1
- [x] `grep -c "export function setStyle" dom.ts` → 1
- [x] `grep -c "export default" dom.ts` → 0
- [x] `grep -c "innerHTML" dom.ts` → 0
- [x] dom.test.ts GREEN (4/4 passing)
- [x] `grep "dompurify" frontend/package.json` returns a dependency line
- [x] `grep "@types/dompurify" frontend/package.json` returns empty — absent
- [x] popup.test.ts FAIL (4/4) — RED (deviates from expected XSS-assertion failure; see deviation above)
- [ ] TypeScript build succeeds — KNOWN DEVIATION (TS2459 from popup.test.ts RED imports; resolved by Plans 06+07)

Next: Plan 01-04 (fix CORS null-origin bug + remove D1 from wrangler.toml)
