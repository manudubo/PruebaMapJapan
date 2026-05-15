# Architecture Patterns — v1.0 Integration

**Domain:** Feature integration into existing Vite MPA + Hono Workers + Keycloak stack
**Researched:** 2026-04-26
**Overall confidence:** HIGH (all claims grounded in actual source files)

---

## 1. Trip Edit Page

### New files

| File | Purpose |
|------|---------|
| `frontend/trip-edit.html` | HTML shell — mirrors `trip.html` structure: `<travel-nav>`, `<search-bar>`, main content area |
| `frontend/src/pages/tripEdit.ts` | Page controller — loads trip, renders edit forms, wires save actions |

### Modified files

| File | Change |
|------|--------|
| `frontend/vite.config.ts` | Add `tripEdit: resolve(__dirname, 'trip-edit.html')` to `rollupOptions.input` |

### Trip ID: URL param pattern

Follow `tripDetail.ts` exactly:

```typescript
const params = new URLSearchParams(window.location.search);
const tripId = params.get('tripId');
if (!tripId) { showError('...'); return; }
```

This is consistent across all dynamic pages. No router, no hash routing — query string is the MPA convention already established.

### Auth requirement

Unlike `tripDetail.ts`, `tripEdit.ts` must always require authentication. On `!authenticated`, redirect immediately rather than attempting guest read:

```typescript
authenticated = await initKeycloak();
if (!authenticated) {
  window.location.replace(`index.html?next=${encodeURIComponent(window.location.href)}`);
  return;
}
```

`ensureUserProvisioned` on the backend means edit API calls will 401 for unauthenticated requests anyway, but rejecting client-side avoids a flicker.

### Form structure — per-section explicit save

The existing `dashboard.ts:handleCreateTrip` (FormData → Object.fromEntries → API call) is the correct pattern. Scale it to per-section forms:

- **Trip metadata form**: name, description, start/end date, is_public toggle → `PATCH /api/trips/:id` via `updateTrip()`
- **Destination forms** (one per destination): city_name, country, dates, lat/lng, zoom_level → `PATCH /api/trips/:id/destinations/:destId` via `updateDestination()`
- **Hotel form** (per destination): name, url, lat/lng, check-in/out → `PUT /api/trips/:id/destinations/:destId/hotel` via `upsertHotel()` (note: upsert, not patch)
- **Day forms** (per day): label, date, color_hex → `PATCH .../days/:dayId` via `updateDay()`
- **Activity forms** (per activity): name, lat/lng, notes, time → `PATCH .../activities/:actId` via `updateActivity()`

**No auto-save.** Auto-save requires diff tracking and dirty state management — unnecessary complexity for this app. Each form section gets a "Guardar" button. Disable during submission, show inline success/error text. This matches the existing `submitBtn.disabled = true` pattern in `dashboard.ts:102-120`.

**Add-new flows**: "Add destination" calls `createDestination()`, appends the returned object to the in-memory trip state, re-renders the destination list. Same pattern for add-day, add-activity.

**Delete flows**: Confirm via `window.confirm()` (cheap, sufficient for v1), then call the DELETE endpoint, remove from in-memory state, re-render. No modal needed in v1.

### Linking to the edit page

In `tripDetail.ts`: Add an "Edit trip" button (only visible when `isAuthenticated() && trip.user_id === currentUserId`). Link: `trip-edit.html?tripId=${tripId}`.

In `dashboard.ts:renderTripCard()`: Add an edit icon/link to the card markup.

---

## 2. Security Hardening

### innerHTML audit — actual risk surface

From grepping all `frontend/src/**/*.ts`:

| File | User data interpolated? | Fix |
|------|------------------------|-----|
| `pages/tripDetail.ts:52` | `dest.city_name` in tab button | DOM construction |
| `pages/tripDetail.ts:301` | `day.label`, `day.color` in day group | DOM construction |
| `pages/tripDetail.ts:344` | `activity.name`, `activity.notes` | DOM construction |
| `pages/tripDetail.ts:373` | `hotel.name` | `textContent` |
| `pages/tripDetail.ts:413` | Static error string only | Safe — no change |
| `pages/dashboard.ts:63` | Static empty-state HTML | Safe — no change |
| `pages/dashboard.ts:72` | `trip.name`, `trip.description`, URL params | DOM construction |
| `pages/dashboard.ts:194` | `Error.message` only | Safe — not user data |
| `pages/profile.ts:74` | `c.userLabel` from Keycloak credential | DOM construction |
| `modules/map.ts:236` | `day.label`, `day.color` | DOM construction |
| `modules/map.ts:260` | `activity.name`, `activity.notes` | DOM construction |
| `modules/map.ts:273` | `hotel.name` | `textContent` |
| `modules/widgets.ts:202` | News/event titles from external API | DOM construction |
| `components/SearchBar.ts:492` | Search result item text | DOM construction |
| `components/Navbar.ts:92` | Static template on mount | Safe — Shadow DOM, no user data |
| `components/Navbar.ts:360` | Icon HTML + static label | Safe — controlled strings |
| `components/SearchBar.ts:32` | Static template on mount | Safe |
| `auth/AuthGuard.ts:58,85,94,135` | Static templates | Safe |

