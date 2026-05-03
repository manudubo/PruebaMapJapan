# Domain Pitfalls

**Domain:** Vanilla TS / Hono / Keycloak 25 — adding trip builder UI, passkeys, public sharing, security hardening
**Researched:** 2026-04-26
**Stack:** Vanilla TypeScript (no framework), Hono on Cloudflare Workers, Neon PostgreSQL, Keycloak 25, keycloak-js 25.0, Leaflet, Vite MPA, GitHub Pages

---

## 1. Vanilla TypeScript CRUD UI — Form & State Pitfalls

### 1.1 Nested-Entity Creation Ordering (CRITICAL)

**What goes wrong:** The hierarchy is trip → destination → hotel → day → activity. Every level requires the server-assigned ID of the parent before the child can be created. Users click "save" expecting a complete trip to be created in one shot; instead, the UI fires serial API calls. If any call fails mid-chain (e.g., destination created, hotel PUT fails), the trip is in a partially-created state with no rollback mechanism.

**Warning sign:** Code like `const dest = await createDestination(...); const day = await createDay(destId, ...); await createActivity(dayId, ...)` in a single submit handler with no error recovery — a partial success leaves orphaned rows the user can't see and can't delete from the UI.

**Prevention:**
- Treat the trip builder as a multi-step form: create the trip and destination first (persist to get IDs), then add hotel/days/activities as separate interactions against already-persisted parents.
- If offering a "create all at once" UX, make each step visually discrete so on failure the user knows exactly what was saved and what wasn't.
- Never silently swallow errors mid-chain. Surface which step failed so the user can retry that step only.
- Do not try to build client-side rollback (deleting previously created rows on failure) — the backend API does not expose a batch-delete and the cascade is complex. Partial state is survivable; silent corruption is not.

**Phase:** Trip Builder UI

---

### 1.2 Double-Submit and Button State Drift

**What goes wrong:** Without a reactive framework, disabling a button on submit requires explicit bookkeeping. Existing code does this correctly in `dashboard.ts:handleCreateTrip` (`submitBtn.disabled = true` in the try block, reset in `finally`). The trip builder will have many more forms (add destination, add day, add activity, edit hotel) — replicating this pattern manually across all of them leads to inconsistency. One missed `finally` causes the button to stay disabled after an error, leaving the user with a form that appears frozen.

**Warning sign:** Any `catch` handler that sets an error message but doesn't re-enable the submit button. Any submit handler without a `finally` block.

**Prevention:** Extract a single `withSubmitLock(button, asyncFn)` utility that wraps the button disable/enable lifecycle. All form handlers call it instead of managing state individually.

**Phase:** Trip Builder UI

---

### 1.3 In-Place Edit Re-render Destroys Sibling Unsaved State

**What goes wrong:** In a framework-less MPA, every time you re-render a section (e.g., after saving an activity) you wipe and re-create the DOM. Any unsaved changes in an open edit form for a sibling entity get destroyed silently.

**Warning sign:** A `renderDestinations()` call inside the success handler of `saveActivity()` — unrelated but co-located state gets nuked.

**Prevention:** Re-render only the minimal subtree that actually changed. Keyed renders: identify DOM nodes by entity ID, update only the node whose data changed rather than rebuilding the whole list. For a vanilla TS MPA this means `document.getElementById('dest-' + id)` surgical updates rather than `container.innerHTML = buildAllDestinations(...)`.

**Phase:** Trip Builder UI

---

### 1.4 Coordinate Validation Timing

**What goes wrong:** Activity and destination entities require latitude/longitude. Users will type or paste coordinates. The API accepts numeric fields but the form collects strings. A silently-coerced `NaN` lat/lng creates a marker at `[NaN, NaN]`, which Leaflet silently ignores but the entity exists in the DB with null coordinates. The user sees no pin and no error.

**Warning sign:** `parseFloat(formData.get('lat'))` with no range check, or a backend schema that allows null coordinates on entities expected to appear on the map.

**Prevention:** Validate range (`lat` in [-90, 90], `lng` in [-180, 180]) client-side before enabling submit. Add a map preview of the pin inside the form so the user sees immediately whether the entered coordinates resolve to a visible location.

