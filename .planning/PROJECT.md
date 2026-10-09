# TravelMap — Trip Planning & Visualization Web App

## What This Is

A full-stack web app for planning, visualizing, and sharing trip itineraries. Users build trips with destinations, hotels, day-by-day chronograms, and activities — all rendered on an interactive Leaflet map. Keycloak OIDC auth with passkeys and OTP fallback. Built as both a portfolio piece and a personally useful tool. v2.0 shipped a hardened auth infrastructure with Terraform IaC, email OTP fallback, passkey campaign, and Playwright real-auth E2E coverage. v3.0 shipped quality, polish, and developer experience: a unified design language between the app and Keycloak, centralized error handling, a single-command dev environment with all KC test users as IaC, an OAuth/OIDC security audit, and full new-user trip-creation E2E parity. v3.2 (merged, PR #23) hardened security and code health across the stack: reliability bugs, supply chain and accessibility, a real-Postgres test harness, DB-level data integrity, demo/editor parity, and a rebuilt Keycloak login flow. A second batch (PR #24, production readiness) adds a self-hosting kit, internet-exposure hardening, the landing LCP and marker target-size fixes, and the Nominatim proxy.

## Core Value

A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.

## Requirements

### Validated

- ✓ Backend REST API: full CRUD for trips, destinations, hotels, days, activities — existing
- ✓ Keycloak OIDC auth (PKCE + RS256 JWT verification on backend) — existing
- ✓ Dashboard: authenticated users see and create their trips — existing
- ✓ Trip detail page with Leaflet map (markers per activity/destination) — existing
- ✓ Trip builder UI: add/edit destinations, hotels, days, activities from the web — Phase 2
- ✓ Security hardening: XSS fixed (dom.ts helper + DOMPurify), CORS corrected, JWT audience tightened — Phase 1
- ✓ Public trip sharing: mark trip public/private, share via link, read-only guest view — Phase 3
- ✓ Passkeys functional: Keycloak WebAuthn passkey auth, profile page passkey management — Phase 4, 8
- ✓ Internationalization: all UI strings translated to English — Phase 5
- ✓ Terraform KC realm IaC: keycloak provider HCL; test users seeded; KC Admin worker client — Phase 6, 7, 9
- ✓ Email OTP fallback: `/api/auth/otp-request` + `otp-verify`; Mailpit local SMTP; 10-min TTL; 5-attempt lockout — Phase 8
- ✓ Passkey campaign: post-login flow, per-device cookie, last-credential guard, UPDATE_PASSWORD gated by WebAuthn support — Phase 8
- ✓ Playwright real-auth E2E: OIDC PKCE globalSetup, storageState + sessionStorage replay, kc-admin fixture, passkeys.spec.ts (CDP), otp.spec.ts (serial) — Phase 9
- ✓ Dev environment script: single-command local startup, Docker Desktop detection, color-labeled `concurrently` output — v3.0 (Phase 12)
- ✓ Terraform expansion: all KC test users (testuser, new_user_test, trip_edit_test_user) managed as IaC; strict redirect URIs, PKCE S256 enforced server-side — v3.0 (Phase 12)
- ✓ OAuth/OIDC security audit: RFC 9700 checklist with evidence, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection test — v3.0 (Phase 13)
- ✓ Documentation: README + SETUP.md + use case inventory, accurate end-to-end — v3.0 (Phase 13)
- ✓ New user feature parity with demo: full trip creation flow (map/days/activities/hotel/search), UI-driven Playwright E2E — v3.0 (Phase 14)
- ✓ Error handling: centralized `toast.ts`, global `unhandledrejection` handler, typed `ApiError`, 401 auto-redirect — v3.0 (Phase 11)
- ✓ Design consistency: `--jp-*` tokens throughout app + Keycloak IDP (login, account, email templates) — v3.0 (Phase 10)
- ✓ Theme consistency: light/dark toggle persists across all MPA flows including Leaflet tile switching — v3.0 (Phase 10)
- ✓ E2E suite stabilized: full Playwright suite green across chromium/firefox/webkit (242 passed, 25 documented deferrals, 0 unexplained failures); shared `loginViaKcForm` helper replaces four independent KC-navigation implementations; every environment-specific deferral is a `test.fixme(condition, reason)`, never a silent skip — v3.1 (Phases 15-19)

### Validated in v3.2 (executed 2026-07-24 to 2026-10-04; merged as PR #23, green on Actions)

Status per requirement is in `.planning/REQUIREMENTS.md` (after v3.3: 103 Complete, 4 Partial, 3 Unverified, 110 rows); evidence in `.planning/phases/TRACEABILITY.md`.

- ✓ Critical security: OTP from CSPRNG, widget XSS closed with DOM APIs, CSP meta built from the resolved build env, unused admin secret removed from the Cloudflare Terraform — Phase 20
- ✓ Deploy and build safety: backend builds, deploys gated on CI, wrangler pinned, Keycloak healthcheck, dependency bumps — Phase 21
- ✓ Reliability: 16 audited bugs fixed test-first (reorder persistence, 401 handling, first-login race, OTP hourly cap, and more) — Phase 22
- ✓ Supply chain and a11y: Leaflet first-party, versioned network-first service worker, gitleaks triage, axe/Lighthouse scripts, contrast and heading fixes — Phase 23 (A11Y-04/05, DEP-02 partial; DEP-03 unverified)
- ✓ Architecture and data: real-Postgres backend tests, typed DB layer, shared `dbMiddleware`, single-JOIN ownership, global error handler, migrations 0004-0007 (OTP index, unique email, lat/lng CHECKs, one hotel per destination), first-party PWA icons — Phase 24 (ARCH-09 unverified)
- ✓ Editor and demo parity: optional/generic/time/maps-link/zoom fields end to end, date and coordinate validation (422), local-date parsing, DB triggers for cross-level date coherence (migration 0008) — Phase 25
- ✓ Remaining security: JWKS cooldown, generic `invalid_token`, atomic OTP attempts and issuance (migration 0009), email transport gate, CORS and security headers by environment, no existence oracle (404), XSS sinks removed, Keycloak browser flow rebuilt (the old flow let a username alone sign in) — Phase 26 (SEC-17 partial, SEC-18 deferred)
- ✓ Post-phase QA: adversarial backend suite, frontend and service-worker QA, OpenStreetMap tiles after CartoDB began returning placeholders, restored overview map, minute-based countdown, deploy-order guard, production-safe Keycloak import script

### Validated in the production-readiness batch (PR #24; sandbox-validated, not yet on the owner's server)

Rows PROD-01..04 and QA-01, plus A11Y-04, A11Y-05, SEC-18, in `.planning/REQUIREMENTS.md`; evidence in `.planning/phases/TRACEABILITY.md`.

- ✓ Landing LCP 5.4 s to 1.3 s (sandbox), overlapping map markers spread to meet WCAG 2.2 target-size, Leaflet loaded on demand — A11Y-04/05
- ✓ Nominatim geocoding through `GET /api/geocode` (authenticated, rate-limited, cached) — SEC-18
- ✓ Internet-exposure hardening: Pages-origin typo fixed, env-driven CORS, access-token-only verifier, rate limits, TLS-only SMTP OTP, scrubbed JSON logs, Keycloak `production` profile with plan-time guards — PROD-02
- ✓ Login from pages with query strings returns to the page — PROD-03
- ✓ Upgrade path for push-built or journal-less databases (migration 0010, preflight, readiness) — PROD-04
- ✓ Real-auth Playwright suite green on a real stack (66/66 plus uat-passkeys), e2e hygiene guard — QA-01 (Keycloak CI job unverified)
- ~ Self-hosting kit (Node server from the same Hono app, compose, Caddy, Tailscale Funnel scripts, backup/restore, guide) — PROD-01, Partial: real Funnel, Gmail and passkeys not validated

### Validated in the registration batch (53 commits after `d2dd404`; sandbox-validated only)

Rows REG-01..07 in `.planning/REQUIREMENTS.md`; evidence in `.planning/phases/TRACEABILITY.md`.

- ✓ E-mail code verification and the `403 email_not_verified` gate (migration 0011), recovery by e-mail code, sign-up/verify/onboarding/recover UI, "Try another way" fix, contract fixture and real-stack e2e — REG-02..05
- ~ Passkey-first self-registration in Keycloak — REG-01 Unverified (real passkeys on the `.ts.net` host and the Actions run not seen); abuse controls — REG-06 Partial (no per-IP sign-up throttle; reCAPTCHA unvalidated); contract tests and e2e in CI — REG-07 Unverified

### Validated in v3.3 UX & Product Polish (PR #27 `c7d54dc`, PR #28 `460a449`, PR #29 `38b9108`, PR #30 `432aba5`, PR #31 pending; sandbox-validated only)

Rows UX-*, UX-MOB-01, PKF-01..04, UX-KC-04, UX-NAV-02, TEST-PARITY-01 in `.planning/REQUIREMENTS.md`; evidence in `.planning/phases/TRACEABILITY.md`; QA in `.planning/qa/UX-REPORT.md`.

- ✓ Keycloak theme rebuilt on the base theme (no PatternFly), device-generated passkey labels, production "back to application" link from deploy defaults — UX-KC-01..03
- ✓ Home reachable when logged in, search scope (own trips vs demo) — UX-NAV-01, UX-SEARCH-01
- ✓ Guided trip editor with autosave, undo and live preview; trip view parity with the demo; dashboard trip cards and states — UX-TRIP-01, UX-TRIP-02
- ✓ Mobile as a tested target (Playwright `mobile` and `mobile-android`, `e2e-mobile` CI job, 11 fixes) — UX-MOB-01
- ✓ Passkey-first login (prompt on load, private device memory, `passkey-done` branch, provider pin) — PKF-01..04, PR #29 (`38b9108`); real biometrics, Safari/iOS and Firefox not seen
- ✓ No `redirect_uri` error on iOS (`silentCheckSsoFallback: false`) — UX-NAV-02, PR #30 (`432aba5`); residual: a signed-in iOS user with a blocked SSO iframe sees the signed-out state until Sign in
- ✓ Demo-parity acceptance test (editor rebuilds the demo; structural and visual gates; 3 gaps fixed, `takayama-option-labels` documented) — TEST-PARITY-01, PR #30
- ✓ Keycloak login theme served fresh (`?v=` cache-busting against the 30-day Keycloak cache) and friendly error pages — UX-KC-04, Complete in PR #31 (pending); real iPhone, real HTTP cache and Inter webfont not seen

### Active

- [ ] Owner validation of v3.3 on real devices (iOS Safari, Android, installed PWA, biometrics), after merging PR #31, rebuilding and redeploying the Keycloak image, and re-running `keycloak-apply` after pulling `main` (see the two-step apply in `STATE.md`); enable Sign up (`REGISTRATION_ENABLED` + SMTP); optionally lengthen sessions ("remember me" is off). Residual gaps are listed in `MILESTONES.md` (v3.3, Known Gaps)

- [ ] Confirm the extended `keycloak-flow.yml` is green on Actions (REG-07); the registration batch is merged (PR #25, `41f43d4`; docs PR #26, `6d4c4f1`). Keep registration closed in production until then. Earlier: PR #24 is merged (`d2dd404`); confirm the `Keycloak flow` workflow is green on Actions (QA-01)
- [ ] Validate the self-hosting kit on the owner's server `legion-server.tailad4a36.ts.net`: Funnel client-IP forwarding (`TRUSTED_PROXY_HOPS=2`), Gmail delivery, passkeys on the `.ts.net` rpId; then close PROD-01 and SEC-17 (owner actions in `STATE.md`)
- [ ] Owner actions before any Cloudflare/Neon deploy: `MIGRATION_DATABASE_URL` secret, Neon smoke checklist, duplicate-email check; rotate the leaked local Keycloak secret (DEP-02)

### Future (deferred, unscoped)

- [ ] **Production deployment**: v3.2 made it deployable (build, CI gate, migration-before-deploy, schema guard) and PR #24 added the self-hosted route (Pages + own server behind Tailscale Funnel). Nothing is deployed yet; Cloudflare Workers + Neon + Railway remains an unscoped alternative
- [x] **Landing demo experience**: landing page with hero, overview map of all cities and countdown, no login needed (v3.2 post-phase QA, merged in PR #23)
- [ ] **Deployment runbook**: self-hosted path done (`docs/SELF-HOSTING.md`, unvalidated on the real server); Cloudflare/Railway path still undocumented
- [ ] **Real-auth E2E in CI**: partly addressed by the Keycloak CI job (IdP specs only, QA-01); SKIP_REAL_AUTH stays for the rest
- [ ] **Passkey rename**: PUT credentials/{id}/label
- [ ] **Prod rpId for passkeys**: `webauthn_rp_id` is a required production variable; the owner must choose the host name before any passkey is registered

## Current Milestone: v3.3 UX & Product Polish (shipped; owner validation pending)

Phases 27-33. Seven owner-reported items (UX-KC-01..03, UX-NAV-01, UX-TRIP-01, UX-TRIP-02, UX-SEARCH-01) shipped in PR #27 (`c7d54dc`), mobile as a tested target (UX-MOB-01) in PR #28 (`460a449`), passkey-first login (PKF-01..04) in PR #29 (`38b9108`), the demo-parity test and iOS redirect fix (TEST-PARITY-01, UX-NAV-02) in PR #30 (`432aba5`), and the login theme cache-busting fix (UX-KC-04) in PR #31 (pending). All Complete, validated in the sandbox only. Details: `ROADMAP.md`, `REQUIREMENTS.md` section "v3.3", `MILESTONES.md`, `qa/UX-REPORT.md`. Previous milestone below.

## Previous Milestone: v3.2 Security & Code Health Hardening (merged) and the production-readiness batch (PR #24)

**Goal:** Fix the ~85 actionable findings from a 7-pass live-verified repo audit — security, deploy safety, reliability bugs, dependencies, accessibility, architecture/test debt, data layer, business-logic/demo-parity, and IdP hardening.

**Target features:**
- Fix the two highest-severity live-verified findings: the backend currently fails to build (`wrangler deploy --dry-run` errors, blocking all deployment), and an unused Keycloak service account holds realm-wide `manage-users` admin permission deployed to prod
- Close the OTP RNG and widget-XSS security gaps (the two most exploitable findings)
- Gate prod deploys on CI passing, and fix the CI e2e job that has never once passed in this repo's history
- Fix the most user-visible reliability bug (activity drag-reorder not persisting visually) plus ~15 lower-severity bugs
- Close the structural gap between the trip-planner demo and what a real user can build with it — cross-level date coherence validation, the confirmed timezone date-shift bug, and exposing DB/schema fields (optional/generic activities, custom map links, zoom) through the actual editor UI
- Full detail, per-item verification status, and rationale: `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`

**Outcome so far:** all seven phases executed and merged (PR #23). The two live-verified blockers from the audit are fixed (backend builds; unused admin secret removed from Terraform). A second batch (PR #24, 89 commits) closed A11Y-04/05 and SEC-18 and added the self-hosting kit and internet hardening. Items still open are listed under Active above and in `.planning/STATE.md`.

Source: Synthesizes `ANALISIS-REPO.md` (7 read/verification passes, 2026-07-22 → 2026-07-24) and `codex-review.md` (2026-06-23 live-environment audit, largely superseded by v3.1's login-harness rewrite but still valid on security/deploy/dependency findings).

### Out of Scope

- Mobile native app — web-only by design
- Social features (likes, comments, trip following) — not needed
- AI/LLM trip suggestions — user builds manually
- Trip marketplace / public discovery feed — not a social platform
- Payment or monetization — free personal tool / portfolio project
- Java KC SPIs — all KC customization via built-in flows + FreeMarker themes only
- ROPC / username-password API auth in tests — PKCE only

## Context

**Codebase state (as of 2026-10-08: `main` at `ed49639` has v3.2; branch `claude/focused-lovelace-cryssy` at `2d7a734` adds the PR #24 batch):**
- Full-stack brownfield: Hono + Cloudflare Workers backend, Vanilla TypeScript frontend (MPA), Keycloak 26.6.1 OIDC auth
- 19 phases complete; 94 plans shipped (62 v2.0 + 19 v3.0 + 13 v3.1)
- Design: unified `--jp-*` token system across app + KC login/account/email themes; light/dark toggle persists across MPA navigations
- Error handling: centralized `toast.ts`, global `unhandledrejection` handlers, typed `ApiError`, 401 auto-redirect to KC login
- Dev environment: `npm run dev` (Docker detection → KC health wait → backend → frontend); all KC test users + strict redirect URIs as Terraform IaC
- Security: RFC 9700 checklist on file, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection coverage
- New-user flow: full UI-driven trip creation (destination/hotel/day/activity/geocoder/map/search) covered by Playwright E2E with no ROPC anywhere in the suite
- v3.2 added: backend tests on real Postgres 16 (1524 tests, 43 files), frontend 1042 tests (47 files), 10 SQL migrations (0004-0009 are v3.2), DB triggers/functions for date coherence and OTP issuance, OpenStreetMap tiles, a Keycloak browser flow that requires a credential. Last verified 2026-10-04; Playwright e2e and live Keycloak were not re-run
- PR #24 added (as reported in `.planning/qa/INTEGRATION-REPORT.md`, 2026-10-08): backend 1928 tests (64 files), frontend 1148 tests (53 files), 11 migrations (0010 reconciles push-built databases), `backend/tests/system/` (Neon HTTP emulator, upgrade path, property tests), a production Node entry (`backend/src/server.ts`), `deploy/selfhost/` (compose, Caddy, scripts; 52 script checks, 40 stack checks), `.github/workflows/keycloak-flow.yml`
- Production deployment not done (the self-hosted route is built and sandbox-proven; Cloudflare + Neon + Railway is unscoped); the backend build is fixed as of Phase 21 (2026-07-30): `wrangler deploy --dry-run` passes (nodejs_compat_v2 via `compatibility_date = "2024-09-23"`), deploy workflows are CI-gated via `workflow_run`, and deps are patched to 0 HIGH/CRITICAL advisories
- E2E suite fully stabilized (v3.1, Phases 15-19): 242 passed / 25 skipped / 0 failed on the full Playwright suite across chromium/firefox/webkit/chromium-passkeys; shared `loginViaKcForm` helper; dedicated `session-test@local` KC user eliminates cross-spec session contamination; every deferral is a documented `test.fixme`
- The 7-pass audit (`ANALISIS-REPO.md`, ~85 findings) was formalized into the v3.2 milestone (82 requirements) and executed

**Known critical constraint (carried forward):**
- `webAuthnPolicyPasswordlessRpId` must be set to the final production Keycloak host name (now the `.ts.net` name on the self-hosted route, or the Railway host) before any prod passkey registration — no migration path exists

## Constraints

- **Cost**: Free or minimal — GitHub Pages (free), Cloudflare Workers (free tier), Neon (free tier), Railway (hobby ~$5/mo for Keycloak)
- **Stack**: Committed to Hono + Cloudflare Workers + Neon + Keycloak + Vanilla TypeScript — no framework migration
- **Keycloak version**: 26.6.1 (upgraded from 25.0 in Phase 4)
- **Node.js**: 22+ required (upgraded from 20 in Phase 8)
- **No build-time secrets**: `VITE_API_URL` must not silently fall back to localhost in production builds

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla TS + Web Components (no React/Vue) | Reduces bundle size, forces clean component boundaries, good portfolio differentiator | ✓ Good — MPA architecture held up well across 9 phases |
| Hono on Cloudflare Workers | Free tier, edge performance, no cold starts, Workers-native Web Crypto for JWT | ✓ Good — zero infrastructure issues |
| Neon PostgreSQL (serverless HTTP) | Works from Cloudflare Workers without persistent connections, free tier | ✓ Good — no connection pool issues at scale |
| Keycloak on Railway | Most configurable IAM option, native passkeys/WebAuthn support, Dockerizable | ✓ Good — passkeys + OTP + AIA all work |
| MPA over SPA | Per-page TS entry points, simpler state management, clean separation | ✓ Good — no regrets |
| Drizzle ORM | TypeScript-first, lightweight, works with dual Neon/pg driver setup | ✓ Good — migrations clean |
| Real-auth via OIDC PKCE headless Chromium (not ROPC) | ROPC is legacy, passkey-only flows can't use password | ✓ Good — storageState + addInitScript workaround for Playwright bug #31108 works |
| SKIP_REAL_AUTH CI guard | KC not available in CI; avoids test failures in pipeline | — Revisit in v3.0 when KC can run in CI |
| OTP serial mode (`test.describe.configure({ mode: 'serial' })`) | Mailpit inbox isolation — parallel OTP tests would race | ✓ Good — mandatory for correctness |
| Terraform KC realm (vs realm-export.json import) | IaC: idempotent applies, no manual KC console work, auditable | ✓ Good — all 16 resources managed; import took effort but worth it |
| CF Terraform provider pinned `>= 4.0, < 5.0` | v5 removed `cloudflare_worker_secret` | ✓ Good — v4.52.7 stable |
| `testuser` created standard (not `import=true`) | KC Docker volume doesn't persist across restarts in this env; user didn't pre-exist at apply time | ✓ Good — INFRA-01 intent satisfied; deviation documented and accepted |
| Keep DEV-gated `console.debug`/`warn` in auth code | Useful for future auth debugging; silent in production builds (`import.meta.env.DEV` guard) | ✓ Good — zero production cost |
| `keycloak-js getToken()` only refreshes when `isTokenExpired(30)` | `updateToken(30)` throws when KC issues a token with no refresh token (e.g. post silent-check-sso); unconditional refresh was a latent bug | ✓ Good — real bug fix found via E2E |
| `z.coerce.string()` for lat/lng Zod schemas | Frontend sends `parseFloat()`'d numbers; `z.string()` rejected valid geocoded coordinates | ✓ Good — real bug fix found via E2E |
| Dedicated `session-test@local` KC user for `session-management.spec.ts` (v3.1 Phase 19) | Sharing `e2e-test@local` across specs caused `logoutUser()` calls in one spec to cross-contaminate KC sessions in another | ✓ Good — standing preference: every E2E spec should ideally have its own dedicated KC user going forward |
| passkeyCampaign per-device cookie pre-seeded via `context.addCookies()` before login (v3.1 Phase 19) | Every fresh test context re-triggered the full webauthn-register-passwordless required-action redirect, slowing the suite and breaking session-count assertions | ⚠️ Revisit — reliable on chromium/firefox; doesn't suppress the redirect on webkit, accepted as a documented `test.fixme` deferral |
| `waitForLoadState('networkidle')` removed from E2E waits (v3.1 Phase 19) | Vite's HMR WebSocket keeps the page perpetually non-idle in dev, causing indefinite hangs (worst on webkit) | ✓ Good — replaced with locator-based waits, no regressions |
| OpenStreetMap tiles instead of CartoDB (v3.2 QA) | CartoDB now answers every tile with a 200 "API KEY REQUIRED" placeholder; e2e stubs hid it. OSM is keyless; dark mode via CSS filter | ✓ Good — single provider config in `src/data/tiles.ts`; ⚠️ revisit if traffic grows (OSM tile policy) |
| Cross-level date rules and OTP issuance live in the database (v3.2 Phases 25/26, migrations 0008/0009) | Production uses the Neon HTTP driver, which has no interactive transactions; a route cannot hold a lock between check and write | ✓ Good — races covered by forced-interleaving tests; ⚠️ Neon driver path not yet smoke-tested |
| 404 instead of 403 for foreign resources (v3.2 SEC-22) | A 403 reveals that a resource exists | ✓ Good — identical bodies asserted on all 19 attack routes |
| Migrations run in the deploy workflow with a direct `MIGRATION_DATABASE_URL`, before `wrangler deploy` (v3.2 review) | The new Worker calls objects (`otp_issue()`, triggers) that only exist after migration | ✓ Good — plus `db:preflight` and a 503 schema guard; ⚠️ not yet run on Actions |
| CSP built from the resolved build env, production build fails on missing/invalid origins (v3.2 Phase 20 fix, review N6) | The first CSP blocked the API origin and would have broken every logged-in call in production | ✓ Good |
| Keycloak login flow: conditional passkey, otherwise password, never username-only (v3.2 KC-01) | The old REQUIRED+ALTERNATIVE layout let a username alone produce a token | ⚠️ Revisit — passkey users have no password fallback; recovery is Forgot password or admin action |
| Phases 22-26 executed from summaries without PLAN.md (v3.2) | Parallel agents on separate worktrees | ⚠️ Revisit — traceability had to be rebuilt afterwards (`phases/TRACEABILITY.md`); prefer a PLAN.md per phase |
| Self-host on the owner's server behind one Tailscale Funnel host, path routing `/api` and `/auth` (PR #24) | No domain needed, free, one TLS name; Keycloak and backend stay off the open internet except through Funnel and Caddy | ⚠️ Revisit — real Funnel, Gmail and passkeys not yet validated; the passkey rpId is fixed to this host name |
| Node server built from the same Hono app (PR #24) | One code path for Workers and Node; the Worker build is unchanged | ✓ Good — boot config reuses the app's validators after the copies drifted |
| Keycloak `production` profile with plan-time guards (PR #24) | A production misconfiguration (ssl, test users, localhost rpId, Mailpit) should fail `terraform plan`, not log in | ✓ Good — 11 negative plans; applied to a real Keycloak 26.6.1 |
| In-memory rate limiter behind a store interface (PR #24) | Exact for one Node process; no extra infrastructure | ⚠️ Revisit — per process; Workers needs a shared store or WAF rules |
| Backend-owned e-mail code verification and passkey-first sign-up (registration batch) | Keycloak core has no e-mail OTP and its registration password cannot be optional (26.6.1); Java SPIs out of scope | ⚠️ Revisit — recovery client holds `manage-users`; no per-IP sign-up throttle |
| Own SMTP client, TLS only (PR #24) | Gmail app password instead of Resend, which needs a domain | ⚠️ Revisit — Workers cannot use it; Gmail limits ~500/day |
| 69 unpushed local commits backed up to `origin/backup/2026-07-22` rather than merged straight to `main` (v3.1 session) | Deploy workflows have no CI gate and the backend fails `wrangler deploy --dry-run` — a straight merge risked pushing a broken build to a prod deploy trigger | ✓ Good — no data loss, no accidental deploy; commits later merged properly after the E2E gate was green |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
Last updated: 2026-10-09 — v3.3 UX & Product Polish shipped (PR #27 `c7d54dc`, PR #28 `460a449`, PR #29 `38b9108`, PR #30 `432aba5`; PR #31 pending); v3.2, PR #24 and the registration batch (PR #25 `41f43d4`, docs PR #26 `6d4c4f1`) merged
