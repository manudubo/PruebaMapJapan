# Directory Structure

**Last mapped:** 2026-04-25

## Top-Level Layout

```
PruebaMapJapan/
├── frontend/          # Vite+TypeScript SPA (the original app)
├── backend/           # Hono API (added later)
├── keycloak/          # Keycloak auth server config + custom theme
├── tests/             # Playwright E2E tests (separate package)
├── .github/           # GitHub Actions CI/CD workflows
├── .planning/         # GSD planning artifacts
├── package.json       # Root — workspace orchestration scripts only
├── README.md
└── DEVELOPMENT.md     # Local dev setup guide
```

## Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── api/
│   │   └── client.ts          # Hono API client, token injection
│   ├── auth/
│   │   ├── AuthGuard.ts        # Keycloak auth guard, redirects
│   │   └── keycloak.ts         # Keycloak.js init/config
│   ├── components/
│   │   ├── Navbar.ts           # Web Component — top nav, auth state
│   │   └── SearchBar.ts        # Web Component — global search overlay
│   ├── data/
│   │   ├── itinerary.ts        # Static itinerary data (all cities/days)
│   │   └── maps.ts             # Google Maps URL lookup table
│   ├── modules/
│   │   ├── countdown.ts        # Trip countdown logic
│   │   ├── map.ts              # Leaflet map initialization, markers
│   │   ├── search.ts           # Search index + query logic
│   │   ├── theme.ts            # Dark/light theme management
│   │   ├── tripAdapter.ts      # API → frontend type adapter
│   │   ├── utils.ts            # Shared utilities
│   │   └── widgets.ts          # Weather + news widgets
│   ├── pages/
│   │   ├── dashboard.ts        # Dashboard page controller
│   │   ├── profile.ts          # Profile page controller (new)
│   │   └── tripDetail.ts       # Trip detail page controller
│   ├── styles/
│   │   └── main.css            # Global CSS with custom properties
│   └── types/
│       └── index.ts            # Frontend TypeScript types
├── tests/                      # Vitest unit tests
│   ├── modules.test.ts         # Theme, countdown, itinerary, maps
│   ├── search.test.ts          # Search index tests
│   └── utils.test.ts           # Utility function tests
├── public/
│   ├── manifest.json           # PWA manifest
│   ├── silent-check-sso.html   # Keycloak silent SSO check frame
│   └── sw.js                   # Service worker (PWA offline)
├── *.html                      # Page entry points (see below)
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── .env / .env.example
```

### HTML Entry Points

| File | Purpose |
|------|---------|
| `index.html` | Landing page with countdown |
| `dashboard.html` | Trip management dashboard |
| `profile.html` | User profile page (new) |
| `trip.html` | Dynamic trip detail page |
| `tokyo.html` / `tokyo2.html` | Static city pages |
| `kyoto.html` | Static city page |
| `osaka.html` | Static city page |
| `nagoya.html` | Static city page |
| `takayama.html` | Static city page |
| `naoshima.html` | Static city page |
| `hakone.html` | Static city page |

Static city pages are the original architecture. `trip.html` is the new dynamic approach that loads from the backend API.

## Backend (`backend/`)

```
backend/
├── src/
│   ├── auth/
│   │   └── keycloak.ts         # Keycloak JWKS verification
│   ├── db/
│   │   ├── index.ts            # DB connection (node-postgres Pool)
│   │   ├── schema.ts           # Drizzle ORM schema definitions
│   │   ├── seed.ts             # Seed script for demo data
│   │   ├── migrations/         # Drizzle migration files
│   │   ├── queries/            # Query modules (trips, users, etc.)
│   │   └── README.md
│   ├── middleware/
│   │   ├── auth.ts             # JWT verification middleware
│   │   ├── cors.ts             # CORS middleware
│   │   └── user.ts             # User upsert middleware (new)
│   ├── routes/
│   │   ├── index.ts            # Route registration
│   │   ├── health.ts           # GET /health
│   │   ├── public.ts           # Public endpoints (no auth)
│   │   ├── trips.ts            # /api/trips CRUD
│   │   └── users.ts            # /api/users profile
│   ├── types/
│   │   └── index.ts            # Backend TypeScript types
│   ├── validation/
│   │   └── schemas.ts          # Zod validation schemas
│   ├── dev.ts                  # Local dev server entry (@hono/node-server)
│   ├── index.ts                # Cloudflare Workers entry
│   └── index.test.ts           # Backend unit tests (Vitest)
├── drizzle.config.ts           # Drizzle ORM config
├── wrangler.toml               # Cloudflare Workers deploy config
├── tsconfig.json
└── package.json
```

## Keycloak (`keycloak/`)

```
keycloak/
├── docker-compose.yml          # Local dev: Keycloak + Postgres containers
├── Dockerfile                  # Custom Keycloak image
├── realm-export.json           # Realm config (clients, flows, passkeys)
├── apply-local-settings.sh     # Script to patch realm for local dev
├── railway.toml                # Railway.app deployment config
├── themes/
│   └── japan-trip/
│       └── login/              # Custom Keycloak login theme
└── README.md
```

## Tests (`tests/`)

```
tests/
├── e2e/
│   ├── accessibility.spec.ts   # WCAG / axe-core checks
│   ├── api.spec.ts             # Backend API E2E tests
│   ├── auth.spec.ts            # Keycloak auth flow tests
│   ├── city-pages.spec.ts      # Static city page smoke tests
│   ├── landing.spec.ts         # Landing page tests
│   ├── pwa.spec.ts             # PWA manifest + service worker
│   ├── search.spec.ts          # Global search tests
│   ├── trips.spec.ts           # Dashboard + trip CRUD tests
│   └── fixtures/
│       └── mockTrip.ts         # Shared mock trip data
├── global-setup.ts             # Playwright global setup
├── playwright.config.ts        # Playwright configuration
└── package.json                # Separate package (playwright only)
```

## Key File Locations

| What | Where |
|------|-------|
| API client | `frontend/src/api/client.ts` |
| Auth guard | `frontend/src/auth/AuthGuard.ts` |
| Keycloak init | `frontend/src/auth/keycloak.ts` |
| Navbar component | `frontend/src/components/Navbar.ts` |
| Trip data types | `frontend/src/types/index.ts` |
| Backend entry (prod) | `backend/src/index.ts` |
| Backend entry (dev) | `backend/src/dev.ts` |
| DB schema | `backend/src/db/schema.ts` |
| Auth middleware | `backend/src/middleware/auth.ts` |
| Trips router | `backend/src/routes/trips.ts` |
| Zod schemas | `backend/src/validation/schemas.ts` |
| Playwright config | `tests/playwright.config.ts` |
| Local dev compose | `keycloak/docker-compose.yml` |

## Naming Conventions

- **Frontend modules**: `camelCase.ts` — single exported function/class per file
- **Web Components**: `PascalCase.ts` — class extending `HTMLElement`
- **Backend routes**: `camelCase.ts` — Hono route handler files
- **Test files**: `*.spec.ts` (Playwright), `*.test.ts` (Vitest)
- **HTML pages**: `kebab-case.html` for city pages, descriptive names for app pages
