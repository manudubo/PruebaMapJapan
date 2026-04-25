# External Integrations

**Analysis Date:** 2026-04-25

## APIs & External Services

**Maps:**
- Leaflet (open-source, no external API calls) — tile layer URLs are configured per city page
  - SDK: `leaflet` npm package
  - Auth: None required

**Auth:**
- Keycloak 25.0 — OpenID Connect provider with passkey support
  - Frontend SDK: `keycloak-js` 25.0 (`frontend/src/auth/keycloak.ts`)
  - Backend: manual JWKS verification via Web Crypto API (`backend/src/auth/keycloak.ts`)
  - JWKS endpoint polled: `{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs`
  - Token algorithm: RS256
  - PKCE method: S256 (`frontend/src/auth/keycloak.ts` line 43)
  - Valid audiences: `japan-trip-api`, `japan-trip-frontend`, `account`
  - Keycloak realm: `japan-trip` (exported to `keycloak/realm-export.json`)

## Data Storage

**Databases:**
- Neon (serverless PostgreSQL) — production database
  - Connection: `DATABASE_URL` env var (Wrangler secret)
  - Client (production): `@neondatabase/serverless` + `drizzle-orm/neon-http` — HTTP-mode for Workers
  - Client (local dev): `pg` Pool + `drizzle-orm/node-postgres` — TCP connection to Docker Postgres
  - Driver selection logic: `backend/src/db/index.ts` — detects `localhost`/`127.0.0.1` in URL
  - Schema defined at: `backend/src/db/schema.ts`
  - Tables: `users`, `trips`, `destinations`, `hotels`, `days`, `activities`
  - Migrations at: `backend/src/db/migrations/`

**Local dev database:**
- PostgreSQL 16 (Alpine) via Docker Compose — `keycloak/docker-compose.yml`
  - Port: 5432
  - Database: `japan_trip`, User: `postgres`

**File Storage:**
- None — no object storage integration. Cover images are URL references stored as text fields in the database.

**Caching:**
- None (server-side). JWKS keys from Keycloak are cached in-memory for 1 hour within the Workers isolate (`backend/src/auth/keycloak.ts` line 40).

## Authentication & Identity

**Auth Provider:**
- Keycloak 25.0 (self-hosted)
  - Local: Docker at `http://localhost:8080` via `keycloak/docker-compose.yml`
  - Production: Railway via Dockerfile at `keycloak/Dockerfile` + `keycloak/railway.toml`
  - Realm config: `keycloak/realm-export.json`
  - Custom themes: `keycloak/themes/`

**Flow:**
1. Frontend initializes `keycloak-js` with `check-sso` and silent SSO redirect (`frontend/src/auth/keycloak.ts`)
2. User logs in via Keycloak (passkeys supported at the Keycloak level)
3. Frontend stores tokens in `sessionStorage` (keycloak-js v21+ default)
4. Frontend attaches `Authorization: Bearer <token>` to API requests (`frontend/src/api/client.ts`)
5. Backend verifies RS256 JWT signature against Keycloak JWKS (`backend/src/middleware/auth.ts`)
6. `ensureUserProvisioned` middleware auto-creates or fetches the local DB user record (`backend/src/middleware/user.ts`)

**User Provisioning:**
- On first authenticated request, `ensureUserProvisioned` (`backend/src/middleware/user.ts`) upserts a row in the `users` table keyed by `keycloak_id` (the JWT `sub` claim)

## Monitoring & Observability

**Error Tracking:**
- None — no third-party error tracking (Sentry, Datadog, etc.) detected.

**Logs:**
- `console.error` / `console.warn` in backend handlers and middleware; surfaced in Cloudflare Workers dashboard logs or local terminal.

## CI/CD & Deployment

**Hosting:**
- Frontend: GitHub Pages — built by `deploy-frontend.yml`, deployed to `github-pages` environment
- Backend: Cloudflare Workers — deployed by `deploy-backend.yml` via `npx wrangler deploy`
- Keycloak: Railway — Docker-based, config via `keycloak/railway.toml`

**CI Pipeline:**
- GitHub Actions — three workflows:
  - `.github/workflows/ci.yml` — TypeScript type-check (frontend + backend), frontend unit tests, E2E (Playwright, Chromium only in CI)
  - `.github/workflows/deploy-frontend.yml` — triggered on `main` changes to `frontend/`; builds with Vite + deploys to GitHub Pages
  - `.github/workflows/deploy-backend.yml` — triggered on `main` changes to `backend/`; deploys via Wrangler

**Secrets required for CI/CD:**
- `CLOUDFLARE_API_TOKEN` — Wrangler deploy auth
- `CLOUDFLARE_ACCOUNT_ID` — Wrangler deploy target
- `VITE_API_URL` — injected into frontend build
- `VITE_KEYCLOAK_URL` — injected into frontend build
- `VITE_KEYCLOAK_REALM` — injected into frontend build
- `VITE_KEYCLOAK_CLIENT_ID` — injected into frontend build

## Environment Configuration

**Required env vars (backend):**
- `DATABASE_URL` — PostgreSQL connection string
- `KEYCLOAK_URL` — Keycloak server base URL
- `KEYCLOAK_REALM` — Keycloak realm name

**Required env vars (frontend, Vite build-time):**
- `VITE_API_URL`
- `VITE_KEYCLOAK_URL`
- `VITE_KEYCLOAK_REALM`
- `VITE_KEYCLOAK_CLIENT_ID`

**Secrets location:**
- Local: `.env` files (gitignored); example at `.env.example`
- Production backend: Wrangler secrets (`wrangler secret put DATABASE_URL`)
- Production frontend: GitHub Actions repository secrets

## Webhooks & Callbacks

**Incoming:**
- None — no webhook endpoints defined in the backend routes.

**Outgoing:**
- None — no outgoing webhook calls.

**Silent SSO:**
- Frontend serves `public/silent-check-sso.html` (Vite `public/` dir) for Keycloak silent token refresh redirects. URI constructed dynamically in `frontend/src/auth/keycloak.ts` using `import.meta.env.BASE_URL`.

---

*Integration audit: 2026-04-25*
