# Roadmap: TravelMap v1.0 Trip Builder

## Overview

Four phases from security foundation through trip builder, public sharing, and passkeys. Security hardening ships first because 11+ live XSS injection sites become public exploits the moment sharing goes live. The trip builder is the core milestone deliverable. Public sharing and passkeys are self-contained layers on top.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Security Hardening** - Eliminate XSS injection sites, fix CORS/JWT, ship dom.ts helper
- [x] **Phase 2: Trip Builder** - Full trip edit UI: destinations, hotels, days, activities, is_public toggle
- [x] **Phase 3: Public Sharing** - public_slug migration, copy-link button, read-only guest view
- [x] **Phase 4: Passkeys** - Keycloak WebAuthn config, passkey registration fix, delete passkey UI
- [x] **Phase 5: Internationalization** - Translate all user-facing strings from Spanish to English
- [x] **Phase 6: Local Infrastructure** - Terraform KC realm + CF Worker secrets; Mailpit replaces MailHog; --import-realm removed
- [ ] **Phase 7: Backend Hardening + KC Config** - Env var hygiene, email optionality, OTP DB migration, KC flows + theme i18n via Terraform
- [ ] **Phase 8: OTP + Passkey Campaign** - Email OTP fallback endpoint; post-login passkey campaign; last-credential guard; UPDATE_PASSWORD gate
- [ ] **Phase 9: Playwright Real Auth** - E2E tests via real KC OIDC login; KC Admin fixtures; passkey and OTP tests automated

## Phase Details

### Phase 1: Security Hardening
**Goal**: All user-controlled strings are safe to render and the backend is hardened against CORS/JWT abuse
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05
**Success Criteria** (what must be TRUE):
  1. No `innerHTML` call in dashboard.ts, tripDetail.ts, or map.ts receives a user-controlled string directly — dom.ts helper is used instead
  2. Leaflet popups pass all HTML through DOMPurify before binding
  3. Backend rejects CORS preflight from unlisted origins and never echoes `*` with credentials
  4. JWT validation accepts only tokens with audience `japan-trip-frontend`, not `account`
  5. `wrangler.toml` contains no D1 binding
**Plans**: 8 plans

Plans:
- [x] 01-01-PLAN.md — Wave 0 frontend test stubs: dom.test.ts + popup.test.ts (RED)
- [x] 01-02-PLAN.md — Wave 0 backend test stubs: cors.test.ts + keycloak.test.ts (RED)
- [x] 01-03-PLAN.md — Wave 2: Create dom.ts helper + install dompurify
- [x] 01-04-PLAN.md — Wave 2: Fix CORS null-origin bug + remove stale D1 wrangler binding
- [x] 01-05-PLAN.md — Wave 2: JWT audience hardening + Keycloak realm re-import (manual checkpoint)
- [x] 01-06-PLAN.md — Wave 3: Replace all innerHTML sites in tripDetail.ts (SEC-01 + SEC-02)
- [x] 01-07-PLAN.md — Wave 3: Replace all innerHTML sites in map.ts (SEC-01 + SEC-02)
- [x] 01-08-PLAN.md — Wave 3: Replace all innerHTML sites in dashboard.ts (SEC-01)

### Phase 2: Trip Builder
**Goal**: Authenticated users can create and manage a complete trip itinerary from the web
**Depends on**: Phase 1
**Requirements**: TRIP-01, TRIP-02, TRIP-03, TRIP-04, TRIP-05, TRIP-06, TRIP-07, TRIP-08, SHARE-01
**Success Criteria** (what must be TRUE):
  1. User navigates from dashboard to a trip edit page (`/trip-edit.html?tripId=X`) and sees a form with current trip metadata
  2. User can add, edit, and delete destinations (with city, country, dates, and coordinates resolved via geocoder or Google Maps URL)
  3. User can add, edit, and delete a hotel per destination (name, URL, check-in/out)
  4. User can add, edit, delete, and reorder activities; each activity accepts a time value stored in the database
  5. User can toggle a trip public or private from the edit page
