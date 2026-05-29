---
phase: 01-security-hardening
plan: "07"
subsystem: frontend-map
tags: [dompurify, dom-ts, sec-01, sec-02, wave-3]
requires:
  - "03"
provides:
  - frontend/src/modules/map.ts — all innerHTML injection sites replaced; createPopupContent/createHotelPopup exported + DOMPurify-sanitized
  - frontend/vite.config.ts — build.target esnext added (pre-existing issue surfaced)
affects:
  - frontend/tests/popup.test.ts — 4/4 GREEN (all suites pass)
  - frontend/tests/dom.test.ts — GREEN (no regression)
  - npm run build — now passes fully (tsc + vite)
tech-stack:
  added: []
  patterns: [safe-dom-mutation, dompurify-sanitize]
key-files:
  created: []
  modified:
    - frontend/src/modules/map.ts
    - frontend/vite.config.ts
key-decisions:
  - createPopupContent/createHotelPopup exported + DOMPurify.sanitize on return
  - createMarkerIcon uses createElement + textContent + setStyle (same pattern as tripDetail.ts Plan 06)
  - Overview map DivIcon uses createElement; overview popup wrapped with DOMPurify.sanitize
  - Static SVG strings in legend/hotel action links kept as innerHTML (no user data)
  - vite.config.ts build.target set to 'esnext' — fixes pre-existing top-level await issue unmasked by our tsc fix
requirements-completed:
  - SEC-01 (map.ts)
  - SEC-02 (map.ts popup builders)
duration: 20 min
completed: "2026-04-27"
---

# Phase 01 Plan 07: map.ts Hardening Summary

All innerHTML injection sites replaced in map.ts with setText/setStyle imperative DOM. DOMPurify.sanitize applied to createPopupContent, createHotelPopup, and overview popup. Both functions exported. popup.test.ts fully GREEN (4/4). TypeScript build and Vite bundle both pass.

Duration: ~20 min | Tasks: 2 | Files modified: 2 (map.ts + vite.config.ts)

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Add imports; export createPopupContent/createHotelPopup; DOMPurify.sanitize | b9b88a3 | ✓ Done |
| 2 | Replace all innerHTML injection sites | b9b88a3 | ✓ Done |

## What Was Built

- **Imports added**: `import DOMPurify from 'dompurify'` and `import { setText, setStyle } from '@/modules/dom'`
- **createPopupContent**: exported + `return DOMPurify.sanitize(content)`
- **createHotelPopup**: exported + `return DOMPurify.sanitize(content)`
- **createMarkerIcon**: replaced `html: \`<div>${label}</div>\`` with createElement + textContent + setStyle; passes HTMLElement to DivIcon
- **generateLegendByDay dayGroup header**: replaced dayGroup.innerHTML template with createElement+setStyle+setText
- **createLegendItem**: replaced item.innerHTML with createElement for all content; removed actionsHtml variable; static SVG icons use innerHTML
- **updateHotelInfo**: replaced hotelInfo.innerHTML with createElement+setText; static SVGs use innerHTML
- **initOverviewMap DivIcon**: replaced html template with createElement+setStyle+textContent
- **initOverviewMap popup**: wrapped popup html string with DOMPurify.sanitize
- **vite.config.ts**: added `build.target: 'esnext'` (pre-existing top-level await issue; was masked by tsc failing first)

## Verification Results

```
PASS tests/dom.test.ts (4/4) — GREEN, no regression
PASS tests/popup.test.ts (4/4) — GREEN (all suites)
PASS tests/utils.test.ts (22/22) — no regression
PASS tests/modules.test.ts (34/34) — no regression
PASS tests/search.test.ts (8/8) — no regression
tsc --noEmit → 0 errors
npm run build → ✓ built in 482ms
```

## Deviations from Plan

**[Rule 1 — Extra file] vite.config.ts modified alongside map.ts**
Found during: Task 2 verification | Issue: `npm run build` (tsc && vite build) failed with "top-level await not available" after tsc now passes. This is a pre-existing issue in vite.config.ts that was masked by tsc failing first. Root cause: Vite's default esbuild target doesn't support top-level await, but Rollup generates it from async module patterns. | Fix: added `build.target: 'esnext'` to vite.config.ts — consistent with tsconfig ES2022 target; build now passes. Not part of Plan 07 scope but required for success criteria.

**Total deviations:** 1 (pre-existing build config issue; minimal targeted fix applied).

## Self-Check: PASSED

- [x] `grep -c "import DOMPurify" map.ts` → 1
- [x] `grep -c "import { setText, setStyle }" map.ts` → 1
- [x] `grep -c "DOMPurify.sanitize" map.ts` → 3 (createPopupContent, createHotelPopup, overview popup)
- [x] `grep "return content" map.ts` → empty (no raw returns)
- [x] `grep -c "^export function createPopupContent" map.ts` → 1
- [x] `grep -c "^export function createHotelPopup" map.ts` → 1
- [x] `grep -c "setText\|setStyle" map.ts` → ≥5
- [x] popup.test.ts ALL GREEN (4/4)
- [x] tsc --noEmit → 0 errors
- [x] npm run build → passes

Next: Plan 01-08 (harden dashboard.ts — dom.ts helpers only; renderTripCard HTMLElement return)
