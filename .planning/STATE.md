---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: E2E Stabilization
status: ready_to_execute
stopped_at: Phase 17 planned — 2 plans ready (kc-login-helper extraction + OTP fixes)
last_updated: "2026-06-22T00:00:00.000Z"
last_activity: 2026-06-22 -- Phase 17 plan-phase complete; 17-01 and 17-02 PLAN.md written
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 4
  completed_plans: 2
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-15 — v3.1 started)

**Core value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.
**Current focus:** v3.1 E2E Stabilization — get the full Playwright E2E suite green

## Current Position

Phase: 17 (OTP + Login Helper) — PLANNED, ready to execute
Next: `/gsd-execute-phase 17`
Status: Phase 16 complete — 2/2 plans done; Phase 17 planned — 2/2 plans ready

Progress: [====      ] 40% (2/5 phases complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 83 (v2.0: 62, v3.0: 19, v3.1: 2)
- Average duration: ~15 min/plan (v2.0 baseline)

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. v3.0 closed with no open decision threads.

**Phase 17 key decisions locked:**
- OTP routes are auth-gated (step-up auth, not passwordless) — specs must send Bearer JWT
- otp-request returns 201 (verified auth.ts:131); tests 1-2 must assert 201 not 200
- otp-test@local is separate from e2e-test@local; beforeAll must log in as otp-test@local
- loginViaKcForm helper: new file tests/e2e/fixtures/kc-login-helper.ts, 4 call sites wired

### Pending Todos

None.

### Blockers/Concerns

- Phase 16 E2E runtime confirmation pending: public-sharing and idp-theme specs need a live stack run (backend + KC) to confirm no regressions.

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

Last session: 2026-06-22
Stopped at: Phase 17 planned — 2 plans ready; checker passed (0 blockers)
Resume: `/gsd-execute-phase 17`
