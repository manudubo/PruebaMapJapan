# TravelMap — Trip Planning & Visualization Web App

## What This Is

A full-stack web app for planning, visualizing, and sharing trip itineraries. Users build trips with destinations, hotels, day-by-day chronograms, and activities — all rendered on an interactive Leaflet map. Keycloak OIDC auth with passkeys and OTP fallback. Built as both a portfolio piece and a personally useful tool. v2.0 shipped a hardened auth infrastructure with Terraform IaC, email OTP fallback, passkey campaign, and Playwright real-auth E2E coverage. v3.0 targets quality, polish, and developer experience: feature-complete new-user trip creation, design consistency, dev environment script, and full E2E coverage.

## Current Milestone: v3.0 Quality, Polish & DevX

**Goal:** Llevar la app a un estado sólido y consistente — experiencia de usuario completa y probada, dev environment de un solo comando, diseño coherente en toda la app, y documentación actualizada.

**Target features:**
- Dev environment script: single-command local startup, cross-platform (Windows + macOS/Linux), auto-opens Docker Desktop if not running
- Terraform expansion: test users, clients, and all remaining KC resources managed as IaC
- OAuth/OIDC security audit: review and enforce current best practices
- Documentation: updated README.md + non-local environment setup guide (dependencies, instructions)
- Use case audit: identify untested scenarios, add missing Playwright E2E coverage
- New user feature parity with demo (CRITICAL): new users can build any trip with full demo capabilities (map, days, activities, hotel, search) for any city/dates — Playwright E2E covers full creation-to-visualization flow
- Error handling: no native browser/API error messages visible to users; all errors caught and presented gracefully
- Design consistency: demo aesthetic applied throughout (minimalist, no rounded borders, Helvetica-style font) including Keycloak IDP theme
- Light/dark theme consistency: theme toggle works correctly across all flows and pages

## Core Value

A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.

## Requirements

### Validated

- ✓ Backend REST API: full CRUD for trips, destinations, hotels, days, activities — existing
- ✓ Keycloak OIDC auth (PKCE + RS256 JWT verification on backend) — existing
- ✓ Dashboard: authenticated users see and create their trips — existing
- ✓ Trip detail page with Leaflet map (markers per activity/destination) — existing
- ✓ Trip builder UI: add/edit destinations, hotels, days, activities from the web — Phase 2
- ✓ Security hardening: XSS fixed (dom.ts helper + DOMPurify), CORS corrected, JWT audience tightened — Phase 1
- ✓ Public trip sharing: mark trip public/private, share via link, read-only guest view — Phase 3
- ✓ Passkeys functional: Keycloak WebAuthn passkey auth, profile page passkey management — Phase 4, 8
- ✓ Internationalization: all UI strings translated to English — Phase 5
- ✓ Terraform KC realm IaC: keycloak provider HCL; test users seeded; KC Admin worker client — Phase 6, 7, 9
- ✓ Email OTP fallback: `/api/auth/otp-request` + `otp-verify`; Mailpit local SMTP; 10-min TTL; 5-attempt lockout — Phase 8
- ✓ Passkey campaign: post-login flow, per-device cookie, last-credential guard, UPDATE_PASSWORD gated by WebAuthn support — Phase 8
- ✓ Playwright real-auth E2E: OIDC PKCE globalSetup, storageState + sessionStorage replay, kc-admin fixture, passkeys.spec.ts (CDP), otp.spec.ts (serial) — Phase 9

### Active (v3.0)

- [ ] **Dev environment script**: Single-command local startup (cross-platform), auto-opens Docker Desktop — v3.0
- [ ] **Terraform expansion**: All KC test users, clients, and resources managed as IaC — v3.0
- [ ] **OAuth/OIDC security audit**: Compliance with current best practices reviewed and enforced — v3.0
- [ ] **Documentation**: README updated; non-local setup guide written — v3.0
- [ ] **Use case audit + E2E**: Untested scenarios identified; Playwright coverage added — v3.0
- [ ] **New user feature parity with demo**: Full trip creation flow (map/days/activities/hotel/search) for any city/dates; Playwright E2E — v3.0 (CRITICAL)
- [ ] **Error handling**: No native error messages to users; all errors caught and presented gracefully — v3.0
- [ ] **Design consistency**: Demo aesthetic throughout app and IDP (minimalist, no rounded borders, Helvetica) — v3.0
- [ ] **Theme consistency**: Light/dark toggle works correctly across all flows — v3.0

