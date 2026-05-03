# Feature Landscape — TravelMap v1.0 Milestone

**Domain:** Trip builder UI + security + sharing + passkeys
**Researched:** 2026-04-26
**Source basis:** Direct codebase analysis (schema, routes, frontend pages, validation schemas)

---

## Feature 1: Trip Builder Edit Page

### Schema/API state (constraints on UI scope)

The backend API is complete: full CRUD for trips, destinations, hotel (upsert), days, activities,
and a reorder endpoint for activities. The frontend API client (`client.ts`) has wrappers for all
of these. The edit page is pure UI work — no new backend routes needed — with two exceptions:

1. **No `time` field on activities.** `schema.ts` has `name`, `notes`, `lat/lng`, `is_optional`,
   `is_generic`, `maps_url`, `order_index`. No time column. `PROJECT.md` says "activities (name,
   time, notes, map pin)". Resolution: treat time as a label prefix in `name` (e.g., "10:00 —
   Senso-ji") or add a nullable `time` column — schema migration needed if the field matters.
2. **Reorder exists only for activities.** `POST .../activities/reorder` exists. There is no
   equivalent for destinations or days. Reordering destinations/days by drag requires new backend
   endpoints, not just UI.

### Table stakes

| Behavior | Complexity | Testable |
|----------|------------|---------|
| Open edit page from dashboard trip card (new HTML entry point `trip-edit.html?tripId=X`) | Low | User clicks "Edit" on a card, arrives at edit page for that trip |
| Edit trip name, description, start/end dates via form; save via `PATCH /trips/:id` | Low | User changes name, saves, returns to dashboard, card shows updated name |
| Public/private toggle on edit page; sends `PATCH /trips/:id { is_public }` | Low | User toggles to public, saves, dashboard badge appears |
| Add destination (city name, country, start/end dates, lat/lng text fields) | Medium | User adds "Tokyo / Japan / 2026-03-01 / 2026-03-07", saves, destination tab appears on trip detail |
| Edit existing destination (any field) | Medium | User changes city name, saves, tab label updates on trip detail |
| Delete destination with confirmation warning (cascades to hotel, days, activities) | Medium | User deletes destination, confirmation dialog mentions cascading data loss, on confirm destination gone |
| Add/edit/delete hotel per destination (name, check-in, check-out, optional lat/lng) | Medium | User adds hotel name + dates, hotel marker appears on trip map |
| Add day under a destination (date, optional label, optional color) | Medium | User adds day "2026-03-01 / Day 1 – Arrival", day appears in day selector on trip detail |
| Add activity under a day (name, optional notes, optional lat/lng) | Medium | User adds "Senso-ji Temple / notes / lat-lng", numbered pin appears on map |
| Edit and delete activities | Medium | User edits notes, map popup reflects change; user deletes activity, pin removed |

### Differentiators

| Behavior | Complexity | Notes |
|----------|------------|-------|
| "Generate days from date range" — if destination has start/end dates, offer to create all days at once | Medium | No bulk endpoint; client-side loop calling `POST .../days` N times; N typically ≤30 |
| Activity reorder by up/down arrow buttons within a day | Low | Calls `POST .../activities/reorder`; simpler than drag-and-drop in vanilla TS |
| Day color picker for `color_hex` | Low | `<input type="color">`; field exists in schema |
| Inline map pin picker — click a Leaflet mini-map to set activity lat/lng | High | Requires embedded Leaflet in the edit form; significant complexity |

### Anti-features

| Anti-feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Destination or day drag-to-reorder | No backend reorder endpoint for these entities | Up/down buttons if ordering matters, defer true drag-reorder |
| Rich text / Markdown in notes | Adds XSS sanitization complexity | Plain `textarea`, render as `textContent` |
| Cover image upload | Needs storage; `cover_image_url` accepts a URL string already | User pastes a link |
| Multi-hotel per city | Schema enforces one hotel per destination (FK) | Single hotel per destination |
| Activity time as a structured column | Schema migration; low value gain | Use name-prefix convention ("10:00 — Senso-ji") or skip for v1 |
| Autosave / optimistic UI | State sync complexity in MPA without framework | Explicit save button per section |

### Dependencies on existing features

- Requires authenticated session (AuthGuard pattern from `profile.ts`)
- Reads existing trip via `GET /trips/:id` on page load
- After any write, trip detail page picks up changes on next load (no cache to invalidate)

---

## Feature 2: Security Hardening

### Current state — concrete XSS sites in the codebase

**`frontend/src/pages/dashboard.ts` lines 41–53 (`renderTripCard`):** Sets `grid.innerHTML` with
`trip.name`, `trip.description`, `dateRange`, and `trip.cover_image_url` in a CSS `style=`
attribute. All user-controlled strings. A crafted trip name containing `<script>` or
`</h3><img onerror=alert(1)>` executes on the dashboard page.