**Phase:** Trip Builder UI

---

## 2. DOMPurify for XSS Prevention

### 2.1 Inline Style URL Injection Is a Separate Attack Surface

**What goes wrong:** `dashboard.ts:38` builds an inline `style=` attribute: `background-image:url('${trip.cover_image_url}')`. DOMPurify operating on the innerHTML of the card template does not sanitize this — a malicious `cover_image_url` value is delivered directly into a CSS context without passing through DOMPurify at all. Similarly, `tripDetail.ts:303` and `map.ts:236` interpolate `day.color` into `style="background:${day.color}"`.

**Warning sign:** Any `style="${userValue}"` or `style="...:${userValue}"` pattern where the value comes from the API response. These are not caught by `innerHTML`-focused sanitization.

**Prevention:**
- Do not put user-controlled strings into inline `style` attributes. Instead set `.style.backgroundImage` via JS after validating the URL is strictly `https://`, or use `element.style.setProperty('background-image', 'url(${sanitizedUrl})')`.
- For color values (e.g., `day.color`): validate the value matches `/^#[0-9a-fA-F]{3,8}$/` before any interpolation. Low risk today with hardcoded data, real vector once users can pick custom destination colors.
- Run DOMPurify on the full assembled innerHTML template string, not on individual field values in isolation, so nothing slips through template composition.

**Phase:** Security Hardening

---

### 2.2 Leaflet Popup Content Bypasses DOMPurify

**What goes wrong:** `tripDetail.ts:188` calls `marker.bindPopup(buildPopup(activity, day, mapsUrl))`. Leaflet's `bindPopup` calls `innerHTML` internally on the string. `buildPopup` (`tripDetail.ts:108-126`) and `buildHotelPopup` (`tripDetail.ts:128-144`) concatenate `activity.name`, `activity.notes`, `day.label`, and `hotel.name` directly into the HTML string without sanitizing. If the focus of the XSS pass is on "convert `innerHTML` to `textContent`", this popup path is easy to miss because it looks like a Leaflet API call rather than a direct `innerHTML` call.

**Warning sign:** `marker.bindPopup(buildPopup(...))` where `buildPopup` concatenates user strings without sanitizing.

**Prevention:** Apply `DOMPurify.sanitize()` inside `buildPopup` and `buildHotelPopup` on the fully-assembled HTML string before returning it. Use a narrow allowlist:
```
DOMPurify.sanitize(html, {
  ALLOWED_TAGS: ['div','h4','p','a','span','svg','path','circle'],
  ALLOWED_ATTR: ['href','target','rel','class','viewBox','fill','stroke',
                 'stroke-width','width','height','d','cx','cy','r']
})
```
This keeps the popup links and SVG icons working while blocking injection.

**Phase:** Security Hardening

---

### 2.3 DOMPurify Requires a DOM — Cannot Be Imported in Workers Context

**What goes wrong:** DOMPurify requires a `window`/DOM environment. Any shared utility module that runs in both the Worker and the browser context cannot import DOMPurify at the top level. During Playwright E2E test runs (Node environment), a top-level DOMPurify import in a module loaded by the test runner will throw `ReferenceError: window is not defined`.

**Warning sign:** DOMPurify imported in a module that is also reachable from `backend/src` or from a Playwright Node helper.

**Prevention:** Import DOMPurify only inside frontend-only page modules (`dashboard.ts`, `tripDetail.ts`, etc.) and their direct helpers. Use dynamic `await import('dompurify')` if the call site may execute in multiple environments.

**Phase:** Security Hardening

---

### 2.4 Missed innerHTML Interpolation Sites — Full Inventory

**What goes wrong:** Migrating from raw `innerHTML` to `textContent`/DOMPurify is mechanical but incomplete without a full audit. Known interpolation sites in this codebase (user-derived values in bold):

