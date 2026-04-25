# Architecture

**Analysis Date:** 2026-04-25

## Pattern Overview

**Overall:** Multi-page SPA (MPA) + REST API — decoupled frontend and backend with OIDC auth bridging them

**Key Characteristics:**
- Frontend is a Vite-built MPA with per-page TypeScript entry points; pages are statically deployed to GitHub Pages
- Backend is a Hono app targeting Cloudflare Workers (prod) / Node.js dev server (local), deployed as a serverless edge function
- Authentication is delegated entirely to Keycloak; both sides implement the OIDC contract independently (frontend uses keycloak-js, backend verifies RS256 JWTs manually)
- The frontend maintains a legacy `CityData` domain model for map rendering; a `tripAdapter` layer converts API responses into that model

## Layers

**Frontend — Pages Layer:**
- Purpose: Per-page initialization and orchestration; renders UI and wires up components, fetches data from API
- Location: `frontend/src/pages/`
- Contains: `dashboard.ts`, `tripDetail.ts`, `profile.ts` — each is an autonomous module bootstrapped by DOMContentLoaded
- Depends on: `api/client.ts`, `auth/keycloak.ts`, `modules/`, `components/`
- Used by: Vite rollup `input` entries in `frontend/vite.config.ts`

**Frontend — Components Layer:**
- Purpose: Reusable custom elements (Web Components) with encapsulated Shadow DOM
- Location: `frontend/src/components/`
- Contains: `Navbar.ts` (`<travel-nav>`), `SearchBar.ts` (`<search-bar>`), `AuthGuard.ts` (`<auth-guard>`)
- Depends on: `modules/theme.ts`, `auth/keycloak.ts`, `modules/search.ts`
- Used by: Every HTML page via `<travel-nav>` and `<search-bar>` tags; page scripts import components to register them

**Frontend — Modules Layer:**
- Purpose: Feature modules — stateless utility and initialization functions
- Location: `frontend/src/modules/`
- Contains: `map.ts`, `search.ts`, `theme.ts`, `countdown.ts`, `widgets.ts`, `tripAdapter.ts`, `utils.ts`
- Depends on: `data/itinerary.ts`, `types/`
- Used by: Pages and components

**Frontend — API Client Layer:**
- Purpose: Typed HTTP client wrapping all backend endpoints; attaches Keycloak Bearer tokens automatically
- Location: `frontend/src/api/client.ts`
- Contains: Functions mirroring every REST route: `getMyTrips`, `createTrip`, `createDestination`, `createActivity`, `getPublicTrip`, `getMe`, etc.
- Depends on: `auth/keycloak.ts` (calls `getToken()` before every authenticated request)
- Used by: `pages/dashboard.ts`, `pages/tripDetail.ts`, `pages/profile.ts`, `modules/search.ts`

**Frontend — Auth Layer:**
- Purpose: Keycloak OIDC adapter; session management and token lifecycle
- Location: `frontend/src/auth/`
- Contains: `keycloak.ts` (singleton adapter, PKCE + silent SSO), `AuthGuard.ts` (Web Component wrapper)
- Depends on: `keycloak-js` npm package, `VITE_KEYCLOAK_*` env vars
- Used by: `api/client.ts`, `components/Navbar.ts`, `pages/dashboard.ts`, `pages/tripDetail.ts`, `pages/profile.ts`

**Frontend — Data Layer:**
- Purpose: Static hardcoded itinerary data and Google Maps URL lookup table for legacy city pages
- Location: `frontend/src/data/`
- Contains: `itinerary.ts` (static `ITINERARY` record with all Japan 2026 trips), `maps.ts`
- Depends on: nothing
- Used by: `modules/search.ts` (index building), `main.ts` (legacy city pages)

**Backend — Routes Layer:**
- Purpose: HTTP route handlers; validation, auth enforcement, response shaping
- Location: `backend/src/routes/`
- Contains: `index.ts` (aggregator), `trips.ts` (full CRUD for trips/destinations/days/activities/hotels), `users.ts`, `health.ts`, `public.ts` (unauthenticated trip read)
- Depends on: middleware, db queries, validation schemas, types
- Used by: `backend/src/index.ts` via `app.route('/api', routes)`

