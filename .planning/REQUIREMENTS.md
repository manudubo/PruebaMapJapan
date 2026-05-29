# Requirements — v3.0 Quality, Polish & DevX

**Milestone:** v3.0
**Status:** Active
**Created:** 2026-05-28

---

## Dev Environment (DEVENV)

- [ ] **DEVENV-01**: User can start the entire local environment with a single command (`npm run dev`) that detects Docker Desktop, opens it if not running, waits for Keycloak to be healthy, then starts all services in order (Compose → backend → frontend)
- [ ] **DEVENV-02**: User sees color-labeled output per process (Keycloak, backend, frontend) with distinct prefixes via `concurrently`
- [ ] **DEVENV-03**: User can follow the README to set up the local environment from scratch without consulting other sources

## Infrastructure / Terraform (INFRA)

- [ ] **INFRA-01**: `testuser` KC user is a managed Terraform resource (no longer hardcoded outside IaC)
- [ ] **INFRA-02**: `new_user_test` KC user exists as a managed Terraform resource for the new-user E2E spec (starts with no trips)
- [ ] **INFRA-03**: `trip_edit_test_user` KC user exists as a managed Terraform resource, replacing the ROPC-based user in `trip-edit-integration.spec.ts`
- [ ] **INFRA-04**: KC client HCL enforces PKCE S256 challenge method server-side

## Security / OAuth & OIDC (SEC)

- [ ] **SEC-01**: A written RFC 9700 checklist artifact exists with each control documented as compliant, non-compliant, or N/A with evidence
- [ ] **SEC-02**: Backend JWT verification retries JWKS fetch once on 401 before failing (handles signing key rotation without requiring backend restart)
- [ ] **SEC-03**: KC client Terraform HCL uses strict redirect URIs with no wildcards; dev and prod URIs separated
- [ ] **SEC-04**: Backend Hono responses include CSP, X-Frame-Options, and HSTS headers
- [ ] **SEC-05**: E2E assertion exists that verifies a token with `aud: account` only returns 401 from the backend API

## Documentation (DOC)

- [ ] **DOC-01**: README.md reflects the simplified local setup using `npm run dev`; includes prerequisites (Docker Desktop, Node 22, Terraform), and is accurate end-to-end
- [ ] **DOC-02**: SETUP.md exists with step-by-step instructions for setting up the project in non-local environments (CI, new machine); covers Terraform apply, env var configuration, service dependencies
- [ ] **DOC-03**: A use case inventory document exists listing what a user can do from the app and which scenarios have Playwright E2E coverage vs which are gaps

## Error Handling (ERR)

- [ ] **ERR-01**: User never sees a raw browser error, uncaught exception stack trace, or native browser error dialog in any flow — all errors are caught and presented gracefully
- [ ] **ERR-02**: A centralized `toast.ts` module handles all user-facing error and success notifications (`showToast(message, type)`)
- [ ] **ERR-03**: A global `unhandledrejection` handler catches unhandled promise rejections across all four frontend entry points (`dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, `profile.ts`)
- [ ] **ERR-04**: API errors carry typed `ApiError` (status + code); backend `onError` responds with consistent error codes
- [ ] **ERR-05**: User receives an automatic redirect to Keycloak login when a 401 is received, instead of a blank or broken page

## New User Experience (UX) — CRITICAL

- [ ] **UX-01**: A new user can create a trip, add a destination with hotel, create a day with activities, edit trip details, and delete the trip — all from the UI — without encountering errors or dead ends
- [ ] **UX-02**: A newly created trip immediately renders on the Leaflet map with correct markers for activities and is discoverable via the global search
- [ ] **UX-03**: A user with no trips sees an empty-state dashboard with a clear "Create your first trip" call-to-action
- [ ] **UX-04**: The Nominatim geocoder widget is available and functional across all location forms (destinations, hotels, activities) — not only the hotels form
- [ ] **UX-05**: A Playwright E2E spec covers the full new-user trip creation flow: registration/login → empty dashboard → create trip → add destination+hotel+day+activity → verify map renders → verify search finds the trip → edit → delete
- [ ] **UX-06**: Existing `trip-edit-integration.spec.ts` ROPC usage is replaced with storageState auth (ROPC is prohibited per PROJECT.md)

## Design Consistency (DESIGN)

- [ ] **DESIGN-01**: All color values in `frontend/src/styles/main.css` and Keycloak CSS files use CSS custom properties (`--jp-*`); no hardcoded hex values remain outside the token definitions
- [ ] **DESIGN-02**: The Keycloak login page matches the app's visual style: Helvetica-style font, `border-radius: 0`, matching color palette, no Keycloak logo
- [ ] **DESIGN-03**: Keycloak email templates (OTP verification, email confirmation) apply the same typography and color palette as the app via inline styles
- [ ] **DESIGN-04**: Light/dark theme toggle state persists correctly across MPA page navigations; Leaflet map switches tile layers when the theme changes

---

## Future Requirements (post-v3.0)

- Production deployment: Cloudflare Workers (backend) + Neon (DB) + Railway (Keycloak) all live
- Landing demo experience: Japan trip showcased without login required
- Deployment runbook for bringing up all three services
- Real-auth E2E in CI (Keycloak running in CI environment)
- Passkey rename (PUT credentials/{id}/label)
- prod rpId set to Railway hostname in Terraform

## Out of Scope (v3.0)

- Keycloak account console geometry restyling — React/PatternFly SPA, cannot be done via FreeMarker; fonts and colors only
- Keycloakify — requires React, out of scope per stack constraints
- DPoP / token binding — future security hardening
- BFF pattern — architecture change, deferred
- Task runners (turbo, nx, just) — overkill for this project
- Drag-and-drop activity reorder — UX enhancement, deferred

---

## Traceability

*Filled by roadmapper during Phase creation.*

| REQ-ID | Phase | Status |
|--------|-------|--------|
| DEVENV-01 | — | — |
| DEVENV-02 | — | — |
| DEVENV-03 | — | — |
| INFRA-01 | — | — |
| INFRA-02 | — | — |
| INFRA-03 | — | — |
| INFRA-04 | — | — |
| SEC-01 | — | — |
| SEC-02 | — | — |
| SEC-03 | — | — |
| SEC-04 | — | — |
| SEC-05 | — | — |
| DOC-01 | — | — |
| DOC-02 | — | — |
| DOC-03 | — | — |
| ERR-01 | — | — |
| ERR-02 | — | — |
| ERR-03 | — | — |
| ERR-04 | — | — |
| ERR-05 | — | — |
| UX-01 | — | — |
| UX-02 | — | — |
| UX-03 | — | — |
| UX-04 | — | — |
| UX-05 | — | — |
| UX-06 | — | — |
| DESIGN-01 | — | — |
| DESIGN-02 | — | — |
| DESIGN-03 | — | — |
| DESIGN-04 | — | — |