- `dashboard.ts:47` — `**trip.name**` in template literal → innerHTML
- `dashboard.ts:48` — `**trip.description**` → innerHTML
- `dashboard.ts:194` — `**(err as Error).message**` → innerHTML (error messages can contain user-derived content if the API error echoes input)
- `tripDetail.ts:50` — destination name in tab labels → innerHTML
- `tripDetail.ts:110` — `**activity.name**`, `**activity.notes**`, `**day.label**` in `buildPopup` → Leaflet innerHTML
- `tripDetail.ts:129` — `**hotel.name**` in `buildHotelPopup` → Leaflet innerHTML
- `tripDetail.ts:344-350` — `**activity.name**`, `**noteText**`, `**markerColor**` → innerHTML
- `tripDetail.ts:373` — `**hotel.name**` → innerHTML
- `map.ts:236` — `**day.label**`, `**day.color**` → innerHTML
- `map.ts:260` — `**activity.name**`, `**noteText**` → innerHTML
- `map.ts:273` — `**hotel.name**` → innerHTML
- `profile.ts:84` — `**c.userLabel**` from Keycloak credential → innerHTML

**Warning sign:** A grep for `innerHTML` after the security pass that still shows user-derived strings.

**Prevention:** For single-field text elements (title, greeting, count): replace `innerHTML` with `textContent`. For template-assembled HTML (cards, popup bodies): sanitize the full assembled string with DOMPurify before assignment.

**Phase:** Security Hardening

---

## 3. CORS on Cloudflare Workers with Hono

### 3.1 credentials: true Is Unnecessary and Locks Out Wildcard Origins

**What goes wrong:** `backend/src/middleware/cors.ts` sets `credentials: true`. The frontend API client (`client.ts`) sends auth via `Authorization: Bearer <token>` headers and never sets `credentials: 'include'` on any `fetch()` call. Cookies are not involved. `credentials: true` in the CORS response has no effect on Bearer-token auth, but the HTTP spec forbids `Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true`. Any request from an origin not in the explicit allowlist — including the public trip endpoint loaded from an arbitrary domain — will receive a CORS error.

**Warning sign:** `credentials: true` in the Hono CORS config while the frontend client has no `credentials: 'include'` in fetch calls.

**Prevention:** Remove `credentials: true` from the CORS middleware. The allow-list origin callback is already present and correct for authenticated endpoints. The public endpoint (`/api/public/*`) can then safely return `*` for its origin.

**Phase:** Security Hardening

---

### 3.2 Preflight OPTIONS Handling Differs Between Wrangler Local Dev and Production

**What goes wrong:** `corsMiddleware` is registered as `app.use('*', corsMiddleware)` which is correct for production. However, Wrangler local dev (`wrangler dev`) uses miniflare, which may inject its own CORS response headers before Hono's handler runs. This can cause double `Access-Control-Allow-Origin` headers or missing `Access-Control-Allow-Methods` on preflight responses. The symptom: CORS works in production (Workers runtime) but preflight fails locally, or vice versa.

**Warning sign:** A preflight OPTIONS returning 405 in local dev, or duplicate CORS headers visible in browser DevTools.

**Prevention:** Test preflight behaviour explicitly in both environments. Confirm that Hono's `cors()` middleware is returning 204 on OPTIONS before the route match. If Wrangler injects headers, check `compatibility_date` in `wrangler.toml` — use a current date to get stable behaviour.

**Phase:** Security Hardening

---

### 3.3 Public Trip Endpoint Needs CORS Open to All Origins

**What goes wrong:** `GET /api/public/trips/:tripId` is unauthenticated and should load from any origin (the point of a shareable link). The current allow-list (`manud.github.io`, `localhost:3000`, `localhost:5173`) will reject requests from any other domain. With `credentials: true` still active (before pitfall 3.1 is fixed), this cannot be opened to `*`.

**Prevention:** After removing `credentials: true` (3.1), the public route group can have its own CORS middleware that returns `origin: '*'`. Easiest implementation: mount a separate `publicCors` middleware on the `/api/public/*` path group that does not restrict origin.

**Phase:** Public Trip Sharing + Security Hardening

---

## 4. Keycloak 25 WebAuthn / Passkeys

### 4.1 webAuthnPolicyPasswordlessRpId Left Blank (CRITICAL)

