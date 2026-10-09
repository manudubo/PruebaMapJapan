# Roadmap: TravelMap

## Milestones

- ✅ **v2.0 Auth Infrastructure & Hardening** — Phases 1–9 (shipped 2026-05-28)
- ✅ **v3.0 Quality, Polish & DevX** — Phases 10–14 (shipped 2026-06-15)
- ✅ **v3.1 E2E Stabilization** — Phases 15–19 (shipped 2026-07-23)
- ✅ **v3.2 Security & Code Health Hardening** — Phases 20–26 (executed 2026-07-24 → 2026-10-04; merged to `main` as PR #23, green on Actions; leftovers: DEP-02 and SEC-17 Partial)
- ✅ **v3.3 UX & Product Polish** — Phases 27–33 (2026-10-08 → 2026-10-09; PR #27 `c7d54dc` seven owner-reported items UX-*, PR #28 `460a449` mobile UX-MOB-01, PR #29 `38b9108` passkey-first login PKF-01..04, PR #30 `432aba5` demo-parity test TEST-PARITY-01 and iOS redirect fix UX-NAV-02, PR #31 (pending) login theme cache-busting UX-KC-04; all Complete, not validated on real devices)
- 🔄 **Production readiness (post-v3.2)** — third batch (self-registration, REG-01..07) added on top, 53 commits after `d2dd404`; second batch PR #24 (89 commits, 2026-10-04 → 2026-10-08), merged as `d2dd404`; the registration batch is merged as PR #25 (`41f43d4`), docs PR #26 (`6d4c4f1`); self-hosting kit, internet hardening, A11Y-04/05, SEC-18; validation on the owner's real server pending

## Phases

<details>
<summary>✅ v2.0 Auth Infrastructure & Hardening (Phases 1–9) — SHIPPED 2026-05-28</summary>

- [x] Phase 1: Security Hardening (8/8 plans) — completed 2026-04-27
- [x] Phase 2: Trip Builder (9/9 plans) — completed 2026-05-04
- [x] Phase 3: Public Sharing (3/3 plans) — completed 2026-05-06
- [x] Phase 4: Passkeys (2/2 plans) — completed 2026-05-09
- [x] Phase 5: Internationalization (12/12 plans) — completed 2026-05-15
- [x] Phase 6: Local Infrastructure (6/6 plans) — completed 2026-05-19
- [x] Phase 7: Backend Hardening + KC Config (9/9 plans) — completed 2026-05-24
- [x] Phase 8: OTP + Passkey Campaign (8/8 plans) — completed 2026-05-26
- [x] Phase 9: Playwright Real Auth (7/7 plans) — completed 2026-05-28

</details>

<details>
<summary>✅ v3.0 Quality, Polish & DevX (Phases 10–14) — SHIPPED 2026-06-15</summary>

- [x] Phase 10: Design Tokens + IDP Theme (4/4 plans) — completed 2026-05-31
- [x] Phase 11: Error Handling (4/4 plans) — completed 2026-06-01
- [x] Phase 12: Terraform Expansion + Dev Script (2/2 plans) — completed 2026-06-02
- [x] Phase 13: Security Audit + Documentation (5/5 plans) — completed 2026-06-07
- [x] Phase 14: E2E Expansion + New User Parity (4/4 plans) — completed 2026-06-09

</details>

<details>
<summary>✅ v3.1 E2E Stabilization (Phases 15–19) — SHIPPED 2026-07-23</summary>

- [x] Phase 15: Triage + Config (2/2 plans) — completed 2026-06-21
- [x] Phase 16: Independent Spec Fixes (2/2 plans) — completed 2026-06-22
- [x] Phase 17: OTP + Login Helper (2/2 plans) — completed 2026-06-23
- [x] Phase 18: Passkeys Fixes (2/2 plans) — completed 2026-07-13
- [x] Phase 19: Session + Closure (2/2 plans) — completed 2026-07-23

Full outcome: 242 passed, 25 skipped (documented deferrals), 0 failed. See `.planning/milestones/v3.1-ROADMAP.md` for phase-by-phase detail.

</details>

### v3.2 Security & Code Health Hardening

Synthesized from `ANALISIS-REPO.md` (7 passes, ~85 actionable findings) and `codex-review.md`. Full findings and per-item verification status in `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`. Requirements defined: `.planning/REQUIREMENTS.md` (82 requirements, 100% mapped). Status after PR #23 went green on Actions and the PR #24 batch: of these 82 plus DATA-04, 81 Complete and 2 Partial (DEP-02, SEC-17); the batch adds 5 rows (below). Per-requirement evidence: `.planning/phases/TRACEABILITY.md`. Phases 22-26 were executed from summaries only (no PLAN.md files).

- [x] **Phase 20: Critical Security** — OTP CSPRNG (SEC-01), widget XSS + CSP meta tag (SEC-02/03/04), remove `KC_ADMIN_CLIENT_SECRET` from prod Cloudflare env (SEC-14) — completed 2026-07-24 (CSP `connect-src` bug found and fixed later: `20-CSP-FOLLOWUP.md`)
- [x] **Phase 21: Deploy & Build Safety** — fix broken backend build (INFRA-03), gate deploys on CI (INFRA-01/02), pin wrangler (INFRA-04), fix KC healthcheck (INFRA-05), drizzle-orm/dompurify bumps (DEP-01)
 (completed 2026-07-30)
- [x] **Phase 22: Reliability Bugs** — all 16 confirmed bugs from the audit (BUG-01..16): drag-reorder persistence, 401 hang, first-login race, plus 13 lower-severity fixes
- [x] **Phase 23: Supply Chain, Secrets & Accessibility** — Leaflet bundled first-party (SEC-15), SW cache versioning (SEC-16), dead EXTERNAL_ASSETS (INFRA-06), Gitleaks triage + CI scanning (DEP-02/03), a11y violations (A11Y-01..05) — DEP-02 **Partial**; DEP-03 Complete since the green Actions run; A11Y-04/05 Complete in the PR #24 batch
- [x] **Phase 24: Architecture Debt & Test Coverage** — real ephemeral test DB + non-vacuous assertions (ARCH-06), CI e2e job fixed (ARCH-09), typed createDb/getDb/dbMiddleware (ARCH-01/M-01), all remaining arch/data/test debt (ARCH-02/03/05/07/08, M-02/09, PWA-01, DATA-01..03) — executed 2026-09-30 → 2026-10-03; ARCH-09 Complete (e2e job green on PR #23 head 2200c6e and on main)
- [x] **Phase 25: Business Logic & Demo Parity** — timezone date-shift bug (BIZ-11), cross-level date coherence (BIZ-07), expose is_optional/is_generic/maps_url/time/zoom_level through editor (BIZ-01..05), date-order validation (BIZ-06/08/09), remaining parity items (BIZ-10) — executed 2026-09-30 → 2026-10-03; BIZ-07 shipped as DB triggers in the follow-up
- [x] **Phase 26: Remaining Security Hardening & IdP Flow** — KC passkey flow restructure (KC-01, SEC-12), JWKS/JWT/OTP atomicity (SEC-05/06/07), remaining low-severity security findings (SEC-08..11/13/17..25) — executed 2026-09-30 → 2026-10-03; SEC-17 **Partial**; SEC-18 Complete in the PR #24 batch

### v3.3 UX & Product Polish

Owner-reported on 2026-10-08, after the registration batch (PR #25) merged. Requirements: UX-KC-01..03, UX-NAV-01, UX-TRIP-01, UX-TRIP-02, UX-SEARCH-01 (`REQUIREMENTS.md`, section "v3.3"), later UX-MOB-01, PKF-01..04, UX-KC-04, UX-NAV-02 and TEST-PARITY-01. Acceptance criteria per item are in the same file. Status: **all Complete** — PR #27 (`c7d54dc`), PR #28 (`460a449`), PR #29 (`38b9108`, passkey-first), PR #30 (`432aba5`, Phase 33: UX-NAV-02, TEST-PARITY-01) and PR #31 (pending, Phase 33: UX-KC-04). Design docs: `docs/design/TRIP-CREATION-UX.md`, `docs/design/MOBILE-COVERAGE.md`, `docs/design/PASSKEY-FIRST-LOGIN.md`. QA: `qa/UX-REPORT.md`. Phases are grouped for traceability; there are no PLAN.md files.

- [x] **Phase 27: Keycloak Screens** — redesign of every realm screen on the site/demo tokens, light/dark, mobile; one flat card on the base theme (UX-KC-01); device-derived passkey labels (UX-KC-02); the error / "back to application" link returns to the production app (UX-KC-03) — PR #27
- [x] **Phase 28: Navigation & Search Scope** — Home reaches the landing page for logged-in users (UX-NAV-01); search scope: own trips on authenticated pages, demo data on demo pages (UX-SEARCH-01) — PR #27
- [x] **Phase 29: Trip Creation Flow** — guided steps, place search, map with dashed route, day/activity editing, live preview, autosave and undo (UX-TRIP-01, the most critical objective of v3.3) — PR #27
- [x] **Phase 30: Trip View Parity** — saved trips shown like the demo, dashboard trip cards, loading / error / API-down states (UX-TRIP-02) — PR #27
- [x] **Phase 31: Cross-cutting Validation and Mobile** — unit, e2e, edge-case and visual validation (light/dark x 375/1280) in `qa/UX-REPORT.md`; mobile as a tested target with Playwright projects `mobile` and `mobile-android` and an `e2e-mobile` CI job (UX-MOB-01) — PR #27 / PR #28
- [x] **Phase 32: Passkey-first Login** — passkey prompt on load for browsers that used one, device memory, `passkey-done` credential branch, provider pin (PKF-01..04) — PR #29 (`38b9108`)
- [x] **Phase 33: Mobile-real Fixes and Parity Validation** — login theme served fresh with `?v=` cache-busting and friendly error pages (UX-KC-04, PR #31 pending), no `redirect_uri` error on iOS via `silentCheckSsoFallback: false` (UX-NAV-02, PR #30), demo-parity acceptance test (TEST-PARITY-01, PR #30; found and fixed 3 gaps, 1 documented)

Dependencies: UX-TRIP-01 and UX-TRIP-02 share the trip data adapters (API shape to editor/view model); UX-SEARCH-01 depends on the API client; UX-KC-01..03 touch the Keycloak theme and Terraform/deploy config only; UX-NAV-01 is independent.

## Phase Details

### Phase 20: Critical Security
**Goal**: The two highest-exploitability vulnerabilities (OTP RNG, widget XSS) are patched, the frontend ships a second-line-of-defense CSP, and the production Cloudflare environment no longer holds an unused admin credential
**Depends on**: Nothing (first v3.2 phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-14
**Success Criteria** (what must be TRUE):
  1. OTP codes are generated with `crypto.getRandomValues` — the `Math.random()` call at `auth.ts:123` is removed; the implementation uses a single `Uint32Array` draw (no per-digit `% 10` loop that would reintroduce modulo bias)
  2. News/events widget inserts RSS data via safe DOM methods only — zero raw `innerHTML` sinks on untrusted RSS content in `widgets.ts`; manual devtools check shows no XSS-injectable path from RSS title/description fields
  3. All 9 city HTML pages and `trip.html` include a `<meta http-equiv="Content-Security-Policy">` tag; devtools console shows 0 CSP violations on page load including map tiles loading, news widget rendering items, and weather widget fetching
  4. `terraform/cloudflare/main.tf` no longer defines `cloudflare_worker_secret.kc_admin_client_secret`; `wrangler tail` on a deployed Worker shows no `KC_ADMIN_CLIENT_SECRET` env binding; the `japan-trip-worker` Keycloak client is retained for local/test use; full E2E admin fixture (`resetCredentials`, `createUser`, `deleteUser`) still passes after the Terraform change
**Plans**: 4 plans
Plans:
- [x] 20-00-PLAN.md — Wave 0: RED test infrastructure (OTP source-audit test + widget XSS tests)
- [x] 20-01-PLAN.md — Wave 1: SEC-01 OTP CSPRNG fix + SEC-14 Terraform cleanup
- [x] 20-02-PLAN.md — Wave 1: SEC-02/03 renderList DOM API rewrite + export
- [x] 20-03-PLAN.md — Wave 2: SEC-04 CSP Vite plugin + browser-verified 0-violations
**UI hint**: yes

### Phase 21: Deploy & Build Safety
**Goal**: The backend build succeeds, production deploys are gated on CI passing, and runtime dependency vulnerabilities are closed
**Depends on**: Phase 20
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, DEP-01
**Success Criteria** (what must be TRUE):
  1. `cd backend && wrangler deploy --dry-run` exits 0 — full green build (not just the `string_decoder` error gone; both `pg` and `neon-http` code paths verified; no new unprefixed-builtin errors after the `compatibility_date` bump)
  2. `deploy-frontend.yml` and `deploy-backend.yml` require the `typecheck`/`build`/unit-test CI jobs to pass before deploying; the `e2e` job is explicitly excluded from the gate until ARCH-09 is fixed; a failing typecheck job blocks a frontend deploy
  3. `wrangler` appears as a pinned version in `backend/package.json` `devDependencies`; no `npx wrangler` in any `backend/package.json` script
  4. `docker ps` shows the Keycloak container with `healthy` status (not `unhealthy` or `health: starting`); the healthcheck uses `wget` or `/dev/tcp`, not `curl`
  5. `npm audit --workspace=backend --omit=dev` shows 0 HIGH or CRITICAL vulnerabilities; `npm audit` confirms `GHSA-gpj5-g38j-94v9` (drizzle-orm) closed by the bump to `^0.45.2`
**Plans**: 2 plans
Plans:
- [x] 21-01-PLAN.md — Wave 1: Build fix (compatibility_date) + dep bumps (drizzle-orm, hono, drizzle-kit, dompurify)
- [x] 21-02-PLAN.md — Wave 2: KC healthcheck + CI test-backend/build-backend jobs + deploy workflow_run gates

### Phase 22: Reliability Bugs
**Goal**: All 16 confirmed reliability bugs from the audit are fixed — the most user-visible first, and remaining low-severity items cleaned up
**Depends on**: Phase 21
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, BUG-12, BUG-13, BUG-14, BUG-15, BUG-16
**Success Criteria** (what must be TRUE):
  1. Activity drag-reorder persists across re-renders — dragging an activity to a new position keeps it there after a page refresh; `order_index` is updated in the optimistic swap and the API response is used to confirm state (BUG-01)
  2. A 401 response from any API call throws `ApiError(401)` immediately and triggers toast + redirect to login; no hanging promise, no dead spinner, no `setTimeout`-only redirect (BUG-02)
  3. Rapid concurrent `getMe()` calls at first login (simulated with two near-simultaneous requests) produce no 500; `auth.ts` uses `INSERT ... ON CONFLICT (keycloak_id) DO NOTHING` + re-select (BUG-03)
  4. `getHotel()` returns `null` on 404 without throwing (BUG-04); `createElement` defaults to `textContent`, raw `innerHTML` requires explicit opt-in (BUG-07); `upsertUser` is wired into the login path so KC email/name changes reflect in the app DB (BUG-08); SETUP.md documents the correct `terraform output -raw worker_client_secret` command (BUG-10)
  5. Remaining BUG-05/06/09/11/12/13/14/15/16 items pass the acceptance check in REQUIREMENTS.md (reorderActivities validates full ID set; stale `sessionStorage` comment corrected; `getUserInfo`/`getMe` use cases documented; lat/lng null uses `?? ''`; dead User-Agent header removed; `dest:any` replaced with proper narrowing; redundant query eliminated; slug regex tightened; per-user/hour OTP cap added)
**Plans**: Executed (summary-only, no PLAN.md): one pass, one commit per bug; see `phases/22-reliability-bugs/22-SUMMARY.md`
**UI hint**: yes

### Phase 23: Supply Chain, Secrets & Accessibility
**Goal**: Leaflet is bundled first-party (no CDN tags), the service worker serves fresh code to returning users, Gitleaks findings are triaged, secret/a11y scanning is added to CI, and the top a11y violations are fixed
**Depends on**: Phase 22
**Requirements**: SEC-15, SEC-16, INFRA-06, DEP-02, DEP-03, A11Y-01, A11Y-02, A11Y-03, A11Y-04, A11Y-05
**Success Criteria** (what must be TRUE):
  1. All 9 HTML files contain no `<script src="https://unpkg.com/...">` or `<link href="https://unpkg.com/...">` Leaflet CDN tags; `leaflet/dist/leaflet.css` is imported via Vite; the map still renders correctly on all city pages; `EXTERNAL_ASSETS` array in `sw.js` is removed or wired into the fetch handler (SEC-15, INFRA-06)
  2. `CACHE_NAME` in `sw.js` is derived from a build hash or version string; HTML/navigation requests use network-first or stale-while-revalidate; a redeployed app is served fresh on the next page load for a returning user with a primed cache (SEC-16)
  3. Gitleaks re-scan against HEAD shows 0 unresolved findings; all 14 prior `generic-api-key` findings are either documented as confirmed false-positives or had live keys rotated (DEP-02)
  4. `aria-expanded` is removed from `<input>` elements across all 12 affected pages; an axe-core run shows 0 `aria-allowed-attr` violations for this pattern; contrast violations on landing/dashboard/profile pages are fixed; `tripDetail.ts` `showError()` renders a proper heading element (A11Y-01..03)
  5. CI pipeline includes a Gitleaks/TruffleHog secret-scanning job and an axe/Lighthouse accessibility-scanning job; both run on each push to main (DEP-03)
**Plans**: Executed (summary-only, no PLAN.md): `phases/23-supply-chain-a11y/23-SUMMARY.md`, plus the QA follow-up `23-QA-FOLLOWUP.md`
**UI hint**: yes

### Phase 24: Architecture Debt & Test Coverage
**Goal**: Backend unit tests run against a real ephemeral DB with non-vacuous assertions, the CI e2e job is green for the first time in repo history, type safety is recovered across `createDb`/`getDb`, and structural/data-layer debt is resolved
**Depends on**: Phase 23
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-05, ARCH-06, ARCH-07, ARCH-08, ARCH-09, M-01, M-02, M-09, PWA-01, DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. Backend unit tests point `DATABASE_URL` at a real ephemeral Postgres instance (migrations applied in `globalSetup`); `toContain([200, 500])` and `toContain([404, 500])` assertions are replaced with exact expected status codes; `npm run test --workspace=backend` passes with real DB-backed assertions; a CI `test-backend` job in `ci.yml` runs these tests on every push (ARCH-06)
  2. CI `e2e` job is green — `#trips-grid`/`#dashboard-login-prompt` visibility assertions no longer time out against the preview-build context; the job that has had a 100% historical failure rate since April 2026 now has a passing run in the Actions history (ARCH-09)
  3. `createDb` return type is no longer `any`; `c.get('db')` is typed without a cast; a single `dbMiddleware` replaces the ~20 duplicated `DATABASE_URL` guard + `getDb()` blocks across `trips.ts`/`auth.ts`/`users.ts`/`public.ts`; `trips.ts` authorization cascade has unit test coverage; driver selection uses an explicit env var (not a `localhost` substring check); `resolveActivity` executes a single JOIN instead of 4 sequential SELECTs (ARCH-01, ARCH-02, ARCH-03, M-01, M-02)
  4. E2E `waitForTimeout` hard sleeps (31 instances) replaced with web-first `expect(locator)` assertions; `test.skip(condition)` calls converted to `test.fixme(condition, reason)` or removed (35 instances); per-route `catch {}` blocks log the original error before rethrowing or are removed in favor of propagation to the global `onError` handler (ARCH-07, M-09)
  5. `email_otp_codes` has an index on `user_id`/`expires_at` with an opportunistic cleanup on `otp-request`; `users.email` has a DB-level unique constraint; `lat`/`lng` columns have `CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)` constraints; PWA manifest icons use first-party/precached assets (DATA-01..03, PWA-01)
**Plans**: Executed (summary-only, no PLAN.md): `phases/24-arch-debt/24-BACKEND-SUMMARY.md` (backend/DB half) and `24-E2E-SUMMARY.md` (ARCH-07/09)

### Phase 25: Business Logic & Demo Parity
**Goal**: User-created trips have field-fidelity parity with the demo — all editor fields are wired end-to-end from form to DB to view, date validation is robust and null-safe, and the confirmed timezone date-shift bug is fixed
**Depends on**: Phase 24
**Requirements**: BIZ-01, BIZ-02, BIZ-03, BIZ-04, BIZ-05, BIZ-06, BIZ-07, BIZ-08, BIZ-09, BIZ-10, BIZ-11
**Success Criteria** (what must be TRUE):
  1. `new Date('YYYY-MM-DD')` is replaced with local-date parsing (`new Date(y, m-1, d)`) throughout the frontend; a date-only ISO string (e.g., `2026-02-22`) renders the correct local day in a negative-UTC-offset timezone (confirmed fix for the live-reproduced `America/Argentina/Buenos_Aires` day-shift bug) (BIZ-11)
  2. `start_date ≤ end_date` is validated for trip, destination, and hotel records — null-safe (validation runs only when both dates are present; partial-date records remain valid); cross-level date coherence enforced in route handlers: day date within parent destination range, destination range within parent trip range, no overlapping destination ranges within a trip (BIZ-06, BIZ-07)
  3. Activity editor exposes `is_optional` checkbox, `is_generic` toggle, `maps_url` input (or auto-derived from lat/lng), `time` field, and `zoom_level` control; these fields propagate from form → Zod schema → DB → adapter → view type; the `optional_label` phantom field is cleaned up or removed (BIZ-01..05)
  4. `lat`/`lng` validated for numeric range (`-90 ≤ lat ≤ 90`, `-180 ≤ lng ≤ 180`) in Zod schemas; PATCH schemas require at least one field (`{}` returns 422, not 200); residual Spanish strings `"Desde"`/`"Hasta"` in `tripAdapter.ts` replaced with `"From"`/`"Until"` (BIZ-08, BIZ-09, BIZ-10)
**Plans**: Executed (summary-only, no PLAN.md): `phases/25-biz-parity/25-SUMMARY.md` (BIZ-07 deferred there) and `25-BIZ07-SEC22-OTP-SUMMARY.md` (BIZ-07, SEC-22, atomic OTP issuance)
**UI hint**: yes

### Phase 26: Remaining Security Hardening & IdP Flow
**Goal**: The remaining security surface is hardened — JWKS/JWT/OTP atomicity, production secrets environment isolation, self-XSS vectors closed, security headers complete, and the Keycloak passkey flow restructured to eliminate the confirmed structural smell
**Depends on**: Phase 25
**Requirements**: SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, SEC-11, SEC-12, SEC-13, SEC-17, SEC-18, SEC-19, SEC-20, SEC-21, SEC-22, SEC-23, SEC-24, SEC-25, KC-01
**Success Criteria** (what must be TRUE):
  1. Keycloak `passkey-forms` subflow includes a `conditional-user-configured` executor wrapping the WebAuthn authenticator; E2E login passes for both a passkey-registered user and the dedicated no-passkey test user (`main.tf:170`, "no passkeys registered"); a negative E2E test asserts username-only auth (no credential) is rejected (KC-01, SEC-12)
  2. OTP attempt counter uses atomic `UPDATE ... WHERE attempts < 5 RETURNING` eliminating the TOCTOU race (SEC-07); JWKS cache force-invalidation includes a cooldown timestamp preventing DoS amplification (SEC-05); JWT verification errors return only a generic `invalid_token` body with issuer/realm detail logged server-side only (SEC-06)
  3. `profile.ts` passkey label rendered via `textContent` or `DOMPurify.sanitize` (SEC-09); `SearchBar.highlightMatch` uses safe DOM construction (SEC-10); Keycloak `error.ftl` includes `kcSanitize()` before `?no_esc` (SEC-11); `X-Content-Type-Options: nosniff` and `Permissions-Policy` headers present in `backend/src/middleware/security.ts` (SEC-20)
  4. CORS allowed origins separated by `ENVIRONMENT` — no `localhost:3000`/`:5173` in production config (SEC-23); Terraform `variables.tf` E2E user password defaults removed (SEC-19); `avatar_url`/`preferences` KC attribute mappers have `add_to_access_token: false` (SEC-25); Terraform documented as sole source of truth for `browserFlow` (SEC-13, ARCH-08)
  5. Remaining SEC-08/17/18/21/22/24 items remediated per per-item acceptance check in REQUIREMENTS.md (email fails loud in prod on missing RESEND_API_KEY; `sslRequired` verified vs Railway proxy config; Nominatim proxied or risk documented; public trip field exposure documented as intentional; `resolveDestination` returns 404 in both unauthorized and non-existent cases; health endpoint minimized or rate-limited)
**Plans**: Executed (summary-only, no PLAN.md): `phases/26-idp-flow/26-IDP-SUMMARY.md` (Keycloak/Terraform half) and `26-APPSEC-SUMMARY.md` (application half)
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Security Hardening | v2.0 | 8/8 | Complete | 2026-04-27 |
| 2. Trip Builder | v2.0 | 9/9 | Complete | 2026-05-04 |
| 3. Public Sharing | v2.0 | 3/3 | Complete | 2026-05-06 |
| 4. Passkeys | v2.0 | 2/2 | Complete | 2026-05-09 |
| 5. Internationalization | v2.0 | 12/12 | Complete | 2026-05-15 |
| 6. Local Infrastructure | v2.0 | 6/6 | Complete | 2026-05-19 |
| 7. Backend Hardening + KC Config | v2.0 | 9/9 | Complete | 2026-05-24 |
| 8. OTP + Passkey Campaign | v2.0 | 8/8 | Complete | 2026-05-26 |
| 9. Playwright Real Auth | v2.0 | 7/7 | Complete | 2026-05-28 |
| 10. Design Tokens + IDP Theme | v3.0 | 4/4 | Complete | 2026-05-31 |
| 11. Error Handling | v3.0 | 4/4 | Complete | 2026-06-01 |
| 12. Terraform Expansion + Dev Script | v3.0 | 2/2 | Complete | 2026-06-02 |
| 13. Security Audit + Documentation | v3.0 | 5/5 | Complete | 2026-06-07 |
| 14. E2E Expansion + New User Parity | v3.0 | 4/4 | Complete | 2026-06-09 |
| 15. Triage + Config | v3.1 | 2/2 | Complete | 2026-06-21 |
| 16. Independent Spec Fixes | v3.1 | 2/2 | Complete | 2026-06-22 |
| 17. OTP + Login Helper | v3.1 | 2/2 | Complete | 2026-06-23 |
| 18. Passkeys Fixes | v3.1 | 2/2 | Complete | 2026-07-13 |
| 19. Session + Closure | v3.1 | 2/2 | Complete | 2026-07-23 |
| 20. Critical Security | v3.2 | 4/4 | Complete | 2026-07-24 |
| 21. Deploy & Build Safety | v3.2 | 2/2 | Complete | 2026-07-30 |
| 22. Reliability Bugs | v3.2 | 0 plans, 1 summary | Executed (summary-only, no PLAN.md); 16/16 requirements Complete | 2026-09-30 |
| 23. Supply Chain, Secrets & Accessibility | v3.2 | 0 plans, 2 summaries | Executed (summary-only, no PLAN.md); 9/10 Complete, DEP-02 Partial (DEP-03 on the Actions run; A11Y-04/05 in the PR #24 batch) | 2026-09-30 (+ QA follow-up, 2026-10-07) |
| 24. Architecture Debt & Test Coverage | v3.2 | 0 plans, 2 summaries | Executed (summary-only, no PLAN.md); 15/15 Complete (ARCH-09 once e2e was green on Actions) | 2026-10-03 |
| 25. Business Logic & Demo Parity | v3.2 | 0 plans, 2 summaries | Executed (summary-only, no PLAN.md); 11/11 Complete (BIZ-07 in follow-up) | 2026-10-03 |
| 26. Remaining Security Hardening & IdP Flow | v3.2 | 0 plans, 2 summaries | Executed (summary-only, no PLAN.md); 18/19 Complete, SEC-17 Partial (SEC-18 in the PR #24 batch) | 2026-10-03 |
| 27. Keycloak Screens | v3.3 | n/a | Complete (UX-KC-01..03; PR #27) | 2026-10-08 |
| 28. Navigation & Search Scope | v3.3 | n/a | Complete (UX-NAV-01, UX-SEARCH-01; PR #27) | 2026-10-08 |
| 29. Trip Creation Flow | v3.3 | n/a | Complete (UX-TRIP-01; PR #27) | 2026-10-08 |
| 30. Trip View Parity | v3.3 | n/a | Complete (UX-TRIP-02; PR #27) | 2026-10-08 |
| 31. Cross-cutting Validation and Mobile | v3.3 | n/a | Complete (UX-MOB-01; PR #28, `qa/UX-REPORT.md`) | 2026-10-09 |
| 32. Passkey-first Login | v3.3 | n/a | Complete (PKF-01..04; PR #29, `38b9108`) | 2026-10-09 |
| 33. Mobile-real Fixes and Parity Validation | v3.3 | n/a | Complete (UX-NAV-02, TEST-PARITY-01; PR #30, `432aba5`) and UX-KC-04 Complete in PR #31 (pending); real-phone validation Unverified | 2026-10-09 |

## Post-phase work (v3.2, outside the original requirements)

Not part of the 82 requirements. Found by QA after Phases 22-26 and recorded in `.planning/qa/` (index: `qa/QA-INDEX.md`). Commits per item are in `phases/TRACEABILITY.md`.

- **Adversarial backend QA** (`QA-BACKEND-REPORT.md`): 11 new defects fixed (malformed-JSON 500, no body cap, path-id aliasing, JWT `exp` typing, mojibake in JWT claims, NUL bytes, `javascript:` URLs and others). The three `it.fails` it left open (SEC-07 issuance, SEC-22, BIZ-07) were closed afterwards, so the suite has no `it.fails` left.
- **Frontend QA** (`QA-FRONTEND-REPORT.md`) and follow-up (`23-QA-FOLLOWUP.md`): theme crash with blocked storage, offline PWA precache, search relevance/XSS, widget payload hardening, dark landing cards, floating search button, Keycloak-down states, double-submit trip creation, OTP requests sent to the wrong origin.
- **Demo regressions** (`QA-DEMO-FIXES.md`): CartoDB now serves "API KEY REQUIRED" tiles, so maps moved to keyless OpenStreetMap tiles (dark mode by CSS filter, attribution, tile-failure notice, SW never caches tiles); the trip overview map and Cities list lost in an earlier redesign were restored; the landing countdown became minute-based and minimalist.
- **CSP `connect-src` fix** (`20-CSP-FOLLOWUP.md`): the Phase 20 policy blocked the API origin, so every logged-in call failed in an enforcing browser. The policy is now derived from the resolved build env.
- **Review fixes** (`REVIEW-FIXES.md`): migrations run before the Worker deploys, same-repo-only deploys with pinned actions, `db:preflight` and a 503 schema guard, trip-edit survives a slow Keycloak, production-safe `import.sh`, build fails on missing CSP origins, service worker resilience.
- **Open from this work:** the CI Keycloak job (S3) was built in the PR #24 batch (below); the Neon smoke test (S4) is still not run (`qa/NEON-SMOKE-CHECKLIST.md`).

## Production readiness (post-v3.2)

Second batch, PR #24 (`git log origin/main..HEAD`: 89 commits, head `2d7a734`). Not phased: five parallel tracks, then one integration pass. Requirement rows: PROD-01..04, QA-01, plus A11Y-04, A11Y-05, SEC-18 closed (`REQUIREMENTS.md`). Evidence per item: `phases/TRACEABILITY.md`; reports in `qa/`.

Target topology: Pages frontend, and backend + Keycloak + Postgres on the owner's server `legion-server.tailad4a36.ts.net`, one Tailscale Funnel host on 443 with path routing (`/api`, `/auth`).

| Track | Delivered | Status | Report |
|-------|-----------|--------|--------|
| Self-hosting kit (PROD-01) | Node entry from the same Hono app, backend and Keycloak images, prod compose, Caddy proxy, deploy / keycloak-apply / funnel / backup / restore / update scripts, guide | Partial: sandbox stack 40/40, real server not validated | `qa/SELFHOST-REPORT.md`, `qa/INTEGRATION-REPORT.md` |
| Internet hardening (PROD-02, SEC-18) | CORS typo fix and allow-list, token strictness, rate limits, SMTP, scrubbed logs, headers, geocode proxy, Keycloak production profile | Complete (tests + live Keycloak production profile) | `qa/PROD-HARDENING.md` |
| Login redirect (PROD-03) | `loginRedirectUri()` and return-to-target after login | Complete | `qa/INTEGRATION-REPORT.md` #5 |
| System QA (PROD-04) | Migration 0010, preflight and readiness fixes, pool listener, Neon HTTP emulator suite (92 tests) | Complete on the emulator; real Neon unrun | `qa/QA-SYSTEM-REPORT.md` |
| Real-auth e2e | 66/66 real-auth Playwright on a real stack, 2/2 uat-passkeys; four test bugs fixed, none in the app | Complete (local) | `qa/QA-FULLSTACK-REPORT.md` |
| E2E hygiene and Keycloak CI job (QA-01) | Hygiene guard, 8 spec fixes, `keycloak-flow.yml` | Unverified: workflow not concluded on Actions | `qa/E2E-DEBT-KC-CI.md` |
| A11Y-04 / A11Y-05 | Marker declutter, landing LCP 5.4 s to 1.3 s (sandbox), lazy Leaflet | Complete (local measurements) | `qa/A11Y-LCP-FOLLOWUP.md` |

Progress: all tracks are merged into the branch and pass in the sandbox. On Actions, the checks for `2d7a734` on PR #24 were still running when this was written (`e2e`, `idp-flow`, `accessibility`, `test-backend`); `typecheck-frontend`, `typecheck-backend`, `build-backend`, `test-frontend`, `test-scripts` and `gitleaks` were green. Re-read them before merging.

Unvalidated gaps (none of these can be closed from a sandbox):
- Real Tailscale Funnel: `funnel.sh` only ran against a stub; whether `tailscale serve` adds the real client IP to `X-Forwarded-For` (so `TRUSTED_PROXY_HOPS=2` is right) is assumed.
- Real Gmail delivery of OTP and Keycloak mail; real passkeys on the `.ts.net` rpId in a real browser.
- Real Neon (the S4 smoke checklist); the production-profile brute-force tests (no admin client in production).
- The `Keycloak flow` workflow on Actions; Firefox/WebKit for the new specs.
- Legacy state move in `keycloak-apply.sh`, Cloudflare Tunnel and Let's Encrypt modes, `bootstrap.sh --install-*` on Ubuntu 26.04.
- Real-network LCP on GitHub Pages.

### Third batch: self-registration (REG-01..07)

PR #24 is in `main` as `d2dd404`; this batch is 53 commits on the same branch (`git log --oneline origin/main..HEAD`), four tracks and one integration pass. Registration is closed in production until the owner opens it.

| Track | Delivered | Status | Report |
|-------|-----------|--------|--------|
| IdP (REG-01, REG-05, REG-06) | Flow `registration-passkey` (no password, passkey required action), `travelmap-recovery` client, "Try another way" fix, theme link, reCAPTCHA option, production guards, purge timer | REG-01 Unverified, REG-05 Complete, REG-06 Partial (no per-IP sign-up throttle) | `qa/REGISTRATION-IDP-REPORT.md` |
| Backend (REG-02, REG-03) | Migration 0011, e-mail code verification, `403 email_not_verified` gate, recovery endpoints | Complete (real Postgres 16; Gmail not exercised) | `qa/REGISTRATION-BACKEND-REPORT.md` |
| UI (REG-04) | Sign up / Sign in, verify screen, passkey onboarding, `recover.html`, backup-password card | Complete (mocked IdP/API, Chromium) | `qa/REGISTRATION-UI-REPORT.md` |
| Integration (REG-07) | `contracts/auth-flows.json`, recovery role fix, real-stack e2e, `registration-stack.sh` in `keycloak-flow.yml`, self-host `register verify recover` | Unverified: workflow not run on Actions | `qa/REGISTRATION-INTEGRATION-REPORT.md` |

Unvalidated: GitHub Actions run of the extended `keycloak-flow.yml`; real Funnel, Gmail and passkeys on the `.ts.net` rpId; reCAPTCHA with real keys; the registration UI in a browser against the self-host stack; Firefox/WebKit. Open risk: no per-IP sign-up throttle.

Next: owner actions in `STATE.md`, then run `stack-e2e.sh` against the real host, then decide whether the Keycloak flow job becomes a required check (after about 10 green runs).

*Full v2.0 phase details in `.planning/milestones/v2.0-ROADMAP.md`*
*Full v3.0 phase details in `.planning/milestones/v3.0-ROADMAP.md`*
*Full v3.1 phase details in `.planning/milestones/v3.1-ROADMAP.md`*