**Plans**: 9 plans

Plans:
- [x] 02-01-PLAN.md — Wave 0: Backend schema + migration [BLOCKING] + Zod + deleteHotel query + DELETE day/hotel routes (TRIP-04, TRIP-05, TRIP-08)
- [x] 02-02-PLAN.md — Wave 0: Frontend client.ts 6 missing functions + ApiHotel.url + ApiActivity.time (TRIP-03,04,05,06)
- [x] 02-03-PLAN.md — Wave 0: Playwright test stubs — trip-edit.spec.ts + geocoder.spec.ts (all requirements)
- [x] 02-04-PLAN.md — Wave 1: trip-edit.html scaffold + metadata form + auth guard + geocoder module + dashboard edit link (TRIP-01, TRIP-02, TRIP-07, SHARE-01)
- [x] 02-05-PLAN.md — Wave 2: Destinations CRUD section — modal + geocoder + accordion (TRIP-03)
- [x] 02-06-PLAN.md — Wave 2: Hotels CRUD section — upsert/delete modal + URL as plain text (TRIP-04)
- [x] 02-07-PLAN.md — Wave 2: Days CRUD section — color picker + bulk generate smart merge (TRIP-05)
- [x] 02-08-PLAN.md — Wave 2: Activities CRUD + reorder POST with ordered_ids (TRIP-06)
- [x] 02-09-PLAN.md — Wave 3: Wire renderHotelSection + renderDaysSection + renderActivitiesSection into parent render functions

### Phase 3: Public Sharing
**Goal**: Trip owners can share a stable public link; guests can view trips without logging in
**Depends on**: Phase 2
**Requirements**: SHARE-02, SHARE-03, SHARE-04
**Success Criteria** (what must be TRUE):
  1. Trip detail page shows a "Compartir" copy-link button visible only to the trip owner
  2. Public share URL uses a UUID slug (`trip.html?slug=<uuid>`), not the integer trip ID
  3. An unauthenticated user opening a public trip link sees the map and itinerary with no edit controls visible
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Wave 1: TDD RED — public.test.ts slug-based route tests (SHARE-02, SHARE-04)
- [x] 03-02-PLAN.md — Wave 2: Backend — schema + migration + getTripBySlug + update public route (SHARE-02, SHARE-04)
- [x] 03-03-PLAN.md — Wave 2: Frontend — ApiTrip.public_slug + getPublicTrip rename + copy-link button + slug URL mode (SHARE-02, SHARE-03, SHARE-04)

### Phase 4: Passkeys
**Goal**: Users can register, use, and delete passkeys; Keycloak is correctly configured for WebAuthn
**Depends on**: Phase 1
**Requirements**: PASS-01, PASS-02, PASS-03
**Success Criteria** (what must be TRUE):
  1. Passkey registration completes without error — action string `webauthn-register-passwordless` is used
  2. `webAuthnPolicyPasswordlessRpId` is set to the frontend domain in `realm-export.json`
  3. User can delete a registered passkey from the profile page and it no longer appears in the list
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — Wave 1: Keycloak infrastructure upgrade (image 26.6.1, env var rename, RP ID, keycloak-js ^26.0.0 + typecheck gate) (PASS-02)
- [x] 04-02-PLAN.md — Wave 2: profile.ts — fix action string, fix type filter, add delete passkey UI (PASS-01, PASS-03)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 (Phase 4 depends only on Phase 1 and may run in parallel with Phases 2-3 if desired)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Hardening | 8/8 | Complete | 2026-04-27 |
| 2. Trip Builder | 9/9 | Complete | 2026-05-04 |
| 3. Public Sharing | 3/3 | Complete | 2026-05-06 |
| 4. Passkeys | 2/2 | Complete | 2026-05-09 |
| 5. Internationalization | 12/12 | Complete | 2026-05-15 |
| 6. Local Infrastructure | 6/6 | Complete | 2026-05-19 |
| 7. Backend Hardening + KC Config | 8/9 | In Progress | - |
| 8. OTP + Passkey Campaign | 8/8 | Complete | 2026-05-26 |
| 9. Playwright Real Auth | 0/7 | Pending | - |

