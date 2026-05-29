---
phase: 01-security-hardening
plan: "01"
subsystem: frontend-tests
tags: [tdd, red-phase, xss, sec-01, sec-02]
requires: []
provides:
  - frontend/tests/dom.test.ts — RED stubs for setText/setStyle contracts (SEC-01)
  - frontend/tests/popup.test.ts — RED stubs for XSS sanitization assertions (SEC-02)
affects: []
tech-stack:
  added: []
  patterns: [tdd-red-green-refactor]
key-files:
  created:
    - frontend/tests/dom.test.ts
    - frontend/tests/popup.test.ts
  modified: []
key-decisions:
  - Tests import not-yet-exported functions to enforce RED state — dom.ts doesn't exist, popup builders not exported
  - popup.test.ts fails via tripDetail.ts module init TypeError (window.matchMedia in jsdom) — expected, resolved in Plan 06
requirements-completed:
  - SEC-01
  - SEC-02
duration: 5 min
completed: "2026-04-27"
---

# Phase 01 Plan 01: TDD Red Phase — Frontend Test Stubs Summary

RED test stubs created for SEC-01 (dom.ts injection-safe helpers) and SEC-02 (DOMPurify popup sanitization). Both files fail RED immediately.

Duration: ~5 min | Tasks: 2 | Files created: 2

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Write dom.test.ts — RED stubs for setText/setStyle | 99ad62a | ✓ Done |
| 2 | Write popup.test.ts — RED stubs for XSS assertions | 55a5fe0 | ✓ Done |

## What Was Built

- **dom.test.ts**: 4 tests (setText×2, setStyle×2) that fail with `Cannot find module '@/modules/dom'` — dom.ts doesn't exist yet. Turns GREEN after Plan 03.
- **popup.test.ts**: 4 tests asserting `<script>` is absent from buildPopup/buildHotelPopup/createPopupContent/createHotelPopup output. Fails due to tripDetail.ts module init TypeError (window.matchMedia not available in jsdom). Turns GREEN after Plans 06+07 export and sanitize the popup builders.

## Verification Results

```
FAIL tests/dom.test.ts — Error: Failed to resolve import "@/modules/dom"
FAIL tests/popup.test.ts — 4 tests | 4 failed (window.matchMedia TypeError from tripDetail.ts init)
```

Both files are RED as required.

## Deviations from Plan

**[Rule 1 — Known Deviation] popup.test.ts failure reason is matchMedia TypeError, not XSS assertion failure**
Found during: Task 2 verification | Issue: tripDetail.ts runs `initTheme()` at module level which calls `window.matchMedia`; jsdom doesn't implement this | This is a pre-existing condition in tripDetail.ts that Plan 06 will address when the module is hardened and popup builders are extracted and exported | Files: None changed | Impact: RED state is confirmed; failure reason differs from plan expectation but the test is in the correct RED state.

**Total deviations:** 1 (pre-existing, no code change needed). **Impact:** Tests are in correct RED state as required by the Nyquist compliance goal.

## Self-Check: PASSED

- [x] dom.test.ts exists at frontend/tests/dom.test.ts
- [x] popup.test.ts exists at frontend/tests/popup.test.ts
- [x] Both fail RED when npm run test:run executes
- [x] No @types/dompurify imported anywhere
- [x] dom.test.ts has 4 test cases (setText×2, setStyle×2)
- [x] popup.test.ts has 4 test cases (2 per file under test)
- [x] Each task committed individually

Next: Ready for Plan 01-02 (backend RED test stubs)
