# Development Guide

Two environments are available: **local** (free, Docker-based, no accounts needed) and **production** (Cloudflare Workers + Neon + Railway, ~$0–$10/month).

---

## Quick start — Local (recommended for development)

### Prerequisites
- [Node.js 20+](https://nodejs.org)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Install dependencies
```bash
npm install
npm install --prefix tests   # Playwright test runner
```

### 2. Start infrastructure (PostgreSQL + Keycloak)
```bash
cd keycloak
docker compose up -d
```

Wait ~15 seconds for Keycloak to finish importing the realm. Check status:
```bash
docker compose ps
# Both services should show "Up (healthy)"
```

Services started:
| Service    | URL                          | Credentials         |
|------------|------------------------------|---------------------|
| PostgreSQL | `localhost:5432`             | `postgres/postgres` |
| Keycloak   | http://localhost:8080        | `admin/admin`       |

### 3. Initialise the database
```bash
# Create all tables
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npx drizzle-kit push --force

# Load demo Japan 2026 itinerary
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npx tsx src/db/seed.ts
```

### 4. Start the backend API
```bash
# From project root
npm run dev:backend
# → http://localhost:8787
```

The `backend/.env` file is pre-configured with local credentials — no setup needed.

### 5. Start the frontend
```bash
# From project root — open a new terminal
npm run dev:frontend
# → http://localhost:5173/PruebaMapJapan/
```

The `frontend/.env` file is pre-configured to point at the local backend and Keycloak.

### 6. Verify everything works
```bash
# API health
curl http://localhost:8787/api/health

# Demo trip (Japan 2026, public)
curl http://localhost:8787/api/public/trips/1

# Frontend
open http://localhost:5173/PruebaMapJapan/
```

### Stop everything
```bash
# Kill Node dev servers: Ctrl+C in each terminal

# Stop Docker containers
cd keycloak
docker compose down           # stop but keep data
docker compose down -v        # stop AND delete database
```

---

## Local environment details

### Architecture

```
Frontend (Vite dev)          Backend (Hono + Node)
http://localhost:5173   ──►  http://localhost:8787
                                     │
                              PostgreSQL (Docker)
                              localhost:5432

Keycloak (Docker)
http://localhost:8080
  Realm: japan-trip
  Client: japan-trip-frontend (PKCE, passkeys)
```

### Environment files (gitignored)

**`backend/.env`**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
```

**`frontend/.env`**
```
VITE_API_URL=http://localhost:8787
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=japan-trip
VITE_KEYCLOAK_CLIENT_ID=japan-trip-frontend
```

### Useful database commands
```bash
cd backend

# Open Drizzle Studio (visual DB browser)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npm run db:studio

# Generate a new migration after schema changes
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npm run db:generate

# Apply pending migrations
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npm run db:migrate

# Re-seed (idempotent — safe to run multiple times)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/japan_trip npm run db:seed

# Direct psql access
docker exec -it keycloak-postgres-1 psql -U postgres -d japan_trip
```

### Keycloak admin console
- URL: http://localhost:8080/admin
- Username: `admin`
- Password: `admin`
- Realm: `japan-trip`

To enable passkeys for a test user:
1. Log in to the admin console
2. Go to **Users → Add user**, fill in email/username
3. Go to **Credentials → Set password**
4. Log in as that user at http://localhost:5173/PruebaMapJapan/dashboard.html
5. Keycloak will prompt to register a passkey on first login

### Running tests
```bash
# Unit tests (frontend)
npm run test --workspace=frontend

# Unit tests (backend)
npm run test --workspace=backend

# E2E tests (Playwright — requires both servers running)
npm run test:e2e

# All tests
npm run test:all
```

---

## Production deployment

### Infrastructure costs

| Service           | Provider              | Free tier         | Paid             |
|-------------------|-----------------------|-------------------|------------------|
| Frontend          | GitHub Pages          | Unlimited         | Free             |
| Backend API       | Cloudflare Workers    | 100k req/day      | $5/month         |
| Database          | Neon (PostgreSQL)     | 0.5 GB            | $19/month        |
| Auth (Keycloak)   | Railway               | $5 trial credit   | ~$5/month        |
| **Total**         |                       | **$0**            | **~$24/month**   |

> For a personal travel app, the free tiers of all four services are sufficient indefinitely.

### Step 1 — Neon database (free)

1. Sign up at https://neon.tech (no credit card)
2. Create a project → copy the **Connection string** (starts with `postgresql://`)
3. Run migrations against Neon:
   ```bash
   cd backend
   DATABASE_URL="<your-neon-url>" npx drizzle-kit push --force
   DATABASE_URL="<your-neon-url>" npx tsx src/db/seed.ts
   ```

### Step 2 — Keycloak on Railway (~$5/month)

1. Sign up at https://railway.app
2. New project → **Deploy from GitHub repo** → select this repo
3. Set root directory to `keycloak/`
4. Railway auto-detects the `Dockerfile`
5. Add a PostgreSQL service in the same Railway project
6. Set environment variables on the Keycloak service:
   ```
   KC_DB=postgres
   KC_DB_URL=jdbc:postgresql://<railway-pg-host>/<db>
   KC_DB_USERNAME=<user>
   KC_DB_PASSWORD=<password>
   KC_HOSTNAME=<your-railway-domain>.up.railway.app
   KEYCLOAK_ADMIN=admin
   KEYCLOAK_ADMIN_PASSWORD=<strong-password>
   ```
7. Note the public URL (e.g., `https://japan-keycloak.up.railway.app`)

### Step 3 — Backend on Cloudflare Workers (free tier)

1. Sign up at https://cloudflare.com (free, no credit card)
2. Install Wrangler and authenticate:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. Set production secrets:
   ```bash
   cd backend
   wrangler secret put DATABASE_URL       # paste your Neon connection string
   wrangler secret put KEYCLOAK_URL       # e.g. https://japan-keycloak.up.railway.app
   wrangler secret put KEYCLOAK_REALM     # japan-trip
   ```
4. Deploy:
   ```bash
   npm run deploy --workspace=backend
   ```
5. Note the Worker URL (e.g., `https://prueba-map-japan-api.<account>.workers.dev`)

### Step 4 — Frontend on GitHub Pages (free)

1. Go to your GitHub repo → **Settings → Pages**
2. Source: **GitHub Actions**
3. Add GitHub Actions secrets (**Settings → Secrets → Actions**):
   ```
   VITE_API_URL          = https://prueba-map-japan-api.<account>.workers.dev
   VITE_KEYCLOAK_URL     = https://japan-keycloak.up.railway.app
   VITE_KEYCLOAK_REALM   = japan-trip
   VITE_KEYCLOAK_CLIENT_ID = japan-trip-frontend
   ```
4. Push to `main` — the `deploy-frontend.yml` workflow deploys automatically.
5. Update Keycloak client redirect URIs to include your GitHub Pages URL:
   - In Keycloak admin → Clients → `japan-trip-frontend`
   - Add: `https://<username>.github.io/PruebaMapJapan/*`

### Step 5 — Cloudflare Workers auto-deploy

Add GitHub Actions secrets for Cloudflare:
```
CLOUDFLARE_API_TOKEN   = (from https://dash.cloudflare.com/profile/api-tokens)
CLOUDFLARE_ACCOUNT_ID  = (from Cloudflare dashboard sidebar)
```

From this point, pushing to `main` triggers:
- `deploy-frontend.yml` → builds and deploys frontend to GitHub Pages
- `deploy-backend.yml` → deploys backend to Cloudflare Workers
- `ci.yml` → runs typechecks + unit tests + E2E tests on every PR

---

## Monorepo structure

```
PruebaMapJapan/
├── frontend/                  # Vite + TypeScript SPA
│   ├── src/
│   │   ├── api/client.ts      # Typed API client
│   │   ├── auth/              # Keycloak client + AuthGuard component
│   │   ├── components/        # Navbar, SearchBar (Web Components)
│   │   ├── data/              # Static demo data (itinerary, maps)
│   │   ├── modules/           # map, search, theme, countdown, widgets
│   │   ├── pages/             # dashboard.ts, tripDetail.ts (dynamic pages)
│   │   ├── modules/tripAdapter.ts  # Converts API data → existing map format
│   │   └── types/index.ts     # Shared TypeScript types
│   ├── index.html             # Landing page (static demo, no auth needed)
│   ├── dashboard.html         # User trip dashboard (requires auth)
│   ├── trip.html              # Dynamic trip page (?tripId=)
│   ├── tokyo.html … osaka.html  # Legacy static city pages (still work)
│   └── .env                   # Local env vars (gitignored)
│
├── backend/                   # Hono API (Cloudflare Workers)
│   ├── src/
│   │   ├── auth/keycloak.ts   # JWKS fetcher + JWT verifier (Web Crypto API)
│   │   ├── db/
│   │   │   ├── schema.ts      # Drizzle ORM schema
│   │   │   ├── index.ts       # Dual-driver: pg (local) / neon (production)
│   │   │   ├── seed.ts        # Japan 2026 demo data
│   │   │   ├── migrations/    # SQL migration files
│   │   │   └── queries/       # Typed query helpers per entity
│   │   ├── middleware/        # auth.ts (JWT), cors.ts
│   │   ├── routes/            # trips, users, public, health
│   │   ├── validation/        # Zod schemas for request bodies
│   │   ├── index.ts           # Hono app (Workers entry point)
│   │   └── dev.ts             # Node.js dev entry (@hono/node-server)
│   ├── .env                   # Local env vars (gitignored)
│   └── wrangler.toml          # Cloudflare Workers config
│
├── keycloak/                  # Auth server (Keycloak 25)
│   ├── realm-export.json      # Realm config (passkeys, clients, flows)
│   ├── docker-compose.yml     # Local: Keycloak + PostgreSQL
│   ├── Dockerfile             # Production image (Railway)
│   └── railway.toml           # Railway deployment config
│
├── tests/                     # Playwright E2E + integration tests
│   ├── e2e/
│   │   ├── landing.spec.ts
│   │   ├── city-pages.spec.ts
│   │   ├── search.spec.ts
│   │   ├── auth.spec.ts
│   │   ├── trips.spec.ts
│   │   ├── api.spec.ts
│   │   ├── accessibility.spec.ts
│   │   └── pwa.spec.ts
│   ├── playwright.config.ts
│   └── global-setup.ts
│
├── .github/workflows/
│   ├── ci.yml                 # Typecheck + unit + E2E on every PR
│   ├── deploy-frontend.yml    # GitHub Pages on push to main
│   └── deploy-backend.yml     # Cloudflare Workers on push to main
│
├── .env.example               # Template for all env vars
└── DEVELOPMENT.md             # This file
```

---

## API reference

Base URL (local): `http://localhost:8787`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/public/trips/:id` | No | Get a public trip with full details |
| GET | `/api/users/me` | Yes | Get current user (auto-creates on first login) |
| PATCH | `/api/users/me` | Yes | Update profile |
| GET | `/api/trips` | Yes | List user's trips |
| POST | `/api/trips` | Yes | Create a trip |
| GET | `/api/trips/:id` | Yes | Get trip with full nested data |
| PATCH | `/api/trips/:id` | Yes | Update trip |
| DELETE | `/api/trips/:id` | Yes | Delete trip |
| POST | `/api/trips/:id/destinations` | Yes | Add destination to trip |
| PATCH | `/api/trips/:id/destinations/:dId` | Yes | Update destination |
| DELETE | `/api/trips/:id/destinations/:dId` | Yes | Delete destination |
| POST | `/api/trips/:id/destinations/:dId/days` | Yes | Add day |
| POST | `/api/trips/:id/destinations/:dId/days/:dayId/activities` | Yes | Add activity |
| PATCH | `…/activities/:actId` | Yes | Update activity |
| DELETE | `…/activities/:actId` | Yes | Delete activity |
| POST | `…/activities/reorder` | Yes | Reorder activities |
| PUT | `…/hotel` | Yes | Upsert hotel for destination |

**Auth header**: `Authorization: Bearer <keycloak-access-token>`