### Phase 5: Internationalization — translate all user-facing UI strings, HTML content, and TypeScript source strings from Spanish to English across all pages and components

**Goal:** Translate ALL user-facing UI strings, HTML content, and TypeScript source strings from Spanish to English across all pages and components. No i18n library required — direct find-and-replace pass.
**Requirements**: I18N-HTML, I18N-TS, I18N-LOCALE, I18N-PASSKEY, I18N-ACCENT
**Depends on:** Phase 4
**Plans:** 12 plans

Plans:
- [x] 05-01-PLAN.md — Wave 1: Shared components — Navbar.ts + SearchBar.ts (I18N-HTML, I18N-TS)
- [x] 05-02-PLAN.md — Wave 2: App HTML pages — index.html + dashboard.html + profile.html (I18N-HTML)
- [x] 05-03-PLAN.md — Wave 2: App HTML pages — trip.html + trip-edit.html (I18N-HTML)
- [x] 05-04-PLAN.md — Wave 2: City HTML pages — all 8 city files batch (I18N-HTML)
- [x] 05-05-PLAN.md — Wave 2: profile.ts + uat-passkeys.spec.ts (test coupling — same commit) (I18N-TS, I18N-LOCALE, I18N-PASSKEY)
- [x] 05-06-PLAN.md — Wave 2: dashboard.ts (I18N-TS, I18N-LOCALE)
- [x] 05-07-PLAN.md — Wave 2: tripDetail.ts + map.ts (shared-string coupling — same task) (I18N-TS)
- [x] 05-08-PLAN.md — Wave 2: trip-edit/destinations.ts + hotels.ts + metadata.ts (I18N-TS)
- [x] 05-09-PLAN.md — Wave 2: trip-edit/days.ts + activities.ts (I18N-TS)
- [x] 05-10-PLAN.md — Wave 2: widgets.ts + search.ts (I18N-TS, I18N-LOCALE)
- [x] 05-11-PLAN.md — Wave 2: itinerary.ts + manifest.json (I18N-TS, I18N-HTML)
- [x] 05-12-PLAN.md — Wave 3: Final validation — accent audit + locale audit + typecheck + Playwright (I18N-ACCENT)

### Phase 6: Local Infrastructure

**Goal**: Terraform manages KC realm config as HCL and Cloudflare Worker secrets; Mailpit replaces MailHog as local SMTP; `--import-realm` removed from docker-compose
**Depends on**: Phase 5
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. `terraform apply` against local Docker KC succeeds with no manual KC console edits required
  2. `realm-export.json` is annotated as read-only reference; `--import-realm` line is removed from docker-compose
  3. Cloudflare Worker secrets (`RESEND_API_KEY`, `KC_ADMIN_CLIENT_SECRET`) are managed via `cloudflare_worker_secret` resources; no plaintext secrets in `wrangler.toml`
  4. Mailpit container starts on ports 1025/8025 and REST API at `/api/v1/messages` is reachable; MailHog is gone from docker-compose
  5. Local dev stack brings up cleanly with `docker compose up`
**Plans**: 6 plans

Plans:
- [x] 06-01-PLAN.md -- Wave 1: Bootstrap -- Terraform CLI, .gitignore, KC + CF module scaffold files, terraform init
- [x] 06-02-PLAN.md -- Wave 2: KC module core -- main.tf (realm + clients + audience mapper), Mailpit in docker-compose, KC healthcheck
- [x] 06-03-PLAN.md -- Wave 3: KC auth flows -- flows.tf (browser-passkey flow + passkey-forms subflow + executions + required action)
- [x] 06-04-PLAN.md -- Wave 3: CF module -- cloudflare/main.tf (worker secrets), terraform plan mock validation
- [x] 06-05-PLAN.md -- Wave 4: KC scope mappers -- mappers.tf (data sources + 6 protocol mapper resources)
- [x] 06-06-PLAN.md -- Wave 5: Final wiring -- terraform import + apply checkpoint, --import-realm removal, realm-export.json annotation, wrangler cleanup, .dev.vars

