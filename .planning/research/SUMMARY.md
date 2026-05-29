# Research Summary — v3.0 Quality, Polish & DevX

**Project:** TravelMap / PruebaMapJapan
**Researched:** 2026-05-28
**Confidence:** HIGH

---

## Executive Summary

v3.0 is a brownfield quality milestone on a mature Hono + Vanilla TS MPA + Keycloak 26.6.1 stack. No significant new runtime dependencies are needed — the delta is two dev-orchestration packages (`concurrently@9.2.1`, `wait-on@9.0.10`) in the root workspace, and an optional `eslint-plugin-security@4.0.0` in the backend if ESLint is already configured. The bulk of the work is architectural retrofits: CSS token consolidation across two origins, centralized error handling across four page entry points, a cross-platform dev startup script, Terraform expansion for reproducible test users, and Playwright E2E coverage for the full new-user trip creation path.

**Phase ordering is non-negotiable:** tokens before error UI, both before E2E. Two tracks (Terraform + dev script) are independent and can run in parallel with token work.

---

## Stack Additions

**New packages (v3.0 only):**

| Package | Version | Location | Purpose |
|---------|---------|----------|---------|
| `concurrently` | `^9.2.1` | root devDeps | Parallel process orchestration with labeled prefixes |
| `wait-on` | `^9.0.10` | root devDeps | Health-check polling before starting app processes |
| `eslint-plugin-security` | `^4.0.0` | backend devDeps (conditional) | Static analysis — ReDoS, eval, path traversal |

`concurrently` v10.0.0 released 2026-05-28 — pin v9 as stable.

**New files to create (not packages):**
- `scripts/dev.mjs` — Node ESM dev orchestration script
- `.vscode/extensions.json` — FreeMarker LSP recommendation (`Nokia.lsp-for-freemarker`)

**Docker Compose addition** — KC cache-disable flags:
```yaml
command: >
  start-dev
  --spi-theme-static-max-age=-1
  --spi-theme-cache-themes=false
  --spi-theme-cache-templates=false
```

**What NOT to add:** task runners (just, mask, turbo, nx), Keycloakify (requires React), dual `.ps1` + `.sh` scripts.

---

## Feature Table Stakes

**Must-deliver in v3.0:**

| Feature | Area | Complexity |
|---------|------|------------|
| Empty-state dashboard with "Create your first trip" CTA | New user flow | Low |
| Nominatim geocoder widget parity across destinations, hotels, activities forms | New user flow | Low (audit) |
| Map renders immediately on first activity save | New user flow | Low (verify) |
| Search indexes newly created trips | New user flow | Low (verify) |
| Playwright E2E covering full create-trip-to-map flow | New user flow | Medium |
| No raw browser errors or unhandled rejections visible to users | Error handling | Low-Medium |
| Inline form validation errors at field level | Error handling | Low |
| API errors rendered as human-readable messages in context | Error handling | Low |
| Auth 401 triggers re-login, not blank page | Error handling | Low |
| `VITE_API_URL` missing fails build loudly in production mode | Error handling | Low |
| Single `npm run dev` entry command | Dev script | Low-Medium |
| Service health-check wait before backend starts | Dev script | Medium |
| PKCE S256 enforced server-side in Terraform | OAuth audit | Low |
| Strict redirect URIs separated by environment (no wildcards in prod) | OAuth audit | Low |
| JWKS cache invalidation on key rotation (retry once on verify failure) | OAuth audit | Low |
| `email` optional typing throughout (passkey users have no email) | OAuth audit | Low |
| Login page typography and colors match app (font-family, border-radius: 0, color palette) | KC theme | Low |
| No KC logo on login page | KC theme | Low |
| Email templates branded with inline styles | KC theme | Low |

**Hard limit — KC account console:** KC 26 Account Console is a React/PatternFly SPA. CSS can change fonts and colors only. Component geometry cannot be restyled via FreeMarker. Accepted limitation for this milestone.

---

## Architecture Highlights

### Key Integration Points

**CSS token cross-origin gap:** Frontend on `localhost:5173`; KC login on `localhost:8080`. Different origins — `localStorage` theme state cannot sync. Decision: accept divergence; KC login uses `@media (prefers-color-scheme: dark)` only. KC `login.css` currently has hardcoded hex inside `@media` blocks — fix this in Phase 1 regardless.