**Backend — Middleware Layer:**
- Purpose: Cross-cutting concerns applied per-route
- Location: `backend/src/middleware/`
- Contains: `auth.ts` (`authMiddleware` — JWT verification, sets `c.var.user`), `user.ts` (`ensureUserProvisioned` — DB lookup/auto-create, sets `c.var.dbUserId`), `cors.ts`
- Depends on: `auth/keycloak.ts` (JWT verify), `db/` (user queries)
- Used by: `routes/trips.ts`, `routes/users.ts` (applied with `tripsRoute.use('*', authMiddleware, ensureUserProvisioned)`)

**Backend — Auth Layer:**
- Purpose: JWKS fetching, caching, and RS256 JWT verification using Web Crypto API (no Node.js deps)
- Location: `backend/src/auth/keycloak.ts`
- Contains: `verifyJwt`, `getKeycloakJwks` (1-hour cache), `extractUserInfo`
- Depends on: Web Crypto API, `KEYCLOAK_URL`/`KEYCLOAK_REALM` env bindings
- Used by: `middleware/auth.ts`

**Backend — DB Layer:**
- Purpose: Drizzle ORM schema, dual-driver factory (Neon HTTP in prod, node-postgres locally), and query helpers
- Location: `backend/src/db/`
- Contains: `schema.ts` (tables: users, trips, destinations, hotels, days, activities), `index.ts` (factory + re-exports), `queries/` (per-entity query files), `migrations/`
- Depends on: `drizzle-orm`, `@neondatabase/serverless`, `pg`
- Used by: All route handlers via `getDb(c.env.DATABASE_URL)`

**Backend — Validation Layer:**
- Purpose: Zod schemas for request body validation; used with `@hono/zod-validator`
- Location: `backend/src/validation/schemas.ts`
- Contains: `CreateTripSchema`, `UpdateTripSchema`, `CreateDestinationSchema`, etc.
- Depends on: `zod`
- Used by: `routes/trips.ts` via `zValidator('json', Schema)`

## Data Flow

**Authenticated Trip Load (dashboard.ts):**

1. `dashboard.ts` calls `initKeycloak()` — silent SSO check, no redirect
2. If authenticated: calls `getMyTrips()` via `api/client.ts`
3. `client.ts` calls `getToken()` from `auth/keycloak.ts` to get a fresh Bearer token
4. Fetch goes to `VITE_API_URL/trips` with `Authorization: Bearer <token>`
5. `authMiddleware` on backend verifies the JWT via JWKS (cached)
6. `ensureUserProvisioned` looks up or creates the DB user by `keycloak_id`
7. Route handler calls `getTripsByUser(db, userId)` and returns `ApiResponse<Trip[]>`
8. Frontend renders trip cards

**Public Trip Load (tripDetail.ts):**

1. `tripDetail.ts` reads `?tripId=` from URL
2. Attempts authenticated fetch first; falls back to `getPublicTrip(tripId)` if unauthenticated
3. `getPublicTrip` calls `GET /api/public/trips/:id` — no auth middleware
4. Response is a full nested `ApiTrip` (trip → destinations → hotel, days → activities)
5. `apiTripToCityData(trip)` converts the response to `CityData[]` via `modules/tripAdapter.ts`
6. `initMap(data)` from the page's self-contained map logic renders the Leaflet map with day markers

**Auth Initialization:**

1. Page loads, calls `initKeycloak()` — creates singleton `Keycloak` instance once
2. Adapter does `check-sso` via `silent-check-sso.html` (no full redirect on first load)
3. Subsequent `getToken()` calls refresh the token if it expires within 30 seconds
4. On token expiry: `keycloak.onTokenExpired` fires `refreshToken()` automatically

**State Management:**
- No global state store; each page initializes its own state in module-level variables
- Auth state lives in the `keycloak-js` singleton (`frontend/src/auth/keycloak.ts`)
- Search index is a module-level array in `frontend/src/modules/search.ts`; built on `SearchBar` mount, extended per-trip on dashboard load

## Key Abstractions

**TripAdapter (`frontend/src/modules/tripAdapter.ts`):**
- Purpose: Bridges the new API response model (`ApiTrip`/`ApiDestination`/`ApiDay`/`ApiActivity`) with the legacy `CityData` domain model expected by the Leaflet map modules
- Functions: `apiTripToCityData`, `apiTripToItinerary`, `apiDestinationToCityData`, `apiDayToDay`, `apiActivityToActivity`
- Pattern: Pure conversion functions — no side effects, no API calls