### Phase 7: Backend Hardening + KC Config

**Goal**: Backend env var hygiene, email optionality, OTP DB migration, and KC Admin client operational; Keycloak flows (VERIFY_EMAIL, browser-passkey, Required Actions) and theme i18n configured via Terraform
**Depends on**: Phase 6
**Requirements**: BACK-01, BACK-02, BACK-03, BACK-04, KC-01, KC-02, KC-03, KC-04
**Success Criteria** (what must be TRUE):
  1. `validAudiences` reads from `VALID_AUDIENCES` env var (comma-separated); no hardcoded audience strings in backend source
  2. `email?: string` — passkey-only tokens with no email claim are accepted without error throughout the auth middleware chain
  3. `email_otp_codes` table exists in DB with correct schema: id, user_id, code_hash, expires_at, used_at, attempts, created_at
  4. KC Admin client (service account with `manage-users` role) is operational — Admin API calls succeed
  5. `VERIFY_EMAIL` Required Action is enabled and SMTP config (Mailpit local / Resend prod) is wired; verification email is delivered in local E2E flow
  6. `browserFlow` is `browser-passkey` in Terraform; password-forms ALTERNATIVE branch exists in flow before the switch
  7. `webauthn-register-passwordless` Required Action registered in realm with `defaultAction: false`
  8. `messages_es.properties` exists; `locales=es,en` in `theme.properties`; FreeMarker overrides present for login.ftl, login-otp.ftl, verify-email.ftl, error.ftl
**Plans**: 9 plans

Plans:
- [x] 07-01-PLAN.md — Wave 1: BACK-01 + BACK-02: VALID_AUDIENCES env extraction + email optional (types, keycloak.ts, users.ts, .dev.vars)
- [x] 07-02-PLAN.md — Wave 1: BACK-03: emailOtpCodes schema + [BLOCKING] drizzle-kit generate migration
- [x] 07-03-PLAN.md — Wave 1: Terraform additive: password-forms subflow (flows.tf) + worker client + VERIFY_EMAIL + browserFlow flip (main.tf)
- [x] 07-04-PLAN.md — Wave 1: KC-04 theme i18n foundation: theme.properties locales + messages_es.properties
- [x] 07-05-PLAN.md — Wave 1: KC-04 FTL batch A: login.ftl + error.ftl
- [x] 07-06-PLAN.md — Wave 1: KC-04 FTL batch B: login-otp.ftl + verify-email.ftl
- [x] 07-07-PLAN.md — Wave 2: Terraform apply + KC-03 verify-only + human checkpoint
- [x] 07-08-PLAN.md — Wave 2: Retrieve worker secret from terraform output + Admin API smoke test
- [ ] 07-09-PLAN.md — Wave 2: Integration verification — all 8 success criteria + VERIFY_EMAIL Mailpit smoke + human sign-off

### Phase 8: OTP + Passkey Campaign

**Goal**: Email OTP fallback endpoint live; post-login passkey campaign with per-device cookie; last-credential guard; UPDATE_PASSWORD gated by WebAuthn support
**Depends on**: Phase 7
**Requirements**: PASS-04, PASS-05, PASS-06, PASS-07
**Success Criteria** (what must be TRUE):
  1. `POST /api/auth/otp-request` delivers a 6-digit OTP via Resend (prod) / Mailpit (local) with 10-min TTL and max-5-attempts rate limit per email per window
  2. `POST /api/auth/otp-verify` validates OTP with timing-safe HMAC-SHA256+XOR comparison; marks code used; returns 200 on match
  3. Post-login: if device supports WebAuthn and no `pnk_{userId}` cookie exists, user is redirected to passkey campaign AIA; cookie is written after `initKeycloak()` resolves
  4. Profile page delete passkey flow refuses if it would leave the user with zero credentials
  5. UPDATE_PASSWORD Required Action is forced post-OTP only when device does NOT support WebAuthn; passkey-capable devices skip it
