# TravelMap — Trip Planning & Visualization Web App

## What This Is

A web app for planning, visualizing, and sharing fully customizable trip itineraries. Users build trips with destinations, hotels, day-by-day chronograms, and activities — all rendered on an interactive Leaflet map. Built as both a portfolio piece and a personally useful tool, with Keycloak auth, passkeys, and a free/cheap cloud deployment.

## Core Value

A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.

## Requirements

### Validated

- ✓ Backend REST API: full CRUD for trips, destinations, hotels, days, activities — existing
- ✓ Keycloak OIDC auth (PKCE + RS256 JWT verification on backend) — existing
- ✓ Dashboard: authenticated users see and create their trips — existing
- ✓ Trip detail page with Leaflet map (markers per activity/destination) — existing
- ✓ Public trip endpoint: unauthenticated read of trips marked public — existing
- ✓ Legacy Japan trip static pages as landing demo content — existing
- ✓ Profile page with passkey management UI stub — existing
- ✓ Docker Compose local dev stack (Keycloak + PostgreSQL) — existing
- ✓ GitHub Actions CI/CD + Playwright E2E test suite — existing

### Active

- [ ] **Trip builder UI**: Add/edit destinations (with dates), hotels (name, URL, check-in/out), days, and activities (name, time, location, notes) from the web — the API exists, the UI does not
- [ ] **Passkeys functional**: Configure Keycloak 25 for WebAuthn passkey auth, wire up profile page to Keycloak Account REST API, verify stashed changes on `feature/backend`
- [ ] **Production deployment**: Cloudflare Workers (backend) + Neon (DB) + Railway (Keycloak) all live with public URLs and correct env vars — currently local-only
- [ ] **Public trip sharing**: Mark any trip as public/private from the UI, share via link that works without login
- [ ] **Landing demo experience**: Landing page showcases Japan trip as demo without requiring login; link to create own trip
- [ ] **Security hardening**: Fix XSS (`innerHTML` → `textContent`/DOMPurify), CORS misconfiguration (`*` + credentials), JWT audience tightened to specific API client
- [ ] **Deployment runbook**: Document how to bring up all three services (frontend/backend/Keycloak) together in both local and production environments

### Out of Scope

- Mobile native app — web-only by design
- Social features (likes, comments, trip following) — not needed for v1
- AI/LLM trip suggestions — user builds manually, no AI needed
- Trip marketplace / public discovery feed — not a social platform
- Payment or monetization — free personal tool / portfolio project

## Context

**Existing codebase state (as of 2026-04-25):**
- Full-stack brownfield: backend API is complete and tested; frontend UI for trip management is almost entirely missing
- The Japan trip is hardcoded as static TypeScript data (`frontend/src/data/itinerary.ts`), dates hardcoded to Feb-Mar 2026
- There are stashed/unpushed changes on `feature/backend` related to passkeys — need to review before planning auth work
- Three-service architecture (GitHub Pages + Cloudflare Workers + Railway Keycloak + Neon) has no confirmed production deployment and no runbook

**Key technical concerns to address:**
- XSS: user-controlled strings injected via `innerHTML` in `tripDetail.ts`, `dashboard.ts`, `map.ts`
- CORS: `Access-Control-Allow-Origin: *` combined with `credentials: true` is spec-invalid
- JWT audience validation too broad (`account` instead of specific API client)
- `email` field typed as required but may be absent in passkey-only auth flows
- DB connection pool not reused across requests (Neon free tier exhaustion risk)
- Fake D1 binding in `wrangler.toml` — stale from early scaffolding

## Constraints

- **Cost**: Free or minimal — GitHub Pages (free), Cloudflare Workers (free tier), Neon (free tier), Railway (hobby ~$5/mo for Keycloak)
- **Stack**: Committed to Hono + Cloudflare Workers + Neon + Keycloak + Vanilla TypeScript — no framework migration
- **Keycloak version**: Must stay at 25.0 to match `keycloak-js` 25.0 frontend adapter
- **Node.js**: 20+ required (enforced in `frontend/package.json` engines)
- **No build-time secrets**: `VITE_API_URL` must not silently fall back to localhost in production builds

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla TS + Web Components (no React/Vue) | Reduces bundle size, forces clean component boundaries, good portfolio differentiator | — Pending evaluation |
| Hono on Cloudflare Workers | Free tier, edge performance, no cold starts, Workers-native Web Crypto for JWT | — Pending evaluation |
| Neon PostgreSQL (serverless HTTP) | Works from Cloudflare Workers without persistent connections, free tier | — Pending evaluation |
| Keycloak on Railway | Most configurable IAM option, native passkeys/WebAuthn support, Dockerizable | — Pending evaluation |
| MPA over SPA | Per-page TS entry points, simpler state management, clean separation | — Pending evaluation |
| Drizzle ORM | TypeScript-first, lightweight, works with dual Neon/pg driver setup | — Pending evaluation |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-25 after initialization*
