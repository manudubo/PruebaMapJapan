# Stack Research

**Project:** TravelMap (PruebaMapJapan)
**Researched:** 2026-04-26 (updated for v1.0 milestone)
**Note:** Version numbers verified via `npm show` against the live registry. Keycloak Account REST API usage verified against codebase. All DOMPurify findings HIGH confidence (npm registry + codebase-verified). WebSearch was unavailable; supplemental web claims are flagged.

---

## Existing Decisions (not to revisit)

| Layer | Technology | Version pinned |
|-------|-----------|----------------|
| Frontend | Vanilla TypeScript + Vite + Web Components | Vite 5.x, no framework |
| Backend | Hono on Cloudflare Workers | Hono 4.6 |
| Local dev server | @hono/node-server | matches Hono version |
| DB ORM | Drizzle ORM | current |
| DB (prod) | Neon PostgreSQL — serverless HTTP driver | @neondatabase/serverless |
| DB (local) | node-postgres (pg) via Pool | pg |
| Auth | Keycloak 25.0 with OIDC/PKCE + RS256 + WebAuthn | **LOCKED at 25.0** — keycloak-js compat |
| Maps | Leaflet | 1.9 |
| Frontend deploy | GitHub Pages | — |
| Backend deploy | Cloudflare Workers (free tier) | — |
| Auth deploy | Railway hobby | — |
| DB deploy | Neon (free tier) | — |

---

## v1.0 Milestone: New Library Additions

### 1. DOMPurify — XSS Sanitization

**Add to:** `frontend/` (runtime dependency)

```bash
npm install dompurify@3.4.1
npm install -D @types/dompurify@3.2.0
```

**Why 3.x:** DOMPurify 3.x ships its own TypeScript types in `dist/purify.es.d.mts` (verified via `npm show dompurify@3.4.1`). The `@types/dompurify` package is a separate DefinitelyTyped mirror — pin `3.2.0` to match the `3.x` API. If both are installed, `dompurify`'s own types take precedence for the ESM path; `@types/dompurify` is a fallback safety net.

**Why it's needed:** `tripDetail.ts`, `dashboard.ts`, `profile.ts`, `map.ts`, `widgets.ts`, and `SearchBar.ts` all use `innerHTML` with user-controlled strings interpolated directly into templates — e.g., `trip.name`, `activity.name`, `hotel.name`, `day.label`. These values come from the Neon DB via the API and are set by the logged-in user during trip creation. An attacker could store `<script>` or `<img onerror=...>` payloads in any name/label field and have them execute for any viewer of that trip.

**Usage pattern for Vanilla TS (no SSR, browser-only):**

```typescript
import DOMPurify from 'dompurify';

// Sanitize before any innerHTML assignment
element.innerHTML = DOMPurify.sanitize(userString);

// For plain text that NEVER needs HTML — prefer textContent (no DOMPurify needed)
element.textContent = userString;
```

**Key decision: textContent vs DOMPurify.sanitize:**

Most `innerHTML` usages in the codebase mix user strings with hard-coded HTML structure. Two strategies:

1. **Pure text values** (`trip.name`, `dest.city_name`, `activity.name`, `hotel.name`, `day.label`): these should always be rendered as text, never as HTML. Use `textContent` or `createTextNode` where possible. Only use DOMPurify when you need the surrounding HTML structure to stay as `innerHTML`.

2. **Templates with user values interpolated**: sanitize the full string or extract the user parts, set them via `textContent` on child nodes, then assemble via DOM methods.

The simplest correct path for the trip builder: wrap any final `innerHTML` assignment that includes user data with `DOMPurify.sanitize(...)`. This is single-call, low-risk, and doesn't require rewriting template assembly logic.

**DOMPurify config for this app (no need for custom config):**

Default config strips all JS event handlers and script elements. No FORCE_BODY or ALLOWED_TAGS customization needed — the app only renders user-provided strings (names, labels, notes), not user-authored HTML.

**Confidence:** HIGH (version from npm registry; usage from codebase analysis).

---

### 2. No new library needed — Trip Builder UI

**The trip builder edit page is a form-heavy UI.** All data operations (CRUD) already have:
- A complete API client in `frontend/src/api/client.ts` — all endpoints exist
- TypeScript types in `frontend/src/types/index.ts` — `ApiTrip`, `ApiDestination`, `ApiDay`, `ApiActivity`, `ApiHotel`
- Hono + Zod validation schemas on the backend

**What's needed is a new HTML entry point + TS page module, not a new library.**

Add to `vite.config.ts` rollupOptions.input:
```typescript
edit: resolve(__dirname, 'edit.html'),
```

The page follows the same MPA pattern as `dashboard.ts` and `tripDetail.ts`:
- `edit.html` + `frontend/src/pages/edit.ts`
- Auth guard via `initKeycloak()` (same as profile.ts)
- DOM manipulation via standard Web APIs — no form library needed
- Leaflet reused from the existing chunk split for the map picker (click-to-set-coordinates for destinations and activities)

