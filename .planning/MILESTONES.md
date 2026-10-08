# Milestones

## v3.3 UX & Product Polish (Phases 27-31)

**Status:** In progress (started 2026-10-08). Seven owner-reported items implemented by parallel agents in separate worktrees; none merged when this was written, so every status is In progress. Whoever merges updates `REQUIREMENTS.md`, `phases/TRACEABILITY.md` and this entry.
**Requirements:** UX-KC-01..03, UX-NAV-01, UX-TRIP-01, UX-TRIP-02, UX-SEARCH-01 (`REQUIREMENTS.md`, section "v3.3")
**Design doc:** `docs/design/TRIP-CREATION-UX.md` (UX-TRIP-01)

### Goal

Make the product feel finished: modern Keycloak screens that match the site, device-named passkeys, a production-correct "back to application" link, a landing page logged-in users can reach, search that matches the page you are on, and above all a trip creation flow as simple as the demo makes it look, with saved trips viewed the same way.

### Scope and dependencies

- Phase 27 (UX-KC-01..03): Keycloak theme, Terraform and deploy defaults
- Phase 28 (UX-NAV-01, UX-SEARCH-01): navigation and search scope; search depends on the API client
- Phases 29-30 (UX-TRIP-01, UX-TRIP-02): creation flow and view parity; share the trip data adapters
- Phase 31: cross-cutting validation: unit, e2e, edge cases, visual light/dark at 375 and 1280

### Known Gaps (at time of writing)

- Nothing is merged or verified; no test counts yet. QA entry is a placeholder in `qa/QA-INDEX.md`
- Production Keycloak keeps the old theme until the owner redeploys the image (the prod image has no theme today, see `STATE.md` blockers)

## Post-v3.2 batch 3 — Self-registration (REG-01..07)

