# Requirements: TravelMap v3.2 Security & Code Health Hardening

**Defined:** 2026-07-24
**Core Value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.

Source: `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` (synthesized from `ANALISIS-REPO.md` 7-pass live-verified audit + `codex-review.md`).

## v3.2 Requirements

### Security: Critical & High — Phase 20

- [ ] **SEC-01**: OTP codes are generated using a CSPRNG with no modulo bias (`crypto.getRandomValues` — not `Math.random()`)
- [ ] **SEC-02**: News/events widget sanitizes RSS fields before inserting into the DOM (no raw `innerHTML` sinks on untrusted data)
- [ ] **SEC-03**: Widget RSS content is fetched from a trusted source or sanitized at ingestion, not blindly relayed from arbitrary third-party CORS proxies
- [ ] **SEC-04**: Frontend ships a Content Security Policy via `<meta http-equiv>` as a second line of defense against XSS
- [ ] **SEC-14**: `KC_ADMIN_CLIENT_SECRET` is removed from production Cloudflare Workers environment; Keycloak `japan-trip-worker` client is kept for local/test use only

### Deploy & Build Safety — Phase 21

- [x] **INFRA-01
**: `deploy-frontend.yml`/`deploy-backend.yml` gate on `typecheck`/`build`/unit-test CI jobs before deploying (explicitly excluding the `e2e` job until ARCH-09 is fixed)
- [x] **INFRA-02
**: Backend deploy workflow runs typecheck/tests before `wrangler deploy`; a backend CI unit-test job exists in `ci.yml`
- [ ] **INFRA-03**: Backend build succeeds on `wrangler deploy --dry-run` (`compatibility_date` updated to ≥ 2024-09-23 to resolve `string_decoder` builtin gap)
- [x] **INFRA-04
**: `wrangler` is pinned as a `devDependency` in `backend/package.json` (no more `npx wrangler` pulling latest on each run)
- [x] **INFRA-05
**: Keycloak Docker healthcheck uses a method available in the `quay.io/keycloak/keycloak:26.6.1` image (`wget`/`/dev/tcp`) instead of `curl`
- [ ] **DEP-01**: `drizzle-orm` upgraded to `^0.45.2` and `dompurify` upgraded to `^3.4.12` (runtime dependency vulnerabilities resolved; not the RQBv2/1.0 rewrite — targeted minor bump only)

### Reliability Bugs — Phase 22

- [ ] **BUG-01**: Activity drag-reorder persists visually — `order_index` is updated in the optimistic array swap and the API response is used to confirm state (not discarded)
- [ ] **BUG-02**: `request()` API client throws `ApiError(401)` on 401 responses instead of hanging indefinitely
- [ ] **BUG-03**: First-login race condition resolved — user creation uses `INSERT ... ON CONFLICT (keycloak_id) DO NOTHING` + re-select
- [ ] **BUG-04**: `getHotel()` returns `null` on 404 instead of throwing an unhandled error
- [ ] **BUG-05**: `reorderActivities` backend validates that `orderedIds` covers the full activity set for the day
- [ ] **BUG-06**: Stale comment in `keycloak.ts:32` corrected — tokens live in keycloak-js memory, not `sessionStorage`
- [ ] **BUG-07**: `createElement` DOM helper does not expose an `html` path by default; raw HTML insertion requires an explicit opt-in; default path uses `textContent`
- [ ] **BUG-08**: `upsertUser` is wired into the login path so email/name changes in Keycloak are reflected in the app DB (no more stale user records)
- [ ] **BUG-09**: `getUserInfo()` (JWT-local) and `getMe()` (backend) sources of truth are documented per use case to prevent divergence confusion
- [ ] **BUG-10**: `terraform output` command in SETUP.md matches the actual Terraform output name (`worker_client_secret`)
- [ ] **BUG-11**: Activity lat/lng null handling uses `act.lat ?? ''` instead of `String(act.lat)` (prevents literal `"null"` string)
- [ ] **BUG-12**: Dead `User-Agent` header removed from Nominatim browser fetch (browser overrides it silently — the comment describing server-fetch behavior is wrong)
- [ ] **BUG-13**: `dest: any`/`day: any` cast in `trips.ts:132` replaced with proper type narrowing
- [ ] **BUG-14**: Redundant double-query in `getTripById` (select followed by findFirst with same `where`) eliminated
- [ ] **BUG-15**: Slug regex tightened to match an actual UUID pattern (not just `[0-9a-f-]{36}`)
- [ ] **BUG-16**: Per-user/hour cap added to OTP issuance to prevent cycling attack (request OTP → exhaust 5 attempts → burn → repeat, throttled only by email rate)

