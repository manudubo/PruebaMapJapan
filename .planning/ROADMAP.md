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
| 5. Internationalization | 0/12 | Planned | — |

### Phase 5: Internationalization — translate all user-facing UI strings, HTML content, and TypeScript source strings from Spanish to English across all pages and components

**Goal:** Translate ALL user-facing UI strings, HTML content, and TypeScript source strings from Spanish to English across all pages and components. No i18n library required — direct find-and-replace pass.
**Requirements**: I18N-HTML, I18N-TS, I18N-LOCALE, I18N-PASSKEY, I18N-ACCENT
**Depends on:** Phase 4
**Plans:** 12 plans

Plans:
- [ ] 05-01-PLAN.md — Wave 1: Shared components — Navbar.ts + SearchBar.ts (I18N-HTML, I18N-TS)
- [ ] 05-02-PLAN.md — Wave 2: App HTML pages — index.html + dashboard.html + profile.html (I18N-HTML)
- [ ] 05-03-PLAN.md — Wave 2: App HTML pages — trip.html + trip-edit.html (I18N-HTML)
- [ ] 05-04-PLAN.md — Wave 2: City HTML pages — all 8 city files batch (I18N-HTML)
- [ ] 05-05-PLAN.md — Wave 2: profile.ts + uat-passkeys.spec.ts (test coupling — same commit) (I18N-TS, I18N-LOCALE, I18N-PASSKEY)
- [ ] 05-06-PLAN.md — Wave 2: dashboard.ts (I18N-TS, I18N-LOCALE)
- [ ] 05-07-PLAN.md — Wave 2: tripDetail.ts + map.ts (shared-string coupling — same task) (I18N-TS)
- [ ] 05-08-PLAN.md — Wave 2: trip-edit/destinations.ts + hotels.ts + metadata.ts (I18N-TS)
- [ ] 05-09-PLAN.md — Wave 2: trip-edit/days.ts + activities.ts (I18N-TS)
- [ ] 05-10-PLAN.md — Wave 2: widgets.ts + search.ts (I18N-TS, I18N-LOCALE)
- [ ] 05-11-PLAN.md — Wave 2: itinerary.ts + manifest.json (I18N-TS, I18N-HTML)
- [ ] 05-12-PLAN.md — Wave 3: Final validation — accent audit + locale audit + typecheck + Playwright (I18N-ACCENT)

### Phase 6: Multi-environment configuration — Vite env files per environment (local/dev/prod), Cloudflare Workers wrangler.toml environments, Keycloak realm per env, sslRequired prod hardening

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 5
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 6 to break down)

### Phase 7: Passkey login — wire browser-passkey Keycloak flow as default browser flow, enable AvoidSameAuthenticatorRegister, add Sign in with passkey entry point on landing page

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 7 to break down)

### Phase 8: Demo trip — seed a public demo trip in the database, add View demo trip button on landing page pointing to its public slug so guests can browse the trip builder without logging in

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 7
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 8 to break down)
