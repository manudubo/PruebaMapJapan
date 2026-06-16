---
phase: 14-e2e-expansion-new-user-parity
plan: "01"
subsystem: frontend/dashboard
tags: [ux, dashboard, empty-state, cta]
dependency_graph:
  requires: []
  provides: [empty-state-create-btn in renderGrid()]
  affects: [frontend/src/pages/dashboard.ts]
tech_stack:
  added: []
  patterns: [DOM createElement + createElementNS SVG construction]
key_files:
  modified:
    - frontend/src/pages/dashboard.ts
decisions:
  - Used createElementNS for SVG to match existing #new-trip-btn pattern in dashboard.html
metrics:
  duration: ~5 min
  completed: "2026-06-08T23:38:58Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 14 Plan 01: Empty-State CTA Button Summary

**One-liner:** Added `#empty-state-create-btn.btn.btn-primary` with plus SVG icon inside `renderGrid()` empty branch, wired to `openCreateForm()`, replacing stale "button above" text.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add empty-state CTA button to renderGrid() | c52392e | frontend/src/pages/dashboard.ts |

## What Was Built

Modified `renderGrid()` in `dashboard.ts` to render a "Create your first trip" button inside `.trips-empty` when `trips.length === 0`. The button:

- ID: `empty-state-create-btn`, classes: `btn btn-primary`, type: `button`
- Includes the same plus SVG icon (two `<line>` elements via `createElementNS`) as `#new-trip-btn` in the toolbar
- `marginTop: 16px` inline style for spacing below p1
- Click listener calls `openCreateForm()` — opens the existing `#create-trip-overlay`

The stale p2 paragraph ("Create your first itinerary with the button above!") was deleted. No new CSS rules added.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — the CTA button calls `openCreateForm()` which reveals an already-present hidden overlay. No new data flows, no untrusted input, no new network endpoints.

## Self-Check

- [x] `frontend/src/pages/dashboard.ts` modified and committed at c52392e
- [x] `rg "empty-state-create-btn"` matches
- [x] `rg "button above"` returns no match
- [x] `rg "Create your first trip"` matches
- [x] `tsc --noEmit` exits 0

## Self-Check: PASSED