### Supply Chain, Secrets & Accessibility — Phase 23

- [ ] **SEC-15**: CDN `<script>`/`<link>` Leaflet tags removed from all 9 HTML pages; `leaflet/dist/leaflet.css` imported via Vite (same-origin, build-hashed — pairs with INFRA-06)
- [ ] **SEC-16**: Service worker `CACHE_NAME` derived from build hash/version; HTML/navigation requests switch to network-first or stale-while-revalidate (not cache-first with a hardcoded, never-rotating key)
- [ ] **INFRA-06**: Dead `EXTERNAL_ASSETS` array removed from `sw.js` (or wired into the fetch handler if offline map support is intended — currently unreachable code)
- [ ] **DEP-02**: Gitleaks full-history re-scan completed against HEAD; all 14 `generic-api-key` findings triaged (confirmed false-positives documented; any live keys rotated)
- [ ] **DEP-03**: CI pipeline includes Gitleaks/TruffleHog secret scanning and axe/Lighthouse accessibility scanning so regressions are caught automatically
- [ ] **A11Y-01**: `aria-expanded` attribute removed from `<input>` elements across all 12 affected pages (invalid ARIA role/attribute combo — highest-leverage a11y fix)
- [ ] **A11Y-02**: Contrast violations fixed on landing page (`.demo-countdown-title`, loading span), dashboard `.nav-link`, and profile page (13 nodes)
- [ ] **A11Y-03**: `tripDetail.ts`'s `showError()` error-render path includes a proper heading element (currently wipes `<main>` and rebuilds with no `<h1>`)
- [ ] **A11Y-04**: `tokyo.html` heading-order and target-size violations resolved
- [ ] **A11Y-05**: Mobile LCP improved for landing and Tokyo pages (Lighthouse mobile-throttled baseline: landing 5.856s, Tokyo 6.261s)

### Architecture Debt & Test Coverage — Phase 24

- [ ] **ARCH-01**: `createDb` returns a typed union (`NeonDb | PgDb`) instead of `any` (cascades into `trips.ts:132` type recovery)
- [ ] **ARCH-02**: Dual DB driver selection uses an explicit env var (not a `localhost` substring match on the connection string)
- [ ] **ARCH-03**: `trips.ts` authorization cascade has unit test coverage (unblocked by ARCH-06)
- [ ] **ARCH-05**: Zod schemas include null-safe `.refine()` guards for `start_date ≤ end_date` (trip/destination/hotel) and lat/lng numeric range; `.partial()` PATCH schemas require at least one field
- [ ] **ARCH-06**: Backend unit tests point `DATABASE_URL` at a real ephemeral Postgres DB (migrations + minimal seed); vacuous `toContain([200, 500])` assertions replaced with real assertions
- [ ] **ARCH-07**: E2E suite `waitForTimeout` hard sleeps replaced with web-first `expect(locator)` assertions (31 instances); conditional `test.skip()` calls converted to documented `test.fixme(condition, reason)` or removed (35 instances)
- [ ] **ARCH-08**: Terraform documented as sole source of truth for KC realm config; `apply-local-settings.sh` browserFlow override documented or removed; vestigial `realm-export.json` deleted or regenerated (tracked as SEC-13)
- [ ] **ARCH-09**: CI `e2e` job is green (100% historical failure rate since April 2026 — `#trips-grid`/`#dashboard-login-prompt` timing assertions fixed for preview-build context)
- [ ] **M-01**: `DATABASE_URL`/`getDb` middleware extracted to a shared helper, eliminating ~20 duplicated guard blocks across `trips.ts`/`auth.ts`/`users.ts`/`public.ts`
- [ ] **M-02**: `resolveActivity` uses a single JOIN query instead of 4 sequential SELECTs
- [ ] **M-09**: Per-route `catch {}` blocks log the original error before rethrowing (or removed in favor of propagation to the global `onError` handler — currently makes prod 500s undiagnosable from `wrangler tail`)
- [ ] **PWA-01**: PWA manifest icons use first-party/precached assets instead of remote CDN URLs
- [ ] **DATA-01**: `email_otp_codes` table has an index on `user_id`/`expires_at`; used/expired rows are cleaned up (cleanup job or opportunistic delete on `otp-request`)
- [ ] **DATA-02**: `users.email` has a unique constraint at the DB level (not just Keycloak-enforced upstream)
- [ ] **DATA-03**: `lat`/`lng` columns have `CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)` DB constraint

