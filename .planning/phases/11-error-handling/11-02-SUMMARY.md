---
phase: 11-error-handling
plan: "02"
subsystem: backend
tags: [error-handling, api, types]
dependency_graph:
  requires: []
  provides: [backend-error-codes]
  affects: [frontend-api-client]
tech_stack:
  added: []
  patterns: [typed-error-codes]
key_files:
  created: []
  modified:
    - backend/src/types/index.ts
    - backend/src/index.ts
decisions:
  - "Error code field named 'code' (optional string) added to ApiResponse<T> for typed client consumption"
  - "onError handler emits fixed enum value 'internal_error' — no stack trace or err.message forwarded to client"
metrics:
  duration: "3 minutes"
  completed: "2026-05-31T22:46:28Z"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
---

# Phase 11 Plan 02: Backend Error Codes Summary

**One-liner:** Added `code?: string` to `ApiResponse<T>` and `code: 'internal_error'` to `app.onError()` to establish the backend side of the typed error code contract.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add code field to ApiResponse and update onError | 393f96e | backend/src/types/index.ts, backend/src/index.ts |

## What Was Built

- `backend/src/types/index.ts`: Added `code?: string` field to `ApiResponse<T>` after the `error?` field
- `backend/src/index.ts`: Updated `app.onError()` to return `code: 'internal_error'` in the JSON response body

The `code` field is optional so all existing route handlers that return `ApiResponse`-shaped objects without a `code` field continue to typecheck cleanly. The `onError` handler emits a fixed string value — no dynamic data from the error object crosses the trust boundary.

## Verification

- `cd backend && npm run typecheck` — 0 errors
- `rg "code\?: string" backend/src/types/index.ts` — match at line 74 inside ApiResponse
- `rg "code: 'internal_error'" backend/src/index.ts` — match at line 42 inside onError

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None. The `code` field is a hardcoded enum value (`'internal_error'`). No stack trace, no `err.message`, no dynamic data crosses the server-to-client trust boundary. This matches threat T-11-02-01 disposition.

## Self-Check: PASSED

- `backend/src/types/index.ts` — modified, `code?: string` present at line 74
- `backend/src/index.ts` — modified, `code: 'internal_error'` present at line 42
- Commit 393f96e exists with both files