**Do not use DOMPurify.** Every risky interpolation is plain text — there is no legitimate rich-text input in this app. DOMPurify adds ~20KB bundle weight and licenses HTML parsing, which is the wrong semantic fit. Use DOM construction helpers instead.

### New file: `frontend/src/modules/dom.ts`

A lightweight typed DOM construction module:

```typescript
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
```

Usage replaces inline templates:

```typescript
// Before
tabsEl.innerHTML = sorted.map(dest => `<button>${dest.city_name}</button>`).join('');

// After
tabsEl.replaceChildren(...sorted.map((dest, i) =>
  el('button', { class: `dest-tab${i === activeIndex ? ' is-active' : ''}` }, [dest.city_name])
));
```

### CORS fix — `backend/src/middleware/cors.ts`

The bug is on line 18: `return origin ?? '*'`. When no `Origin` header is present, it falls back to `'*'`, which is spec-invalid when `credentials: true`. Fix:

```typescript
// Before
return origin ?? '*';

// After — reject unknown/absent origins
origin: (origin) => {
  const allowed = [
    'https://manud.github.io',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  if (origin && allowed.includes(origin)) return origin;
  return null;
},
```

No other changes to the Hono CORS config are needed. `corsMiddleware` is already mounted as `app.use('*', corsMiddleware)` before routes, so OPTIONS preflights are handled correctly.

### JWT audience tightening — `backend/src/auth/keycloak.ts`

Currently the `aud` claim is validated against `account` (the Keycloak management client). Add a dedicated backend audience (`japan-trip-api`) via a Keycloak audience mapper on the `japan-trip-frontend` client, then validate against `japan-trip-api` in `verifyJwt`. Keep `account` as an additional audience (needed by the Account REST API — see Section 4). This is the standard Keycloak multi-audience pattern.

---

## 3. Public Trip Sharing UI

### No new route needed

`tripDetail.ts` already falls back to `getPublicTrip()` for unauthenticated users (lines 447–462). The shareable URL is already `trip.html?tripId=<uuid>`. A public trip URL already works without login.

### Where the toggle lives

**Canonical location: trip-edit page** — `is_public` toggle in the trip metadata form. The `PATCH /api/trips/:id` endpoint already accepts `is_public` (confirmed in `UpdateTripSchema` and `updateTrip()`).

**Secondary: trip detail page** — When the viewer is the authenticated owner, show a "Compartir" button that:
1. Calls `updateTrip(tripId, { is_public: true })` if not yet public
2. Copies `window.location.href` to clipboard via `navigator.clipboard.writeText()`
3. Shows a transient "Enlace copiado" status message inline

This is a one-click share flow that does not require visiting the edit page for the most common action.

**Dashboard card badge**: Already implemented in `dashboard.ts:renderTripCard()` lines 33–35. No change needed.

### Shareable URL format

```
https://manud.github.io/PruebaMapJapan/trip.html?tripId=<uuid>
```

No signed URLs, no `/share/` aliases. The UUID is opaque enough for casual privacy. The backend enforces `is_public` gating in `routes/public.ts`.

---

## 4. Passkeys via Keycloak Account REST API

### Realm configuration status

From `keycloak/realm-export.json`:
- `webAuthnPolicyPasswordlessAuthenticatorAttachment: "platform"` — correct for passkeys
- `webAuthnPolicyPasswordlessRequireResidentKey: "Yes"` — correct for passkeys
- `webAuthnPolicyPasswordlessUserVerificationRequirement: "required"` — correct
- Authentication flow `browser-passkey` exists with `webauthn-authenticator-passwordless` as required step

The realm is correctly configured for passwordless WebAuthn. **The `webAuthnPolicyPasswordlessRpId` is empty** — must be set per environment before passkeys work. Set to `localhost` in `apply-local-settings.sh` for dev, and to `manud.github.io` for production. The RP ID must match the origin of the page performing the WebAuthn ceremony.

### Keycloak Account REST API endpoints (self-service, user Bearer token)

| Operation | Method | Path |
|-----------|--------|------|
| List credentials | GET | `/realms/{realm}/account/credentials?type=webauthn` |
| Delete credential | DELETE | `/realms/{realm}/account/credentials/{id}` |
| Rename credential | PUT | `/realms/{realm}/account/credentials/{id}/label` — body: plain text string |
| Register new passkey | Redirect | `keycloak.login({ action: 'webauthn-register-passwordless', redirectUri: window.location.href })` |

The existing `profile.ts:loadPasskeys` is already calling the GET endpoint correctly.

**Critical bug in `profile.ts:registerPasskey`:** The action string is `'webauthn-register'` which registers a second-factor WebAuthn credential, not a passwordless passkey. For the passwordless flow configured in the realm, the correct action is `'webauthn-register-passwordless'`.

**Confidence on action string:** MEDIUM — confirmed by realm config (flow uses `webauthn-authenticator-passwordless`) but should be verified against a running local Keycloak 25 instance at implementation time.

