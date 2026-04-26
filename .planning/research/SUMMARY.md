# Research Summary — TravelMap v1.0

**Milestone:** Trip Builder + Security Hardening + Passkeys + Public Sharing
**Researched:** 2026-04-26
**Confidence:** HIGH

## Executive Summary

v1.0 is almost entirely frontend work on top of a complete backend API. The only new dependency is `dompurify@3.4.1` for Leaflet popup sanitization. Security hardening must go first — 11+ live XSS injection sites become a public exploit the moment trip sharing ships.

The highest-risk non-security item is `webAuthnPolicyPasswordlessRpId = ""` in `realm-export.json`. Must be set before any user registers a passkey in production; cannot be changed retroactively.

## Stack Additions

| Item | Change |
|------|--------|
| `dompurify@3.4.1` | New frontend runtime dep — Leaflet popup HTML only |
| `@types/dompurify@3.2.0` | Dev dep |
| Backend | None |
| Infrastructure | None |
| Keycloak | Config only (RP ID, audience mapper) |

All other XSS surfaces use a new `dom.ts` DOM construction helper (zero library weight).

## Feature Table Stakes

### Trip Builder Edit Page
- `trip-edit.html?tripId=X` entry point; open from dashboard card
- Edit trip metadata (name, description, dates, `is_public` toggle)
- Add/edit/delete destinations (city, country, dates, lat/lng)
- Add/edit/delete hotel per destination (name, URL, check-in/out)
- Add/edit/delete days (label, date, color)
- Add/edit/delete activities (name, notes, lat/lng); reorder via up/down buttons
- Multi-step form: create parent → persist → add children against server-assigned ID

### Security Hardening
- New `dom.ts` helper replacing all template-literal `innerHTML` with DOM construction
- `DOMPurify.sanitize()` for Leaflet popup strings only (`buildPopup`, `buildHotelPopup`)
- Fix inline style injection: `cover_image_url` → `.style.backgroundImage` with `https://` validation; `day.color` → regex `#[0-9a-fA-F]{3,8}`
- CORS: remove `credentials: true`; fix `origin ?? '*'` fallback → `null`
- JWT: remove `'account'` from `validAudiences`; add audience mapper on Keycloak client
- Remove stale D1 binding from `wrangler.toml`

### Public Trip Sharing
- `is_public` toggle on trip edit page (covered by trip builder phase)
- "Compartir" + copy-link button on trip detail (owner-only)
- `public_slug uuid` column for share URLs — prevents integer ID enumeration
- Backend route: `/api/public/trips/:slug` (replaces `:id`)
- Read-only guest view: hide edit controls when not authenticated or not owner

### Passkeys Functional
- Fix `registerPasskey` action string → `'webauthn-register-passwordless'`
- Set `webAuthnPolicyPasswordlessRpId` in `realm-export.json`
- Delete passkey: `DELETE /realms/{realm}/account/credentials/{id}`
- Rename passkey: `PUT /account/credentials/{id}/label`
- Session refresh (`keycloak.updateToken(60)`) before registration

## Key Architectural Points

- **`dom.ts`** — new shared module built in Phase 1; consumed by dashboard, tripDetail, map, widgets, SearchBar, profile, tripEdit
- **Trip edit page** — `tripEdit.ts` uses surgical DOM updates keyed by entity ID; no auto-save; explicit save buttons per section
- **Share URL** uses `public_slug` (UUID), not integer PK

## Critical Pitfalls

| # | Pitfall | Severity | Phase |
|---|---------|----------|-------|
| 1 | `webAuthnPolicyPasswordlessRpId = ""` — defaults to Keycloak hostname, not frontend domain | CRITICAL | 4 |
| 2 | `cover_image_url` / `day.color` inline style injection bypasses innerHTML-only fix | HIGH | 1 |
| 3 | Leaflet `bindPopup` calls innerHTML internally — needs DOMPurify, not `dom.ts` | HIGH | 1 |
| 4 | Integer trip IDs enumerable in share URLs | HIGH | 3 |
| 5 | Serial nested entity creation with no rollback | HIGH | 2 |
| 6 | `credentials: true` in CORS is unused and harmful | HIGH | 1 |
| 7 | Keycloak credential listing response shape — verify at runtime before implementing delete/rename | MEDIUM | 4 |

## Recommended Phase Order

1. **Security Hardening** — prerequisite for safe public sharing; creates `dom.ts` primitive
2. **Trip Builder Edit Page** — largest feature; `is_public` toggle subsumes most of Phase 3
3. **Public Trip Sharing** — minimal net-new code after Phase 2; requires `public_slug` migration
4. **Passkeys Functional** — self-contained; verify credential listing shape before implementing

## Open Decisions (Resolve Before Phase 2)

- **Activity `time` field**: schema migration (nullable `time text` column) or name-prefix convention ("10:00 — Senso-ji")?
- **Coordinate input UX**: plain lat/lng text fields or Nominatim geocoder lookup?
- No existing share URLs in the wild, so `public_slug` migration needs no transition plan.

---
*Ready for roadmap: yes — 4 phases, all research flags resolved except Phase 4 runtime Keycloak verification*
