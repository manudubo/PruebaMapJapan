# Roadmap: TravelMap

## Milestones

- ✅ **v2.0 Auth Infrastructure & Hardening** — Phases 1–9 (shipped 2026-05-28)
- 🚧 **v3.0 Quality, Polish & DevX** — Phases 10–14 (in progress)

## Phases

<details>
<summary>✅ v2.0 Auth Infrastructure & Hardening (Phases 1–9) — SHIPPED 2026-05-28</summary>

- [x] Phase 1: Security Hardening (8/8 plans) — completed 2026-04-27
- [x] Phase 2: Trip Builder (9/9 plans) — completed 2026-05-04
- [x] Phase 3: Public Sharing (3/3 plans) — completed 2026-05-06
- [x] Phase 4: Passkeys (2/2 plans) — completed 2026-05-09
- [x] Phase 5: Internationalization (12/12 plans) — completed 2026-05-15
- [x] Phase 6: Local Infrastructure (6/6 plans) — completed 2026-05-19
- [x] Phase 7: Backend Hardening + KC Config (9/9 plans) — completed 2026-05-24
- [x] Phase 8: OTP + Passkey Campaign (8/8 plans) — completed 2026-05-26
- [x] Phase 9: Playwright Real Auth (7/7 plans) — completed 2026-05-28

</details>

### 🚧 v3.0 Quality, Polish & DevX

**Milestone Goal:** Bring the app to a solid, consistent state — complete and tested user experience, single-command dev environment, coherent design throughout, and accurate documentation.

- [x] **Phase 10: Design Tokens + IDP Theme** - CSS token consolidation, KC login page alignment, email templates, light/dark theme consistency — completed 2026-05-31
- [x] **Phase 11: Error Handling** - Centralized toast module, global unhandledrejection handler, typed ApiError, 401 auto-redirect — completed 2026-06-01
- [ ] **Phase 12: Terraform Expansion + Dev Script** - Test users as IaC, PKCE S256 + strict redirect URIs, single-command local startup
- [ ] **Phase 13: Security Audit + Documentation** - RFC 9700 checklist, JWKS retry, CSP/security headers, SEC-05 assertion, README + SETUP.md + use case inventory
- [ ] **Phase 14: E2E Expansion + New User Parity** - Full new-user creation E2E spec, ROPC removal, empty-state dashboard, geocoder parity across all forms

## Phase Details

### Phase 10: Design Tokens + IDP Theme
**Goal**: The app and Keycloak login page share a unified visual language with no hardcoded color values; light/dark theme toggle is consistent across all MPA pages
**Depends on**: Nothing (first phase of v3.0)
**Requirements**: DESIGN-01, DESIGN-02, DESIGN-03, DESIGN-04
**Success Criteria** (what must be TRUE):
  1. No hardcoded hex values exist in `frontend/src/styles/main.css` or any Keycloak CSS file outside of the `--jp-*` token definitions
  2. The Keycloak login page displays with Helvetica-style font, `border-radius: 0`, matching color palette, and no Keycloak logo
  3. Keycloak email templates (OTP verification, email confirmation) apply the app's typography and color palette via inline styles
  4. Toggling light/dark theme persists across MPA page navigations; the Leaflet map switches tile layers when the theme changes
**Plans**: 4 plans
Plans:
- [x] 10-01-PLAN.md — Rename --jp-* tokens + add D-03 new tokens + fix all hardcoded component values in main.css
- [x] 10-02-PLAN.md — Rename old token names in 7 TypeScript source files (inline CSS strings)
- [x] 10-03-PLAN.md — Fix residual hardcoded values in login.css and account.css (KC CSS files)
- [x] 10-04-PLAN.md — Create KC email theme: template.ftl card chrome + 4 html FTLs + 4 text FTLs + messages_es/en.properties
**UI hint**: yes

### Phase 11: Error Handling
**Goal**: Users never see a raw browser error, uncaught exception stack trace, or native browser dialog — all failures surface as styled, readable notifications
**Depends on**: Phase 10
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04, ERR-05
**Success Criteria** (what must be TRUE):
  1. A `showToast(message, type)` call from any page renders a visible, styled notification consuming CSS tokens defined in Phase 10
  2. Triggering an unhandled promise rejection on any of the four frontend entry points (`dashboard`, `tripDetail`, `trip-edit`, `profile`) produces a toast notification, not a silent failure
  3. Backend API errors carry a typed `ApiError` with `status` and `code`; the frontend renders the code as a human-readable message in context
  4. Receiving a 401 response from the backend API automatically redirects the user to Keycloak login instead of showing a blank or broken page
**Plans**: 4 plans
Plans:
- [x] 11-01-PLAN.md — Create toast.ts module + CSS block in main.css + toast.test.ts (Wave 1)
- [x] 11-02-PLAN.md — Add code field to backend ApiResponse + update onError (Wave 1, parallel)
- [x] 11-03-PLAN.md — Add ApiError class + 401 detection to client.ts + client.test.ts (Wave 2)
- [x] 11-04-PLAN.md — Retrofit 4 entry points + dashboard.html + metadata.ts D-08 success toast (Wave 2)
**UI hint**: yes