### Business Logic & Demo Parity — Phase 25

- [ ] **BIZ-01**: Optional/alternative activities can be created from the editor UI (`is_optional` checkbox; `optional_label` phantom-field cleaned up or removed from `ApiActivity` type)
- [ ] **BIZ-02**: Generic/area markers (`is_generic`) can be set from the editor UI; `CreateActivitySchema`/`UpdateActivitySchema` accept it; backend no longer silently drops the field
- [ ] **BIZ-03**: `activities.maps_url` field propagates through the adapter into the view type; editor exposes an input for it (or auto-derives from lat/lng); static `getMapsUrl(name)` table kept as demo-data fallback only
- [ ] **BIZ-04**: Activity `time` field mapped through the adapter to the shared/public view (no longer silently dropped after being stored)
- [ ] **BIZ-05**: Per-destination map zoom adjustable from the editor (`zoom_level` form control — currently defaults to 12 for all user-created destinations)
- [ ] **BIZ-06**: `start_date ≤ end_date` validated for trip, destination, and hotel records (null-safe — only when both dates are present; partial-date trips are valid)
- [ ] **BIZ-07**: Cross-level date coherence validated in route handlers: day date within parent destination range, destination range within parent trip range, no overlapping destination ranges within a trip
- [ ] **BIZ-08**: Activity lat/lng validated for numeric range in Zod schemas (`-90 ≤ lat ≤ 90`, `-180 ≤ lng ≤ 180`; reconsidering string-typed coordinates to prevent `"null"`/`"NaN"` strings)
- [ ] **BIZ-09**: PATCH schemas require at least one field (currently `.partial()` accepts `{}` and returns 200 with only `updated_at` changed)
- [ ] **BIZ-10**: Residual Spanish strings (`"Desde"`, `"Hasta"`) in `tripAdapter.ts` replaced with English (`"From"`, `"Until"`)
- [ ] **BIZ-11**: Date-only ISO strings parsed as local date (not UTC midnight) throughout the frontend — `new Date('YYYY-MM-DD')` replaced with `new Date(y, m-1, d)`; fixes confirmed day-shift bug in negative-UTC-offset timezones (live-reproduced in `America/Argentina/Buenos_Aires`)

### Remaining Security Hardening & IdP Flow — Phase 26