**What goes wrong:** `keycloak/realm-export.json:43` has `"webAuthnPolicyPasswordlessRpId": ""`. An empty RP ID defaults to the hostname of the Keycloak server at registration time. In production, Keycloak runs on Railway (`*.railway.app` or a custom domain); the frontend runs on `manud.github.io`. The RP ID used at registration must exactly match the effective domain used at authentication. If they differ, the browser rejects the assertion with `NotAllowedError` and passkey login silently fails.

**Warning sign:** Passkey registration succeeds locally but passkey login fails in production with `NotAllowedError` even though the credential appears to exist.

**Prevention:** Set `webAuthnPolicyPasswordlessRpId` to the effective domain of the frontend (`manud.github.io`) before any user registers a passkey. This value must be set before the first registration — it cannot be changed afterwards for existing credentials. If the domain ever changes (custom domain), all existing passkeys become invalid.

**Phase:** Passkeys

---

### 4.2 JWT Audience Validator Still Accepts 'account' (CRITICAL)

**What goes wrong:** `backend/src/auth/keycloak.ts:193` has `validAudiences = ['japan-trip-api', 'japan-trip-frontend', 'account']`. The `account` audience appears in tokens issued for Keycloak's own Account Console UI. Accepting it in the backend API means any token a user obtains for the Account Console is also valid for the trip API. This is the "JWT audience too broad" issue from PROJECT.md in concrete form.

**Warning sign:** `'account'` in the `validAudiences` array.

**Prevention:**
1. Add an audience mapper to the `japan-trip-frontend` client in `realm-export.json`: add a protocol mapper of type `oidc-audience-mapper` with `includedClientAudience: japan-trip-frontend`. Tokens issued for the frontend will then contain `japan-trip-frontend` in `aud`.
2. Remove `'account'` from `validAudiences`. Keep only `'japan-trip-frontend'`.
3. The client already has `"fullScopeAllowed": false` which is correct — the audience mapper is the only missing piece.

**Phase:** Security Hardening

---

### 4.3 email Field Typed as Required, Absent in Passkey-Only Auth

**What goes wrong:** `KeycloakJwtPayload` in `backend/src/types/index.ts:40` types `email: string` as required (not optional). When a user authenticates with a passkey and their Keycloak account has no email set, the JWT omits the `email` claim entirely. `extractUserInfo` in `keycloak.ts:254` already handles this gracefully (`payload.email ?? ''`), but any code that destructures `const { email } = payload` will get `undefined` at runtime while TypeScript believes it's a `string`.

**Warning sign:** `email: string` in `KeycloakJwtPayload` (not `string | undefined`). Any `ensureUserProvisioned` logic that writes `email` to a NOT NULL database column.

**Prevention:** Change `email` to `email?: string` in `KeycloakJwtPayload`. Audit the users table schema and the user provisioning middleware — the `email` column must be nullable.

**Phase:** Passkeys

---

### 4.4 Keycloak Account REST API Credential Listing Shape May Be Nested

**What goes wrong:** `profile.ts:57-65` calls `GET /realms/{realm}/account/credentials?type=webauthn` and treats the response as a flat `CredentialInfo[]`, filtering by `c.type === 'webauthn'`. In Keycloak 22+, this v1 Account API endpoint returns `CredentialContainer[]` where each container has a `userCredentialMetadatas` array containing the actual credential entries. If the actual shape is `[{ type: 'webauthn', userCredentialMetadatas: [{id, userLabel, createdDate, ...}] }]`, the current filter passes (the container has `type: 'webauthn'`) but the subsequent mapping reads `c.userLabel` from the container object rather than from the nested metadata — and every passkey shows as "Passkey" with no created date, or the list renders one item per type rather than one item per credential.

**Warning sign:** Passkey list always shows exactly one item labelled "Passkey" regardless of how many authenticators are registered; or list is always empty after successful registration.

**Prevention:** Verify the response shape against the live Keycloak 25 instance. If nested, unwrap: `const creds = res.flatMap((c) => c.userCredentialMetadatas ?? [])` and map over `creds`. Confidence on exact shape: MEDIUM — needs runtime verification.

**Phase:** Passkeys

---

### 4.5 keycloak.login action:'webauthn-register' Requires a Live Session