**What NOT to add for the trip builder:**

| Library | Why not |
|---------|---------|
| React / Vue / Svelte | Stack is locked to Vanilla TS; adds 40-100KB bundle; overkill for a form page |
| SortableJS / drag-and-drop library | Reordering activities is a `order_index` PATCH — a simple up/down button pair is sufficient for v1; saves a dependency |
| Flatpickr or similar date picker | `<input type="date">` is supported in all target browsers (Chrome, Firefox, Safari, Edge); native datepicker is sufficient for v1 |
| Alpine.js or htmx | Stack is locked Vanilla TS; these would add a second paradigm to a codebase already using Web Components |
| Zod on frontend | Validation is enforced server-side; frontend can use HTML5 `required`/`pattern` for UX; adding Zod front-end would duplicate backend logic without benefit for v1 |

**Coordinate input for destinations and activities:** Use Leaflet click-to-pick. The user clicks on a map, and the `lat`/`lng` inputs update. Leaflet is already bundled as a manual chunk. No geocoding library needed for v1 — users paste coordinates or click the map.

**Confidence:** HIGH (derived from existing codebase structure and API completeness).

---

### 3. No new library needed — CORS Fix

The CORS fix is a configuration change, not a new library. The existing `hono/cors` middleware is already in use (`backend/src/middleware/cors.ts`). The fix is to tighten the `origin` callback.

**Current bug:** When `origin` is unrecognized, the callback returns `null` (correct). But when called from a browser without an Origin header (same-origin request or curl), it returns `'*'`. The Hono cors middleware will set `Access-Control-Allow-Origin: *` on those responses. For credentialed cross-origin requests, the origin callback returns the specific allowed origin string — this is actually correct behavior. The spec-invalid combination (`*` + `credentials`) only occurs when `origin` is set to `'*'` as a string, not when the callback returns the request origin. **The current cors.ts is already correct** — it returns the specific origin string, not `'*'`, for requests from allowed origins.

The actual remaining fix: add `http://localhost:5173` to the allowed origins list if it's not already there for local dev (currently it is). For production, `KEYCLOAK_URL` and CORS origin should come from environment variables, not be hardcoded. No new library needed.

**Confidence:** HIGH (code-derived from `backend/src/middleware/cors.ts`).

---

### 4. No new library needed — JWT Audience Validation

The JWT audience validation is already implemented in `backend/src/auth/keycloak.ts` (lines 192-199). It validates against `['japan-trip-api', 'japan-trip-frontend', 'account']`. The hardening task is to:

1. Remove `'account'` from `validAudiences` — the `account` audience is issued by Keycloak's own Account Service tokens, not by API tokens. Accepting it means any token issued for the Keycloak Account UI can be used against the API. The API should only accept tokens with `aud: 'japan-trip-api'`.

2. Configure the Keycloak `japan-trip-api` client to add an audience mapper that includes `japan-trip-api` in the `aud` claim of access tokens issued via `japan-trip-frontend`. Without this mapper, access tokens issued to `japan-trip-frontend` may only have `aud: ['account']` by default.

This is a Keycloak realm configuration change (add Audience mapper to `japan-trip-api` client) + a one-line code change in `auth/keycloak.ts`. No new library.

**Confidence:** HIGH (code-derived; Keycloak audience mapper behavior is stable across versions).

---

### 5. No new library needed — Passkeys/WebAuthn via Keycloak Account REST API

The passkey management UI in `profile.ts` is already functionally implemented:
- `loadPasskeys()` calls `GET /realms/{realm}/account/credentials?type=webauthn` — correct Keycloak 25 endpoint
- `registerPasskey()` calls `keycloak.login({ action: 'webauthn-register' })` — correct Keycloak 25 pattern

**No WebAuthn library (SimpleWebAuthn, fido2-lib, etc.) is needed.** The Keycloak Account REST API abstracts the entire WebAuthn ceremony. The frontend never calls `navigator.credentials.create()` or `navigator.credentials.get()` directly — Keycloak handles that in its own UI flow via the login redirect.

**What the v1.0 work actually requires:**

1. Fix the credential type filter in `profile.ts` to include `'webauthn-passwordless'` (code fix, no library)
2. Add delete passkey functionality — `DELETE /realms/{realm}/account/credentials/{id}` using the existing `keycloak.token` pattern (code addition, no library)
3. Configure the Keycloak realm: set `webAuthnPolicyPasswordlessRpId` to the production domain (realm config, not code)
4. Set `browserFlow` to `'browser-passkey'` in the Keycloak admin UI for production (realm config, not code)

**What NOT to add:**

