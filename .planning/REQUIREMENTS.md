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

### Self-registration — added by the third batch (registration)

Not in the audit-derived list. Added 2026-10-08 after the 53 commits that follow `d2dd404` (PR #24 as merged to `main`) on `claude/focused-lovelace-cryssy` (`git log --oneline origin/main..HEAD`; four tracks: IdP, backend, UI, integration). Reports: `.planning/qa/REGISTRATION-IDP-REPORT.md`, `REGISTRATION-BACKEND-REPORT.md`, `REGISTRATION-UI-REPORT.md`, `REGISTRATION-INTEGRATION-REPORT.md`. Registration stays closed in production until the owner opens it (`REGISTRATION_ENABLED`).

- [ ] **REG-01**: Anyone can create an account in Keycloak (`registration_allowed`, flow `registration-passkey`); the sign-up form has no password and a passkey is a required action, so no usable credential-less account exists; production plans refuse unsafe sign-up settings **[Unverified]** (proven on a real Keycloak 26.6.1 with a virtual authenticator; real passkeys on the `.ts.net` rpId and the GitHub Actions run not seen)
- [x] **REG-02**: A new account must prove its e-mail with a 6-digit code sent by the backend (Keycloak core has no e-mail OTP); until then every authenticated route except `GET|PATCH /api/users/me` and the two verify endpoints answers `403 email_not_verified` (migration 0011, `users.email_verified_at`, `REQUIRE_VERIFIED_EMAIL`)
- [x] **REG-03**: A passkey-only user on a device without passkey support recovers by e-mail code and sets a password (`recover.html`, `/api/auth/recovery/*`, least-privilege `travelmap-recovery` client with only `manage-users`); same 202 for known and unknown addresses; an unverified squatted account loses its other credentials. Limit: only for accounts that already have a `users` row
- [x] **REG-04**: Web UI: "Sign up" next to every "Sign in" (hidden in demo-only builds), verification screen with resend cooldown, new-user passkey onboarding dialog (backup-password variant on unsupported devices), `recover.html`, and a "Add a password as a backup" card on the profile page
- [x] **REG-05**: Login-flow password fallback: users with both a passkey and a password get "Try another way" (fixes KC-01's trade-off that passkey users had none); a passkey-only user keeps no password form
- [ ] **REG-06**: Abuse controls: `purge-unverified` timer deletes never-verified self-registered accounts, optional reCAPTCHA on the form, production guards (password policy 12, lockout at most 10, recovery client present, no worker client, captcha keys both-or-neither) **[Partial]** (no per-IP sign-up throttle: stock Caddy 2.10 has no rate-limit module, Keycloak has none for registration, and no backend check is wired as `forward_auth`; reCAPTCHA only plan/executions-checked)
- [ ] **REG-07**: The e-mail-code wire contract is one fixture (`contracts/auth-flows.json`, 14 cases) checked from both sides, plus a real-stack e2e (Keycloak, backend, Postgres, Mailpit, built frontend) and a self-host `register verify recover` phase **[Unverified]** (all green locally; the extended `keycloak-flow.yml` has not been observed on GitHub Actions)

## v3.3 Requirements: UX & Product Polish

Owner-reported on 2026-10-08. Not audit-derived; phases 27-33 (`ROADMAP.md`). **Status of all seven: Complete** (PR #27, merged as `c7d54dc`); UX-MOB-01 (PR #28, `460a449`), PKF-01..04 (PR #29, `38b9108`), UX-NAV-02 and TEST-PARITY-01 (PR #30, `432aba5`) and UX-KC-04 (PR #31, pending) were added after the owner reports. Evidence per ID: `phases/TRACEABILITY.md`, `qa/UX-REPORT.md`. Every item must ship with: unit tests; e2e (Playwright, mocked and, where it touches auth, real stack); edge cases (empty, error, API down, long text, no JS storage, slow network, double click, back button); and visual validation of the changed screens in light and dark at 375 px and 1280 px, with screenshots in `qa/screens-theme/`, `docs/design/trip-view-screens/`, `docs/design/trip-creation-screens/`, `docs/design/mobile-screens/`. Axe must report 0 violations on touched pages.

### Keycloak screens — Phase 27

- [x] **UX-KC-01**: Every Keycloak realm screen (login, passkey, OTP, verify-email, register, webauthn-register, update-password, info, error, logout) is redesigned: modern, consistent with the site/demo `--jp-*` tokens, light/dark, usable at 375 px. The login screen is not nested in three boxes (one card). **Acceptance:** all ten screens render with the theme in light/dark at 375/1280 (screenshots); no more than one card container on login (DOM assertion); existing `idp-flow` / `idp-registration` / `idp-theme` specs still pass; theme invariants (SEC-11/13/19/25) intact; axe 0 violations; long username/error text and missing JS degrade without overflow. **Complete** — PR #27 (`d1e126e`, `d1e33f0`; tests `idp-theme-static`, `idp-theme-render`, `idp-theme`, `idp-config`; screenshots `qa/screens-theme/`)
- [x] **UX-KC-02**: Passkey labels are generated from the device (browser/OS), the user is not asked to type one. **Acceptance:** the webauthn-register screen has no label input and still registers; the generated label is non-empty, bounded in length and stable across browsers (unit test for the label function with unknown/empty user agents); registering twice on the same device yields distinguishable labels; the profile passkey list shows the generated labels; existing passkey e2e (`passkeys`, `uat-passkeys`) updated and green. **Complete** — PR #27 (`17971b6`; table tests of the label generator in `idp-theme-static.spec.ts`, stored label checked in `idp-theme.spec.ts`)
- [x] **UX-KC-03**: The Keycloak error page's "back to application" link and any base-URL link return to the production app, not `http://localhost:5173/PruebaMapJapan/` (the client `base_url` defaults to localhost in production). Production URLs are derived from `config/deploy-defaults.json`. **Acceptance:** a Terraform test (production profile) plans the client `base_url` from the deploy defaults and fails on a localhost value; local profile keeps localhost; the error page link is asserted in the e2e idp-theme spec; no second source of truth for the app URL (existing `deploy-defaults` test still passes). **Complete** — PR #27 (`c8280df`; `terraform/keycloak/tests/guards.tftest.hcl`, `deploy/selfhost/tests/scripts.test.sh`, `idp-theme.spec.ts`)

### Navigation and search — Phase 28

- [x] **UX-NAV-01**: On `dashboard.html` the brand/Home link to `index.html` opens the landing page; today it bounces back to the dashboard. A logged-in user can always visit the landing page. **Acceptance:** unit test of the redirect rule (no auto-redirect from `index.html` when authenticated, or only for the post-login callback); e2e: logged in, dashboard, Home, URL is `index.html` and stays there; post-login return-to (PROD-03) and logout still work; deep link to `index.html?code=...` callback is not broken; edge: expired session on the landing page. **Complete** — PR #27 (`98caa8f`, `52dffee`; `frontend/tests/auth-redirect.test.ts`, `e2e/home-link.spec.ts`)
- [x] **UX-SEARCH-01**: The search magnifier searches the user's own trips (destinations, hotels, days, activities) on authenticated pages (dashboard, trip, trip-edit, profile); demo itinerary data only on the demo/static city pages and the landing page. **Depends on** the API client. **Acceptance:** unit tests for scope selection per page type and for the own-trips index (empty trips, API error, 401, many trips, special characters, XSS strings rendered as text); e2e: authenticated page returns a user trip and no demo hit, city page returns a demo hit and no user trip; keyboard and screen-reader behaviour of the search UI unchanged; light/dark 375/1280 visual check. **Complete** — PR #27 (`a0d1c8d`, `17f0ee5`, `cbf723b`, `36f63fa`; `search-scope`, `user-search-index`, `searchbar-scope` unit tests, `e2e/search-scope.spec.ts`)

### Trip creation and viewing — Phases 29-30

- [x] **UX-TRIP-01**: **Most critical objective of v3.3.** Building a trip is as simple as the demo makes it look: guided steps, place search, a map with a dashed route, day and activity editing, a live preview, and autosave, so that someone who has seen the demo thinks "I want to create a trip like that and view it the same way". Design doc: `docs/design/TRIP-CREATION-UX.md`. **Depends on** the shared data adapters with UX-TRIP-02 and the API client. **Acceptance:** a new user creates a multi-city trip with hotels, days and activities using only the guided flow (e2e, mocked and real stack, extends `new-user-trip-creation`); live preview matches what the saved view shows (same adapter, unit-tested); autosave: draft survives reload, failed save shows an error and retries, no lost edits on double click, offline or 401 mid-edit (Phase 22 reliability regressions stay green); place search uses the geocode proxy (SEC-18) with debounce, no-result and rate-limit states; route polyline is dashed and follows the order of destinations; edge cases: 0 and 1 destination, 30+ days, activities without coordinates, optional/generic flags, date conflicts (422 `date_conflict`), reorder; light/dark 375/1280 screenshots of every step; axe 0 violations; keyboard-only completion. **Complete** — PR #27 (`a9008b4`, `578d531`, `da62653`, `ad89ef8`; `trip-edit-*` unit tests, `e2e/trip-edit.spec.ts`, `trip-edit-resilience.spec.ts`; also fixed the missing `order_index` bug)
- [x] **UX-TRIP-02**: Saved trips are visualised like the demo: an overview map with a dashed line and selectable cities, itinerary cards linking to the city views, modern dashboard trip cards, and states for loading, error and API down. **Depends on** the adapters shared with UX-TRIP-01. **Acceptance:** adapter unit tests (API trip to the demo `CityData`/`Day`/`Activity` shape, missing coordinates, empty days); e2e: dashboard card to trip view, city selection on the overview map, card to city view; loading skeleton, error with retry and API-down message each asserted; the public share view (Phase 3) renders the same way; the demo pages are unchanged (existing `overview-map`, `map-tiles` specs green); light/dark 375/1280 screenshots; axe 0 violations. **Complete** — PR #27 (`5f47b90`, `a2c8548`, `6a17ed8`, `2c937fa`; `trip-view`, `trip-cards` unit tests, `e2e/trip-view.spec.ts`, `dashboard-trips.spec.ts`)

### Mobile — Phase 31

- [x] **UX-MOB-01**: Mobile is a tested target, not an afterthought. **Acceptance:** Playwright projects `mobile` (iPhone 13 descriptor) and `mobile-android` (Pixel 7), Chromium only, run `mobile-*.spec.ts` (`mobile-layout`, `mobile-touch`, `mobile-platform`, `mobile-screens`) and a separate `e2e-mobile` CI job; every screen is walked from 320 to 430 px, landscape and tablets with no sideways scroll, no clipped control, 44 px targets on coarse pointers and 16 px fields (no iOS focus zoom); navbar and search (shadow DOM) sized for touch, city links on their own row; one-finger map pan off on coarse pointers with a two-finger hint, bigger zoom and marker hit areas; 44 px one-digit OTP boxes; `100dvh` for the hero and body; safe-area-aware undo snackbar; manifest orientation unlocked (WCAG 1.3.4). **Complete** — PR #28 (merged `460a449`; `9751b2c`, `3cb1425`, `8ba6797`, `1103e0a`, `dcdb793`, `4ff7fec`; 11 fixes; matrix in `docs/design/MOBILE-COVERAGE.md`). Not covered, real device only: iOS Safari focus zoom and toolbar, keyboard overlap, installed PWA, a real swipe over the map, WebAuthn prompts, OTP autofill; no WebKit run

### Passkey-first login — Phase 32 (PR #29, `38b9108`)

Design and evidence: `docs/design/PASSKEY-FIRST-LOGIN.md`. Verified on Keycloak 26.6.1 with a Chromium virtual authenticator only.

- [x] **PKF-01**: A browser that has used a passkey with the realm is asked for it as soon as the login page loads, without a username; other browsers get the e-mail field with passkey autofill (`autocomplete="username webauthn"`) and a "Sign in with a passkey" button. **Complete** — commits `ded6f2f` (realm passkeys on), `86f4edf` (marker and auto prompt). Cancel leaves the form (no loop, no new prompt on reload or back), user verification always required, never on sign-up, recovery, error pages or in iframes
- [x] **PKF-02**: Device memory and privacy: `localStorage["jp.passkey.<realm>"] = {v,t,m}` says only that a passkey was used here (no user name, id, e-mail or credential id; extra fields invalidate the marker), lifetime 180 days from last use, cleared by "Use another account" followed by a sign-in with that account's own credentials, after two dismissed automatic prompts in a row, and when the server rejects the answer; storage off or throwing means nothing is remembered and nothing breaks. **Complete** — `86f4edf`, tests `0a66df3`, `9353b96` (`idp-passkey-first-unit`, `-static`, `-render`; `idp-passkey-first.spec.ts` case (g) checks every storage and cookie for the account's identifiers)
- [x] **PKF-03**: After a passkey answer on the username page the credential step must not ask for the passkey again. Fix: an extra ALTERNATIVE branch `passkey-done` (`conditional-credential` over `webauthn-passwordless`, then `allow-access-authenticator`) in the credential step. **Complete** — `ded6f2f`, pinned by `idp-config.spec.ts`; `idp-passkey-first.spec.ts` (h) forges assertions and a bare username and expects no code. **Finding: a CONDITIONAL credential subflow FAILS OPEN** (Keycloak skips a conditional subflow that has no condition; a bare username got an authorization code in the window between two API calls, reproduced on 26.6.1), so the step is an extra branch, fail-closed at every step; order inside it matters (condition first, `allow-access` second, or the selection resolver swaps in the WebAuthn authenticator and the second prompt returns)
- [x] **PKF-04**: Terraform provider pinned for the realm passkey switch: `versions.tf` requires `>= 5.8.0` (`passwordless_passkeys_enabled`), lock file at `5.10.0`; the bump defaults `add_to_token_introspection` to true, so the SEC-25 mappers pin it to `false`. **Complete** — `ded6f2f` (`flows.tf`, `main.tf`, `mappers.tf`, `versions.tf`, `.terraform.lock.hcl`). Operator steps in `docs/SELF-HOSTING.md` ("Passkey-first sign-in (operator notes)"): redeploy the Keycloak theme, run `keycloak-apply`; the plan adds 5 resources and updates the realm passkey setting; the two profile mappers show no change

### Mobile-real fixes and parity validation — Phase 33

Found after v3.3 by the owner's iPhone screenshots and by rebuilding the demo through the editor. Evidence in `phases/TRACEABILITY.md` and `qa/UX-REPORT.md`.

- [x] **UX-KC-04**: The Keycloak login theme is served fresh and errors are friendly. **Acceptance:** `template.ftl` links every theme stylesheet and script as `?v=${properties.jpAssetVersion}`; `theme.properties` `jpAssetVersion` is a hash of `login/resources`, refreshed by `node tests/e2e/fixtures/idp-theme/asset-version.mjs --write`, and a test fails if a resource is edited without it; `error.ftl` maps Keycloak messages to "We couldn't start the sign-in" / "This link has expired" / "Sign-up is closed right now" / "This account is disabled" / generic, details collapsed, Back button from `client.baseUrl`, SEC-11 kept, English and Spanish; a mobile audit (`fixtures/idp-theme/mobile-checks.ts`) passes on the stock HTML. **Complete** in PR #31 (pending); root cause: production Keycloak serves theme resources with `Cache-Control: max-age=2592000` under a Keycloak-version hash, so phones kept the OLD `login.css` on the NEW templates. **Unverified**: a real iPhone, a real phone's HTTP cache, the Inter webfont. The Keycloak image must be redeployed (`deploy.sh`) to reach users. Residual: module imports inside `passkey-first.js` are not versioned.
- [x] **UX-NAV-02**: No `redirect_uri` error on iOS. **Acceptance:** keycloak-js is initialised with `silentCheckSsoFallback: false`, so a hidden SSO iframe that cannot answer (iOS blocks third-party storage) no longer redirects the whole page with `prompt=none` and the current URL as `redirect_uri`. **Complete** — PR #30 (`432aba5`, `39827dd`; test `frontend/tests/auth-redirect.test.ts`). Residual: a signed-in user on iOS whose iframe is blocked sees the signed-out state until Sign in. Not seen on a real iPhone.
- [x] **TEST-PARITY-01**: Acceptance test that the editor can rebuild the demo. **Acceptance:** `tests/e2e/demo-parity.spec.ts` (fixtures `demoTrip.ts`, `tripSnapshot.ts`, `pixelDiff.ts`; `frontend/tests/demo-roundtrip.test.ts`) builds the demo through the real editor (Kyoto, Osaka, Takayama fully via the UI; all 8 destinations by search; Tokyo, Nagoya, Naoshima, Hakone, Tokyo (return) seeded) and compares it structurally (gating) and visually (gating at 5% overview / 2% other views). **Complete** — PR #30 (`432aba5`; `eaa2dd9`, `7642e95`, `abb55da`, `511fbc8`). Fixed 3 gaps (day colour swatches `c47d78e` / `88e006a`, return-stay popup title `c684774`, overview declutter `ab42df6`). Documented gap (`EXPECTED_GAPS`, product decision): `takayama-option-labels` needs an `activities.option_label` column.

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

| REG-01 (extra) | Third batch (registration) | Unverified | `4649ea4` (flow `registration-passkey`, `travelmap-recovery`, guards), `74d7556`, `bd34659`. `terraform test` 23/23 (3 valid profiles plan, 20 misconfigurations fail), fresh apply then "no changes". Live: passkey sign-up creates one credential and no password, no code before enrolment, credential-less account rejected, registration closed means no form. Not validated: real passkeys on the `.ts.net` rpId, GitHub Actions run, Firefox/WebKit |
| REG-02 (extra) | Third batch (registration) | Complete | `995bab6` (migration 0011), `85f9824`, `0c26e86`. Verified = `email_verified_at` set OR token `email_verified === true` (boolean only). `be/routes/email-verify.test.ts`, `adv/email-verification.test.ts` (a test enumerates `app.routes`, so a new route cannot ship ungated), `be/db/migrations.test.ts`. Existing users are grandfathered by the migration backfill |
| REG-03 (extra) | Third batch (registration) | Complete | `fdb3395`, `b6463b8` (recovery token had no roles until the scope mapping; found by the integration run), `86c5512` (theme link). `adv/recovery.test.ts` (enumeration, brute force, Keycloak stubs), `e2e/idp-registration.spec.ts` (squatting test), `ss/stack-e2e.sh recover`. Gmail not exercised |
| REG-04 (extra) | Third batch (registration) | Complete | `ea9662b`, `c2e9b36`, `64c1269`, `074e7e1`, `31e4472`, `f0c51f1`, `912970b`. `fe/verify-email.test.ts`, `fe/passkey-onboarding.test.ts`, `fe/recover-view.test.ts`, `fe/password-backup.test.ts`, `fe/auth-gate.test.ts`, `e2e/registration-ui.spec.ts`, `e2e/registration-ui-a11y.spec.ts` (axe 0 violations, 24 combinations), `e2e/registration-integration.spec.ts`. Chromium only; UI not run in a browser against the self-host stack |
| REG-05 (extra) | Third batch (registration) | Complete | `17a2493` (root cause: Keycloak lists sibling branches only when the current execution is first in its subflow). `e2e/idp-flow.spec.ts` with WebAuthn on and off (`b061473`). Trade-off: Keycloak shows the preferred credential first (enrolment order) |
| REG-06 (extra) | Third batch (registration) | Partial | `a85ed2f` (`purge-unverified.sh`, systemd timer), `4649ea4`, `74d7556`, `3160610`, `823c180`. `ss/purge-unverified.test.sh` 34/34 (queries also run on Postgres 16). NOT implemented: per-IP sign-up throttle (see requirement). Not validated: real reCAPTCHA keys |
| REG-07 (extra) | Third batch (registration) | Unverified | `d12959b` (fixture; fixed `max_attempts` classified as a wait), `b431ae3`, `8c70a4d`, `7425a2d`, `5b1544c`. `be/routes/auth-flows-contract.test.ts`, `fe/auth-flows-contract.test.ts`; stack `registration-stack.sh`: `idp-registration` 9/9 + `registration-integration` 7/7; self-host `stack-e2e.sh` 67/67. Not observed: the extended `keycloak-flow.yml` on Actions; expired code and double click against the real stack
| UX-KC-01 | Phase 27 | Complete | Theme rebuilt on the base theme (no PatternFly), one flat card per screen; PR #27 |
| UX-KC-02 | Phase 27 | Complete | Passkey label generated from the device; PR #27 |
| UX-KC-03 | Phase 27 | Complete | Production client `root_url`/`base_url` derived from `config/deploy-defaults.json`, loopback guard in Terraform and `keycloak-apply.sh`; PR #27 |
| UX-NAV-01 | Phase 28 | Complete | Home link `index.html?home`; PR #27 |
| UX-SEARCH-01 | Phase 28 | Complete | Search scope: user trips on dashboard/trip/profile, demo elsewhere; PR #27 |
| UX-TRIP-01 | Phase 29 | Complete | Guided editor with autosave queue, undo and live demo-style preview; PR #27 |
| UX-TRIP-02 | Phase 30 | Complete | Trip view parity with the demo, dashboard trip cards and states; PR #27 |
| UX-MOB-01 | Phase 31 | Complete | Mobile Playwright projects, 11 fixes, `e2e-mobile` CI job; PR #28 (`460a449`). Real-device gaps in `docs/design/MOBILE-COVERAGE.md` |
| PKF-01 | Phase 32 | Complete | Passkey-first prompt (marker + auto prompt); PR #29 (`38b9108`). Chromium virtual authenticator only |
| PKF-02 | Phase 32 | Complete | Device memory and privacy (180 days, no identifying data); PR #29 (`38b9108`) |
| PKF-03 | Phase 32 | Complete | Credential step `passkey-done` ALTERNATIVE branch; a CONDITIONAL subflow fails open (finding); PR #29 (`38b9108`) |
| PKF-04 | Phase 32 | Complete | Provider `>= 5.8.0` (lock 5.10.0) and SEC-25 `add_to_token_introspection=false`; PR #29 (`38b9108`) |
| UX-KC-04 | Phase 33 | Complete | Theme assets linked as `?v=${properties.jpAssetVersion}` (30-day Keycloak cache was serving the old `login.css`), friendly error pages, mobile audit; Complete in PR #31 (pending). Real iPhone, real HTTP cache and Inter webfont Unverified |
| UX-NAV-02 | Phase 33 | Complete | `silentCheckSsoFallback: false` (no `redirect_uri` error on iOS); PR #30 (`432aba5`), `frontend/tests/auth-redirect.test.ts` |
| TEST-PARITY-01 | Phase 33 | Complete | Demo-parity acceptance test, 3 gaps fixed, 1 documented (`takayama-option-labels`); PR #30 (`432aba5`) |

**Coverage:**
- v3.2 requirements: 82 total (85 audit findings minus 3 duplicates consolidated: ARCH-04 to BUG-08, ARCH-08 to SEC-13, one KC-02 informational), plus 1 extra (DATA-04), plus 5 added by the second batch (PROD-01..04, QA-01), plus 7 added by the third batch (REG-01..07): 95 rows; v3.3 adds 7 owner-reported rows (UX-*), UX-MOB-01 (PR #28), PKF-01..04 (passkey-first login, PR #29), then UX-KC-04, UX-NAV-02 and TEST-PARITY-01 (Phase 33): 110 rows
- Mapped to phases: 82 (DATA-04 and the 12 batch rows are outside the original phase plan; the 7 UX rows are mapped to phases 27-30, UX-MOB-01 to 31, PKF-01..04 to 32, UX-KC-04, UX-NAV-02 and TEST-PARITY-01 to 33)
- Unmapped: 0
- Status: **103 Complete, 4 Partial** (DEP-02, SEC-17, PROD-01, REG-06), **0 Deferred**, **3 Unverified** (QA-01, REG-01, REG-07), **0 In progress** (v3.3: the 7 UX-* and UX-MOB-01 are Complete and merged; PKF-01..04 are Complete and merged as PR #29; UX-NAV-02 and TEST-PARITY-01 are Complete and merged as PR #30; UX-KC-04 is Complete in PR #31, pending; nothing validated on a real device)
- Change since the first consolidation (76 Complete including DATA-04, 4 Partial, 1 Deferred, 2 Unverified): A11Y-04, A11Y-05, SEC-18, DEP-03 and ARCH-09 became Complete; PROD-02/03/04 are new and Complete; PROD-01 and QA-01 are new and open. The earlier line "75 Complete" excluded DATA-04

---
*Requirements defined: 2026-07-24*
*Last updated: 2026-10-09 with Phase 33 (UX-NAV-02 and TEST-PARITY-01 via PR #30 `432aba5`, UX-KC-04 in PR #31, pending). Before that: v3.3 shipped (UX-* Complete via PR #27 `c7d54dc`, UX-MOB-01 via PR #28 `460a449`, PKF-01..04 via PR #29 `38b9108`). Before that: 2026-10-08, the v3.3 requirements (UX-*, In progress). Before that: after the third batch (registration, 53 commits after `d2dd404`; REG-01..07). Before that: the second batch (PR #24, 89 commits): statuses re-checked against code, tests, commits and GitHub check runs; see phases/TRACEABILITY.md*
