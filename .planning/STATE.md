---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: E2E Stabilization
status: complete
stopped_at: v3.1 milestone shipped — Phase 19 closed, full suite 242 passed/25 skipped/0 failed
last_updated: "2026-07-23T22:00:00.000Z"
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-22 — v3.2 candidate added)

**Core value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.
**Current focus:** v3.1 shipped. Next: formalize v3.2 candidate via `/gsd-new-milestone` (not started)

## Current Position

Phase: 19 (Session + Closure) — COMPLETE
Plan: 2 of 2 (19-02) — done
Next: Formalize `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` into a real milestone when ready
Status: v3.1 E2E Stabilization milestone complete

Progress: [==========] 100% (5/5 phases complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 85 (v2.0: 62, v3.0: 19, v3.1: 4)
- Average duration: ~15 min/plan (v2.0 baseline)

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. v3.0 closed with no open decision threads.

**Phase 17 key decisions locked:**

- OTP routes are auth-gated (step-up auth, not passwordless) — specs must send Bearer JWT
- otp-request returns 201 (verified auth.ts:131); tests 1-2 must assert 201 not 200
- otp-test@local is separate from e2e-test@local; beforeAll must log in as otp-test@local
- loginViaKcForm helper: new file tests/e2e/fixtures/kc-login-helper.ts, 4 call sites wired

**Phase 19 key decisions locked:**

- session-management.spec.ts gets its own dedicated Terraform-provisioned KC user (`session-test@local`) instead of sharing `TEST_USER`/`e2e-test@local` with auth.spec.ts/public-sharing.spec.ts — its `logoutUser()` calls were destroying sessions globally for whichever user it used, cross-contaminating any other spec sharing that user on firefox/webkit. User's stated broader preference: every E2E spec should ideally have its own dedicated user (not retroactively applied to other specs without explicit direction — noted for future E2E work).
- 69 local commits on `main` were unpushed for an extended period; backed up to `origin/backup/2026-07-22` rather than pushed to `main` directly, because `deploy-frontend.yml`/`deploy-backend.yml` trigger on push-to-main with no CI gate, and the backend currently fails `wrangler deploy --dry-run` (tracked as v3.2 candidate INFRA-01/INFRA-02).

### Pending Todos

- Formalize `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` into a real milestone via `/gsd-new-milestone` when ready to start v3.2.

### Blockers/Concerns

- Local dev stack (Docker Keycloak/Postgres, backend, frontend) has been intermittently going down between sessions — restart and re-verify before trusting any "stack is up" assumption from a prior turn. Note: a git worktree's `backend/.dev.vars` is gitignored and NOT copied on worktree creation — if the backend was ever restarted from within a worktree, verify `.dev.vars` exists there before trusting DB-backed test results (observed 2026-07-23: missing `.dev.vars` caused silent per-request DB failures that looked like a hung test suite rather than a clear startup error).

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| DEPLOY | Production deployment (Cloudflare + Neon + Railway) | Deferred, unscoped | v1.0 planning |
| DEMO | Landing demo experience | Deferred, unscoped | v1.0 planning |
| PASS | Rename passkey (PUT credentials/{id}/label) | Deferred, unscoped | v1.0 planning |
| PROD | prod rpId for passkeys (Railway hostname in Terraform) | Deferred, unscoped | Phase 09 |
| PROD | Real-auth E2E in CI (requires KC in CI environment) | Deferred, unscoped | Phase 09 |
| E2E | OTP brute-force lockout: add `attackDetection.del` to `beforeEach` | Deferred to future | v3.1 planning |
| E2E | Per-recipient Mailpit isolation (`search?query=to:...`) | Deferred to future | v3.1 planning |

## Session Continuity

Last session: 2026-07-23
Stopped at: v3.1 milestone complete — Phase 19 closed, worktree merged and removed
Resume: start v3.2 planning via `/gsd-new-milestone` when ready, or pick up any other backlog item