- [ ] **SEC-05**: JWKS cache force-invalidation includes a cooldown timestamp to prevent DoS amplification against Keycloak (any bad-signature request currently triggers an unconditional refresh)
- [ ] **SEC-06**: JWT verification errors return a generic `invalid_token` response body; issuer URL/realm/audience detail logged server-side only
- [ ] **SEC-07**: OTP attempt counter uses atomic `UPDATE ... WHERE attempts < 5 RETURNING` (eliminates TOCTOU race on concurrent requests)
- [ ] **SEC-08**: Email delivery in `otp-request` gated on explicit `ENVIRONMENT` env var; production missing `RESEND_API_KEY` fails loudly (no silent fallback to local Mailpit)
- [ ] **SEC-09**: `profile.ts` passkey label rendered via `textContent` or `DOMPurify.sanitize`, not raw `innerHTML` (closes self-XSS vector)
- [ ] **SEC-10**: `SearchBar.highlightMatch` uses safe DOM construction instead of substring concat into raw `innerHTML` (currently latent — becomes live once search indexes API data)
- [ ] **SEC-11**: Keycloak `error.ftl` template includes `kcSanitize()` before `?no_esc` (consistent with `login.ftl`)
- [ ] **SEC-12**: Keycloak `passkey-forms` subflow restructured to remove the `REQUIRED`+`ALTERNATIVE` smell (confirmed live at 819 occurrences/2h); negative E2E test asserts that username-only auth is impossible
- [ ] **SEC-13**: Terraform is the sole source of truth for `browserFlow`; `apply-local-settings.sh` browserFlow override is documented or removed; vestigial `realm-export.json` deleted or regenerated (also tracked as ARCH-08)
- [ ] **SEC-17**: KC realm `sslRequired` verified against Railway proxy-header configuration; `"all"` enforced in prod if headers are correctly forwarded
- [ ] **SEC-18**: Nominatim geocoder requests proxied through the Worker (not direct from browser) to comply with OSM Usage Policy and avoid per-user query leakage
- [ ] **SEC-19**: Terraform `variables.tf` E2E user password defaults removed; forced via `-var-file=local.tfvars` or guarded by a `precondition` checking `kc_url` is localhost
- [ ] **SEC-20**: `X-Content-Type-Options: nosniff` and `Permissions-Policy` headers added to `backend/src/middleware/security.ts`
- [ ] **SEC-21**: Public trip response field exposure is documented as an intentional product decision, or `user_id`/numeric internal IDs are projected out of the public response
- [ ] **SEC-22**: `resolveDestination` and similar resolvers return 404 for both existing-and-unauthorized and non-existent resources (no 403 that reveals existence)
- [ ] **SEC-23**: CORS allowed origins separated by environment (no `localhost:3000`/`:5173` in production config)
- [ ] **SEC-24**: Health endpoint response minimized, rate-limited, or authenticated to remove fingerprinting data
- [ ] **SEC-25**: `avatar_url`/`preferences` KC attribute mappers remove `add_to_access_token: true` (unnecessary token bloat; backend only reads them on user-CREATE via `id_token`/`userinfo`)
- [ ] **KC-01**: Keycloak `passkey-forms` subflow restructured to a single REQUIRED credential-subflow with webauthn/password as internal ALTERNATIVEs using `conditional-user-configured` executor; password fallback for non-passkey users (including E2E `e2e-test@local`) must remain functional

## Future Requirements (Deferred)

From STATE.md deferred items and v3.1 closing notes — not in v3.2 roadmap.

### Deployment

- **DEPLOY-01**: Production deployment live (Cloudflare Workers + Neon + Railway) with public URLs — unblocked by INFRA-03
- **DEPLOY-02**: Deployment runbook documenting how to bring up all three services locally and in production
- **DEPLOY-03**: Real-auth E2E in CI (Keycloak running in CI; `SKIP_REAL_AUTH` removed from pipeline)

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
| Production deployment | Prerequisite (INFRA-03) is in v3.2, but full prod deploy is deferred |
| Nominatim proxy (SEC-18) if project remains personal-scale | Low-risk for single-user personal tool; only required before scaling to public use |

## Traceability

