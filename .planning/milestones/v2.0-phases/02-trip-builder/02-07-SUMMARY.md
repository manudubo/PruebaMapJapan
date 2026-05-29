---
phase: 02-trip-builder
plan: "07"
subsystem: frontend
tags: [trip-edit, days, crud, color-picker, bulk-generate, XSS-safe, smart-merge]
dependency_graph:
  requires: [02-04, 02-05, 02-06]
  provides: [days-crud-module, renderDaysSection]
  affects: [02-08]
tech_stack:
  added: []
  patterns: [singleton-modal, COLOR_MAP-hex-resolution, REVERSE_COLOR_MAP-swatch-preselect, smart-merge-Set, cloneNode-listener-swap, setText-XSS-safe]
key_files:
  created:
    - frontend/src/pages/trip-edit/days.ts
  modified:
    - frontend/src/pages/trip-edit/destinations.ts
decisions:
  - "COLOR_MAP static lookup table resolves --marker-N to hex at form submission — never sends CSS variable string to backend; prevents Zod /^#[0-9A-Fa-f]{6}$/ validation failure"
  - "REVERSE_COLOR_MAP used at edit-modal open to pre-select correct swatch from stored color_hex"
  - "generateDays builds existingDates Set from dest.days before loop — skips already-present dates, only POSTs missing ones (smart merge)"
  - "destinations.ts wired to call renderHotelSection and renderDaysSection inside dest-section-body — removes 'Hotel y días aparecerán aquí.' placeholder stub from plan 02-05/02-06"
  - "renderDaysDisplay internal function separated from renderDaysSection export — re-render after CRUD without re-registering outer context (mirrors hotels.ts pattern)"
  - "Day rows sorted by date ascending before rendering — predictable display order regardless of API insertion order"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-03"
  tasks_completed: 1
  files_created: 1
  files_modified: 1
---

# Phase 02 Plan 07: Days CRUD Module Summary

Self-contained `days.ts` module implementing add/edit/delete day flow with 8-swatch color picker (COLOR_MAP hex resolution + REVERSE_COLOR_MAP pre-selection), smart-merge bulk generate, shared confirm-overlay delete, and XSS-safe DOM manipulation. Wired into `destinations.ts` body alongside hotel section, replacing the placeholder stub.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create days.ts module (CRUD + color picker + bulk generate) + wire into destinations.ts | 9ec7ef6 | frontend/src/pages/trip-edit/days.ts, frontend/src/pages/trip-edit/destinations.ts |

## Decisions Made

1. **COLOR_MAP resolution at submit**: `selectedColor` module state holds `'--marker-N'` string (set on swatch click). At form submit: `COLOR_MAP[selectedColor] ?? null` resolves to hex (`'#ff3b30'`). The CSS variable name is never sent to the API.

2. **REVERSE_COLOR_MAP at edit open**: When opening edit modal for an existing day, `REVERSE_COLOR_MAP[day.color_hex]` maps the stored hex back to `'--marker-N'` to highlight the correct swatch. Falls through gracefully if hex is not in map (no swatch pre-selected).

3. **Smart merge with Set**: `generateDays` builds `existingDates = new Set(dest.days.map(d => d.date))` before the loop. Each ISO date is checked via `existingDates.has(iso)` — skips if present, pushes `createDay` promise if absent. `Promise.all` creates only missing days in parallel.

4. **destinations.ts wiring (deviation from plan scope)**: Plan 02-06 left `renderHotelSection` unwired (known stub). Plan 02-07's key_links specify destinations.ts must import renderDaysSection. Both were wired in the same edit to avoid two separate stubs. The body now renders: Hotel header → hotel container → Days header → days container.

5. **renderDaysDisplay internal**: Same separation as hotels.ts — public `renderDaysSection` sets module context state, internal `renderDaysDisplay` does the actual DOM rebuild (called recursively after CRUD operations).

6. **Day sort**: `[...dest.days].sort((a, b) => a.date.localeCompare(b.date))` — locale-compare on ISO `YYYY-MM-DD` strings gives chronological order without `new Date()` overhead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Wire renderHotelSection + renderDaysSection into destinations.ts**
- **Found during:** Task 1 (integration review)
- **Issue:** Plan 02-06 left `renderHotelSection` unwired. Plan 02-07 key_links require destinations.ts to import renderDaysSection. Without wiring, the module is created but never called — the days section never renders.
- **Fix:** Added imports and calls for both `renderHotelSection` and `renderDaysSection` inside `renderList()` in destinations.ts, replacing the `'Hotel y días aparecerán aquí.'` stub.
- **Files modified:** frontend/src/pages/trip-edit/destinations.ts
- **Commit:** 9ec7ef6

## Known Stubs

- Activities sub-list containers (`id="activities-${day.id}"`) are created as empty divs per day row. They will be populated by plan 02-08 (activities module). This stub is intentional and documented in the plan.

## Threat Flags

None — all threat register mitigations implemented:
- T-02-07-01: COLOR_MAP resolves --marker-N to hex before API call; backend Zod regex validates server-side
- T-02-07-02: existingDates Set prevents duplicate day creation in generateDays
- T-02-07-03: Backend resolveDay() ownership check (pre-existing, not frontend concern)
- T-02-07-04: All day fields (label, date) rendered via setText/textContent — no innerHTML path in file

## Self-Check

- [x] frontend/src/pages/trip-edit/days.ts exists
- [x] exports `renderDaysSection`
- [x] COLOR_MAP defined with all 8 --marker-N entries
- [x] REVERSE_COLOR_MAP defined
- [x] Smart merge uses existingDates Set (`existingDates.has(iso)`)
- [x] Color submit: `COLOR_MAP[selectedColor]` sends hex, not CSS var
- [x] Edit mode: REVERSE_COLOR_MAP pre-selects swatch
- [x] Contains "Se eliminarán todas las actividades de este día." (confirm copy)
- [x] Contains "Sin días. Agregá un día o usá \"Generar todos los días\"." (empty state)
- [x] No innerHTML usage (`grep "innerHTML" days.ts` returns empty)
- [x] destinations.ts imports and calls renderHotelSection and renderDaysSection
- [x] `cd frontend && npx tsc --noEmit` exits 0
- [x] Playwright smoke tests: 9 skipped, 1 passed
- [x] Commit 9ec7ef6 exists

## Self-Check: PASSED