**What goes wrong:** `profile.ts:104` calls `keycloak.login({ action: 'webauthn-register', redirectUri: window.location.href })`. If the user's Keycloak session has expired between page load and clicking "Add passkey" (access token lifespan is 300 seconds per realm-export), the `action` parameter is ignored and the user is redirected to a full login page. They see re-authentication, not a passkey registration screen.

**Warning sign:** "Add passkey" button works immediately after login but silently redirects to login if the page is left open for more than 5 minutes.

**Prevention:** Call `await keycloak.updateToken(60)` immediately before the `keycloak.login({ action: ... })` call. If `updateToken` throws (session fully expired), show a "Please log in again to add a passkey" prompt rather than letting the action redirect silently.

**Phase:** Passkeys

---

### 4.6 Platform-Only Authenticator Attachment Blocks Hardware Keys (Intentional Policy)

**What goes wrong:** `realm-export.json:44` sets `"webAuthnPolicyPasswordlessAuthenticatorAttachment": "platform"`. This restricts passkey registration to on-device authenticators (Face ID, Windows Hello, Touch ID). Hardware security keys (YubiKey, etc.) will be rejected by the browser.

**Warning sign:** Hardware security key registration silently fails or the browser shows no authenticator selection.

**Prevention:** This is a deliberate policy choice, not a bug. Keep `"platform"` if platform-only passkeys are the intent (simpler UX, stronger binding to user's device). Change to `"not specified"` if roaming authenticators should also be supported. Document the decision explicitly so it is not accidentally changed.

**Phase:** Passkeys (decision point, not a defect)

---

## 5. Public Trip Sharing

### 5.1 Sequential Integer IDs Are Enumerable in Shareable URLs

**What goes wrong:** `GET /api/public/trips/:tripId` uses the sequential integer PK as the shareable identifier. Any user who knows trip #42 is public can enumerate trips #1–#41 to find all other public trips. Any trip accidentally toggled to `is_public = true` is immediately discoverable by walking the integer range.

**Warning sign:** The share URL contains a small integer (e.g., `/trip.html?tripId=42`).

**Prevention:** Add a `public_slug` column (`text unique not null default gen_random_uuid()`) to the trips table. The public share URL uses the slug; the integer PK is used only in authenticated API calls. The public endpoint pattern becomes `GET /api/public/trips/:slug` with `where eq(trips.public_slug, slug)`. UUIDv4 is sufficient — cryptographic randomness not required.

**Phase:** Public Trip Sharing

---

### 5.2 is_public Toggle Does Not Invalidate Edge Cache

**What goes wrong:** If Cloudflare caches the public trip GET response (via default caching of successful GET requests or an explicit `Cache-Control` header), toggling `is_public = false` on a trip does not purge the cached response. The trip continues to be served to anyone with the link until the TTL expires.

**Warning sign:** Setting a trip to private does not stop it from loading via the share link for minutes or hours.

**Prevention:** Do not add `Cache-Control: public` headers to the public trip endpoint. Default to `no-store` or set `Cache-Control: private, no-store`. If performance caching is needed, use the Cloudflare Cache API with an explicit cache purge when `is_public` is set to false in the PATCH handler.

**Phase:** Public Trip Sharing

---

### 5.3 Same Page Used for Owner-Edit and Public-View Creates Broken UI State

**What goes wrong:** The trip detail page (`trip.html?tripId=N`) currently shows edit controls for the trip owner. If the public shareable link uses the same page and same URL parameter, a logged-in user who opens someone else's public trip URL will see broken edit controls. The backend will 403 on any mutation (ownership is enforced), but the client-side code will render edit buttons and potentially throw errors when it tries to set up the edit UI for a trip it doesn't own.

**Warning sign:** The same entry point handles both owner-edit and public-view, with the distinction made after rendering.

**Prevention:** Gate at the top of the page initialisation: if the user is not authenticated, call `getPublicTrip()` and render in strict read-only mode with no edit UI. If authenticated, call `getTrip()` and check whether the returned trip belongs to the current user before rendering edit controls. This is a single `if` branch at init time, not conditional rendering scattered through activity/hotel renderers.

**Phase:** Public Trip Sharing + Trip Builder UI

---

## 6. DB Connection Pool — Local Dev Stability

### 6.1 New pg.Pool Per Request Under Playwright Load

**What goes wrong:** `backend/src/db/index.ts:22-23` calls `new Pool({ connectionString })` inside `createDb(databaseUrl)`, which is called per-request in every route handler. In local dev (when the URL contains `localhost`), this creates a new connection pool on every incoming request. Under Playwright E2E tests that run many requests in parallel, this exhausts the local Postgres connection limit (Docker Compose default: 100).

**Warning sign:** Local Playwright E2E tests failing with `ECONNREFUSED` or Postgres `FATAL: sorry, too many clients already`.

**Prevention:** Memoize the pool per connection string:
```typescript
const pools = new Map<string, pg.Pool>();
if (!pools.has(url)) pools.set(url, new Pool({ connectionString: url }));
return drizzlePg(pools.get(url)!, { schema });
```
In production the `isLocal` branch is never taken (Neon uses HTTP), so this is a dev-only fix with no production impact.

**Phase:** Trip Builder UI (prerequisite for stable E2E tests during development)

---

## 7. Wrangler / Workers Config

### 7.1 Stale D1 Binding Blocks wrangler dev Startup

**What goes wrong:** PROJECT.md notes a stale `[[d1_databases]]` binding in `wrangler.toml` from early scaffolding. Wrangler will attempt to initialise this binding at startup. If the binding references a D1 database that does not exist in the Cloudflare dashboard, `wrangler dev` fails immediately.

**Warning sign:** `wrangler dev` fails with a binding resolution error on startup, even though the application code never references D1.

**Prevention:** Remove the `[[d1_databases]]` stanza from `wrangler.toml`. The backend uses Neon HTTP via the `DATABASE_URL` secret binding exclusively.

**Phase:** Security Hardening (prerequisite for any backend deploy)

---

## Phase-Specific Warning Index

| Phase | Pitfall | Severity |
|-------|---------|----------|
| Trip Builder UI | 1.1 Serial nested-entity creation with no rollback | HIGH |
| Trip Builder UI | 1.2 Double-submit / missing finally in form handlers | MEDIUM |
| Trip Builder UI | 1.3 Full-list re-render destroys open sibling edit forms | MEDIUM |
| Trip Builder UI | 1.4 NaN coordinates silently accepted | MEDIUM |
| Trip Builder UI | 6.1 New Pool per request under Playwright load | MEDIUM |
| Security Hardening | 2.1 Inline style URL injection (separate from innerHTML XSS) | HIGH |
| Security Hardening | 2.2 Leaflet popup bypasses DOMPurify | HIGH |
| Security Hardening | 2.3 DOMPurify import requires DOM environment | LOW |
| Security Hardening | 2.4 Missed innerHTML interpolation sites (full inventory above) | HIGH |
| Security Hardening | 3.1 credentials: true unnecessary, prevents * origin fallback | HIGH |
| Security Hardening | 3.2 OPTIONS preflight behaviour differs in Wrangler local dev | MEDIUM |
| Security Hardening | 4.2 'account' audience accepted in JWT validator | HIGH |
| Security Hardening | 7.1 Stale D1 binding blocks wrangler dev startup | HIGH |
| Passkeys | 4.1 Empty RP ID breaks cross-origin passkey assertion in production | CRITICAL |
| Passkeys | 4.3 email typed as required, absent in passkey-only auth tokens | MEDIUM |
| Passkeys | 4.4 Credential listing assumes flat array, may be nested CredentialContainer | MEDIUM |
| Passkeys | 4.5 Expired session redirects to login instead of webauthn-register | LOW |
| Passkeys | 4.6 Platform-only attachment blocks hardware keys (intentional policy) | LOW |
| Public Trip Sharing | 5.1 Sequential integer IDs enumerable in shareable URLs | HIGH |
| Public Trip Sharing | 5.2 is_public toggle does not invalidate edge cache | MEDIUM |
| Public Trip Sharing | 5.3 Same page used for owner-edit and public-view | MEDIUM |
| Public Trip Sharing | 3.3 Public endpoint needs CORS open to all origins | MEDIUM |