**ApiResponse envelope (`backend/src/types/index.ts`):**
- Purpose: Consistent `{ success: boolean, data?: T, error?: string, message?: string }` shape for all responses
- Used by: Every route handler wraps its return in `ApiResponse<T>`
- Frontend: `client.ts` unwraps the envelope, throws on `success: false`

**Dual-driver DB factory (`backend/src/db/index.ts`):**
- Purpose: Selects between Neon HTTP (`@neondatabase/serverless`) for production and node-postgres (`pg`) for local Docker dev, based on the DATABASE_URL
- Pattern: `getDb(databaseUrl)` — inspects URL for `localhost`/`127.0.0.1`, returns a Drizzle instance

**Web Component custom elements:**
- `<travel-nav>` (`frontend/src/components/Navbar.ts`): sticky navigation with auth state, dynamic trip destinations injected via `setDestinations()` public method
- `<search-bar>` (`frontend/src/components/SearchBar.ts`): global fuzzy search over the in-memory index
- `<auth-guard>` (`frontend/src/auth/AuthGuard.ts`): wraps protected content, shows spinner while checking auth, redirects to Keycloak if unauthenticated

**Ownership chain helpers (`backend/src/routes/trips.ts`):**
- `resolveDestination(db, tripId, destId, userId)` — verifies trip ownership then destination membership; returns typed `{ dest }` or `{ error: 'not_found' | 'forbidden' }`
- `resolveDay` and `resolveActivity` compose on top, walking the ownership tree
- Pattern: prevents broken-object-level-authorization bugs at each nesting level

## Entry Points

**Frontend — Landing page:**
- Location: `frontend/src/main.ts`
- Triggers: `DOMContentLoaded` on `frontend/index.html`
- Responsibilities: init theme, countdown, map (legacy static pages), PWA service worker registration

**Frontend — Dashboard:**
- Location: `frontend/src/pages/dashboard.ts`
- Triggers: `DOMContentLoaded` on `frontend/dashboard.html`
- Responsibilities: Keycloak silent SSO, load user trips from API, render trip grid, handle create-trip form

**Frontend — Trip Detail:**
- Location: `frontend/src/pages/tripDetail.ts`
- Triggers: `DOMContentLoaded` on `frontend/trip.html`
- Responsibilities: load trip (auth or public), render destination tabs, initialize Leaflet map with activities, update navbar destinations

**Frontend — Profile:**
- Location: `frontend/src/pages/profile.ts`
- Triggers: `DOMContentLoaded` on `frontend/profile.html`
- Responsibilities: load user profile, display passkey management via Keycloak Account REST API

**Backend — Hono app:**
- Location: `backend/src/index.ts`
- Triggers: Cloudflare Workers `fetch` handler (`export default app`) in prod; `@hono/node-server` in dev via `backend/src/dev.ts`
- Responsibilities: global CORS middleware, mount `routes` at `/api`, 404/error handlers

## Error Handling

**Strategy:** Structured error responses with HTTP status codes; no global try/catch — each route handler catches its own exceptions

**Patterns:**
- All routes return `ApiResponse<T>` — `{ success: false, error: 'message' }` on error with appropriate HTTP status
- Auth errors → 401 from `authMiddleware` before route handler runs
- Ownership verification failures → 403/404 from `resolveDestination`/`resolveDay`/`resolveActivity` helpers
- Frontend `api/client.ts` throws `Error` for non-2xx responses and for `success: false` envelopes; pages catch with try/catch and render error UI

## Cross-Cutting Concerns

**Logging:** `console.error` in error paths; backend logs unhandled errors in `app.onError`; frontend logs in dev mode only (`import.meta.env.DEV`)

**Validation:** Zod schemas in `backend/src/validation/schemas.ts` applied at route boundaries via `@hono/zod-validator`; invalid input returns 400 before route handler runs

**Authentication:** Two-phase on protected routes: (1) `authMiddleware` verifies JWT signature/claims, (2) `ensureUserProvisioned` maps Keycloak sub to DB user id; both must pass

---

*Architecture analysis: 2026-04-25*