**Status:** 53 commits after `d2dd404` (PR #24 as merged); merged to `main` as PR #25 (`41f43d4`), with its planning docs in PR #26 (`6d4c4f1`); sandbox-validated, real-host validation pending. Not a numbered milestone.
**Timeline:** 2026-10-08
**Stats (`git log origin/main..HEAD`):** 53 commits (49 non-merge, 4 merges), four tracks (IdP, backend, UI, integration)
**Tests as reported (not re-run for these docs):** backend 70 files / 2161 tests x3, frontend 69 files / 1488 tests, `terraform test` 23/23, `purge-unverified.test.sh` 34/34, `scripts.test.sh` 57/57, `idp-registration` 9/9 + `registration-integration` 7/7 on the real stack, self-host `stack-e2e.sh` 67/67, mocked UI Playwright 96/96 (`qa/REGISTRATION-*.md`)
**Requirements:** new REG-01..07 (`REQUIREMENTS.md`)

### Delivered

Anyone can sign up with a passkey (no password), must prove their e-mail with a 6-digit code before the API opens, and can recover by e-mail code when a device cannot use the passkey. Registration stays closed in production until the owner opens it.

### Key Accomplishments

1. Keycloak: passkey-first `registration-passkey` flow, `travelmap-recovery` least-privilege client, "Try another way" fix, optional reCAPTCHA, 9 new plan-time production guards
2. Backend: migration 0011, shared OTP core with purposes, verified-email gate over every authenticated route, recovery endpoints with anti-enumeration
3. UI: Sign up / Sign in, verification screen, passkey onboarding, `recover.html`, profile backup-password card; axe 0 violations
4. Integration: one wire-contract fixture used by both sides; the real stack found a recovery token with no roles (every recovery answered 503) and a `max_attempts` misread; both fixed
5. Operations: purge timer for never-verified accounts, `registration-stack.sh` in the Keycloak flow workflow, self-host `register verify recover` phases

### Known Gaps

- The extended `Keycloak flow` workflow has not run on GitHub Actions
- Not validated: real Funnel, real Gmail, real passkeys on the `.ts.net` rpId, reCAPTCHA, the UI against the self-host stack, Firefox/WebKit
- No per-IP sign-up throttle (stock Caddy has no rate-limit module); recovery only for accounts with a `users` row
- Reports: `qa/REGISTRATION-IDP-REPORT.md`, `REGISTRATION-BACKEND-REPORT.md`, `REGISTRATION-UI-REPORT.md`, `REGISTRATION-INTEGRATION-REPORT.md`

## Post-v3.2 batch — Production readiness (PR #24)

**Status:** PR #24, merged to `main` as `d2dd404` (head was `2d7a734`); sandbox-validated, real-server validation pending. Not a numbered milestone: it follows v3.2 and has no phases.
**Timeline:** 2026-10-04 → 2026-10-08
**Stats (`git log origin/main..HEAD`):** 89 commits (13 dated 2026-10-04, 68 on 10-07, 8 on 10-08), run as five parallel tracks plus one integration pass
**Tests as reported (`qa/INTEGRATION-REPORT.md`, not re-run for these docs):** backend 1928 (64 files), frontend 1148 (53 files), `scripts.test.sh` 52, `stack-e2e.sh` 40 on a fresh sandbox stack, real-auth Playwright 66/66 plus `uat-passkeys` 2/2
**Requirements:** A11Y-04, A11Y-05, SEC-18 closed; DEP-03 and ARCH-09 closed by the green Actions run of PR #23; new PROD-01..04 and QA-01 (`REQUIREMENTS.md`)

### Delivered

The app can be run on the owner's own server and exposed to the internet through one Tailscale Funnel host, with the API and Keycloak hardened for that exposure. The same batch fixed the two remaining accessibility items and the Nominatim leak.

### Key Accomplishments

1. Self-hosting kit: production Node server from the same Hono app, images, compose stack with Caddy, deploy / Keycloak-apply / funnel / backup / restore / update / add-user scripts, guide (`docs/SELF-HOSTING.md`); 40/40 stack checks in the sandbox
2. Internet hardening: the CORS origin typo (`manud` vs `manudubo`) fixed and defined once, env-driven CORS, a verifier that rejects ID tokens (a real one was accepted before), rate limits with trusted-proxy client IP, TLS-only SMTP, log scrubbing, HSTS and API CSP, Keycloak `production` profile; Nominatim through the backend (SEC-18)
3. Login from `trip-edit.html?tripId=N` no longer fails with an invalid `redirect_uri`; the target is restored after login
4. System QA on a Neon HTTP emulator: migration 0010 for push-built databases, `db:preflight` and readiness fixes (4 findings fixed, 7 design-level findings documented)
5. Real-auth e2e: 66/66 on a real stack after fixing four test bugs (none in the app); e2e hygiene guard; `Keycloak flow` CI workflow
6. A11Y-04/05: overlapping markers spread for target-size, landing LCP 5.4 s to 1.3 s in the sandbox

### Known Gaps

- Not validated on the real server: Tailscale Funnel client-IP forwarding, Gmail delivery, passkeys on the `.ts.net` rpId
- Neon is only an emulator; the smoke checklist is unrun
- The `Keycloak flow` workflow had not concluded on Actions when checked; PR #24's `e2e`, `idp-flow`, `accessibility` and `test-backend` were still running
- Username enumeration in the username-first flow is residual; rate limits are per process
- Informational: the owner's existing Funnel on 8443 (Home Assistant) is public; the kit does not touch it
- Reports: `qa/SELFHOST-REPORT.md`, `PROD-HARDENING.md`, `INTEGRATION-REPORT.md`, `QA-SYSTEM-REPORT.md`, `QA-FULLSTACK-REPORT.md`, `E2E-DEBT-KC-CI.md`, `A11Y-LCP-FOLLOWUP.md`; index in `qa/QA-INDEX.md`

## v3.2 — Security & Code Health Hardening

**Status:** Executed and merged to `main` as PR #23 (merge `ed49639`, all checks green on Actions); the figures below are as of the 2026-10-04 consolidation. Close with `/gsd-complete-milestone` after the owner actions in `STATE.md`
**Phases:** 20–26
**Plans:** 6 with PLAN.md (Phases 20–21); Phases 22–26 were executed from summaries only (9 summary documents)
**Timeline:** 2026-07-24 → 2026-10-04 (Phases 20–21 by 2026-07-30; Phases 22–26 and QA 2026-09-30 → 2026-10-04)
**Stats (`git log 3c147f6..HEAD`):** 151 commits plus 18 merges, 303 files changed, +30,798 / -4,212 lines (backend 99 files, frontend 108, e2e 31, Terraform/Keycloak 13, planning 39)
**Tests as last verified (2026-10-04, real Postgres 16):** backend 1524 (43 files), frontend 1042 (47 files, also under `America/Argentina/Buenos_Aires`); typecheck and production build clean. At the start of Phase 22 the counts were 34 and 101. Playwright e2e was not re-run.
**Requirements:** 82 plus 1 extra: 75 Complete, 4 Partial, 1 Deferred, 2 Unverified (`.planning/REQUIREMENTS.md`, evidence in `.planning/phases/TRACEABILITY.md`)

### Delivered

Fixed the findings of the 7-pass repo audit: the backend now builds and deploys behind CI with migrations applied first, the highest-risk security items are closed, backend tests run against a real database, user-built trips have the same fields as the demo, and the Keycloak login flow no longer lets a username alone sign in.

### Key Accomplishments

1. Closed the exploitable findings: CSPRNG OTP codes, DOM-API rendering for RSS and search results, a CSP built from the build environment (after QA showed the first version blocked the API), JWKS refresh cooldown, generic `invalid_token`, atomic OTP attempts and issuance, CORS and security headers per environment, 404 instead of 403 for foreign resources
2. Rebuilt the Keycloak browser flow. The old flow was a live authentication bypass (username only produced a token); the new one requires a credential, Terraform is the only source of realm config, and `import.sh` is safe to run against production
3. Replaced mock-based backend tests with a real ephemeral Postgres 16 harness (34 → 1524 backend tests) and added an adversarial API suite with forced race interleavings; typed the DB layer, shared one `dbMiddleware`, and added a global error handler that maps SQLSTATEs to 4xx
4. Moved integrity rules into the database: unique email, lat/lng CHECKs, one hotel per destination, cross-level date coherence triggers and an atomic `otp_issue()` function (migrations 0004–0009), because production uses the Neon HTTP driver without transactions
5. Reached editor/demo parity: optional, generic, time, maps-link and zoom fields end to end; 422 field errors; local-date parsing across 13 time zones; "Generate all days" keeps partial successes
6. Supply chain and accessibility: Leaflet bundled, content-hashed network-first service worker, gitleaks triage, axe and Lighthouse scripts, first-party PWA icons, contrast and heading fixes
7. Post-phase QA fixed demo regressions (CartoDB placeholder tiles replaced with OpenStreetMap, overview map restored, minute-based countdown) and review findings (migrate-before-deploy, same-repo-only deploys with pinned actions, schema guard, Keycloak-down states)

### Known Gaps at Close

(Written at the 2026-10-04 consolidation. Since then: ARCH-09, DEP-03 and the `test-backend` Postgres service ran green on Actions; A11Y-04/05 and SEC-18 were closed and S3 was built in the PR #24 batch above.)

- Was open at close: ARCH-09 (CI e2e green) and DEP-03 (security workflow) had never run on GitHub Actions; the Postgres service in `test-backend` was unobserved
- Partial: DEP-02 (leaked local Keycloak secret redacted but rotation unverified), SEC-17 (still Partial: the production profile enforces `ssl_required = all`, the real proxy chain is unvalidated). Closed afterwards: A11Y-04 (marker target size), A11Y-05 (landing LCP)
- Was deferred: SEC-18 (Nominatim proxy); delivered in the PR #24 batch
- No CI job runs Keycloak (S3; built later, unverified on Actions); the Neon HTTP driver path has never run on real Neon (S4)
- Production Keycloak must be re-imported with `--remove-stale-flows` and treated as exposed until then; the backend has never been deployed to production
- Verification gaps for the PR reviewer: `.planning/qa/QA-INDEX.md`

### Archive

- Roadmap: `.planning/ROADMAP.md` (archive to `.planning/milestones/v3.2-ROADMAP.md` on completion)
- Requirements: `.planning/REQUIREMENTS.md` (archive to `.planning/milestones/v3.2-REQUIREMENTS.md` on completion)

## v3.1 — E2E Stabilization

**Shipped:** 2026-07-23
**Phases:** 15–19
**Plans:** 11 total
**Timeline:** 2026-06-21 → 2026-07-23 (32 days)
**Stats:** 68 files changed, +8,837 / -343 lines (79 commits)

### Delivered

Pure stabilization milestone — no new product features. Took the E2E suite from a stale, several-commits-old failure list to a fresh authoritative triage, root-caused and fixed every real bug found (test and app), and closed with zero unexplained failures: 242 passed, 25 skipped (all documented deferrals), 0 failed.

### Key Accomplishments

1. Fresh full-suite triage established an authoritative, current failure list, and passkeys Chromium-scoping was corrected so cross-browser config bugs no longer polluted signal from subsequent fixes
2. Fixed `public-sharing.spec.ts` and `idp-theme.spec.ts` independently — self-contained `beforeAll` fixtures, valid PKCE S256 challenge, current KC 26 template assertions
3. Extracted a single shared `loginViaKcForm` helper replacing four independent, fragile KC-navigation implementations; fixed OTP route-contract mismatches and SMTP-lag false failures
4. Fixed `passkeys.spec.ts` reliability — `afterEach` authenticator cleanup, `resetCredentials` clearing stale `webauthn-register-passwordless` required actions
5. Root-caused and fixed the passkeyCampaign-driven session flakiness across multiple specs (per-device cookie pre-seed), found and fixed a real production bug (`tripDetail.ts` trip title never set for zero-destination trips), and closed the milestone with a clean 242 passed / 25 skipped / 0 failed full-suite run
6. Every environment-specific deferral documented via `test.fixme(condition, reason)` with explicit rationale — no silent skips; all 25 deferrals trace to two known, documented root causes

### Known Gaps at Close

- None — all 17 v3.1 requirements complete, 0 unexplained test failures

### Archive

- Roadmap: `.planning/milestones/v3.1-ROADMAP.md`
- Requirements: `.planning/milestones/v3.1-REQUIREMENTS.md`

## v3.0 — Quality, Polish & DevX

**Shipped:** 2026-06-15
**Phases:** 10–14
**Plans:** 19 total
**Timeline:** 2026-05-28 → 2026-06-15 (18 days)
**Stats:** 141 files changed, +20,819 / -1,325 lines

### Delivered

Brought the app from feature-complete (v2.0) to a solid, consistent state: unified design language between the app and Keycloak IDP, centralized error handling with no raw browser errors reaching users, single-command local dev environment, all KC test users as Terraform IaC, an RFC 9700 OAuth/OIDC security audit, and full new-user trip-creation E2E parity with ROPC eliminated from all test files.

### Key Accomplishments

1. Design system unification — all colors via `--jp-*` CSS custom properties; KC login page and email templates match app visual identity; theme persists across MPA navigations including Leaflet tile switching
2. Centralized error handling — `toast.ts` + global `unhandledrejection` handler across all 4 entry points; typed `ApiError` with automatic 401 → KC login redirect
3. One-command local dev + IaC-managed test users — `npm run dev` orchestrates Docker → KC health-check → backend → frontend; all 3 KC test users and strict redirect URIs Terraform-managed
4. Security hardening + audit trail — RFC 9700 checklist, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection proof
5. Full new-user E2E parity — UI-driven trip-creation flow covered end-to-end; ROPC eliminated from all specs; caught and fixed 2 real production bugs (lat/lng Zod coercion, KC token-refresh throw)
6. 30/30 v3.0 requirements verified complete, with 1 documented and accepted deviation (Phase 12 `import=true`)

### Known Gaps at Close

- Phase 11 has no `11-VERIFICATION.md` file — corroborated by live codebase evidence instead; not blocking
- 7 pre-existing failing E2E specs (idp-theme, otp, passkeys ×3, public-sharing, session-management) — out of v3.0 scope, not investigated

### Archive

- Roadmap: `.planning/milestones/v3.0-ROADMAP.md`
- Requirements: `.planning/milestones/v3.0-REQUIREMENTS.md`

## v2.0 — Auth Infrastructure & Hardening

**Shipped:** 2026-05-28
**Phases:** 1–9 (v2.0 requirements: phases 6–9)
**Plans:** 62 total
**Timeline:** 2026-05-15 → 2026-05-28 (13 days, v2.0 phases)
**Stats:** 168 files changed, +20,147 / -1,583 lines (v2.0 range)

### Delivered

Full-stack trip planning web app with hardened auth infrastructure: Terraform IaC for Keycloak realm management, email OTP fallback, post-login passkey campaign, and complete Playwright real-auth E2E coverage.

### Key Accomplishments

1. Terraform KC realm IaC — 16 KC resources managed as HCL; `terraform apply` idempotent; `--import-realm` removed; Mailpit replaces MailHog
2. Backend hardening — `VALID_AUDIENCES` env var, `email?: string` relaxation, `email_otp_codes` migration, KC Admin client operational
3. KC auth flows + theme i18n — `browser-passkey` as default flow (password ALTERNATIVE), VERIFY_EMAIL + Mailpit SMTP, FreeMarker overrides (es/en)
4. Email OTP fallback — HMAC-SHA256 timing-safe, 10-min TTL, 5-attempt lockout via Mailpit/Resend
5. Passkey campaign — WebAuthn detection, per-device cookie, last-credential guard, UPDATE_PASSWORD gated
6. Playwright real-auth E2E — OIDC PKCE globalSetup, CDP Virtual Authenticator passkeys, Mailpit REST OTP tests

### Known Deferred Items at Close: 4 (see STATE.md Deferred Items)

- Verification docs for phases 02–04 marked human_needed (pre-v2.0 era)
- Phase 03 UAT flagged by audit (status: resolved, 0 pending scenarios)

### Archive

- Roadmap: `.planning/milestones/v2.0-ROADMAP.md`
- Requirements: `.planning/milestones/v2.0-REQUIREMENTS.md`
