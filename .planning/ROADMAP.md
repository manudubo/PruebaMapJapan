# Roadmap: TravelMap

## Milestones

- ✅ **v2.0 Auth Infrastructure & Hardening** — Phases 1–9 (shipped 2026-05-28)
- ✅ **v3.0 Quality, Polish & DevX** — Phases 10–14 (shipped 2026-06-15)
- ✅ **v3.1 E2E Stabilization** — Phases 15–19 (shipped 2026-07-23)
- 🔄 **v3.2 Security & Code Health Hardening** — Phases 20–26 (roadmap created 2026-07-24, not started)

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

Synthesized from `ANALISIS-REPO.md` (7 passes, ~85 actionable findings) and `codex-review.md`. Full findings and per-item verification status in `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`. Requirements defined: `.planning/REQUIREMENTS.md` (82 requirements, 100% mapped).

- [x] **Phase 20: Critical Security** — OTP CSPRNG (SEC-01), widget XSS + CSP meta tag (SEC-02/03/04), remove `KC_ADMIN_CLIENT_SECRET` from prod Cloudflare env (SEC-14) — completed 2026-07-24
- [ ] **Phase 21: Deploy & Build Safety** — fix broken backend build (INFRA-03), gate deploys on CI (INFRA-01/02), pin wrangler (INFRA-04), fix KC healthcheck (INFRA-05), drizzle-orm/dompurify bumps (DEP-01)
- [ ] **Phase 22: Reliability Bugs** — all 16 confirmed bugs from the audit (BUG-01..16): drag-reorder persistence, 401 hang, first-login race, plus 13 lower-severity fixes
- [ ] **Phase 23: Supply Chain, Secrets & Accessibility** — Leaflet bundled first-party (SEC-15), SW cache versioning (SEC-16), dead EXTERNAL_ASSETS (INFRA-06), Gitleaks triage + CI scanning (DEP-02/03), a11y violations (A11Y-01..05)
- [ ] **Phase 24: Architecture Debt & Test Coverage** — real ephemeral test DB + non-vacuous assertions (ARCH-06), CI e2e job fixed (ARCH-09), typed createDb/getDb/dbMiddleware (ARCH-01/M-01), all remaining arch/data/test debt (ARCH-02/03/05/07/08, M-02/09, PWA-01, DATA-01..03)
- [ ] **Phase 25: Business Logic & Demo Parity** — timezone date-shift bug (BIZ-11), cross-level date coherence (BIZ-07), expose is_optional/is_generic/maps_url/time/zoom_level through editor (BIZ-01..05), date-order validation (BIZ-06/08/09), remaining parity items (BIZ-10)
- [ ] **Phase 26: Remaining Security Hardening & IdP Flow** — KC passkey flow restructure (KC-01, SEC-12), JWKS/JWT/OTP atomicity (SEC-05/06/07), remaining low-severity security findings (SEC-08..11/13/17..25)

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
- [ ] 21-01-PLAN.md — Wave 1: Build fix (compatibility_date) + dep bumps (drizzle-orm, hono, drizzle-kit, dompurify)
- [ ] 21-02-PLAN.md — Wave 2: KC healthcheck + CI test-backend/build-backend jobs + deploy workflow_run gates

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
**Plans**: TBD
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
**Plans**: TBD
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
**Plans**: TBD

### Phase 25: Business Logic & Demo Parity
**Goal**: User-created trips have field-fidelity parity with the demo — all editor fields are wired end-to-end from form to DB to view, date validation is robust and null-safe, and the confirmed timezone date-shift bug is fixed
**Depends on**: Phase 24
**Requirements**: BIZ-01, BIZ-02, BIZ-03, BIZ-04, BIZ-05, BIZ-06, BIZ-07, BIZ-08, BIZ-09, BIZ-10, BIZ-11
**Success Criteria** (what must be TRUE):
  1. `new Date('YYYY-MM-DD')` is replaced with local-date parsing (`new Date(y, m-1, d)`) throughout the frontend; a date-only ISO string (e.g., `2026-02-22`) renders the correct local day in a negative-UTC-offset timezone (confirmed fix for the live-reproduced `America/Argentina/Buenos_Aires` day-shift bug) (BIZ-11)
  2. `start_date ≤ end_date` is validated for trip, destination, and hotel records — null-safe (validation runs only when both dates are present; partial-date records remain valid); cross-level date coherence enforced in route handlers: day date within parent destination range, destination range within parent trip range, no overlapping destination ranges within a trip (BIZ-06, BIZ-07)
  3. Activity editor exposes `is_optional` checkbox, `is_generic` toggle, `maps_url` input (or auto-derived from lat/lng), `time` field, and `zoom_level` control; these fields propagate from form → Zod schema → DB → adapter → view type; the `optional_label` phantom field is cleaned up or removed (BIZ-01..05)
  4. `lat`/`lng` validated for numeric range (`-90 ≤ lat ≤ 90`, `-180 ≤ lng ≤ 180`) in Zod schemas; PATCH schemas require at least one field (`{}` returns 422, not 200); residual Spanish strings `"Desde"`/`"Hasta"` in `tripAdapter.ts` replaced with `"From"`/`"Until"` (BIZ-08, BIZ-09, BIZ-10)
**Plans**: TBD
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
**Plans**: TBD
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
| 20. Critical Security | v3.2 | 0/4 | Not started | — |
| 21. Deploy & Build Safety | v3.2 | 0/0 | Not started | — |
| 22. Reliability Bugs | v3.2 | 0/0 | Not started | — |
| 23. Supply Chain, Secrets & Accessibility | v3.2 | 0/0 | Not started | — |
| 24. Architecture Debt & Test Coverage | v3.2 | 0/0 | Not started | — |
| 25. Business Logic & Demo Parity | v3.2 | 0/0 | Not started | — |
| 26. Remaining Security Hardening & IdP Flow | v3.2 | 0/0 | Not started | — |

*Full v2.0 phase details in `.planning/milestones/v2.0-ROADMAP.md`*
*Full v3.0 phase details in `.planning/milestones/v3.0-ROADMAP.md`*
*Full v3.1 phase details in `.planning/milestones/v3.1-ROADMAP.md`*
