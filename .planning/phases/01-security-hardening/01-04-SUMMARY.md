---
phase: 01-security-hardening
plan: "04"
subsystem: backend-cors-wrangler
tags: [cors, wrangler, sec-03, sec-05, wave-2]
requires:
  - "02"
provides:
  - backend/src/middleware/cors.ts — null-origin returns null (not '*'); credentials key removed
  - backend/wrangler.toml — stale [[d1_databases]] block deleted
affects:
  - backend/src/middleware/cors.test.ts — GREEN (3/3)
  - backend/src/index.test.ts — GREEN (6/6, no regression)
tech-stack:
  added: []
  patterns: [cors-null-origin-fix]
key-files:
  created: []
  modified:
    - backend/src/middleware/cors.ts
    - backend/wrangler.toml
key-decisions:
  - `origin ?? null` — null/absent origin returns null; browser receives no ACAO header
  - `credentials: true` removed entirely (not replaced with false) — frontend is bearer-only
  - [[d1_databases]] block deleted completely — actual DB is Neon via DATABASE_URL
requirements-completed:
  - SEC-03
  - SEC-05
duration: 5 min
completed: "2026-04-27"
---

# Phase 01 Plan 04: CORS Fix + D1 Removal Summary

CORS null-origin bug fixed (`origin ?? null`), `credentials: true` removed, stale D1 block deleted from wrangler.toml. cors.test.ts GREEN (3/3); index.test.ts GREEN (6/6).

Duration: ~5 min | Tasks: 2 | Files modified: 2

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Fix `origin ?? '*'` → `origin ?? null`; remove `credentials: true` | 8b4c606 | ✓ Done |
| 2 | Remove `[[d1_databases]]` block from wrangler.toml | 3548dac | ✓ Done |

## What Was Built

- **cors.ts**: Changed `return origin ?? '*'` → `return origin ?? null` on line 18. Deleted `credentials: true,` line. Config now has keys: `origin`, `allowMethods`, `allowHeaders`, `exposeHeaders`, `maxAge` only.
- **wrangler.toml**: Deleted 6-line `[[d1_databases]]` block (was never used; Neon is the actual DB via DATABASE_URL secret).

## Verification Results

```
PASS src/middleware/cors.test.ts (3/3) — GREEN
PASS src/index.test.ts (6/6) — no regression
FAIL src/auth/keycloak.test.ts (7/7) — RED (expected; fixed in Plan 05)
grep -c "d1_databases" backend/wrangler.toml → 0
```

## Deviations from Plan

None.

## Self-Check: PASSED

- [x] `grep "origin ?? null" cors.ts` returns the fix line
- [x] `grep "origin ?? '\*'" cors.ts` returns empty
- [x] `grep "credentials" cors.ts` returns empty
- [x] cors.test.ts GREEN (3/3)
- [x] index.test.ts GREEN (6/6) — no regression
- [x] `grep -c "d1_databases" wrangler.toml` → 0
- [x] `grep -c "DB_PLACEHOLDER" wrangler.toml` → 0

Next: Plan 01-05 (validateAudience helper + realm-export.json + human checkpoint)