| Library | Why not |
|---------|---------|
| `@simplewebauthn/browser` | The app delegates WebAuthn to Keycloak's UI flow. Adding SimpleWebAuthn would bypass Keycloak and require a custom ceremony/server-side verification implementation — far more work for no benefit |
| `@simplewebauthn/server` | Same reason; also only relevant if running own WebAuthn server, not applicable with Keycloak |
| Any other FIDO2/WebAuthn library | Keycloak 25 already handles the full passkey lifecycle; adding a client library would create parallel, conflicting auth paths |

**Confidence:** HIGH (derived from profile.ts implementation + Keycloak 25 Account REST API pattern).

---

### 6. No new library needed — Public Trip Sharing UI

The backend already has `GET /api/public/trips/:id` (unauthenticated) and `is_public: boolean` on the `ApiTrip` type. The toggle is a PATCH to `updateTrip(tripId, { is_public: !trip.is_public })` using the existing `client.ts` function.

The shareable link is `window.location.origin + '/PruebaMapJapan/trip.html?tripId=' + trip.id`. The "copy link" button uses `navigator.clipboard.writeText()` — Web API, no library needed.

**What NOT to add:** No URL shortening service (adds external dependency, complexity); no QR code library (overkill for v1).

**Confidence:** HIGH (all pieces already exist in codebase).

---

## Complete v1.0 Frontend Installation Delta

```bash
# In frontend/ — only one new runtime dep
npm install dompurify@3.4.1
npm install -D @types/dompurify@3.2.0
```

No backend dependencies change. No new infrastructure. No new Cloudflare bindings.

---

## What NOT to Add (Master List for v1.0)

| Package | Why not |
|---------|---------|
| React / Vue / Svelte | Stack locked to Vanilla TS |
| `@simplewebauthn/browser` | Keycloak handles WebAuthn ceremony; adding this creates conflicting auth paths |
| SortableJS | Up/down reorder buttons sufficient for v1; saves dependency |
| Flatpickr / date-fns | Native `<input type="date">` sufficient; date-fns is large (~200KB) for minimal gain |
| Zod (frontend) | Backend validates; HTML5 constraint validation sufficient for UX |
| Alpine.js / htmx | Adds a second paradigm alongside existing Web Components |
| `isomorphic-dompurify` | SSR wrapper — this app is browser-only; plain `dompurify` is correct |
| `sanitize-html` | Node-centric; larger than DOMPurify; no TypeScript types built in |
| Any URL shortener SDK | External dependency, not needed for trip sharing |
| Geocoding library (Nominatim client, etc.) | Click-to-pick on Leaflet map is sufficient; avoids rate-limit concerns on third-party geocoding APIs |

---

## Integration Points Summary

| Feature | Library delta | Config change | Code change |
|---------|--------------|---------------|-------------|
| Trip builder edit page | None | Add `edit` entry to `vite.config.ts` rollupOptions | New `edit.html` + `frontend/src/pages/edit.ts` |
| XSS hardening | `dompurify@3.4.1` + `@types/dompurify@3.2.0` | None | Wrap `innerHTML` assignments with `DOMPurify.sanitize()` in `tripDetail.ts`, `dashboard.ts`, `map.ts`, `widgets.ts`, `SearchBar.ts` |
| CORS fix | None | None | Remove `account` from `corsMiddleware` if present; confirm origin list matches production URL |
| JWT audience tightening | None | Keycloak: add Audience mapper to `japan-trip-api` client | Remove `'account'` from `validAudiences` array in `auth/keycloak.ts` |
| Passkeys functional | None | Keycloak realm: set RP ID, set `browserFlow`, wire required actions | Fix credential type filter; add delete passkey button |
| Public trip sharing | None | None | Add toggle button to trip detail/dashboard; copy-link using `navigator.clipboard` |

---

## Confidence Levels

| Topic | Confidence | Reason |
|-------|------------|--------|
| DOMPurify version (3.4.1) | HIGH | Verified via `npm show dompurify dist-tags` |
| `@types/dompurify` version (3.2.0) | HIGH | Verified via `npm show @types/dompurify version` |
| DOMPurify ESM compatibility with Vite 5 | HIGH | Package ships `dist/purify.es.mjs` as `module` field; Vite picks it up automatically |
| XSS surface (innerHTML with user data) | HIGH | Derived from full grep of codebase |
| No new library for trip builder | HIGH | API client and types are complete; MPA pattern is established |
| CORS fix is config-only | HIGH | Derived from `cors.ts` implementation |
| JWT audience fix is code-only | HIGH | Derived from `auth/keycloak.ts` lines 192-199 |
| Passkeys use Keycloak Account REST API (no WebAuthn library) | HIGH | Derived from `profile.ts` implementation |
| Public sharing uses existing API + clipboard | HIGH | `getPublicTrip()` and `is_public` field already exist |
| Keycloak Audience mapper behavior | MEDIUM | Training knowledge, not live-verified; but behavior is stable across Keycloak versions |
