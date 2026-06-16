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

## Milestone: v3.0 — Quality, Polish & DevX

**Shipped:** 2026-06-15
**Phases:** 5 | **Plans:** 19

### What Was Built

- Design system unification: `--jp-*` tokens across app + KC login/account/email themes; theme toggle persists across MPA navigations
- Centralized error handling: `toast.ts` + global `unhandledrejection` across all 4 entry points; typed `ApiError`; 401 auto-redirect
- One-command dev environment: `npm run dev` (Docker → KC health → backend → frontend); all 3 KC test users + strict redirect URIs as Terraform IaC
- Security audit: RFC 9700 checklist, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection test
- Full new-user E2E parity: UI-driven trip-creation flow end-to-end; ROPC eliminated from all specs

### What Worked

- **Catching real bugs via E2E, not just exercising UI** — Phase 14's new-user spec surfaced two genuine production bugs (backend lat/lng Zod coercion, KC token-refresh throw) that unit tests had missed because they never round-tripped through the real geocoder/KC flow
- **Accepting and documenting deviations instead of forcing a literal match** — Phase 12's `import=true` clause couldn't be satisfied (KC volume doesn't persist locally); recording it as an accepted override with rationale kept the milestone honest without blocking on an environment quirk outside the team's control
- **Independent phase tracks running in parallel** — Phase 12 (Terraform + dev script) had no dependency on Phases 10–11 and ran concurrently, per the roadmap's stated execution order

### What Was Inefficient

- **REQUIREMENTS.md traceability went stale again** — same antipattern flagged in the v2.0 retrospective recurred: all 30 v3.0 requirements were verified complete in phase VERIFICATION.md files but the top-level traceability table was never updated during execution, only caught and fixed at milestone close. The v2.0 "Key Lesson" (track requirements during execution) was not yet automated/enforced.
- **Phase 11 has no VERIFICATION.md at all** — a genuine gap in the artifact trail; not caught by either `audit-open` or `roadmap.analyze` since both only inspect existing files, not absence of expected ones. Resolved by accepting live-codebase corroboration instead of blocking.
- **Wave 1 worktree merges in Phase 13 produced no commits** — plans 13-01, 13-02, 13-05 had to be re-executed directly in the main context rather than merged from isolated worktrees, losing the parallelism benefit for that wave.
- **`gsd-sdk query milestone.complete` is broken in the installed CLI version** — it calls the underlying `phasesArchive` handler with empty args, dropping the `version` parameter, so it always fails with "version required for phases archive". All archival (ROADMAP.md/REQUIREMENTS.md archiving, MILESTONES.md entry, phase directory moves) had to be done manually by reading the templates and replicating the v2.0 archive format by hand.

### Patterns Established

- DEV-gated `console.debug`/`console.warn` (`if (import.meta.env.DEV) ...`) for auth-flow debugging — zero production cost, kept rather than stripped
- `z.coerce.string()` for any Zod schema field that crosses the JS-number → Postgres-numeric boundary, since the frontend sends `parseFloat()`'d numbers over the wire as JSON numbers
- `keycloak-js` token refresh: gate `updateToken(30)` behind `isTokenExpired(30)` — calling it unconditionally throws when KC issues a token with no refresh token (e.g. after silent-check-sso)
- Geocoder widgets require an explicit search-button click to commit lat/lng hidden fields — input fill alone does not trigger the geocode

### Key Lessons

1. **The "track requirements during execution" lesson from v2.0 did not stick** — it needs to become an automated checkpoint (e.g., part of the verifier or a phase-completion hook) rather than a retrospective note, or it will keep recurring every milestone.
2. **A missing VERIFICATION.md is a silent gap** — `audit-open` and `roadmap.analyze` both check disk state of expected files but neither flags an entirely absent verification report for a phase that has plans/summaries. Worth a future audit-open enhancement.
3. **Don't trust the GSD CLI's documented behavior without a smoke test** — `milestone.complete` is documented in the workflow as handling full archival but is actually broken; the workflow markdown and the installed SDK version had drifted apart. A version check or a dry-run before relying on CLI delegation would have caught this earlier.
4. **Accepted deviations are cheaper than forcing the plan's literal wording** — Phase 12's import=true couldn't be satisfied due to an environment constraint; writing the override with rationale and accepted_by/accepted_at was faster and more honest than re-litigating the plan.

### Cost Observations

- Model mix: Sonnet-only this session (no Opus escalation needed)
- Sessions: ~3-4 across 5 phases (compacted at least once)
- Notable: milestone close itself required substantial manual work (rewriting archive files by hand) due to the broken `milestone.complete` CLI command — budget for this when planning future milestone closes until the CLI is fixed

---

## Cross-Milestone Trends

| Trend | v2.0 | v3.0 |
|-------|------|------|
| Requirements tracking at close | Stale (19/19 unchecked) | Stale again (30/30 unchecked until close) |
| ROADMAP progress table accuracy | Stale at close | Stale (Phase 10/12 plan counts wrong until close) |
| Wave-based parallelism effectiveness | High | Mixed — Phase 13 Wave 1 worktree merges produced no commits, re-executed directly |
| Session limit hits | 1 (Phase 9 Plan 07) | 0 |
| External binary compatibility issues | 1 (CF Terraform on Windows) | 0 |
| GSD tooling gaps found | 0 | 2 (`milestone.complete` drops version arg; no missing-VERIFICATION.md detection) |
