# Requirements: TravelMap v3.2 Security & Code Health Hardening

**Defined:** 2026-07-24
**Core Value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.

Source: `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` (synthesized from `ANALISIS-REPO.md` 7-pass live-verified audit + `codex-review.md`).

## v3.2 Requirements

Checked = `Complete`. Unchecked items carry a bold status tag (`Partial`, `Deferred`, `Unverified`); details are in the Traceability table below. Items added by the second batch (PR #24) are in the last section of this list.

### Security: Critical & High — Phase 20

- [x] **SEC-01**: OTP codes are generated using a CSPRNG with no modulo bias (`crypto.getRandomValues` — not `Math.random()`)
- [x] **SEC-02**: News/events widget sanitizes RSS fields before inserting into the DOM (no raw `innerHTML` sinks on untrusted data)
- [x] **SEC-03**: Widget RSS content is fetched from a trusted source or sanitized at ingestion, not blindly relayed from arbitrary third-party CORS proxies
- [x] **SEC-04**: Frontend ships a Content Security Policy via `<meta http-equiv>` as a second line of defense against XSS
- [x] **SEC-14**: `KC_ADMIN_CLIENT_SECRET` is removed from production Cloudflare Workers environment; Keycloak `japan-trip-worker` client is kept for local/test use only

### Deploy & Build Safety — Phase 21

- [x] **INFRA-01**: `deploy-frontend.yml`/`deploy-backend.yml` gate on `typecheck`/`build`/unit-test CI jobs before deploying (explicitly excluding the `e2e` job until ARCH-09 is fixed)
- [x] **INFRA-02**: Backend deploy workflow runs typecheck/tests before `wrangler deploy`; a backend CI unit-test job exists in `ci.yml`
- [x] **INFRA-03**: Backend build succeeds on `wrangler deploy --dry-run` (`compatibility_date` updated to ≥ 2024-09-23 to resolve `string_decoder` builtin gap)
- [x] **INFRA-04**: `wrangler` is pinned as a `devDependency` in `backend/package.json` (no more `npx wrangler` pulling latest on each run)
- [x] **INFRA-05**: Keycloak Docker healthcheck uses a method available in the `quay.io/keycloak/keycloak:26.6.1` image (`wget`/`/dev/tcp`) instead of `curl`
- [x] **DEP-01**: `drizzle-orm` upgraded to `^0.45.2` and `dompurify` upgraded to `^3.4.12` (runtime dependency vulnerabilities resolved; not the RQBv2/1.0 rewrite — targeted minor bump only)

### Reliability Bugs — Phase 22

- [x] **BUG-01**: Activity drag-reorder persists visually — `order_index` is updated in the optimistic array swap and the API response is used to confirm state (not discarded)
- [x] **BUG-02**: `request()` API client throws `ApiError(401)` on 401 responses instead of hanging indefinitely
- [x] **BUG-03**: First-login race condition resolved — user creation uses `INSERT ... ON CONFLICT (keycloak_id) DO NOTHING` + re-select
- [x] **BUG-04**: `getHotel()` returns `null` on 404 instead of throwing an unhandled error
- [x] **BUG-05**: `reorderActivities` backend validates that `orderedIds` covers the full activity set for the day
- [x] **BUG-06**: Stale comment in `keycloak.ts:32` corrected — tokens live in keycloak-js memory, not `sessionStorage`
- [x] **BUG-07**: `createElement` DOM helper does not expose an `html` path by default; raw HTML insertion requires an explicit opt-in; default path uses `textContent`
- [x] **BUG-08**: `upsertUser` is wired into the login path so email/name changes in Keycloak are reflected in the app DB (no more stale user records)
- [x] **BUG-09**: `getUserInfo()` (JWT-local) and `getMe()` (backend) sources of truth are documented per use case to prevent divergence confusion
- [x] **BUG-10**: `terraform output` command in SETUP.md matches the actual Terraform output name (`worker_client_secret`)
- [x] **BUG-11**: Activity lat/lng null handling uses `act.lat ?? ''` instead of `String(act.lat)` (prevents literal `"null"` string)
- [x] **BUG-12**: Dead `User-Agent` header removed from Nominatim browser fetch (browser overrides it silently — the comment describing server-fetch behavior is wrong)
- [x] **BUG-13**: `dest: any`/`day: any` cast in `trips.ts:132` replaced with proper type narrowing
- [x] **BUG-14**: Redundant double-query in `getTripById` (select followed by findFirst with same `where`) eliminated
- [x] **BUG-15**: Slug regex tightened to match an actual UUID pattern (not just `[0-9a-f-]{36}`)
- [x] **BUG-16**: Per-user/hour cap added to OTP issuance to prevent cycling attack (request OTP → exhaust 5 attempts → burn → repeat, throttled only by email rate)

### Supply Chain, Secrets & Accessibility — Phase 23

- [x] **SEC-15**: CDN `<script>`/`<link>` Leaflet tags removed from all 9 HTML pages; `leaflet/dist/leaflet.css` imported via Vite (same-origin, build-hashed — pairs with INFRA-06)
- [x] **SEC-16**: Service worker `CACHE_NAME` derived from build hash/version; HTML/navigation requests switch to network-first or stale-while-revalidate (not cache-first with a hardcoded, never-rotating key)
- [x] **INFRA-06**: Dead `EXTERNAL_ASSETS` array removed from `sw.js` (or wired into the fetch handler if offline map support is intended — currently unreachable code)
- [ ] **DEP-02**: Gitleaks full-history re-scan completed against HEAD; all 14 `generic-api-key` findings triaged (confirmed false-positives documented; any live keys rotated) **[Partial]**
- [x] **DEP-03**: CI pipeline includes Gitleaks/TruffleHog secret scanning and axe/Lighthouse accessibility scanning so regressions are caught automatically
- [x] **A11Y-01**: `aria-expanded` attribute removed from `<input>` elements across all 12 affected pages (invalid ARIA role/attribute combo — highest-leverage a11y fix)
- [x] **A11Y-02**: Contrast violations fixed on landing page (`.demo-countdown-title`, loading span), dashboard `.nav-link`, and profile page (13 nodes)
- [x] **A11Y-03**: `tripDetail.ts`'s `showError()` error-render path includes a proper heading element (currently wipes `<main>` and rebuilds with no `<h1>`)
- [x] **A11Y-04**: `tokyo.html` heading-order and target-size violations resolved
- [x] **A11Y-05**: Mobile LCP improved for landing and Tokyo pages (Lighthouse mobile-throttled baseline: landing 5.856s, Tokyo 6.261s)

### Architecture Debt & Test Coverage — Phase 24

- [x] **ARCH-01**: `createDb` returns a typed union (`NeonDb | PgDb`) instead of `any` (cascades into `trips.ts:132` type recovery)
- [x] **ARCH-02**: Dual DB driver selection uses an explicit env var (not a `localhost` substring match on the connection string)
- [x] **ARCH-03**: `trips.ts` authorization cascade has unit test coverage (unblocked by ARCH-06)
- [x] **ARCH-05**: Zod schemas include null-safe `.refine()` guards for `start_date ≤ end_date` (trip/destination/hotel) and lat/lng numeric range; `.partial()` PATCH schemas require at least one field
- [x] **ARCH-06**: Backend unit tests point `DATABASE_URL` at a real ephemeral Postgres DB (migrations + minimal seed); vacuous `toContain([200, 500])` assertions replaced with real assertions
- [x] **ARCH-07**: E2E suite `waitForTimeout` hard sleeps replaced with web-first `expect(locator)` assertions (31 instances); conditional `test.skip()` calls converted to documented `test.fixme(condition, reason)` or removed (35 instances)
- [x] **ARCH-08**: Terraform documented as sole source of truth for KC realm config; `apply-local-settings.sh` browserFlow override documented or removed; vestigial `realm-export.json` deleted or regenerated (tracked as SEC-13)
- [x] **ARCH-09**: CI `e2e` job is green (100% historical failure rate since April 2026 — `#trips-grid`/`#dashboard-login-prompt` timing assertions fixed for preview-build context)
- [x] **M-01**: `DATABASE_URL`/`getDb` middleware extracted to a shared helper, eliminating ~20 duplicated guard blocks across `trips.ts`/`auth.ts`/`users.ts`/`public.ts`
- [x] **M-02**: `resolveActivity` uses a single JOIN query instead of 4 sequential SELECTs
- [x] **M-09**: Per-route `catch {}` blocks log the original error before rethrowing (or removed in favor of propagation to the global `onError` handler — currently makes prod 500s undiagnosable from `wrangler tail`)
- [x] **PWA-01**: PWA manifest icons use first-party/precached assets instead of remote CDN URLs
- [x] **DATA-01**: `email_otp_codes` table has an index on `user_id`/`expires_at`; used/expired rows are cleaned up (cleanup job or opportunistic delete on `otp-request`)
- [x] **DATA-02**: `users.email` has a unique constraint at the DB level (not just Keycloak-enforced upstream)
- [x] **DATA-03**: `lat`/`lng` columns have `CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)` DB constraint
- [x] **DATA-04** *(added during Phase 24, not in the original audit list)*: `hotels` has at most one row per destination (unique index on `destination_id`, atomic `INSERT ... ON CONFLICT` upsert); concurrent PUTs previously left several rows

### Business Logic & Demo Parity — Phase 25

- [x] **BIZ-01**: Optional/alternative activities can be created from the editor UI (`is_optional` checkbox; `optional_label` phantom-field cleaned up or removed from `ApiActivity` type)
- [x] **BIZ-02**: Generic/area markers (`is_generic`) can be set from the editor UI; `CreateActivitySchema`/`UpdateActivitySchema` accept it; backend no longer silently drops the field
- [x] **BIZ-03**: `activities.maps_url` field propagates through the adapter into the view type; editor exposes an input for it (or auto-derives from lat/lng); static `getMapsUrl(name)` table kept as demo-data fallback only
- [x] **BIZ-04**: Activity `time` field mapped through the adapter to the shared/public view (no longer silently dropped after being stored)
- [x] **BIZ-05**: Per-destination map zoom adjustable from the editor (`zoom_level` form control — currently defaults to 12 for all user-created destinations)
- [x] **BIZ-06**: `start_date ≤ end_date` validated for trip, destination, and hotel records (null-safe — only when both dates are present; partial-date trips are valid)
- [x] **BIZ-07**: Cross-level date coherence validated in route handlers: day date within parent destination range, destination range within parent trip range, no overlapping destination ranges within a trip
- [x] **BIZ-08**: Activity lat/lng validated for numeric range in Zod schemas (`-90 ≤ lat ≤ 90`, `-180 ≤ lng ≤ 180`; reconsidering string-typed coordinates to prevent `"null"`/`"NaN"` strings)
- [x] **BIZ-09**: PATCH schemas require at least one field (currently `.partial()` accepts `{}` and returns 200 with only `updated_at` changed)
- [x] **BIZ-10**: Residual Spanish strings (`"Desde"`, `"Hasta"`) in `tripAdapter.ts` replaced with English (`"From"`, `"Until"`)
- [x] **BIZ-11**: Date-only ISO strings parsed as local date (not UTC midnight) throughout the frontend — `new Date('YYYY-MM-DD')` replaced with `new Date(y, m-1, d)`; fixes confirmed day-shift bug in negative-UTC-offset timezones (live-reproduced in `America/Argentina/Buenos_Aires`)

### Remaining Security Hardening & IdP Flow — Phase 26

- [x] **SEC-05**: JWKS cache force-invalidation includes a cooldown timestamp to prevent DoS amplification against Keycloak (any bad-signature request currently triggers an unconditional refresh)
- [x] **SEC-06**: JWT verification errors return a generic `invalid_token` response body; issuer URL/realm/audience detail logged server-side only
- [x] **SEC-07**: OTP attempt counter uses atomic `UPDATE ... WHERE attempts < 5 RETURNING` (eliminates TOCTOU race on concurrent requests)
- [x] **SEC-08**: Email delivery in `otp-request` gated on explicit `ENVIRONMENT` env var; production missing `RESEND_API_KEY` fails loudly (no silent fallback to local Mailpit)
- [x] **SEC-09**: `profile.ts` passkey label rendered via `textContent` or `DOMPurify.sanitize`, not raw `innerHTML` (closes self-XSS vector)
- [x] **SEC-10**: `SearchBar.highlightMatch` uses safe DOM construction instead of substring concat into raw `innerHTML` (currently latent — becomes live once search indexes API data)
- [x] **SEC-11**: Keycloak `error.ftl` template includes `kcSanitize()` before `?no_esc` (consistent with `login.ftl`)
- [x] **SEC-12**: Keycloak `passkey-forms` subflow restructured to remove the `REQUIRED`+`ALTERNATIVE` smell (confirmed live at 819 occurrences/2h); negative E2E test asserts that username-only auth is impossible
- [x] **SEC-13**: Terraform is the sole source of truth for `browserFlow`; `apply-local-settings.sh` browserFlow override is documented or removed; vestigial `realm-export.json` deleted or regenerated (also tracked as ARCH-08)
- [ ] **SEC-17**: KC realm `sslRequired` verified against Railway proxy-header configuration; `"all"` enforced in prod if headers are correctly forwarded **[Partial]**
- [x] **SEC-18**: Nominatim geocoder requests proxied through the backend (not direct from browser) to comply with OSM Usage Policy and avoid per-user query leakage (done after the first consolidation: `GET /api/geocode`; demo-only builds without `VITE_API_URL` still call Nominatim directly)
- [x] **SEC-19**: Terraform `variables.tf` E2E user password defaults removed; forced via `-var-file=local.tfvars` or guarded by a `precondition` checking `kc_url` is localhost
- [x] **SEC-20**: `X-Content-Type-Options: nosniff` and `Permissions-Policy` headers added to `backend/src/middleware/security.ts`
- [x] **SEC-21**: Public trip response field exposure is documented as an intentional product decision, or `user_id`/numeric internal IDs are projected out of the public response
- [x] **SEC-22**: `resolveDestination` and similar resolvers return 404 for both existing-and-unauthorized and non-existent resources (no 403 that reveals existence)
- [x] **SEC-23**: CORS allowed origins separated by environment (no `localhost:3000`/`:5173` in production config)
- [x] **SEC-24**: Health endpoint response minimized, rate-limited, or authenticated to remove fingerprinting data
- [x] **SEC-25**: `avatar_url`/`preferences` KC attribute mappers remove `add_to_access_token: true` (unnecessary token bloat; backend only reads them on user-CREATE via `id_token`/`userinfo`)
- [x] **KC-01**: Keycloak `passkey-forms` subflow restructured to a single REQUIRED credential-subflow with webauthn/password as internal ALTERNATIVEs using `conditional-user-configured` executor; password fallback for non-passkey users (including E2E `e2e-test@local`) must remain functional

### Production readiness and QA — added by the second batch (PR #24)

Not in the audit-derived list. Added 2026-10-08 after the 89 commits on `claude/focused-lovelace-cryssy` (`git log origin/main..HEAD`). Target: frontend on GitHub Pages; backend, Keycloak and Postgres on the owner's own server behind Tailscale Funnel (single host, path routing `/api` and `/auth`). Reports: `.planning/qa/SELFHOST-REPORT.md`, `PROD-HARDENING.md`, `INTEGRATION-REPORT.md`, `QA-SYSTEM-REPORT.md`.

- [ ] **PROD-01**: A self-hosting kit takes a fresh Linux server to a working login: production Node entry built from the same Hono app, images, compose stack, reverse proxy, Funnel/tunnel modes, deploy / Keycloak-apply / backup / restore / update scripts, and a guide **[Partial]** (sandbox-proven; real Funnel, Gmail and passkeys not validated)
- [x] **PROD-02**: The API and Keycloak are hardened for internet exposure: Pages-origin typo fixed and defined once, env-driven CORS allow-list, access-token-only verifier (`typ`/`azp`), per-IP and per-user rate limits with trusted-proxy client IP, TLS-only SMTP OTP transport, scrubbed structured logs, HSTS and API CSP, Keycloak `production` profile with plan-time guards
- [x] **PROD-03**: Login started from a page with a query string (for example `trip-edit.html?tripId=N`) no longer fails with Keycloak "Invalid redirect_uri"; the target is restored after the callback
- [x] **PROD-04**: A database built by the old `drizzle-kit push` docs (or journal-less at 0003) upgrades safely: migration 0010, `db:preflight` no longer blocks the likely production state, `/api/health/ready` reports an unreachable database
- [ ] **QA-01**: E2E hygiene is enforced (no sleeps, no silent skips, exact `api.spec` assertion) and a Keycloak CI job runs the KC-01/IdP regression specs on Chromium and Firefox **[Unverified]** (the hygiene guard runs in the frontend suite; the `Keycloak flow` workflow had not concluded on Actions when this was written)

## Future Requirements (Deferred)

From STATE.md deferred items and v3.1 closing notes — not in v3.2 roadmap.

### Deployment

- **DEPLOY-01**: Production deployment live with public URLs — unblocked by INFRA-03; the self-hosted route (PROD-01) is now the primary candidate, Cloudflare Workers + Neon + Railway remains possible
- **DEPLOY-02**: Deployment runbook documenting how to bring up all three services locally and in production — the self-hosted path is covered by `docs/SELF-HOSTING.md`; the Cloudflare/Railway path is still open
- **DEPLOY-03**: Real-auth E2E in CI (Keycloak running in CI; `SKIP_REAL_AUTH` removed from pipeline) — partly addressed by QA-01 (IdP specs only; `SKIP_REAL_AUTH` stays for the rest)

### Features

- **FEAT-01**: Landing demo experience — Japan trip showcased without requiring login
- **FEAT-02**: Passkey rename (`PUT credentials/{id}/label`)
- **FEAT-03**: `webAuthnPolicyPasswordlessRpId` set to Railway prod hostname before any prod passkey registration

### E2E Quality (deferred from v3.1)

- **E2E-01**: OTP brute-force lockout: add `attackDetection.del` to `beforeEach` in OTP specs to reset KC lockout state between tests
- **E2E-02**: Per-recipient Mailpit isolation (`search?query=to:...`) to support parallel OTP tests

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile native app | Web-only by design |
| Social features (likes, comments, trip following) | Not needed |
| AI/LLM trip suggestions | User builds itineraries manually |
| Trip marketplace / public discovery feed | Not a social platform |
| Payment or monetization | Free personal tool / portfolio project |
| Java KC SPIs | All KC customization via built-in flows + FreeMarker themes; re-evaluated in ANALISIS pass 6 — constraint confirmed |
| ROPC / username-password API auth in tests | PKCE only; passkey flows cannot use ROPC |
| Production deployment | Prerequisite (INFRA-03) is in v3.2; the self-hosting kit and hardening (PROD-01/02) make it deployable, but nothing is deployed yet |

## Traceability

Which phase covers which requirement, and how far it got. Evidence (commits, tests, docs) per ID is in `.planning/phases/TRACEABILITY.md`.

**Status vocabulary:** `Complete` = implemented and proven by tests or a recorded manual check. `Partial` = part of the acceptance criteria met. `Deferred` = consciously not done, reason recorded. `Unverified` = implemented, but a required verification (for example a run on GitHub Actions) has not happened.

| Requirement | Phase | Status | Notes |
|-------------|-------|--------|-------|
| SEC-01 | Phase 20 | Complete | Single Uint32 draw via crypto.getRandomValues; residual `% 1_000_000` bias ~0.02%, accepted by the Phase 20 criterion |
| SEC-02 | Phase 20 | Complete | renderList rebuilt with DOM APIs; weather/RSS hardened again in QA (e048732) |
| SEC-03 | Phase 20 | Complete | Sanitised at render (DOM APIs, http(s)-only links). The RSS relay through allorigins/corsproxy is unchanged (still referenced in `widgets.ts`); it is not covered by SEC-18, which now means Nominatim only |
| SEC-04 | Phase 20 | Complete | CSP meta built from resolved env (1b9ba1d); production build fails on bad/missing origins. `script-src` still has `unsafe-inline`; `frame-ancestors` needs an HTTP header |
| SEC-14 | Phase 20 | Complete | Cloudflare secret removed from Terraform; Worker never deployed so the `wrangler tail` check is moot |
| INFRA-01 | Phase 21 | Complete | Live CI gating UAT passed on push to main (3c147f6). Since 2fa0560 the e2e job is no longer `continue-on-error`, so it now also gates deploys |
| INFRA-02 | Phase 21 | Complete | test-backend job has a Postgres service; observed green on Actions (PR #23 head 2200c6e, and the push to main at ed49639) |
| INFRA-03 | Phase 21 | Complete | `wrangler deploy --dry-run` OK at every later verification |
| INFRA-04 | Phase 21 | Complete | wrangler pinned `^3.101.0`; deploy via `npm run deploy` |
| INFRA-05 | Phase 21 | Complete | bash /dev/tcp healthcheck |
| DEP-01 | Phase 21 | Complete | drizzle-orm ^0.45.2, dompurify ^3.4.12 |
| BUG-01 | Phase 22 | Complete |  |
| BUG-02 | Phase 22 | Complete |  |
| BUG-03 | Phase 22 | Complete |  |
| BUG-04 | Phase 22 | Complete | Refined by be3551f: only the `hotel_not_found` 404 maps to null |
| BUG-05 | Phase 22 | Complete |  |
| BUG-06 | Phase 22 | Complete |  |
| BUG-07 | Phase 22 | Complete |  |
| BUG-08 | Phase 22 | Complete | Keycloak is source of truth for name/email; SELECT-first path added in 5001faf |
| BUG-09 | Phase 22 | Complete |  |
| BUG-10 | Phase 22 | Complete |  |
| BUG-11 | Phase 22 | Complete |  |
| BUG-12 | Phase 22 | Complete |  |
| BUG-13 | Phase 22 | Complete |  |
| BUG-14 | Phase 22 | Complete |  |
| BUG-15 | Phase 22 | Complete |  |
| BUG-16 | Phase 22 | Complete | Cap made atomic in 6f7990f (migration 0009) |
| SEC-15 | Phase 23 | Complete |  |
| SEC-16 | Phase 23 | Complete | Cache name = content hash; navigations network-first; hardened in d439e21 |
| INFRA-06 | Phase 23 | Complete | Offline map tiles are intentionally not cached |
| DEP-02 | Phase 23 | Partial | 14 findings triaged, leaked local KC secret redacted at HEAD (history not rewritten). Rotation of the `japan-trip-worker` secret NOT verified (owner action) |
| DEP-03 | Phase 23 | Complete | security.yml (gitleaks, axe, Lighthouse) ran on Actions: `gitleaks` and `accessibility` success on PR #23 head 2200c6e and on the push to main (ed49639; the `Security & Accessibility Scans` run succeeded). It needed 2200c6e to triage two test-fixture hits by fingerprint in `.gitleaksignore`. Lighthouse LCP on a real network is still unmeasured |
| A11Y-01 | Phase 23 | Complete |  |
| A11Y-02 | Phase 23 | Complete | axe 0 violations on 7 pages, light and dark (local run, not on Actions) |
| A11Y-03 | Phase 23 | Complete |  |
| A11Y-04 | Phase 23 | Complete | Overlapping markers are spread in screen space (`frontend/src/modules/declutter.ts`, 8de5e7f). axe wcag2a/2aa/21a/21aa/22aa: 0 violations on 9 pages x light/dark x 375/1280; Lighthouse a11y tokyo 0.96 to 1.00. Evidence: `qa/A11Y-LCP-FOLLOWUP.md`; tests `declutter.test.ts`, `lcp-target-size.spec.ts`. Local run, not re-run on Actions |
| A11Y-05 | Phase 23 | Complete | Landing LCP 5415 ms to 1304 ms, Lighthouse performance 0.68 to 1.00 (sandbox, mobile emulation, median of 3). Tokyo LCP 2749 to 2261 ms (noisy; its LCP element is the tile-failure notice in the sandbox). Body opacity gate removed, hero served as AVIF/WebP/JPEG `image-set` with preloads, Leaflet lazy-loaded. Tests `lcp-budget.test.ts`, `lcp-target-size.spec.ts`. Real-network LCP on GitHub Pages not measured |
| ARCH-01 | Phase 24 | Complete |  |
| ARCH-02 | Phase 24 | Complete |  |
| ARCH-03 | Phase 24 | Complete | Matrix over all nested endpoints, DB snapshot asserted |
| ARCH-05 | Phase 24 | Complete | Delivered by BIZ-06/08/09 |
| ARCH-06 | Phase 24 | Complete | Real Postgres 16 via globalSetup; the Actions `postgres:16-alpine` service is now observed: `test-backend` success on 2200c6e and ed49639 |
| ARCH-07 | Phase 24 | Complete | Original 31 sleeps / 35 skips cleared. Later specs added 3 `waitForTimeout` and 6 `test.skip(` (idp-flow, idp-config, qa-sw, overview-map, qa-frontend). Specs needing a real Keycloak were typecheck-only |
| ARCH-08 | Phase 24 | Complete | Done with SEC-13 (Phase 26) |
| ARCH-09 | Phase 24 | Complete | `e2e` job success on PR #23 head 2200c6e and on the push to main (ed49639), after 2200c6e fixed the last expectation (`trip-edit.spec.ts`, zoom_level). It gates deploys, so it must stay green. Earlier local CI-mode runs: 144 passed / 41 fixme / 0 failed |
| M-01 | Phase 24 | Complete |  |
| M-02 | Phase 24 | Complete |  |
| M-09 | Phase 24 | Complete |  |
| PWA-01 | Phase 24 | Complete |  |
| DATA-01 | Phase 24 | Complete | Migration 0004 |
| DATA-02 | Phase 24 | Complete | Migration 0005 aborts if duplicate emails exist; `db:preflight` reports them first |
| DATA-03 | Phase 24 | Complete | Migration 0006 nulls BOTH coords of out-of-range rows before adding the CHECKs |
| BIZ-01 | Phase 25 | Complete | Optional labels are derived (A/B/C), not stored |
| BIZ-02 | Phase 25 | Complete |  |
| BIZ-03 | Phase 25 | Complete |  |
| BIZ-04 | Phase 25 | Complete |  |
| BIZ-05 | Phase 25 | Complete | Slider 1-19; a stored 20 shows as 19 |
| BIZ-06 | Phase 25 | Complete |  |
| BIZ-07 | Phase 25 | Complete | Done by migration 0008 DB triggers (Neon HTTP has no transactions), not route handlers; answers 422 `date_conflict` |
| BIZ-08 | Phase 25 | Complete |  |
| BIZ-09 | Phase 25 | Complete |  |
| BIZ-10 | Phase 25 | Complete |  |
| BIZ-11 | Phase 25 | Complete | Tested across 13 time zones |
| SEC-05 | Phase 26 | Complete | 60 s cooldown per isolate |
| SEC-06 | Phase 26 | Complete |  |
| SEC-07 | Phase 26 | Complete | Attempts atomic (7e5d975); issuance atomic via `otp_issue()` (6f7990f, migration 0009) |
| SEC-08 | Phase 26 | Complete |  |
| SEC-09 | Phase 26 | Complete |  |
| SEC-10 | Phase 26 | Complete |  |
| SEC-11 | Phase 26 | Complete | The prod Keycloak image has no theme (Dockerfile never copies themes/), so the fix only applies where the theme is mounted |
| SEC-12 | Phase 26 | Complete | Verified on live KC 26.6.1 in the sandbox; not run in CI (S3) |
| SEC-13 | Phase 26 | Complete | apply-local-settings.sh and realm-export.json deleted |
| SEC-17 | Phase 26 | Partial | The `production` Keycloak profile now refuses any plan with `ssl_required != all` (precondition in `terraform/keycloak/main.tf`). Realm dumps show `sslRequired=all` on a TLS Keycloak under `/auth` and on the self-host kit stack (a TLS front stood in for Funnel). The Railway check no longer applies (the target is a self-hosted server). Not validated: proxy-header behaviour (`KC_PROXY_HEADERS=xforwarded`) behind the real Funnel to Caddy chain; no production realm has been applied |
| SEC-18 | Phase 26 | Complete | Delivered after the first consolidation (7dbb9b2, 070af9c): `GET /api/geocode`, authenticated, per-IP 30/min and per-user 20/min, identifying User-Agent, 1 req/s process-wide gate, 24 h LRU, only lat/lon/display_name returned. The frontend uses it when `VITE_API_URL` is set and the CSP drops the Nominatim origin. Tests: `adv/geocode.test.ts`, `fe/geocoder-proxy.test.ts`, `fe/csp-plugin.test.ts`. `NOMINATIM_USER_AGENT` is honoured since ec2f546. Caveats: cache and gate are per process; demo-only builds still call Nominatim directly; tested against a fake upstream, not live Nominatim |
| SEC-19 | Phase 26 | Complete |  |
| SEC-20 | Phase 26 | Complete |  |
| SEC-21 | Phase 26 | Complete | `user_id` projected out; remaining fields documented as intentional (26-APPSEC-SUMMARY). 26-IDP-SUMMARY lists it as Deferred; superseded |
| SEC-22 | Phase 26 | Complete | 404 on every nested route (ea1f511); 16 `403` branches removed |
| SEC-23 | Phase 26 | Complete | Now driven by `ALLOWED_ORIGINS` (exact origins; default = the Pages origin from `config/deploy-defaults.json`). The original value `https://manud.github.io` was a typo for the real site `https://manudubo.github.io`; fixed and defined once in PROD-02 (0325e75) |
| SEC-24 | Phase 26 | Complete | Minimised to `{"status":"ok"}`; not rate-limited by design |
| SEC-25 | Phase 26 | Complete |  |
| KC-01 | Phase 26 | Complete | The old flow was a live auth bypass: treat any prod Keycloak that ran it as exposed (see STATE.md) |
| DATA-04 (extra) | Phase 24 | Complete | Not in the original list. `hotels` unique on `destination_id` plus atomic upsert (migration 0007, 623917b); found by the new concurrency tests |
| PROD-01 (extra) | Post-v3.2 batch | Partial | Self-hosting kit (`deploy/selfhost/`, `backend/src/server.ts`, `backend/src/node/`, `docs/SELF-HOSTING.md`). `stack-e2e.sh` 40/40 on a fresh sandbox stack (a TLS front and Mailpit stood in for Funnel and Gmail), `scripts.test.sh` 52/52, shellcheck clean. Not validated: real Tailscale Funnel, real Gmail delivery, real passkeys on the `.ts.net` rpId, Ubuntu 26.04 specifics, Cloudflare Tunnel and Let's Encrypt modes (config level only), the legacy state move |
| PROD-02 (extra) | Post-v3.2 batch | Complete | CORS fix and env allow-list, access-token-only verifier (a real Keycloak ID token was accepted before), rate limits, SMTP transport, log scrubbing, header fixes, Keycloak `production` profile; `qa/PROD-HARDENING.md` lists 12 findings. Last integration run: backend 1928 tests, frontend 1148 tests. The production-profile realm was applied to a real Keycloak 26.6.1 and `idp-hardening.spec.ts` ran against it. Residual: per-process rate limiter, username enumeration in the username-first flow, tokens valid up to 5 min after logout |
| PROD-03 (extra) | Post-v3.2 batch | Complete | `loginRedirectUri()` in `frontend/src/auth/keycloak.ts` (bda9027); `auth-redirect.test.ts` (23) and the `@qa-noauth` `auth-return-to.spec.ts`, which fails on the old code. Chromium only |
| PROD-04 (extra) | Post-v3.2 batch | Complete | Migration 0010 (297dba5), `db:preflight` fix (e8b2d5a), `/api/health/ready` reports an unreachable database (ad852aa; later one `SELECT 1` per probe), pool error listener (f2a3edb). `backend/tests/system/` (5 files, 92 tests) runs on a Neon HTTP emulator, not on real Neon; the Neon smoke checklist is still unrun |
| QA-01 (extra) | Post-v3.2 batch | Unverified | `e2e-hygiene.test.ts` guard (253cd65) and 8 spec fixes are in the frontend suite (`test-frontend` success on Actions for PR #24 head 2d7a734). The `Keycloak flow` workflow (`keycloak-flow.yml`, `scripts/ci/keycloak-flow.sh`) passes locally (31 passed / 4 fixme; 51 passed / 5 fixme with idp-hardening) but had not concluded on Actions when checked. It is informational, not a deploy gate |

**Coverage:**
- v3.2 requirements: 82 total (85 audit findings minus 3 duplicates consolidated: ARCH-04 to BUG-08, ARCH-08 to SEC-13, one KC-02 informational), plus 1 extra (DATA-04), plus 5 added by the second batch (PROD-01..04, QA-01): 88 rows
- Mapped to phases: 82 (DATA-04 and the 5 batch rows are outside the original phase plan)
- Unmapped: 0
- Status: **84 Complete, 3 Partial** (DEP-02, SEC-17, PROD-01), **0 Deferred**, **1 Unverified** (QA-01)
- Change since the first consolidation (76 Complete including DATA-04, 4 Partial, 1 Deferred, 2 Unverified): A11Y-04, A11Y-05, SEC-18, DEP-03 and ARCH-09 became Complete; PROD-02/03/04 are new and Complete; PROD-01 and QA-01 are new and open. The earlier line "75 Complete" excluded DATA-04

---
*Requirements defined: 2026-07-24*
*Last updated: 2026-10-08 after the second batch (PR #24, 89 commits): statuses re-checked against code, tests, commits and GitHub check runs; see phases/TRACEABILITY.md*
