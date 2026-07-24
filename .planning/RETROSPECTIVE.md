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

## Milestone: v3.1 — E2E Stabilization

**Shipped:** 2026-07-23
**Phases:** 5 | **Plans:** 11

### What Was Built

- Fresh, authoritative full-suite E2E triage replacing a stale several-commits-old failure list; `passkeys.spec.ts` correctly scoped to `chromium-passkeys` only
- `public-sharing.spec.ts` and `idp-theme.spec.ts` fixed independently — self-contained `beforeAll` fixtures, valid PKCE S256 challenge, current KC 26 template assertions
- Single shared `loginViaKcForm` helper replacing four independent, fragile KC-navigation implementations; OTP route-contract and SMTP-lag fixes
- `passkeys.spec.ts` reliability fixes: `afterEach` authenticator cleanup, `resetCredentials` clearing stale `webauthn-register-passwordless` required actions
- Root-caused and fixed the passkeyCampaign-driven session flakiness (per-device cookie pre-seed), a dedicated `session-test@local` KC user, and a real production bug (`tripDetail.ts` trip title never set for zero-destination trips)
- Milestone closed at 242 passed / 25 skipped (all documented `test.fixme` deferrals) / 0 failed

### What Worked

- **Root-causing "flaky" failures instead of retrying them away** — the session-management webkit failures and the tripDetail.ts bug both initially looked like test flakes; isolating and repeating them (4/6 and 4/4 reruns) distinguished a genuine environment constraint (webkit + passkeyCampaign) from a real, deterministic app bug, and each got the right kind of fix
- **Requiring reproduction before accepting `test.fixme`** — every webkit deferral in this milestone has a documented rationale backed by repeated isolated runs and Keycloak log evidence, not a one-off flake accepted on faith
- **Container-log correlation** — cross-referencing Keycloak logs (`CUSTOM_REQUIRED_ACTION_ERROR`) against Playwright failures turned "test sometimes hangs" into a precise, provable root cause (Case B / passkeyCampaign redirect)
- **Advisor catch before merging** — before merging the phase-19 worktree into `main`, the advisor caught that `main`'s own working tree had uncommitted changes (some stale, some legitimate v3.2 planning work) that a naive merge/checkout would have silently destroyed. Checking `main`'s status before any worktree merge is now a hard rule going forward, not just for `git merge --no-ff` conflicts but for uncommitted state on the target branch itself

### What Was Inefficient

- **Requirements tracking at close, a third time** — v2.0 and v3.0's retrospectives both flagged that `REQUIREMENTS.md` checkboxes go stale during execution and only get fixed at milestone close. It happened again: all 17 v3.1 requirements were unchecked until this close step. The "automated checkpoint" fix proposed in both prior retrospectives still hasn't been built.
- **`gsd-sdk query milestone.complete` is still broken** — same bug documented in the v3.0 retrospective (`phasesArchive` called with empty args, dropping `version`) is present in the CLI version installed for this milestone too. Archival was done by hand again, reading the template and replicating the v2.0/v3.0 format.
- **Local dev stack instability across sessions** — Docker Keycloak/Postgres containers exited silently between sessions more than once, and a git worktree's `backend/.dev.vars` (gitignored, not copied on worktree creation) caused a *silent* per-request DB failure after one such restart — which looked exactly like a hung 25-minute test suite rather than a clear startup error. Cost significant investigation time before the root cause (missing env file, not a real hang) was found.
- **First full-suite background run used a detached subshell instead of the harness's native background-task tracking**, so the harness reported the trivial launcher script as "completed" while the real `npx playwright test` process kept running invisibly. Caught and corrected on the second attempt.

### Patterns Established

- Dedicate one KC test user per E2E spec file rather than sharing a user across specs — `logoutUser()` calls in one spec were destroying sessions another spec relied on. Standing preference now, not yet retroactively applied to older specs.
- Pre-seed the passkeyCampaign's per-device cookie (`pnk_<userId>`) via `context.addCookies()` before login in any spec that intentionally clears storageState per test — otherwise every fresh context re-triggers the full webauthn-register-passwordless redirect
- Never use `waitForLoadState('networkidle')` against a Vite dev server — the HMR WebSocket keeps the connection open indefinitely, so "idle" may never fire. Use locator-based waits instead.
- Before any worktree→main merge: check `main`'s own `git status` first, not just the merge's conflict outcome — uncommitted state on the target branch is a silent-data-loss risk a clean `git merge --no-ff` won't warn about
- When a Docker/dev-server restart is needed mid-session, verify gitignored env files (`.dev.vars`, etc.) exist in whatever directory (main repo vs. worktree) the server is being started from — don't assume "backend responds 200" means it's actually configured correctly

### Key Lessons

1. **The requirements-checkbox lesson needs to stop being a retrospective note and become an actual checkpoint.** Three milestones in a row have hit this. If it isn't automated (e.g., a hook that runs after each phase's SUMMARY.md lands), it will keep recurring — write it once, not the fourth time.
2. **A "hung" process should be diagnosed as "hung" only after ruling out silent misconfiguration.** The `.dev.vars`-missing incident cost real time because a slow/absent test run was assumed to be a flake or a timeout, when it was actually every request failing fast and retrying. Check container/service logs for hard errors before assuming a timing problem.
3. **`gsd-sdk query milestone.complete` should not be trusted without a smoke test — this is the second milestone in a row where it silently failed.** Worth filing upstream or patching locally rather than re-discovering this every close.
4. **Reproduction rigor for `test.fixme` pays off** — the extra 10-15 minutes spent running a suspected flake 4-6 times in isolation before accepting a deferral is what makes the milestone's "25 skipped, 0 failed" claim actually trustworthy rather than a rubber stamp.

### Cost Observations

- Model mix: Sonnet-only this session
- Sessions: 2 (one hit a context-compaction boundary mid-Phase-19)
- Notable: a comprehensive 7-pass repo security/code-health audit (`ANALISIS-REPO.md`, ~84 findings) was produced and synthesized into `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` alongside the milestone close — not part of v3.1 scope, but front-loads the next milestone's requirements-gathering step

---

## Cross-Milestone Trends

| Trend | v2.0 | v3.0 | v3.1 |
|-------|------|------|------|
| Requirements tracking at close | Stale (19/19 unchecked) | Stale again (30/30 unchecked until close) | Stale a third time (17/17 unchecked until close) |
| ROADMAP progress table accuracy | Stale at close | Stale (Phase 10/12 plan counts wrong until close) | Stale (Phase 18/19 status wrong until fixed mid-session) |
| Wave-based parallelism effectiveness | High | Mixed — Phase 13 Wave 1 worktree merges produced no commits, re-executed directly | N/A — single worktree used for phase 19 wave 2 work, merged cleanly |
| Session limit hits | 1 (Phase 9 Plan 07) | 0 | 1 (context compaction mid-Phase-19) |
| External binary/environment compatibility issues | 1 (CF Terraform on Windows) | 0 | 1 (worktree-local `.dev.vars` gitignored, not copied — silent DB failure after a Docker restart) |
| GSD tooling gaps found | 0 | 2 (`milestone.complete` drops version arg; no missing-VERIFICATION.md detection) | 1 confirmed recurring (`milestone.complete` still broken, same root cause as v3.0) |