Which phases cover which requirements. Populated from candidate requirements phase breakdown.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 20 | Pending |
| SEC-02 | Phase 20 | Pending |
| SEC-03 | Phase 20 | Pending |
| SEC-04 | Phase 20 | Pending |
| SEC-14 | Phase 20 | Pending |
| INFRA-01 | Phase 21 | Pending |
| INFRA-02 | Phase 21 | Pending |
| INFRA-03 | Phase 21 | Pending |
| INFRA-04 | Phase 21 | Pending |
| INFRA-05 | Phase 21 | Pending |
| DEP-01 | Phase 21 | Pending |
| BUG-01 | Phase 22 | Pending |
| BUG-02 | Phase 22 | Pending |
| BUG-03 | Phase 22 | Pending |
| BUG-04 | Phase 22 | Pending |
| BUG-05 | Phase 22 | Pending |
| BUG-06 | Phase 22 | Pending |
| BUG-07 | Phase 22 | Pending |
| BUG-08 | Phase 22 | Pending |
| BUG-09 | Phase 22 | Pending |
| BUG-10 | Phase 22 | Pending |
| BUG-11 | Phase 22 | Pending |
| BUG-12 | Phase 22 | Pending |
| BUG-13 | Phase 22 | Pending |
| BUG-14 | Phase 22 | Pending |
| BUG-15 | Phase 22 | Pending |
| BUG-16 | Phase 22 | Pending |
| SEC-15 | Phase 23 | Pending |
| SEC-16 | Phase 23 | Pending |
| INFRA-06 | Phase 23 | Pending |
| DEP-02 | Phase 23 | Pending |
| DEP-03 | Phase 23 | Pending |
| A11Y-01 | Phase 23 | Pending |
| A11Y-02 | Phase 23 | Pending |
| A11Y-03 | Phase 23 | Pending |
| A11Y-04 | Phase 23 | Pending |
| A11Y-05 | Phase 23 | Pending |
| ARCH-01 | Phase 24 | Pending |
| ARCH-02 | Phase 24 | Pending |
| ARCH-03 | Phase 24 | Pending |
| ARCH-05 | Phase 24 | Pending |
| ARCH-06 | Phase 24 | Pending |
| ARCH-07 | Phase 24 | Pending |
| ARCH-08 | Phase 24 | Pending |
| ARCH-09 | Phase 24 | Pending |
| M-01 | Phase 24 | Pending |
| M-02 | Phase 24 | Pending |
| M-09 | Phase 24 | Pending |
| PWA-01 | Phase 24 | Pending |
| DATA-01 | Phase 24 | Pending |
| DATA-02 | Phase 24 | Pending |
| DATA-03 | Phase 24 | Pending |
| BIZ-01 | Phase 25 | Pending |
| BIZ-02 | Phase 25 | Pending |
| BIZ-03 | Phase 25 | Pending |
| BIZ-04 | Phase 25 | Pending |
| BIZ-05 | Phase 25 | Pending |
| BIZ-06 | Phase 25 | Pending |
| BIZ-07 | Phase 25 | Pending |
| BIZ-08 | Phase 25 | Pending |
| BIZ-09 | Phase 25 | Pending |
| BIZ-10 | Phase 25 | Pending |
| BIZ-11 | Phase 25 | Pending |
| SEC-05 | Phase 26 | Pending |
| SEC-06 | Phase 26 | Pending |
| SEC-07 | Phase 26 | Pending |
| SEC-08 | Phase 26 | Pending |
| SEC-09 | Phase 26 | Pending |
| SEC-10 | Phase 26 | Pending |
| SEC-11 | Phase 26 | Pending |
| SEC-12 | Phase 26 | Pending |
| SEC-13 | Phase 26 | Pending |
| SEC-17 | Phase 26 | Pending |
| SEC-18 | Phase 26 | Pending |
| SEC-19 | Phase 26 | Pending |
| SEC-20 | Phase 26 | Pending |
| SEC-21 | Phase 26 | Pending |
| SEC-22 | Phase 26 | Pending |
| SEC-23 | Phase 26 | Pending |
| SEC-24 | Phase 26 | Pending |
| SEC-25 | Phase 26 | Pending |
| KC-01 | Phase 26 | Pending |

**Coverage:**
- v3.2 requirements: 82 total (85 audit findings minus 3 duplicates consolidated: ARCH-04→BUG-08, ARCH-08→SEC-13, one KC-02 informational)
- Mapped to phases: 82
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-24*
*Last updated: 2026-07-24 after initial definition*