### Audience requirement

The access token must contain `account` in the `aud` claim for Account REST API calls to succeed. This is why the JWT audience tightening (Section 2) must use a multi-audience approach: add `japan-trip-api` as an additional audience for the backend, while preserving `account` in the token. The `japan-trip-frontend` client needs both audience mappers.

### What `profile.ts` needs

Currently: list credentials (working) + register with wrong action string.

Missing:
- DELETE credential: `DELETE /realms/{realm}/account/credentials/${c.id}` with same Bearer token, reload list on success
- Rename credential: `PUT /realms/{realm}/account/credentials/${c.id}/label` with `Content-Type: text/plain` body
- Fix action string: `'webauthn-register'` → `'webauthn-register-passwordless'`
- XSS fix: passkey list `innerHTML` → DOM construction (part of Phase 1 hardening)

---

## 5. New vs Modified Files — Complete List

### New files

| File | Why new |
|------|---------|
| `frontend/trip-edit.html` | New Vite entry point for edit page |
| `frontend/src/pages/tripEdit.ts` | New page controller |
| `frontend/src/modules/dom.ts` | DOM construction helpers — used by all XSS fixes and new edit page |

### Modified files

| File | Changes |
|------|---------|
| `frontend/vite.config.ts` | Add `tripEdit` entry to rollupOptions.input |
| `frontend/src/pages/tripDetail.ts` | innerHTML → dom helpers (city_name, day label/color, activity name/notes, hotel name); add edit/share buttons for owner |
| `frontend/src/pages/dashboard.ts` | innerHTML → dom helpers (renderTripCard: trip name, description); add edit link to card |
| `frontend/src/pages/profile.ts` | Fix action string; add DELETE + rename for passkeys; innerHTML → dom helpers in passkey list |
| `frontend/src/pages/tripEdit.ts` | (NEW) Full edit page implementation |
| `frontend/src/modules/map.ts` | innerHTML → dom helpers (day group header, legend item, hotel info) |
| `frontend/src/modules/widgets.ts` | innerHTML → dom helpers (news/event list items) |
| `frontend/src/components/SearchBar.ts` | innerHTML → dom helpers for dynamic search result items (static shadow template is safe) |
| `backend/src/middleware/cors.ts` | Drop `?? '*'` fallback (line 18) |
| `backend/src/auth/keycloak.ts` | Add `japan-trip-api` audience validation |
| `keycloak/realm-export.json` | Set `webAuthnPolicyPasswordlessRpId`; verify `webOrigins` includes GitHub Pages URL |

---

## 6. Build Order (Dependency-Aware)

```
Phase 1 — Security hardening (establishes safe primitives before new code is written)
  1a. Create frontend/src/modules/dom.ts helper
  1b. Replace all user-data innerHTML with dom.ts across:
        tripDetail.ts, dashboard.ts, profile.ts, map.ts, widgets.ts, SearchBar.ts
  1c. Fix cors.ts — drop ?? '*' fallback
  1d. Add japan-trip-api audience in keycloak client mapper + tighten backend/src/auth/keycloak.ts
  Rationale: tripEdit.ts uses dom.ts from day one. Fixes before new code prevents compounding debt.

Phase 2 — Trip edit page (depends on dom.ts from Phase 1)
  2a. trip-edit.html + tripEdit.ts scaffolding (URL param, auth guard, trip load)
  2b. Trip metadata form + save (includes is_public toggle — covers Phase 3a)
  2c. Destination forms + add/delete destinations
  2d. Hotel form (upsert)
  2e. Day and activity forms + add/delete
  2f. Update vite.config.ts; add edit links in tripDetail + dashboard
  Rationale: Each sub-step is independently testable. API is fully available for all these calls.

Phase 3 — Public sharing UI (depends on tripEdit for canonical toggle; 2b already adds it)
  3a. is_public toggle already in Phase 2b — no separate step if done in order
  3b. "Compartir" button in tripDetail.ts (owner-only, copy link + toggle public if needed)
  Rationale: Minimal. Only step 3b adds code beyond Phase 2.

Phase 4 — Passkeys (independent track; can run in parallel with Phases 2-3)
  4a. Set webAuthnPolicyPasswordlessRpId in realm-export.json for dev + prod; update apply-local-settings.sh
  4b. Fix registerPasskey action string in profile.ts ('webauthn-register-passwordless')
  4c. Add DELETE passkey to profile.ts
  4d. Add rename passkey to profile.ts
  Note: 4's XSS fix (passkey list innerHTML) is covered by Phase 1b if done together.
```

---

## 7. Cloudflare Workers Constraints

All changes are Workers-compatible:
- `dom.ts` is browser code (frontend only), irrelevant to Workers
- CORS fix uses only `hono/cors` — already the Workers CORS implementation
- JWT audience change is a string comparison in `verifyJwt` — no new dependencies
- No new npm packages introduced anywhere in the backend

---

*Research date: 2026-04-26 | Sources: actual source files read in this session*
