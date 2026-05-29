# Retrospective

Living retrospective — one section per milestone, cross-milestone trends at the bottom.

---

## Milestone: v2.0 — Auth Infrastructure & Hardening

**Shipped:** 2026-05-28
**Phases:** 9 | **Plans:** 62

### What Was Built

- Terraform KC realm IaC (16 resources, idempotent apply, Mailpit replaces MailHog)
- Backend hardening: VALID_AUDIENCES env var, email-optional JWT, email_otp_codes migration, KC Admin client
- KC auth flows + theme i18n: browser-passkey default flow, VERIFY_EMAIL + SMTP, FreeMarker overrides (es/en)
- Email OTP fallback: POST /api/auth/otp-request + otp-verify; HMAC-SHA256 timing-safe; 10-min TTL; 5-attempt lockout
- Passkey campaign: WebAuthn detection, per-device cookie, last-credential guard, UPDATE_PASSWORD gated
- Playwright real-auth E2E: OIDC PKCE globalSetup, CDP Virtual Authenticator passkeys, Mailpit REST OTP tests

### What Worked

- **Wave-based parallel execution** — planning phases into waves (blocking → parallel → integration) consistently reduced dependencies and allowed safe parallelization
- **SUMMARY.md one-liners** — having a clear "one-liner" per plan made progress tracking frictionless
- **Worktree isolation for parallel plans** — executor worktrees for wave plans prevented merge conflicts
- **RED stubs before implementation** — TDD wave (RED stubs first, then GREEN) caught interface mismatches early
- **Terraform import before plan** — importing existing KC resources before `terraform apply` prevented destructive plan diffs; the import format quirks (subflow path, audience mapper UUID) were a one-time learning

### What Was Inefficient

- **REQUIREMENTS.md traceability table never updated** — all 19 v2.0 requirements were completed but the tracking table was never updated during execution; discovered only at milestone close. The execute flow should check off requirements as phases complete.
- **Phase progress table in ROADMAP.md** — similarly stale (showed Phase 7 "In Progress" and Phase 9 "Pending" at milestone close). Automation or a post-phase hook would prevent this.
- **CF Terraform provider binary blocked on Windows** — Windows App Control policy blocked the CF provider binary locally; had to defer CF module apply to CI/CD. Caught late.
- **Session limit on Phase 9 Plan 07** — worktree agent hit context limit; had to implement directly in main tree. Could have been caught earlier by scope-bounding the plan.

### Patterns Established

- `SKIP_REAL_AUTH` CI guard env var for any test requiring external services (KC, Mailpit) not available in CI
- `test.describe.configure({ mode: 'serial' })` mandatory for Mailpit-dependent OTP tests (inbox isolation)
- CDP `hasUserVerification: true` (not `haUserVerification`) — critical typo in Playwright docs; two-context login flow for clean KC OIDC redirect
- `kc_admin_pass` (not `admin_password`) as the local.tfvars field name for KC admin credentials
- Terraform import format for KC resources: subflows need `{realm}/{parentFlowAlias}/{subflowAlias}`, executions need `{realm}/{parentFlowAlias}/{executionId}`

### Key Lessons

1. **Track requirements during execution, not at close** — a post-phase hook that checks off completed requirements would prevent the stale-traceability antipattern.
2. **Validate third-party binary execution environment early** — the CF Terraform provider binary issue was only caught in Wave 5; should be a Phase 0 smoke test.
3. **Plan scope-bounding for wave parallelism** — large plans (e.g., Plan 07 in Phase 9) should be scope-bounded to fit a single session; hitting context limits mid-plan is avoidable.
4. **Terraform import is a one-time cost** — once all 16 KC resources are imported and apply is idempotent, subsequent phases that add resources are cheap; the initial import investment was worth it.

### Cost Observations

- Model mix: ~70% Sonnet, ~30% Opus (complex planning and debugging sessions)
- Sessions: ~20+ across 9 phases
- Notable: Phase 9 required 3 fix commits before execution started (blocking issues resolved from plan review); early plan-review investment paid off

---

## Cross-Milestone Trends

| Trend | v2.0 | v3.0 |
|-------|------|------|
| Requirements tracking at close | Stale (19/19 unchecked) | — |
| ROADMAP progress table accuracy | Stale at close | — |
| Wave-based parallelism effectiveness | High | — |
| Session limit hits | 1 (Phase 9 Plan 07) | — |
| External binary compatibility issues | 1 (CF Terraform on Windows) | — |
