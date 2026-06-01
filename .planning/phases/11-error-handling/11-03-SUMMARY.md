---
plan: 11-03
status: complete
wave: 2
completed: 2026-06-01
commits:
  - ca90747  # test(11-03): add failing client.test.ts stubs
  - 796e7be  # feat(11-03): add ApiError and 401 detection to client.ts
---

# Plan 11-03 Summary: ApiError + 401 detection in client.ts

## What was built

- **`frontend/src/api/client.ts`** — Four targeted edits:
  1. Added `login` to keycloak import + new `showToast` import from `@/modules/toast`
  2. Added `code?` to `ApiEnvelope<T>` interface
  3. Exported `ApiError extends Error` class with `status`, `code`, `name='ApiError'` fields
  4. Replaced generic `!response.ok` block with 401-first check (never-resolving `Promise<never>` + toast + login redirect) then ApiError throw for other non-ok responses

- **`frontend/tests/client.test.ts`** — 7 tests: ApiError class shape (3), 401 path (3: showToast, login scheduling, never-resolving promise), non-401 ApiError throw (1)

## Deviations from plan

The plan's test template used `void Promise.race([..., new Promise(resolve => setTimeout(() => resolve('timeout'), 50))])` with only 2 `await Promise.resolve()` ticks before assertions. This deadlocked or under-flushed with `vi.useFakeTimers()`:
- The async chain `buildHeaders → getToken → fetch` requires more than 2 microtask ticks
- The "never-resolving" test deadlocked awaiting a race whose timeout branch required fake timer advancement

**Fix:** Replaced with `void getMyTrips()` + `await vi.runAllTimersAsync()` pattern. `runAllTimersAsync` flushes all pending microtasks (the full async chain) before advancing fake timers — correct behavior with no deadlock.

## Test gate

- All 97 tests GREEN (7 new in client.test.ts + 90 existing)
- `npm run typecheck` clean
