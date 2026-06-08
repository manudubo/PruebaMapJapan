# Travel Planner

Full-stack travel planning app. Plan trips with destinations, hotels, days, and activities — all on an interactive map.

Includes a pre-loaded demo for a 30-day Japan 2026 itinerary.

## Features

- **Trip builder** — Create and edit trips with destinations, hotels, days, and activities
- **Interactive maps** — Leaflet maps with markers for every activity
- **Global search** — Search across all activities, cities, days, and hotels
- **Authentication** — Keycloak OIDC with PKCE and passkey support
- **Public sharing** — Make trips public and share them without login
- **Dark mode** — System-aware theme with manual toggle
- **PWA** — Installable, works offline

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 5 + TypeScript, Leaflet, Keycloak.js |
| Backend | Hono (Node.js / Cloudflare Workers), Drizzle ORM |
| Database | PostgreSQL (local Docker / Neon in production) |
| Auth | Keycloak 26 (local Docker / Railway in production) |
| Testing | Vitest (unit), Playwright (E2E + integration) |
| Deployment | GitHub Pages (frontend), Cloudflare Workers (backend) |

## Prerequisites

- Docker Desktop 3.0+
- Node.js 22+
- Terraform >= 1.0
- git
- [gh CLI](https://cli.github.com/) (optional — for GitHub operations)

## Getting Started

First-time setup (fresh machine): see [SETUP.md](SETUP.md).

**Quick start** (after first-time setup):

```bash
npm install
npm run dev
```

`npm run dev` starts Docker Desktop if needed, launches Keycloak via Docker Compose, waits for it to be healthy, then starts the backend (http://localhost:8787) and frontend (http://localhost:5173/PruebaMapJapan/) with color-labeled output.

## Project Structure

```
PruebaMapJapan/
├── frontend/          # Vite + TypeScript SPA
│   ├── src/
│   │   ├── api/       # Typed API client
│   │   ├── auth/      # Keycloak adapter
│   │   ├── components/# Web Components (Navbar, SearchBar)
│   │   ├── modules/   # Map, search, theme, geocoder
│   │   ├── pages/     # dashboard.ts, trip-edit/ (metadata, destinations, hotels, days, activities)
│   │   └── types/     # Shared TypeScript types
│   ├── dashboard.html
│   ├── trip-edit.html
│   └── index.html     # Landing page with Japan 2026 demo
│
├── backend/           # Hono API
│   ├── src/
│   │   ├── auth/      # Keycloak JWKS + JWT verification
│   │   ├── db/        # Drizzle schema, migrations, seed, queries
│   │   ├── routes/    # trips, users, public, health
│   │   └── validation/# Zod schemas
│   └── wrangler.toml  # Cloudflare Workers config
│
├── keycloak/          # Keycloak 26 (Docker + Railway)
│   ├── realm-export.json
│   └── docker-compose.yml
│
├── tests/             # Playwright E2E + integration tests
│   └── e2e/
│
└── SETUP.md           # Fresh machine setup guide
```

## API

Base URL (local): `http://localhost:8787`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/public/trips/:id` | No | Public trip with full details |
| GET | `/api/trips` | Yes | List user's trips |
| POST | `/api/trips` | Yes | Create a trip |
| GET/PATCH/DELETE | `/api/trips/:id` | Yes | Get / update / delete trip |
| POST | `/api/trips/:id/destinations` | Yes | Add destination |
| PATCH/DELETE | `/api/trips/:id/destinations/:dId` | Yes | Update / delete destination |
| PUT | `.../hotel` | Yes | Upsert hotel for destination |
| POST | `.../days` | Yes | Add day |
| POST | `.../days/:dayId/activities` | Yes | Add activity |
| PATCH/DELETE | `.../activities/:actId` | Yes | Update / delete activity |
| POST | `.../activities/reorder` | Yes | Reorder activities |

## Running Tests

```bash
# Unit tests
npm run test --workspace=frontend
npm run test --workspace=backend

# E2E + integration (requires full stack running)
npm run test:e2e

# All
npm run test:all
```

## Deployment

Production deployment instructions are not yet documented (post-v3.0 scope — Cloudflare Workers + Neon + Railway).

## License

MIT
