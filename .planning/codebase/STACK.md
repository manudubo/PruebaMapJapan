# Technology Stack

**Analysis Date:** 2026-04-25

## Languages

**Primary:**
- TypeScript 5.6 - All frontend and backend source code

**Secondary:**
- HTML - Multi-page static entry points (`frontend/*.html`)
- CSS - `frontend/src/styles/main.css`
- SQL - Migration files at `backend/src/db/migrations/0000_initial.sql`

## Runtime

**Environment:**
- Node.js >=20.0.0 (enforced in `frontend/package.json` `engines` field)
- Cloudflare Workers runtime (production backend) — Web Crypto API, no Node.js built-ins
- `@hono/node-server` bridges the Workers app for local development

**Package Manager:**
- npm with workspaces
- Root workspace: `package.json` defines `frontend` and `backend` workspaces
- `tests/` is a standalone package managed via `npm install --prefix tests`
- Lockfiles: `package-lock.json` present at root; `tests/package-lock.json` present

## Frameworks

**Backend:**
- Hono 4.6 (`backend/package.json`) - HTTP framework targeting Cloudflare Workers
- Entry point: `backend/src/index.ts` — exports default Hono app for Workers
- Local dev entry: `backend/src/dev.ts` — wraps app with `@hono/node-server`

**Frontend:**
- Vite 5.4 (`frontend/package.json`) - Build tool and dev server
- No framework (Vanilla TypeScript + native Web Components)
- Leaflet 1.9 - Interactive maps
- keycloak-js 25.0 - Auth adapter (singleton in `frontend/src/auth/keycloak.ts`)

**ORM / Query Builder:**
- Drizzle ORM 0.38 - Schema definition at `backend/src/db/schema.ts`
- Drizzle Kit 0.30 - Migrations CLI, config at `backend/drizzle.config.ts`
- Dual-driver setup: `drizzle-orm/neon-http` for production, `drizzle-orm/node-postgres` for local dev (`backend/src/db/index.ts`)

**Validation:**
- Zod 3.23 - Request body validation via `@hono/zod-validator`; schemas at `backend/src/validation/schemas.ts`

**Testing:**
- Vitest 2.1 - Unit tests for both frontend (`frontend/vitest.config.ts`) and backend (`backend/package.json`)
- Playwright 1.48 - E2E tests in `tests/` workspace

**Build/Dev:**
- tsx 4.19 - TypeScript execution for local backend dev (`tsx watch src/dev.ts`)
- Wrangler 3.101 - Cloudflare Workers deploy CLI (`backend/package.json`)
- esbuild (via Vite) - Frontend minification

## Key Dependencies

**Critical:**
- `hono` 4.6 - Core backend framework; all routing, middleware, and context typing depend on it
- `drizzle-orm` 0.38 - Database access layer; schema drives all inferred types in `backend/src/types/index.ts`
- `@neondatabase/serverless` 0.10 - Required for production HTTP-mode Neon connections from Workers
- `leaflet` 1.9 - Map rendering on all city pages and trip detail pages
- `keycloak-js` 25.0 - Frontend auth adapter; must match Keycloak server version (25.0 in Docker)

**Infrastructure:**
- `pg` 8.13 + `@hono/node-server` 1.13 - Local development only; not bundled for production
- `dotenv` 16.4 - Local env loading in `backend/src/dev.ts`
- `@cloudflare/workers-types` 4.20241224 - TypeScript types for Workers runtime APIs
- `@vitest/coverage-v8` 2.1 - Coverage provider for frontend unit tests
- `jsdom` 25 - DOM environment for frontend Vitest runs

## Configuration

**Environment (backend):**
- `DATABASE_URL` — Neon PostgreSQL connection string (secret via `wrangler secret put`)
- `KEYCLOAK_URL` — Keycloak server URL (var in `wrangler.toml`, override at deploy time)
- `KEYCLOAK_REALM` — Keycloak realm name (var in `wrangler.toml`)
- Local dev reads from `.env` file via dotenv

**Environment (frontend):**
- `VITE_API_URL` — Backend API base URL, defaults to `http://localhost:8787/api`
- `VITE_KEYCLOAK_URL` — Keycloak URL, defaults to `http://localhost:8080`
- `VITE_KEYCLOAK_REALM` — Keycloak realm, defaults to `japan-trip`
- `VITE_KEYCLOAK_CLIENT_ID` — Keycloak client, defaults to `japan-trip-frontend`
- All injected at build time via Vite; see `.env.example`

**Build:**
- `frontend/vite.config.ts` — Multi-page input map (12 HTML entry points), base `/PruebaMapJapan/`, Leaflet in separate chunk
- `backend/wrangler.toml` — Worker name `prueba-map-japan-api`, `nodejs_compat` flag, `compatibility_date = "2024-01-01"`
- `backend/drizzle.config.ts` — PostgreSQL dialect, schema at `./src/db/schema.ts`, migrations to `./src/db/migrations`
- `frontend/tsconfig.json` — ES2022 target, strict mode, `@/*` alias to `src/`
- `backend/tsconfig.json` — ES2022 target, strict mode, `@cloudflare/workers-types`

## Platform Requirements

**Development:**
- Node.js 20+
- Docker (for local Keycloak + PostgreSQL via `keycloak/docker-compose.yml`)
- npm workspaces support

**Production:**
- Frontend: GitHub Pages at `https://manud.github.io/PruebaMapJapan/`
- Backend: Cloudflare Workers (`wrangler deploy`)
- Keycloak: Railway (Dockerfile at `keycloak/Dockerfile`, config at `keycloak/railway.toml`)
- Database: Neon (serverless PostgreSQL)

---

*Stack analysis: 2026-04-25*