**`frontend/src/pages/tripDetail.ts` (multiple functions):**
- `buildPopup()` — interpolates `activity.name`, `activity.notes`, `day.label` into innerHTML
- `buildHotelPopup()` — interpolates `hotel.name` into innerHTML
- `buildLegendItem()` — interpolates `activity.name`, `activity.notes` via `item.innerHTML`
- `updateHotelInfo()` — interpolates `hotel.name` into `hotelInfo.innerHTML`
- `buildDestTabs()` — interpolates `dest.city_name` into tab button innerHTML

**`backend/src/middleware/cors.ts` line 19:** `return origin ?? '*'` returns the string `'*'` for
requests with no `Origin` header, combined with `credentials: true`. Browsers reject
`ACAO: *` with credentials, but non-browser clients bypass it.

**`backend/src/auth/keycloak.ts` line 193:** `validAudiences` includes `'account'`. A token
issued for Keycloak's account console is accepted by the trips API, expanding the blast radius
if a token is stolen or crafted.

### Table stakes

| Fix | Complexity | Testable |
|-----|------------|---------|
| Replace all `innerHTML` string interpolations above with `textContent` + `createElement` | Medium | Trip named `<img src=x onerror=alert(1)>` renders literally on dashboard and trip detail — no alert fires |
| Fix CORS null-origin: replace `origin ?? '*'` with `origin ?? null` (return null denies) | Low | OPTIONS with no Origin header → no `ACAO` header in response |
| Remove `'account'` from backend `validAudiences`; keep `'japan-trip-api'` and `'japan-trip-frontend'` | Low | JWT with `aud: account` (Keycloak account console token) is rejected with 401 on trip endpoints |
| Verify `email` is not required when provisioning users in `middleware/user.ts` for passkey-only flows | Low | A JWT with no `email` claim (passkey user) does not cause 500 during user provisioning |

### Differentiators

| Fix | Complexity | Notes |
|-----|------------|-------|
| CSP response header (`Content-Security-Policy`) on backend | Medium | Hono middleware; defense-in-depth against missed injection sites |
| DOMPurify for notes/description if HTML rendering is intentionally added later | Medium | Only worthwhile if Markdown is added; overkill for plain text fields |

### Anti-features

| Anti-feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Sanitizing HTML with a regex | Always incomplete | `textContent` for display; DOMPurify only if HTML rendering is intentional |
| Per-route CORS overrides | Maintenance surface | Single `corsMiddleware` at root, origin list from env var |
| Changing JWT algorithm from RS256 | RS256 + JWKS rotation is already implemented correctly | Leave RS256 + JWKS as-is |

### Dependencies on existing features

- XSS fixes are a hard prerequisite for public trip sharing — unauthenticated users would see injected HTML from any trip marked public
- CORS fix prerequisite for production deployment (GitHub Pages origin must be explicitly allowed, not `*`)

---

## Feature 3: Public Trip Sharing

### Current state

- `is_public` boolean exists in schema (default `false`)
- `GET /api/public/trips/:id` enforces `is_public = true`, no auth required
- `client.ts` has `getPublicTrip()`
- `tripDetail.ts` already falls back to `getPublicTrip()` when the user is unauthenticated
- `dashboard.ts` already renders `trip-card-badge--public` when `trip.is_public` is true
- Missing: UI to set `is_public` from the frontend; copy-link button; read-only enforcement on guest view

### Table stakes

| Behavior | Complexity | Testable |
|----------|------------|---------|
| Toggle public/private on edit page (or dashboard) via `PATCH /trips/:id { is_public }` | Low | User flips toggle to public, reloads dashboard, "Público" badge appears on card |
| "Copy share link" button that writes `trip.html?tripId=X` to clipboard | Low | `navigator.clipboard.writeText()`; user clicks button, pastes URL into new tab, sees trip without logging in |
| Unauthenticated user opens share link, sees trip map and legend | Low | Already works via `getPublicTrip()` fallback; verify no edit controls appear for guests |
| Read-only enforcement: no edit/delete buttons visible when viewing as guest | Medium | Guest visits shared link; no "Edit" button, no "Add activity" affordances |
| Public badge on dashboard card toggles correctly with `is_public` state | Low | Partially implemented; verify badge appears/disappears after toggle |

### Differentiators

| Behavior | Complexity | Notes |
|----------|------------|-------|
| "Link copied!" toast notification | Low | Single div, CSS animation, `setTimeout` dismiss |
| Open Graph meta tags on `trip.html` for link preview | Medium | MPA complicates this — Vite builds static HTML; would require injecting `og:title` at runtime or a separate SSR step |

### Anti-features

| Anti-feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Public trip discovery / browse feed | Not a social platform | Trips shared by link only; no listing endpoint |
| "Fork this trip" for other users | Ownership-transfer complexity | Copy URL, create your own trip |
| Expiring share links | Requires token generation and new table | `is_public` toggle is sufficient for v1 |
| Password-protected sharing | New auth flow; out of scope | Use Keycloak auth for private access |
| Comments or likes on public trips | Social feature explicitly out of scope | — |

### Dependencies on existing features