### Future (post-v3.0)

- [ ] **Production deployment**: Cloudflare Workers (backend) + Neon (DB) + Railway (Keycloak) all live with public URLs — post-v3.0
- [ ] **Landing demo experience**: Landing page showcases Japan trip as demo without requiring login — post-v3.0
- [ ] **Deployment runbook**: Document how to bring up all three services in both local and production environments — post-v3.0
- [ ] **Real-auth E2E in CI**: Keycloak in CI environment; SKIP_REAL_AUTH removed from pipeline — post-v3.0

### Out of Scope

- Mobile native app — web-only by design
- Social features (likes, comments, trip following) — not needed
- AI/LLM trip suggestions — user builds manually
- Trip marketplace / public discovery feed — not a social platform
- Payment or monetization — free personal tool / portfolio project
- Java KC SPIs — all KC customization via built-in flows + FreeMarker themes only
- ROPC / username-password API auth in tests — PKCE only

## Context

**Codebase state (as of 2026-05-28, v2.0 shipped; v3.0 planning started 2026-05-28):**
- Full-stack brownfield: Hono + Cloudflare Workers backend, Vanilla TypeScript frontend (MPA), Keycloak 26.6.1 OIDC auth
- 9 phases complete; 62 plans shipped
- Backend: `email_otp_codes` table, OTP endpoints, VALID_AUDIENCES env var, email-optional JWT
- Frontend: trip-edit UI (destinations/hotels/days/activities CRUD), passkey campaign, OTP banner/modal
- Keycloak: managed via Terraform; browser-passkey flow; VERIFY_EMAIL; FreeMarker theme (es/en)
- E2E: Playwright with OIDC real-auth, CDP Virtual Authenticator passkeys, Mailpit OTP tests
- Tests: 22 backend tests, 79 frontend tests, all passing
- Production deployment not yet configured (Cloudflare + Neon + Railway)

**Known critical constraint for v3.0:**
- `webAuthnPolicyPasswordlessRpId` must be set to Railway prod hostname before any prod passkey registration — no migration path exists

## Constraints

- **Cost**: Free or minimal — GitHub Pages (free), Cloudflare Workers (free tier), Neon (free tier), Railway (hobby ~$5/mo for Keycloak)
- **Stack**: Committed to Hono + Cloudflare Workers + Neon + Keycloak + Vanilla TypeScript — no framework migration
- **Keycloak version**: 26.6.1 (upgraded from 25.0 in Phase 4)
- **Node.js**: 22+ required (upgraded from 20 in Phase 8)
- **No build-time secrets**: `VITE_API_URL` must not silently fall back to localhost in production builds

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vanilla TS + Web Components (no React/Vue) | Reduces bundle size, forces clean component boundaries, good portfolio differentiator | ✓ Good — MPA architecture held up well across 9 phases |
| Hono on Cloudflare Workers | Free tier, edge performance, no cold starts, Workers-native Web Crypto for JWT | ✓ Good — zero infrastructure issues |
| Neon PostgreSQL (serverless HTTP) | Works from Cloudflare Workers without persistent connections, free tier | ✓ Good — no connection pool issues at scale |
| Keycloak on Railway | Most configurable IAM option, native passkeys/WebAuthn support, Dockerizable | ✓ Good — passkeys + OTP + AIA all work |
| MPA over SPA | Per-page TS entry points, simpler state management, clean separation | ✓ Good — no regrets |
| Drizzle ORM | TypeScript-first, lightweight, works with dual Neon/pg driver setup | ✓ Good — migrations clean |
| Real-auth via OIDC PKCE headless Chromium (not ROPC) | ROPC is legacy, passkey-only flows can't use password | ✓ Good — storageState + addInitScript workaround for Playwright bug #31108 works |
| SKIP_REAL_AUTH CI guard | KC not available in CI; avoids test failures in pipeline | — Revisit in v3.0 when KC can run in CI |
| OTP serial mode (`test.describe.configure({ mode: 'serial' })`) | Mailpit inbox isolation — parallel OTP tests would race | ✓ Good — mandatory for correctness |
| Terraform KC realm (vs realm-export.json import) | IaC: idempotent applies, no manual KC console work, auditable | ✓ Good — all 16 resources managed; import took effort but worth it |
| CF Terraform provider pinned `>= 4.0, < 5.0` | v5 removed `cloudflare_worker_secret` | ✓ Good — v4.52.7 stable |

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
*Last updated: 2026-05-28 — v3.0 milestone started*