**Multiple frontend entry points:** `main.ts` is the legacy city-page entry. `dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, and `profile.ts` are separate Vite entry points. Error handling must be applied to all four individually.

**Shadow DOM CSS inheritance:** `Navbar.ts` and `SearchBar.ts` inline all styles as TS template literals using CSS custom properties. `[data-theme]` attribute selectors do not pierce Shadow DOM. Components must consume custom properties only.

**Playwright sessionStorage workaround:** `keycloak-js` stores tokens in `sessionStorage`. Playwright's `storageState()` captures cookies and `localStorage` only (issue #31108, unresolved in v1.60.0). The existing `addInitScript` workaround must be used for all new auth-dependent specs.

### New vs Modified Components

**New files:**

| File | Phase | Purpose |
|------|-------|---------|
| `frontend/src/modules/toast.ts` | 2 | Central toast; consumes CSS tokens |
| `frontend/src/modules/errorHandler.ts` | 2 | Global unhandledrejection handler |
| `scripts/dev.mjs` | 3 | Docker Desktop detection + sequenced startup |
| `scripts/lib/wait-for-server.mjs` | 3 | Shared polling helper |
| `tests/e2e/new-user-trip-creation.spec.ts` | 4 | Full CRUD + map E2E |
| `tests/e2e/fixtures/trip-helpers.ts` | 4 | `createTestTrip` / `deleteTestTrip` API helpers |

**Modified files:**

| File | Change | Phase |
|------|--------|-------|
| `keycloak/themes/japan-trip/login/resources/css/login.css` | Remove hardcoded hex; use `--jp-*` tokens | 1 |
| `keycloak/themes/japan-trip/account/resources/css/account.css` | Token alignment | 1 |
| `keycloak/themes/japan-trip/login/*.ftl` (5 files) | Remove inline styles | 1 |
| `frontend/src/styles/main.css` | Audit hardcoded hex | 1 |
| `frontend/src/api/client.ts` | Typed `ApiError` (status + code) | 2 |
| `backend/src/index.ts` | Error code taxonomy in `onError` | 2 |
| `frontend/src/pages/dashboard.ts`, `tripDetail.ts`, `trip-edit.ts`, `profile.ts` | try/catch + showToast | 2 |
| `terraform/keycloak/main.tf` | `trip_edit_test_user`, `new_user_test` resources | 3 |
| `tests/e2e/trip-edit-integration.spec.ts` | Remove ROPC; use storageState | 4 |

### Suggested Phase Order

```
Phase 10 (Design Tokens + IDP Theme)
  └─ Phase 11 (Error Handling) — blocked on Phase 10 tokens

Phase 12a (Terraform Expansion) ─┐ parallel, independent
Phase 12b (Dev Script)          ─┤
                                 └─ Phase 13 (E2E + New User Parity) — blocked on Phases 11 + 12
```

---

## Watch Out For

**Top 5 pitfalls (ranked by severity):**

**1. Terraform `webAuthnPolicyPasswordlessRpId` drift — CATASTROPHIC/IRREVERSIBLE**
If any `terraform apply` resets this field, all passkey registrations are permanently invalidated. No migration path. Prevention: pin value explicitly in HCL; add `lifecycle { prevent_destroy = true }` to realm resource; run `terraform plan` before any apply and verify zero changes on the realm resource. **First action in Phase 12a — verify the pin before touching anything else.**

**2. KC passkey AIA templates break silently on macro restructure — CRITICAL**
The passkey enrollment flow uses AIA FreeMarker templates. Renaming macros or restructuring `login.ftl` causes the passkey prompt to silently break. Prevention: treat passkey AIA templates as frozen. Run `passkeys.spec.ts` after every theme change.

**3. KC startup race causes 401 wall on first dev run — HIGH**
KC takes 15-30s after the Docker healthcheck passes to serve JWKS. If backend starts before KC's OIDC discovery endpoint is reachable, all requests return 401 until backend restarts. Prevention: startup script must poll `{KEYCLOAK_URL}/health/ready` and block backend start.

**4. JWT audience regression during audit — HIGH**
v2.0 tightened `VALID_AUDIENCES` to `['japan-trip-api']`. A Terraform change can silently re-add `account`, widening the security boundary. Prevention: add E2E assertion — a token with `aud: account` only must return 401.

**5. CSS token rename misses Shadow DOM TS template literals — HIGH**
IDE refactoring and CSS linters do not scan TS string literals in `Navbar.ts` / `SearchBar.ts`. Prevention: before any rename, run `rg "var\(--old-token-name" --type ts --type css` across the entire repo.

**Additional mandatory items:**
- ROPC removal from `trip-edit-integration.spec.ts` is mandatory — PROJECT.md prohibits ROPC
- `testuser` is not in Terraform; must be added in Phase 12a before Phase 13 E2E expansion
- Fix existing loose assertions in `trips.spec.ts` and `auth.spec.ts` before adding new coverage

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack additions (packages, versions) | HIGH | Verified against npm registry |
| Feature table stakes | HIGH | Derived from codebase analysis |
| Architecture — component boundaries | HIGH | Grounded in actual codebase file review |
| Cross-origin theme constraint | HIGH | Architectural fact; Option D is the correct call |
| Terraform rpId risk | HIGH | PROJECT.md explicitly flags; codebase-verified |
| OAuth audit scope | HIGH | RFC 9700 (Jan 2025) is current IETF BCP |
| KC account console limitations | HIGH | Confirmed via official KC 26 docs |
