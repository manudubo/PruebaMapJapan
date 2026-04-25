# Research Summary

**Project:** TravelMap (PruebaMapJapan)
**Date:** 2026-04-25
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## Key Findings

### Stack
The committed stack (Hono + Cloudflare Workers + Neon + Keycloak 25 + Vite MPA + Leaflet) is sound. No stack changes needed. Critical fixes before production:
- Remove stale D1 placeholder from `wrangler.toml`
- Update `compatibility_date` to `2025-03-01`
- Fix CORS wildcard → explicit GitHub Pages origin
- Add Vite build-time guard for `VITE_API_URL`
- Cache local dev DB pool to avoid per-request Pool creation

### Features (Table Stakes for v1)
These must exist for the product to feel like a trip planner:
1. Edit trip metadata inline (name, dates, description, public/private)
2. Add/remove destinations with geocoordinates
3. Hotel per destination (name, check-in/out, coords)
4. Add/edit/delete days with label and color
5. Add/edit/delete activities per day (name, coords, notes)
6. Activity reorder (up/down buttons minimum)
7. Map sync — activity list clicks pan/zoom the map
8. Geocoding input (Nominatim OSM, free) for destinations and activities
9. Public/private toggle + shareable link copy
10. Delete trip with confirmation

### Architecture
**Recommended approach:** Inline editing on `trip.html`, not a separate edit page.
- `isOwner` flag derived at load time (compare `trip.user_id` vs `getUserInfo().id`)
- `editMode` boolean controls CSS class on container, shows/hides all edit controls
- Single `currentTrip: ApiTrip` variable mutated in place after each API call
- Targeted re-renders per level — never full page reload
- Plain `<form>` elements for editor panels (not Web Components)
- Map click → captures `e.latlng` → populates lat/lng inputs in open forms
- Missing API client functions to add: `updateDay`, `deleteDay`, `upsertHotel`, `deleteHotel`, `reorderActivities`

### Watch Out For (High Severity)
| Pitfall | Fix |
|---------|-----|
| Blank WebAuthn RP ID → passkeys fail in prod | Set `webAuthnPolicyPasswordlessRpId` to `manud.github.io` |
| CORS `*` + credentials → all auth API calls silently fail | Explicit origin in Hono `cors()` middleware |
| XSS via `innerHTML` with user data | `textContent` everywhere; DOMPurify if HTML needed |
| `VITE_API_URL` silent fallback to localhost | Build-time assertion in `vite.config.ts` |
| Railway Keycloak no DB → config lost on redeploy | Provision Railway PostgreSQL, set `KC_DB_*` env vars |
| `KC_HOSTNAME` mismatch → every JWT fails | Set to Railway URL before first deploy |

---

## Build Order Recommendation

Based on dependencies between features and pitfalls:

1. **Security hardening** — CORS, XSS, JWT audience, VITE_API_URL guard. These block production and affect every phase that touches those files. Fix before building on top.

2. **Trip builder UI** — The largest gap. Backend API is complete; frontend needs inline editing for all 5 entity levels (trip → destinations → hotels → days → activities). Includes geocoding via Nominatim, map-click pin placement, and the missing backend DELETE day route.

3. **Passkeys + IAM** — Configure Keycloak WebAuthn RP ID, flip `browserFlow` to `browser-passkey` in prod, fix credential type filter in `profile.ts`, make `email` nullable.

4. **Production deployment** — Cloudflare Workers + Neon + Railway Keycloak all live with correct env vars, wrangler.toml cleanup, KC_HOSTNAME set, deployment runbook written.

5. **Demo + public sharing** — Migrate Japan trip from static TS to DB (as a demo public trip), landing page queries API, public/private toggle UI with shareable link copy.

---

## Deferred (v2)
- Drag-and-drop activity reorder
- Route polyline between activity pins
- Cover image upload for trip cards
- Export to PDF / print view
- Day color picker (schema supports it, low effort — could be v1 bonus)
