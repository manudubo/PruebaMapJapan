---
phase: 07-backend-hardening-kc-config
plan: 02
subsystem: backend/db
tags: [drizzle, schema, migration, otp, postgres]
dependency_graph:
  requires: []
  provides: [email_otp_codes table schema, 0003 migration file]
  affects: [backend/src/db/schema.ts, backend/src/db/migrations/]
tech_stack:
  added: []
  patterns: [drizzle pgTable declaration, incremental SQL migration file]
key_files:
  created:
    - backend/src/db/migrations/0003_add_email_otp_codes.sql
  modified:
    - backend/src/db/schema.ts
decisions:
  - Migration file written in hand-written SQL style (CREATE TABLE IF NOT EXISTS, TIMESTAMPTZ, inline FK) matching 0000-0002 convention rather than drizzle-kit format -- drizzle-kit lacked journal context in the worktree and produced a full schema dump instead of incremental output
metrics:
  duration: ~8 minutes
  completed: 2026-05-20
---

# Phase 07 Plan 02: Add email_otp_codes Schema and Migration (BACK-03) Summary

**One-liner:** Drizzle `emailOtpCodes` table added to schema.ts and `0003_add_email_otp_codes.sql` migration committed matching existing hand-written SQL convention.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add emailOtpCodes table to schema.ts | 172b3d0 | backend/src/db/schema.ts |
| 2 | Generate Drizzle migration and verify SQL output | 0744b0b | backend/src/db/migrations/0003_add_email_otp_codes.sql |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] drizzle-kit generate produced full-schema dump instead of incremental migration**
- **Found during:** Task 2
- **Issue:** The worktree has no drizzle meta journal (main repo never committed `meta/`), so `drizzle-kit generate` started from index 0 and regenerated all 7 tables into `0000_superb_tarot.sql` instead of an incremental `0003_*` file
- **Fix:** Deleted the stray `0000_superb_tarot.sql` and `meta/` directory; wrote `0003_add_email_otp_codes.sql` manually in the existing hand-written SQL style matching `0000_initial.sql` format (`CREATE TABLE IF NOT EXISTS`, `TIMESTAMPTZ`, inline FK `REFERENCES "users"("id") ON DELETE CASCADE`, no statement-breakpoint markers)
- **Files modified:** backend/src/db/migrations/0003_add_email_otp_codes.sql (created)
- **Commit:** 0744b0b

## Verification Results

- `rg "emailOtpCodes" backend/src/db/schema.ts` -- passes
- `rg "email_otp_codes" backend/src/db/schema.ts` -- passes
- `rg "code_hash: text" backend/src/db/schema.ts` -- passes
- `rg "expires_at: timestamp" backend/src/db/schema.ts` -- passes
- `rg "used_at: timestamp" backend/src/db/schema.ts` -- passes (nullable, no .notNull())
- `cd backend && npm run typecheck` -- passes (exit 0)
- `backend/src/db/migrations/0003_add_email_otp_codes.sql` -- exists
- `rg "email_otp_codes" ...0003_add_email_otp_codes.sql` -- passes
- `rg "code_hash" ...0003_add_email_otp_codes.sql` -- passes
- `rg "expires_at" ...0003_add_email_otp_codes.sql` -- passes
- `rg "user_id" ...0003_add_email_otp_codes.sql` -- passes
- `cd backend && npm run test` -- 20 tests pass (4 test files)

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. Schema adds `email_otp_codes` table -- this is the in-plan `mitigate` disposition for T-07-04 (code_hash column enforces hash storage, never plaintext OTP) and T-07-05 (attempts counter column for Phase 8 lockout).

## Known Stubs

None -- schema and migration are complete artifacts. Phase 8 will wire the OTP endpoints that use this table.

## Self-Check: PASSED

- `backend/src/db/schema.ts` -- verified contains emailOtpCodes table (7 columns)
- `backend/src/db/migrations/0003_add_email_otp_codes.sql` -- verified exists with CREATE TABLE email_otp_codes
- Task 1 commit 172b3d0 -- verified in git log
- Task 2 commit 0744b0b -- verified in git log