- XSS fixes (Feature 2) are a hard prerequisite — any injected HTML in a public trip is visible to unauthenticated users
- Public/private toggle can live on the trip edit page (Feature 1) or the dashboard — one of the two must exist first

---

## Feature 4: Passkeys Functional

### Current state

`profile.ts` already has:
- `loadPasskeys()` — calls `GET /realms/{realm}/account/credentials?type=webauthn`; filters by `type === 'webauthn'`; renders name and creation date; no delete button
- `registerPasskey()` — calls `keycloak.login({ action: 'webauthn-register', redirectUri: window.location.href })` — redirect-based flow via Keycloak's WebAuthn registration page

Missing: delete button wired to `DELETE /realms/{realm}/account/credentials/{credentialId}`.

Login-with-passkey is a **Keycloak realm configuration** (enable WebAuthn Passwordless
authentication flow in the Authentication tab), not a UI feature. It is a config dependency.

### Table stakes

| Behavior | Complexity | Testable |
|----------|------------|---------|
| List registered passkeys (name, creation date) on profile page | Low | Already implemented; user with 1 passkey sees it listed with creation date |
| Register a new passkey via Keycloak redirect flow | Low | Already wired; user clicks "Add passkey", redirects to Keycloak WebAuthn page, completes biometric, returns to profile, passkey appears in list |
| Delete a passkey from profile page | Medium | User clicks delete on a passkey row, `DELETE /realms/{realm}/account/credentials/{id}` called with bearer token, on success list refreshes, passkey gone |
| Graceful error if user cancels biometric prompt | Low | User cancels; page does not crash; button re-enabled; no stale state |
| Keycloak realm configured with WebAuthn authenticator flow | Medium (config) | User can authenticate from Keycloak login page using a registered passkey; realm export contains WebAuthn policy |

### Differentiators

| Behavior | Complexity | Notes |
|----------|------------|-------|
| Rename passkey via `PUT /account/credentials/{id}/userLabel` | Low | Keycloak Account REST supports this; lets user label "MacBook Touch ID" vs "Phone Face ID" |
| Show device type hint from AAGUID | Low | `credentialData` may include AAGUID; parsing to device name requires a lookup table |

### Anti-features

| Anti-feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Implementing WebAuthn ceremony manually (generate challenge, verify attestation) | Keycloak handles the full ceremony; reimplementing duplicates auth logic | Use `keycloak.login({ action: 'webauthn-register' })` redirect |
| Inline WebAuthn registration without redirect | Requires Keycloak non-public SPI; not exposed as Account REST in v25 | Redirect flow is the supported path |
| Forcing passkey-only auth (disabling password login) | Would lock out users without a registered passkey | Leave as optional second factor / alternative flow |
| "Remember this device" / trusted device UI | Keycloak manages sessions internally | — |

### Dependencies on existing features

- Requires `keycloak.token` to be a valid bearer token accepted by Keycloak Account REST API
- **Important:** JWT audience tightening in Feature 2 removes `'account'` from the backend's `validAudiences` — this applies only to the backend trips API validator. The `keycloak-js` token still carries `aud: account` for Keycloak's own Account REST API calls. These are separate: profile page calls Keycloak directly (correct), backend API rejects `account`-only tokens (also correct).
- Profile page is already auth-gated (redirects to `index.html` when unauthenticated)

---

## Feature Dependency Map

```
Security hardening — XSS fixes
  └── hard prerequisite for → Public trip sharing (guest users see injected HTML)

CORS fix
  └── prerequisite for → Production deployment (not blocking local dev)

Trip builder edit page
  └── natural home for → Public/private toggle (can defer toggle to dashboard if needed)

JWT audience tightening (remove 'account' from backend)
  └── does NOT affect → Passkey profile page
      (profile calls Keycloak Account REST directly with the same token;
       backend audience check only applies to trips API)
```

## MVP Build Order

1. **Security hardening** — XSS + CORS + JWT audience; blocks public sharing safety; lowest complexity; do first
2. **Public trip sharing** — toggle + copy link; backend is fully ready; UI is ~50 lines
3. **Trip builder edit page** — largest feature; no backend changes; pure frontend
4. **Passkeys functional** — delete + Keycloak config; self-contained; last because it depends only on existing auth infrastructure

## Open Questions

- **Activity time field:** Schema has no `time` column. Accept text convention in `name` or add migration? Decision needed before trip builder phase starts; a migration against Neon is straightforward but must be planned.
- **Coordinate input UX:** Lat/lng as plain number fields vs. a Nominatim geocoder lookup. Plain fields work but require users to look up coordinates externally. Nominatim adds an external HTTP call but removes friction significantly. Decision affects trip builder scope.
- **Day reorder:** Only activities have a reorder endpoint. If destination visit order or day order within a destination needs to be changeable from the UI, two new backend endpoints are required. Worth deciding before the trip builder phase starts.
- **Keycloak realm config for WebAuthn:** The `keycloak/realm-export.json` should be verified to have the WebAuthn passwordless flow configured, or manual Keycloak admin steps documented. This is a setup dependency for passkeys, not code.
