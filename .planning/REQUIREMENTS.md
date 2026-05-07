# Requirements — TravelMap v1.0 Trip Builder

**Milestone:** v1.0
**Goal:** Build the end-to-end trip builder UI so a user can create and manage a complete trip itinerary from the web.
**Defined:** 2026-04-26

---

## v1.0 Requirements

### Security Hardening

- [ ] **SEC-01**: User-controlled strings are never interpolated via `innerHTML` — `dom.ts` helper replaces all 11+ injection sites, including inline style attributes (`cover_image_url`, `day.color`)
- [ ] **SEC-02**: Leaflet popup HTML strings are sanitized with DOMPurify in `buildPopup` / `buildHotelPopup`
- [ ] **SEC-03**: CORS middleware: `credentials: true` removed; null-origin fallback returns `null` not `'*'`
- [ ] **SEC-04**: JWT audience validation removes `'account'`; Keycloak client gets audience mapper for `japan-trip-frontend`
- [ ] **SEC-05**: Stale D1 binding removed from `wrangler.toml`

### Trip Builder

- [ ] **TRIP-01**: User can open a dedicated trip edit page (`trip-edit.html?tripId=X`) from the dashboard
- [ ] **TRIP-02**: User can edit trip metadata — name, description, start/end dates, public/private toggle
- [ ] **TRIP-03**: User can add, edit, and delete destinations — city, country, dates, coordinates via geocoder
- [ ] **TRIP-04**: User can add, edit, and delete the hotel for a destination — name, URL, check-in/out, optional coordinates
- [ ] **TRIP-05**: User can add, edit, and delete days — label, date, color; "generate all days" bulk helper from destination date range
- [ ] **TRIP-06**: User can add, edit, delete, and reorder activities — name, time, notes, coordinates via geocoder
- [ ] **TRIP-07**: Geocoder input accepts a Nominatim search query or a Google Maps URL and resolves to lat/lng
- [ ] **TRIP-08**: Drizzle migration adds nullable `time text` column to activities table

### Public Sharing

- [ ] **SHARE-01**: User can toggle a trip public/private from the edit page
- [ ] **SHARE-02**: Trip owner sees a "Compartir" + copy-link button on the trip detail page
- [ ] **SHARE-03**: Drizzle migration adds `public_slug uuid` to trips; public backend endpoint uses slug instead of integer ID
- [ ] **SHARE-04**: Unauthenticated user opens a public trip link and sees map + details with no edit controls

### Passkeys

- [ ] **PASS-01**: Passkey registration uses correct action string (`webauthn-register-passwordless`)
- [x] **PASS-02
**: `webAuthnPolicyPasswordlessRpId` is set in `realm-export.json` for both local dev and production
- [ ] **PASS-03**: User can delete a registered passkey from the profile page

---

## Future Requirements (Deferred)

- Rename passkey (PASS) — `PUT /account/credentials/{id}/label`
- Production deployment (DEPLOY) — Cloudflare Workers + Neon + Railway all live with public URLs
- Deployment runbook (DEPLOY) — Local and production bring-up documented
- Landing demo experience (DEMO) — Landing page queries API for Japan trip as demo
- Day color drag-to-reorder (TRIP) — no backend endpoint for destinations/days reorder
- Cover image upload (TRIP) — requires storage; URL-paste already works
- Activity time as structured column in search (TRIP) — v1 has DB column; search indexing deferred
- CSP response header (SEC) — Hono middleware; v1 fixes XSS at source

---

## Out of Scope

- Mobile native app — web-only by design
- Social features (likes, comments, following) — not needed for v1
- AI/LLM trip suggestions — user builds manually
- Trip marketplace / public discovery feed — not a social platform
- Payment or monetization — free personal tool
- Drag-to-reorder destinations/days — no backend reorder endpoints; up/down buttons sufficient

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 1 | Pending |
| SEC-04 | Phase 1 | Pending |
| SEC-05 | Phase 1 | Pending |
| TRIP-01 | Phase 2 | Pending |
| TRIP-02 | Phase 2 | Pending |
| TRIP-03 | Phase 2 | Pending |
| TRIP-04 | Phase 2 | Pending |
| TRIP-05 | Phase 2 | Pending |
| TRIP-06 | Phase 2 | Pending |
| TRIP-07 | Phase 2 | Pending |
| TRIP-08 | Phase 2 | Pending |
| SHARE-01 | Phase 2 | Pending |
| SHARE-02 | Phase 3 | Pending |
| SHARE-03 | Phase 3 | Pending |
| SHARE-04 | Phase 3 | Pending |
| PASS-01 | Phase 4 | Pending |
| PASS-02 | Phase 4 | Pending |
| PASS-03 | Phase 4 | Pending |
