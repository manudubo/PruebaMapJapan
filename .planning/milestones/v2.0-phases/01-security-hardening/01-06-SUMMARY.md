---
phase: 01-security-hardening
plan: "06"
subsystem: frontend-tripdetail
tags: [dompurify, dom-ts, sec-01, sec-02, wave-3]
requires:
  - "03"
provides:
  - frontend/src/pages/tripDetail.ts — all innerHTML injection sites replaced; buildPopup/buildHotelPopup exported + DOMPurify-sanitized
affects:
  - frontend/tests/popup.test.ts — 2/4 GREEN (tripDetail suite passes; map suite still RED pending Plan 07)
  - frontend/tests/dom.test.ts — GREEN (no regression)
tech-stack:
  added: []
  patterns: [safe-dom-mutation, dompurify-sanitize]
key-files:
  created: []
  modified:
    - frontend/src/pages/tripDetail.ts
key-decisions:
  - Leaflet DivIcon html accepts HTMLElement — used createElement+textContent for marker labels (no innerHTML)
  - Static SVG strings in legend/hotel action links kept as innerHTML (no user data interpolation)
  - showError uses plain textContent (not a styled <p> wrapper string) — errorEl is already a container
  - actionsHtml variable eliminated entirely — replaced with imperative DOM
requirements-completed:
  - SEC-01 (tripDetail.ts)
  - SEC-02 (tripDetail.ts popup builders)
duration: 15 min
completed: "2026-04-27"
---

# Phase 01 Plan 06: tripDetail.ts Hardening Summary

All innerHTML injection sites replaced with setText/setStyle imperative DOM. DOMPurify.sanitize applied to buildPopup and buildHotelPopup. Both functions exported. TypeScript TS2459 errors for tripDetail imports cleared.

Duration: ~15 min | Tasks: 2 | Files modified: 1

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Add imports; export buildPopup/buildHotelPopup; DOMPurify.sanitize | e7aa7f7 | ✓ Done |
| 2 | Replace all innerHTML injection sites | e7aa7f7 | ✓ Done |

## What Was Built

- **Imports added**: `import DOMPurify from 'dompurify'` and `import { setText, setStyle } from '@/modules/dom'`
- **buildPopup**: exported + `return DOMPurify.sanitize(html)`
- **buildHotelPopup**: exported + `return DOMPurify.sanitize(html)`
- **createMarkerIcon**: replaced `html: \`<div>${label}</div>\`` with createElement + textContent + setStyle; passes HTMLElement to DivIcon
- **buildDestTabs**: replaced `tabsEl.innerHTML = sorted.map().join('')` with forEach+createElement+setText
- **generateLegend dayGroup header**: replaced dayGroup.innerHTML template with createElement+setStyle+setText
- **buildLegendItem**: replaced item.innerHTML with createElement for all content; removed actionsHtml variable; static SVG icons use innerHTML (no user data)
- **updateHotelInfo**: replaced hotelInfo.innerHTML with createElement+setText; static SVG icons use innerHTML
- **showError**: replaced main.innerHTML template with createElement+setText(p, message)

## Verification Results

```
PASS tests/dom.test.ts (4/4) — GREEN, no regression
PASS tests/popup.test.ts > tripDetail suite (2/2) — GREEN (buildPopup, buildHotelPopup)
FAIL tests/popup.test.ts > map suite (2/2) — RED (createPopupContent, createHotelPopup not exported from map.ts — fixed by Plan 07)
tsc --noEmit: 2 errors (TS2459 for map.ts exports — resolved by Plan 07)
```

## Deviations from Plan

None.

## Self-Check: PASSED

- [x] `grep -c "import DOMPurify" tripDetail.ts` → 1
- [x] `grep -c "import { setText, setStyle }" tripDetail.ts` → 1
- [x] `grep -c "DOMPurify.sanitize" tripDetail.ts` → 2
- [x] `grep "return html" tripDetail.ts` → empty (no raw returns)
- [x] `grep -c "^export function buildPopup" tripDetail.ts` → 1
- [x] `grep -c "^export function buildHotelPopup" tripDetail.ts` → 1
- [x] `grep -c "setText\|setStyle" tripDetail.ts` → ≥6
- [x] popup.test.ts tripDetail suite GREEN (2/2)
- [x] All other test suites GREEN (no regression)

Next: Plan 01-07 (harden map.ts — same pattern; export createPopupContent and createHotelPopup)
