# TravelMap — Trip Planning & Visualization Web App

## What This Is

A full-stack web app for planning, visualizing, and sharing trip itineraries. Users build trips with destinations, hotels, day-by-day chronograms, and activities — all rendered on an interactive Leaflet map. Keycloak OIDC auth with passkeys and OTP fallback. Built as both a portfolio piece and a personally useful tool. v2.0 shipped a hardened auth infrastructure with Terraform IaC, email OTP fallback, passkey campaign, and Playwright real-auth E2E coverage. v3.0 shipped quality, polish, and developer experience: a unified design language between the app and Keycloak, centralized error handling, a single-command dev environment with all KC test users as IaC, an OAuth/OIDC security audit, and full new-user trip-creation E2E parity.

## Current Milestone: v3.1 E2E Stabilization

**Goal:** Get the full Playwright E2E suite green. Pure stabilization — no new product features.

**Target features:**
- Fresh full-suite triage run against current `main` to get an accurate failure list (prior known failures — idp-theme, otp, passkeys ×3, public-sharing, session-management — are stale, several commits old)
- Root-cause and fix each failing spec for real (app bug or test bug, whichever it is)
- Formally document any spec that's genuinely environment-specific and can't reasonably be fixed as an accepted skip/deferral, not silently ignored

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
- ✓ Dev environment script: single-command local startup, Docker Desktop detection, color-labeled `concurrently` output — v3.0 (Phase 12)
- ✓ Terraform expansion: all KC test users (testuser, new_user_test, trip_edit_test_user) managed as IaC; strict redirect URIs, PKCE S256 enforced server-side — v3.0 (Phase 12)
- ✓ OAuth/OIDC security audit: RFC 9700 checklist with evidence, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection test — v3.0 (Phase 13)
- ✓ Documentation: README + SETUP.md + use case inventory, accurate end-to-end — v3.0 (Phase 13)
- ✓ New user feature parity with demo: full trip creation flow (map/days/activities/hotel/search), UI-driven Playwright E2E — v3.0 (Phase 14)
- ✓ Error handling: centralized `toast.ts`, global `unhandledrejection` handler, typed `ApiError`, 401 auto-redirect — v3.0 (Phase 11)
- ✓ Design consistency: `--jp-*` tokens throughout app + Keycloak IDP (login, account, email templates) — v3.0 (Phase 10)
- ✓ Theme consistency: light/dark toggle persists across all MPA flows including Leaflet tile switching — v3.0 (Phase 10)

### Active (v3.1)

(Defined in next step — see `.planning/REQUIREMENTS.md`)

### Future (deferred, unscoped)

- [ ] **Production deployment**: Cloudflare Workers (backend) + Neon (DB) + Railway (Keycloak) all live with public URLs
- [ ] **Landing demo experience**: Landing page showcases Japan trip as demo without requiring login
- [ ] **Deployment runbook**: Document how to bring up all three services in both local and production environments
- [ ] **Real-auth E2E in CI**: Keycloak in CI environment; SKIP_REAL_AUTH removed from pipeline
- [ ] **Passkey rename**: PUT credentials/{id}/label
- [ ] **Prod rpId for passkeys**: Set to Railway hostname in Terraform before any prod passkey registration

## Candidate Milestone: v3.2 Security & Code Health Hardening

Not started — draft requirements at `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`, phase skeleton in ROADMAP.md. Synthesizes `ANALISIS-REPO.md` (2026-07-22 static audit) and `codex-review.md` (2026-06-23 live-environment audit, largely superseded by v3.1's login-harness rewrite but still valid on security/deploy/dependency findings). Headline items: OTP uses `Math.random()` instead of a CSPRNG, unescaped RSS/passkey-label HTML in `innerHTML` sinks, prod deploys aren't gated on CI passing, the backend Worker fails `wrangler deploy --dry-run`, 21 known dependency vulnerabilities (2 critical), and a UI bug where activity drag-reorder doesn't persist visually until page reload.

### Out of Scope

- Mobile native app — web-only by design
- Social features (likes, comments, trip following) — not needed
- AI/LLM trip suggestions — user builds manually
- Trip marketplace / public discovery feed — not a social platform
- Payment or monetization — free personal tool / portfolio project
- Java KC SPIs — all KC customization via built-in flows + FreeMarker themes only
- ROPC / username-password API auth in tests — PKCE only

## Context

**Codebase state (as of 2026-06-22, v3.1 Phase 16 complete):**
- Full-stack brownfield: Hono + Cloudflare Workers backend, Vanilla TypeScript frontend (MPA), Keycloak 26.6.1 OIDC auth
- 16 phases complete; 83 plans shipped (62 v2.0 + 19 v3.0 + 2 v3.1)
- Design: unified `--jp-*` token system across app + KC login/account/email themes; light/dark toggle persists across MPA navigations
- Error handling: centralized `toast.ts`, global `unhandledrejection` handlers, typed `ApiError`, 401 auto-redirect to KC login
- Dev environment: `npm run dev` (Docker detection → KC health wait → backend → frontend); all KC test users + strict redirect URIs as Terraform IaC
- Security: RFC 9700 checklist on file, JWKS retry-on-failure, CSP/HSTS/X-Frame-Options headers, E2E audience-rejection coverage
- New-user flow: full UI-driven trip creation (destination/hotel/day/activity/geocoder/map/search) covered by Playwright E2E with no ROPC anywhere in the suite
- Production deployment still not configured (Cloudflare + Neon + Railway) — deferred, unscoped
- Phase 16 complete: public-sharing.spec.ts rewritten with self-contained beforeAll/afterAll fixtures; idp-theme.spec.ts fixed with empty storageState override and valid PKCE S256 challenge

**Known critical constraint (carried forward):**
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
| `testuser` created standard (not `import=true`) | KC Docker volume doesn't persist across restarts in this env; user didn't pre-exist at apply time | ✓ Good — INFRA-01 intent satisfied; deviation documented and accepted |
| Keep DEV-gated `console.debug`/`warn` in auth code | Useful for future auth debugging; silent in production builds (`import.meta.env.DEV` guard) | ✓ Good — zero production cost |
| `keycloak-js getToken()` only refreshes when `isTokenExpired(30)` | `updateToken(30)` throws when KC issues a token with no refresh token (e.g. post silent-check-sso); unconditional refresh was a latent bug | ✓ Good — real bug fix found via E2E |
| `z.coerce.string()` for lat/lng Zod schemas | Frontend sends `parseFloat()`'d numbers; `z.string()` rejected valid geocoded coordinates | ✓ Good — real bug fix found via E2E |

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
Last updated: 2026-06-22
