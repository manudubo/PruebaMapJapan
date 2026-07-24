---
phase: 20-critical-security
plan: "02"
subsystem: frontend
tags: [security, xss, dom-api, rss-widget]
dependency_graph:
  requires: ["20-00"]
  provides: ["renderList-safe-export", "sec-02-insertion-sanitization"]
  affects: ["frontend/src/modules/widgets.ts", "frontend/tests/widgets-xss.test.ts"]
tech_stack:
  added: []
  patterns: ["DOM API createElement/textContent/setAttribute for untrusted data"]
key_files:
  created: []
  modified:
    - frontend/src/modules/widgets.ts
decisions:
  - "D-02: DOM API rewrite chosen over DOMPurify for renderList"
  - "D-03: Weather widget innerHTML retained — trusted data sources"
  - "D-04: DOMPurify not added to widgets.ts"
  - "T-20-02-02: javascript: URI risk in item.link accepted — deferred to Phase 26"
metrics:
  duration: "~5 minutes"
  completed: "2026-07-24"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 20 Plan 02: renderList DOM API Rewrite Summary

DOM API rewrite of `renderList` in widgets.ts: exports the function and eliminates all innerHTML on RSS-sourced fields, closing SEC-02 and the insertion-sanitization path of SEC-03.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Rewrite renderList with DOM API, add export keyword | 1e43fcb | frontend/src/modules/widgets.ts |

## What Was Built

`renderList` in `frontend/src/modules/widgets.ts` was rewritten from a template-string + `container.innerHTML` approach to a full DOM API implementation:

- `export` keyword added — function now importable by `widgets-xss.test.ts`
- `item.title` via `cleanTitle()` → `titleSpan.textContent` (safe)
- `item.source` → `sourceSpan.textContent` (safe)
- `item.pubDate` via `formatDate()` → `time.textContent` + `time.setAttribute('datetime', ...)` (safe)
- `item.link` → `a.setAttribute('href', ...)` (safe — prevents HTML injection; javascript: URI risk accepted per T-20-02-02)
- `calUrl` from `createCalendarUrl()` → `calA.setAttribute('href', calUrl)` (safe)
- SVG calendar icon → `calA.innerHTML = '<svg>...</svg>'` (safe — hardcoded literal, no RSS data)
- `container.innerHTML = ''` at end (safe — clears prior render state, no user data)

Trusted innerHTML uses retained per D-03 (weather numerics, createWidgetsSection city names). 7 `innerHTML` occurrences remain in file, none on untrusted data.

## Verification

- `grep -n "export function renderList"` → 1 match at line 190
- `grep -n "container.innerHTML.*listItems"` → 0 matches
- `grep -c "innerHTML"` → 7 (trusted uses retained)
- `npm run typecheck` → exit 0
- `npm run test:run` → 101/101 tests pass, including all 4 `widgets-xss.test.ts` assertions

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: javascript-uri-accepted | frontend/src/modules/widgets.ts | `item.link` assigned via `setAttribute('href', ...)` — prevents HTML injection but allows `javascript:` URIs. Accepted per T-20-02-02; SEC-18 Phase 26 deferred. |

## SEC-03 Partial Closure Note

This plan closes the **insertion-sanitization path** of SEC-03 (RSS data rendered via textContent/setAttribute prevents XSS injection at the DOM boundary). The **relay-path** concern (content arriving via CORS proxies `api.allorigins.win` and `corsproxy.io`) remains open — proxy removal is SEC-18, deferred to Phase 26 per D-07.

## Self-Check: PASSED

- `frontend/src/modules/widgets.ts` modified: FOUND
- Commit `1e43fcb`: FOUND
- `widgets-xss.test.ts` (4 tests): PASSED
- `npm run typecheck`: PASSED
- Total suite (101 tests): PASSED
