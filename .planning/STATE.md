---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: E2E Stabilization
status: context_captured
stopped_at: Phase 17 context captured — OTP step-up auth decision + loginViaKcForm helper decisions locked
last_updated: "2026-06-22T00:00:00.000Z"
last_activity: 2026-06-22 -- Phase 17 discuss-phase complete; CONTEXT.md written
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 2
  completed_plans: 2
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-15 — v3.1 started)

**Core value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.
**Current focus:** v3.1 E2E Stabilization — get the full Playwright E2E suite green

## Current Position

Phase: 17 (OTP + Login Helper) — NOT STARTED, ready to discuss/plan
Next: `/gsd-discuss-phase 17` (recommended) or `/gsd-plan-phase 17`
Status: Phase 16 complete — 2/2 plans done; public-sharing and idp-theme specs structurally fixed

Progress: [====      ] 40% (2/5 phases complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 83 (v2.0: 62, v3.0: 19, v3.1: 2)
- Average duration: ~15 min/plan (v2.0 baseline)

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. v3.0 closed with no open decision threads.

### Pending Todos

None.

### Blockers/Concerns

- OTP route auth-gating: `backend/src/routes/auth.ts:92` gates `/api/auth/otp-request` and `/otp-verify` behind `authMiddleware`. Whether this is intentional step-up auth or a regression needs a product decision before Phase 17 planning — whichever direction, the spec must match the real contract.
- KC browser-flow shape (WebAuthn-first vs password-first) needs a live walkthrough before implementing `loginViaKcForm()` in Phase 17.
- Phase 16 E2E runtime confirmation pending: `public-sharing` and `idp-theme` specs need a live stack run (backend + KC) to confirm no regressions.

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
Stopped at: Phase 16 complete — both spec files fixed and committed
Resume: `/gsd-discuss-phase 17` (recommended) or `/gsd-plan-phase 17`