**Plans**: 8 plans

Plans:
- [x] 08-01-PLAN.md -- Wave 1: Install resend + extend Env interface (OTP_SECRET, RESEND_API_KEY?) + OtpVerifySchema + .dev.vars seeding (PASS-05)
- [x] 08-02-PLAN.md -- Wave 1: RED test stubs -- backend/src/routes/auth.test.ts (PASS-05)
- [x] 08-03-PLAN.md -- Wave 1: RED test stubs -- frontend/src/modules/passkeyCampaign.test.ts (PASS-04)
- [x] 08-04-PLAN.md -- Wave 2: Backend OTP routes -- auth.ts + db/queries/otp.ts + routes/index.ts mount (PASS-05)
- [x] 08-05-PLAN.md -- Wave 2: Frontend passkeyCampaign.ts -- checkPasskeyCampaign (PASS-04)
- [x] 08-06-PLAN.md -- Wave 1: profile.ts last-credential guard -- credentialCount + guard modal (PASS-06)
- [x] 08-07-PLAN.md -- Wave 3: dashboard.ts OTP banner + modal + campaign wiring + UPDATE_PASSWORD gate (PASS-04, PASS-05, PASS-07)
- [x] 08-08-PLAN.md -- Wave 4: Full verification -- typecheck + test suites + human smoke test (all)

### Phase 9: Playwright Real Auth

**Goal**: E2E tests use real KC OIDC login via storageState; KC Admin fixtures reset state between runs; passkey and OTP tests automated end-to-end
**Depends on**: Phase 8
**Requirements**: E2E-01, E2E-02, E2E-03, E2E-04
**Success Criteria** (what must be TRUE):
  1. `globalSetup` completes OIDC login via headless Chromium and writes `tests/.auth/user.json`; sessionStorage replayed via `addInitScript` workaround for Playwright bug #31108; no ROPC used
  2. `tests/e2e/fixtures/kc-admin.ts` helper can create/delete test users, reset credentials, and clear OTP codes between runs via KC Admin API
  3. `chromium-passkeys` Playwright project runs passkey register/login/delete tests using CDP Virtual Authenticator API
  4. OTP fallback tests: request → Mailpit REST fetch → verify → assert; expired OTP and max-attempts lockout cases covered
**Plans**: 7 plans

Plans:
- [x] 09-01-PLAN.md — Wave 1: Scaffolding — gitignore, deps install, .env.test.example, Mailpit spike + mailpit-helpers.ts (E2E-01, E2E-04)
- [x] 09-02-PLAN.md — Wave 1: KC test user seeding via Terraform — e2e-test@local + otp-test@local (E2E-01, E2E-04)
- [x] 09-03-PLAN.md — Wave 2: globalSetup OIDC login + playwright.config.ts storageState + chromium-passkeys project (E2E-01)
- [x] 09-04-PLAN.md — Wave 2: kc-admin.ts fixture — createUser, deleteUser, resetCredentials, clearOtpCodes (E2E-02)
- [ ] 09-05-PLAN.md — Wave 3: auth.spec.ts real-auth migration + CI SKIP_REAL_AUTH env (E2E-01)
- [ ] 09-06-PLAN.md — Wave 4: passkeys.spec.ts — CDP Virtual Authenticator register/login/delete (E2E-03)
- [ ] 09-07-PLAN.md — Wave 4: otp.spec.ts — serial Mailpit OTP tests (request, expired, lockout, UPDATE_PASSWORD gate) (E2E-04)