### Phase 12: Terraform Expansion + Dev Script
**Goal**: All Keycloak test users are reproducible IaC resources; PKCE S256 and strict redirect URIs are enforced server-side; developers start the full local environment with one command
**Depends on**: Nothing (independent track, runs in parallel with Phases 10–11)
**Requirements**: DEVENV-01, DEVENV-02, INFRA-01, INFRA-02, INFRA-03, INFRA-04, SEC-03
**Success Criteria** (what must be TRUE):
  1. Running `npm run dev` from the project root detects Docker Desktop (opens it if not running), starts Compose, waits for Keycloak to be healthy, then starts backend and frontend in order
  2. Terminal output shows color-labeled prefixes for each process (Keycloak, backend, frontend) via `concurrently`
  3. `terraform apply` creates `testuser`, `new_user_test`, and `trip_edit_test_user` as idempotent KC resources with no manual KC console steps required
  4. The KC client Terraform HCL enforces PKCE S256 challenge method server-side and uses strict redirect URIs with dev and prod URIs separated (no wildcards in either environment)
**Plans**: TBD

### Phase 13: Security Audit + Documentation
**Goal**: OAuth/OIDC compliance is audited with evidence; a 401 audience assertion guards JWT scope regression; all documentation is accurate and complete for a fresh setup
**Depends on**: Phase 12
**Requirements**: DEVENV-03, SEC-01, SEC-02, SEC-04, SEC-05, DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. A written RFC 9700 checklist artifact exists with each control documented as compliant, non-compliant, or N/A with evidence referencing code or configuration
  2. Backend JWT verification retries the JWKS fetch once on a key-verification failure before returning 401 (signing key rotation does not require a backend restart)
  3. All backend Hono responses include CSP, X-Frame-Options, and HSTS headers verifiable via `curl -I`
  4. An E2E assertion sends a token with `aud: account` only to the backend API and verifies a 401 response is returned
  5. README.md accurately documents the `npm run dev` setup; SETUP.md provides step-by-step instructions for a fresh environment; a use case inventory document lists all user scenarios and their E2E coverage status
**Plans**: TBD

### Phase 14: E2E Expansion + New User Parity
**Goal**: A new user can complete the full trip creation flow end-to-end without errors; Playwright E2E covers this path; ROPC is eliminated from all test files
**Depends on**: Phase 11, Phase 12
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06
**Success Criteria** (what must be TRUE):
  1. A new user can create a trip, add a destination with hotel, create a day with activities, edit trip details, and delete the trip — all from the UI — without encountering errors or dead ends
  2. A newly created trip renders on the Leaflet map immediately with correct markers; the trip is discoverable via global search without a page reload
  3. A user with no trips sees an empty-state dashboard with a clear "Create your first trip" call-to-action instead of an empty or broken list
  4. The Nominatim geocoder widget is available and functional on all location forms (destinations, hotels, and activities), not only the hotels form
  5. A Playwright E2E spec (`new-user-trip-creation.spec.ts`) covers the full flow — login → empty dashboard → create trip → add destination+hotel+day+activity → verify map renders → verify search finds the trip → edit → delete; `trip-edit-integration.spec.ts` uses storageState auth with no ROPC calls
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** 10 → 11 → 12 (parallel with 10–11) → 13 → 14

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Security Hardening | v2.0 | 8/8 | Complete | 2026-04-27 |
| 2. Trip Builder | v2.0 | 9/9 | Complete | 2026-05-04 |
| 3. Public Sharing | v2.0 | 3/3 | Complete | 2026-05-06 |
| 4. Passkeys | v2.0 | 2/2 | Complete | 2026-05-09 |
| 5. Internationalization | v2.0 | 12/12 | Complete | 2026-05-15 |
| 6. Local Infrastructure | v2.0 | 6/6 | Complete | 2026-05-19 |
| 7. Backend Hardening + KC Config | v2.0 | 9/9 | Complete | 2026-05-24 |
| 8. OTP + Passkey Campaign | v2.0 | 8/8 | Complete | 2026-05-26 |
| 9. Playwright Real Auth | v2.0 | 7/7 | Complete | 2026-05-28 |
| 10. Design Tokens + IDP Theme | v3.0 | 0/4 | Not started | - |
| 11. Error Handling | v3.0 | 4/4 | Complete | 2026-06-01 |
| 12. Terraform Expansion + Dev Script | v3.0 | 0/TBD | Not started | - |
| 13. Security Audit + Documentation | v3.0 | 0/TBD | Not started | - |
| 14. E2E Expansion + New User Parity | v3.0 | 0/TBD | Not started | - |

*Full v2.0 phase details in `.planning/milestones/v2.0-ROADMAP.md`*
