# Feature Landscape — v3.0 Quality, Polish & DevX

**Domain:** Trip planning web app — quality, polish, and developer-experience milestone
**Researched:** 2026-05-28
**Overall confidence:** HIGH (stack is well-known; KC theme limits confirmed via official docs)

---

## 1. New User Trip Creation — End-to-End Flow

### What "feature parity with demo" means

The Japan demo trip already demonstrates: map rendered with day-colored markers, multiple destinations, hotel info per destination, days with labeled activities, geocoded coordinates per activity, and search across the itinerary. "Parity" means a newly registered user can build any trip that achieves all of this — for any city, any dates.

The critical gap is not backend API (all CRUD routes exist) but **UX flow**: the current UI likely has no guidance for a blank state, no coordinated success/error feedback, and no tested path from "first login" to "trip on a map."

### End-to-end flow (required)

```
Register / login
  → Dashboard (empty state for new user)
  → Create trip (name, cover image URL, dates)
  → Add destination (city name, geocoded via Nominatim or manual lat/lng)
  → Add hotel for that destination
  → Add day(s) to the destination
  → Add activities to each day (name, coordinates, notes)
  → Navigate to trip detail → map renders with markers
  → Search works across new trip data
```

### Table Stakes

| Feature | Why expected | Complexity | Depends on |
|---------|-------------|------------|-----------|
| Empty-state dashboard with CTA | New user sees blank grid with clear "Create your first trip" prompt; UX standard (Nielsen Norman, Carbon Design) | Low | `dashboard.html` / `dashboard.ts` — add branch when `trips.length === 0` |
| Coordinated multi-step creation flow | Adding a trip → then destination → then hotel → then day → then activities is a multi-step journey; user needs to know where they are and what comes next | Medium | Existing trip-edit UI wired across multiple pages; UX needs sequencing |
| Map renders on first save | After adding ≥1 activity with coordinates, the trip detail map must show markers immediately | Low | `tripAdapter.ts` + `tripDetail.ts` — already implemented; needs E2E verification |
| Search indexes user trips | `SearchBar` must index the newly created trip (not just the demo Japan data) | Low | `search.ts` already extends index per trip on dashboard load — verify new trip appears |
| Nominatim geocoding widget for destination/activity/hotel coordinates | User needs a way to get lat/lng for any place; `modules/geocoder.ts` (Nominatim) and `modules/geocoder.ts` (Google Maps URL extraction) already exist in the codebase; verify the forms in `trip-edit/` surface this widget consistently across destinations, hotels, and activities | Low | `frontend/src/modules/geocoder.ts` (already exists); `trip-edit/hotels.ts` already uses it — audit `destinations.ts` and `activities.ts` for parity |
| Date range picker for trip and destination | Trips and destinations have date fields; native `<input type="date">` is acceptable | Low | Existing API schema has date fields; verify frontend form exposes them |
| Playwright E2E covering full creation flow | Regression guard for the complete new-user path | Medium | Requires real-auth globalSetup already in place; new spec added to `tests/` |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Step indicator or breadcrumb during creation | Shows user progress through trip → destination → hotel → day → activity | Medium | Implement as a stateless UI component; no backend changes |
| "Quick start" template trip | Pre-populated trip skeleton (empty days, placeholder destination) user can edit | Medium | API-level: POST a template trip after registration; requires backend endpoint or client-side seeding |
| Inline map preview during destination creation | Miniature Leaflet map that previews the entered coordinates before saving | Medium | Reuse `map.ts`; render small map next to coordinate fields in the form |
| Activity reorder via drag-and-drop | Matches demo's `order_index` field on activities | High | Defer; `order_index` exists in schema but no drag UI yet |

### Anti-Features

| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Adding a paid geocoding API (Google Maps, Mapbox) | Nominatim (free, no key, OSM-backed) already exists in the codebase; paid alternatives add cost and key management with no benefit at this scale | Keep using `frontend/src/modules/geocoder.ts` with Nominatim |
| Wizard modal (multi-step in a single modal) | Hides content; hard to navigate back | Separate pages per entity (trip → destination → day → activity) as already structured |
| Blocking "go to map" until trip is "complete" | Arbitrary gate; map renders with whatever data exists | Allow map view at any point; it simply shows fewer markers |

### Feature Dependencies

```
Empty-state dashboard
  → depends on: dashboard.ts trip-load flow (existing)
  → produces: CTA button linking to create-trip form

Nominatim geocoding parity across forms
  → depends on: modules/geocoder.ts (existing — searchNominatim + extractCoordsFromGoogleMapsUrl)
  → audit: verify trip-edit/destinations.ts and trip-edit/activities.ts use geocoder-widget same as hotels.ts

Map renders new trip
  → depends on: tripAdapter.ts + tripDetail.ts (existing)
  → E2E must verify: trip created via UI appears on map

Search covers new trips
  → depends on: search.ts index (existing, extends on dashboard load)
  → verify: new trip name, activity names appear in search results
```

---

## 2. Error Handling UX Patterns

### Current state

`api/client.ts` throws on non-2xx; page modules catch with `try/catch` and render error UI. However, error UI is ad-hoc per page, and the CONCERNS.md notes that `VITE_API_URL` silently falls back to `localhost` in production — a silent error rather than a loud one. No toast/notification system exists. No offline detection. Native browser fetch errors (network errors) may surface uncaught.

### Table Stakes

| Feature | Why expected | Complexity | Depends on |
|---------|-------------|------------|-----------|
| No native browser error visible to users | Standard for any shipped web app; raw fetch stack traces or `Failed to fetch` visible in console only, not in DOM | Low-Medium | Audit all `try/catch` blocks in `dashboard.ts`, `tripDetail.ts`, `profile.ts`; ensure every catch renders friendly UI |
| Inline form validation errors | Errors appear adjacent to the offending field, not as a toast (NNG, GOV.UK pattern) | Low | Add per-field `<span class="field-error">` elements driven by Zod validation messages from API 400 responses |
| API error display (non-auth) | 404, 409, 500 errors from backend rendered as human-readable messages in context (e.g., within the form, below the submit button) | Low | `api/client.ts` already throws `Error` with message; catch sites need to render the message text, not log to console |
| Auth error recovery | 401 responses trigger a re-login prompt, not a blank page | Low | `authMiddleware` already returns 401; frontend catch must call `keycloak.login()` on 401 |
| Network/offline detection | Fetch failures due to no network shown as "you appear to be offline" rather than a cryptic error | Low | `navigator.onLine` check in `api/client.ts` before each request; window `offline` event listener |
| `VITE_API_URL` build-time guard | Missing env var fails the build loudly (error), not silently falls back to localhost | Low | `vite.config.ts`: add check `if (!process.env.VITE_API_URL) throw new Error(...)` in production mode only |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Global toast/snackbar system | Transient success feedback (e.g., "Activity saved", "Trip created") via a non-blocking notification; errors that need user attention stay persistent | Medium | Implement as a Web Component `<toast-notification>` or a module-level queue; fits the existing Web Component pattern |
| Retry on transient errors | Automatic retry (1-2x) for 503/network errors before showing user an error | Low | Wrap `fetch` in `api/client.ts` with a simple retry loop |
| Loading states on all async actions | Submit buttons show a spinner / disabled state while the API call is in flight | Low | Add `loading` CSS class toggling around each API call in page modules |

### Anti-Features

| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Toast-only for form validation errors | Users cannot see which field failed; error disappears before they can fix it | Inline field-level errors; reserve toast for transient success feedback |
| `alert()` or `confirm()` native dialogs | Blocks the UI; cannot be styled; breaks test automation | Implement custom inline error or modal component |
| Logging error detail in visible DOM | Security: exposes stack traces / internal error messages to users | Log to `console.error` (dev only); show generic message to user |
| Global `window.onerror` as sole catch | Too broad; swallows context | Per-module try/catch is the existing pattern; unhandled rejection listener supplements it |

### Patterns for Vanilla TS MPA (no React Error Boundary)

In a Vanilla TS MPA, the equivalent of React Error Boundary is:

1. Per-page `DOMContentLoaded` handlers wrapped in `try/catch` — already partially done
2. `window.addEventListener('unhandledrejection', ...)` as a backstop — renders a generic "something went wrong" banner
3. A shared `renderError(container: HTMLElement, message: string)` utility in `modules/utils.ts` that every page calls consistently

---

## 3. Dev Environment Script

### Current setup

Three services: PostgreSQL (Docker), Keycloak (Docker), backend (tsx watch). Frontend (Vite dev server) is a fourth process. Docker Compose handles KC + Postgres. Mailpit is a fifth service for email testing. No single entry point coordinates all of them.

### Table Stakes

| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| Single entry command (`npm run dev:all` or `./dev.sh` / `dev.ps1`) | Developers should not need to remember service startup order | Low-Medium | Cross-platform: `.ps1` for Windows, `.sh` for macOS/Linux |
| Preflight checks before starting | Verify Docker Desktop is running; verify required ports (5432, 8080, 8787, 5173, 8025) are free; verify Node version ≥ 22; verify `.env` exists | Medium | Exit with clear message per failed check |
| `.env` bootstrap from `.env.example` | If `.env` doesn't exist, copy `.env.example` with a prompt; never overwrite existing `.env` | Low | Simple file existence check |
| Dependency install check | Run `npm install` only if `node_modules` is absent or `package-lock.json` is newer | Low | `node_modules/.package-lock.json` modification time check |
| Health-check wait before proceeding | After `docker compose up -d`, poll KC health endpoint (`/health/ready`) before declaring success | Medium | KC takes 30-60s to start; use a polling loop with timeout |
| Terraform init + apply for KC realm | After KC is healthy, apply Terraform to seed realm, clients, test users | Medium | Requires `terraform` CLI on PATH; `terraform -chdir=terraform/ apply -auto-approve` |
| Start all four processes | Backend (`tsx watch`), Frontend (`vite`), and optionally Mailpit | Low | `npm-run-all --parallel` or `concurrently` for cross-platform process management |
| Graceful teardown | `Ctrl+C` kills all child processes and optionally runs `docker compose stop` | Low | Process group signal propagation; PowerShell: `Stop-Job`; bash: trap SIGINT |
| Colored output with service label prefix | `[KC]`, `[API]`, `[FRONTEND]` prefixes on log lines | Low | `concurrently` provides this natively |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Auto-open Docker Desktop if not running | Removes one manual step on Windows/macOS | Low | Windows: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`; macOS: `open -a Docker` |
| Browser auto-open after all services healthy | Open `http://localhost:5173` once all services are confirmed up | Low | `start` (Windows) / `open` (macOS) / `xdg-open` (Linux) |
| `--reset` flag to wipe DB and KC state | Useful for testing from-scratch flows | Medium | `docker compose down -v && docker compose up -d` then re-apply Terraform |
| Windows PowerShell + POSIX bash parity | Single script with OS detection, or two scripts that share the same logic | Low | OS detection: `$IsWindows` in PowerShell, `uname -s` in bash |

### Anti-Features

| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| `sleep` timers for service readiness | Arbitrary; fails on slow machines | Health-check polling with timeout |
| Hardcoding paths (e.g., Docker Desktop location) | Different per OS and installation | Check `docker info` to detect Docker availability; fall back to manual instruction if not found |
| Requiring `terraform` in PATH for basic startup | Some developers may not have Terraform installed | Make Terraform step optional (`--with-terraform` flag); print instructions if not found |
| Starting services in wrong order | KC depends on Postgres; Backend depends on KC being up for JWKS | Use `depends_on` with healthchecks in `docker-compose.yml`, and wait for KC health before starting backend |

---

## 4. OAuth/OIDC Security Hardening Checklist

### Current state (from INTEGRATIONS.md and CONCERNS.md)

Already done (v2.0 Validated):
- PKCE S256 enabled in `keycloak-js` and backend JWT verification
- JWT audience tightened (VALID_AUDIENCES env var, `japan-trip-api`)
- CORS corrected (was wildcard + credentials — now fixed)
- RS256 JWT verification via JWKS (Web Crypto API, 1-hour cache)
- XSS fixed (DOMPurify + `dom.ts` helper)
- Tokens in `sessionStorage` (keycloak-js v21+ default)

### Table Stakes for v3.0 Audit

| Item | Why required | Current status | Action |
|------|-------------|----------------|--------|
| PKCE S256 enforced on KC client (server-side) | Client-side PKCE alone is insufficient; KC must require it | Verify in Terraform `keycloak_openid_client.pkce_code_challenge_method = "S256"` | Confirm in Terraform config; add if missing |
| Redirect URI strict matching (no wildcards in production) | Wildcard redirect URIs allow open-redirect token theft | `redirectUris` in `japan-trip-frontend` must not use `*` in production | Separate local (`http://localhost:5173/*`) from production (`https://manud.github.io/PruebaMapJapan/*`) redirect URI lists via Terraform workspace |
| RP-initiated logout with `id_token_hint` | Without `id_token_hint`, KC may not clear the session; user appears logged out from app but KC session persists | `keycloak.logout({ redirectUri })` — verify `id_token_hint` is passed (keycloak-js handles this automatically) | Verify via network trace in Playwright E2E |
| Post-logout redirect URI registered | KC will reject unregistered `post_logout_redirect_uri` values | Register GitHub Pages URL as valid post-logout redirect in Terraform `keycloak_openid_client` | Add `post_logout_redirect_uris` to Terraform |
| `state` parameter validated | CSRF protection for the auth code exchange | keycloak-js handles this automatically; verify no custom auth flow bypasses it | Code review only |
| Token expiry handling (access token 5-min, refresh used) | Short-lived access tokens reduce blast radius | `keycloak.onTokenExpired` fires `refreshToken()` — already implemented in `keycloak.ts` | Verify E2E: let token expire, confirm seamless refresh |
| JWKS cache invalidation on 401 | If KC rotates signing keys, cached JWKS becomes stale; should refetch on verification failure | `backend/src/auth/keycloak.ts` — check if 401 triggers JWKS refetch or just fails | Add: on JWT verify failure, clear cache and retry once |
| `email` optional typing on JWT | Passkey users without email must not cause 500 errors | CONCERNS.md item — `email` is typed required but may be absent | Fix type: `email?: string`; guard all uses |
| CSP headers | Restricts XSS impact even if sanitization fails | Not currently set | Add `Content-Security-Policy` header in Hono `app.use('*', ...)`: `default-src 'self'; script-src 'self'` etc. |
| Keycloak brute-force protection enabled | Prevents credential stuffing | Verify `brute_force_protection = true` in Terraform `keycloak_realm` | Confirm in Terraform; set `failure_factor`, `max_failure_wait_seconds` |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Separate Terraform workspaces for local vs production | Production client has strict redirect URIs; local has wildcard | Medium | Terraform workspace or `tfvars` file per environment |
| Token binding / DPoP | Binds access token to a specific TLS session; defeats token theft | HIGH complexity | RFC 9449; not supported by keycloak-js yet; defer |
| Refresh token in HttpOnly cookie (BFF pattern) | Eliminates XSS-based refresh token theft | HIGH complexity | Requires a backend-for-frontend; no-op for this vanilla TS MPA + Workers stack |

### Context: RFC 9700 (January 2025)

RFC 9700 (IETF Best Current Practice for OAuth 2.0 Security) mandates:
- PKCE for all client types (already done)
- No implicit flow (already done — PKCE only)
- Strict redirect URI matching
- Short-lived access tokens with refresh rotation

The current stack already satisfies most of RFC 9700. The primary gaps are: strict redirect URIs in production and JWKS cache invalidation on key rotation.

### Token Storage Decision (keycloak-js)

The 2025 best practice per OWASP and IETF: access token in JS memory (safest), refresh token in HttpOnly + Secure + SameSite cookie. The keycloak-js default stores both in `sessionStorage` (per-tab, cleared on tab close). This is an acceptable tradeoff for this app: `sessionStorage` is XSS-accessible but prevents the need for a BFF. **For v3.0: leave storage as-is; document the tradeoff.** DPoP/BFF is post-v3.0.

---

## 5. Keycloak FreeMarker Theme Consistency

### What is achievable

**HIGH confidence** (official Keycloak docs + community research):

Keycloak themes have four types. Each has different customization scope:

| Theme type | Pages covered | FreeMarker control | Notes |
|------------|--------------|-------------------|-------|
| `login` | Login, register, password reset, OTP, email verify, passkey forms | Full — override any `.ftl` file + CSS | This is the "japan-trip" theme that already exists |
| `email` | All transactional emails (verification, OTP, password reset) | Full — subject + plain text + HTML body via message bundles | Already has es/en messages |
| `account` | Account console (profile, credentials, sessions) | Partial — KC 26 Account Console is React SPA; only CSS + `index.ftl` wrapper is FreeMarker | **Cannot meaningfully restyle the account console UI via FreeMarker alone** |
| `admin` | Admin console | None practical — React SPA; FreeMarker is only the bootstrap wrapper | Out of scope for this project |

### What "design consistency" means for v3.0

The goal from PROJECT.md: **minimalist aesthetic, no rounded borders, Helvetica-style font, matching the demo app's look**. This means:

For the `login` theme (achievable):
- Full CSS override: font stack, colors, border-radius, button styles, form layout
- Override `template.ftl` for layout structure if needed
- CSS custom properties to match `main.css` variables from the frontend
- All error messages in English (messages_en.properties already exists in v2.0)

For the `email` theme (achievable):
- HTML email templates can match brand fonts and colors (with inline styles — email client requirement)
- Subject lines via message bundles

For the `account` console (limited):
- CSS injection via `index.ftl` + `<style>` tag can change colors and fonts
- The React UI's component structure (button shapes, card layouts, spacing) cannot be restyled without rebuilding the SPA
- **Realistic goal**: match typography and color palette; accept that component geometry (PatternFly-based) will differ from the minimalist app aesthetic
- Keycloakify (React-based KC theme toolchain) is the path to full account console restyling but requires React — out of scope given the vanilla TS constraint (applies only to KC theme, not app stack)

### Table Stakes

| Feature | Why expected | Complexity | Notes |
|---------|-------------|------------|-------|
| Login page typography matches app | Font stack (Helvetica/system-sans) and base colors consistent | Low | CSS override in `login/resources/css/` — `font-family`, `background-color`, `color` |
| No rounded corners on login forms/buttons | Matches "no rounded borders" design spec | Low | `border-radius: 0` in CSS overrides |
| Login page color palette matches app | Dark/light backgrounds, accent colors align | Low | Map CSS custom properties from `main.css` to KC `variables.css` |
| Error messages in English (not KC default) | English is the app language per v2.0 i18n work | Low | `messages_en.properties` already exists in theme; verify all error keys covered |
| Email templates branded | Verification and OTP emails look intentional, not stock KC | Low | Override email FTL templates in `email/html/*.ftl`; use inline CSS |
| No KC logo on login page | Stock KC logo breaks the minimalist aesthetic | Low | Override `template.ftl` or CSS: `#kc-logo { display: none }` |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Dark/light mode parity on login page | If app has theme toggle, login page matching dark/light is surprising and delightful | Medium | Use `prefers-color-scheme` media query in KC login CSS; no JS required |
| Custom "Register" page that matches app's form style | Form fields, labels, buttons all match app aesthetic | Medium | Override `register.ftl`; restyle with app CSS variables |
| Account console color/font alignment (partial) | Font and primary color match even if component geometry differs | Low | `account/resources/` CSS injection; scope: colors and typography only |

### Anti-Features

| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Attempting pixel-perfect account console restyling via FreeMarker | KC 26 Account Console is a React/PatternFly SPA; FreeMarker only wraps it | Accept typography + color parity; note geometry limitation in planning |
| Java SPIs for theme customization | Explicitly out of scope per PROJECT.md | FreeMarker + CSS only |
| Maintaining a separate Keycloakify build | Adds React dependency to the KC theme pipeline; complexity not justified for this project | Stick to FreeMarker + CSS for login; accept account console limitations |
| Hardcoding English strings in FTL templates | Bypasses KC i18n; breaks if locale changes | Always use `${msg("key")}` in FTL; define custom keys in `messages_en.properties` |

### Practical Limit Assessment

The project's design spec (minimalist, no rounded borders, Helvetica) is **fully achievable for the login/register/error/email flows** via FreeMarker + CSS. The account console will have partial parity (fonts and colors only). For a portfolio project, this is sufficient — users spend 99% of their time in the app, not the KC account console.

### Gap: Light/Dark Theme Toggle in the App (out of scope for this section)

PROJECT.md Active item "Light/dark theme consistency" refers to the **app's own theme toggle** working correctly across all flows and pages — not just the KC login page. This is a separate concern from KC theme parity. The app's `theme.ts` / `data-theme` attribute system is the mechanism; the audit should cover: does the theme toggle state persist across page navigations (MPA means each page reload), are there any pages or components (e.g., Leaflet map tiles, modals) that don't respond to the theme attribute, and does the KC login dark/light parity (differentiator above) match what `prefers-color-scheme` reports. This gap belongs in the error handling / design consistency phase, not in the KC theme phase.

---

## Feature Dependency Map

```
New user trip creation parity
  → depends on: trip-edit UI (existing, v2.0)
  → depends on: tripAdapter.ts (existing)
  → depends on: search.ts index (existing, extends per trip)
  → depends on: modules/geocoder.ts (existing — Nominatim + Google Maps URL extraction)
  → audit required: geocoder-widget parity across destinations.ts, hotels.ts, activities.ts
  → produces: Playwright E2E spec (new)
  → empty-state UX is a frontend-only change (dashboard.ts)

Error handling
  → depends on: api/client.ts error propagation (existing)
  → VITE_API_URL build guard: vite.config.ts change (new)
  → toast system: new Web Component or module
  → all page modules updated to render errors consistently

Dev setup script
  → depends on: docker-compose.yml (existing)
  → depends on: Terraform (existing, v2.0)
  → produces: dev.ps1 + dev.sh (new)
  → must run after KC health-check confirms ready

OAuth/OIDC hardening
  → depends on: keycloak.ts auth layer (existing)
  → JWKS cache invalidation: backend/src/auth/keycloak.ts (change)
  → email optional typing: backend/src/types/index.ts + middleware/user.ts (change)
  → CSP headers: backend/src/index.ts middleware (new)
  → redirect URI separation: Terraform keycloak_openid_client (change)

KC theme consistency
  → depends on: keycloak/themes/japan-trip/ (existing, v2.0)
  → login CSS: extend existing theme CSS (change)
  → email templates: keycloak/themes/japan-trip/email/ (new directory)
  → account console: keycloak/themes/japan-trip/account/ (new directory, CSS only)
  → no new dependencies on application code

App light/dark theme parity (separate from KC theme)
  → depends on: frontend/src/modules/theme.ts (existing)
  → audit: theme persistence across MPA page navigations
  → audit: Leaflet map / modal components responding to data-theme attribute
```

---

## Complexity Summary

| Feature Area | Complexity | Primary risk |
|-------------|------------|-------------|
| New user trip creation parity | Medium | E2E path coverage; Nominatim geocoder widget parity audit; empty-state UX |
| Error handling | Low-Medium | Consistent adoption across all page modules; toast component design |
| Dev setup script | Medium | Cross-platform (Windows PowerShell + macOS bash); KC health-check timing |
| OAuth/OIDC hardening | Low | Mostly audit + small fixes; JWKS cache invalidation is the one new logic |
| KC theme (login + email) | Low | CSS overrides only; well-understood FreeMarker API |
| KC theme (account console) | Low (limited scope) | Cannot achieve geometry parity; CSS-only is the limit |
| App light/dark theme parity | Low | MPA page-reload state; Leaflet tile theming |

---

## Sources

- [RFC 9700 — Best Current Practice for OAuth 2.0 Security (Jan 2025)](https://datatracker.ietf.org/doc/rfc9700/)
- [Keycloak — Working with themes (official, KC 26)](https://www.keycloak.org/ui-customization/themes)
- [Red Hat KC 26.0 Server Developer Guide — Themes chapter](https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.0/html/server_developer_guide/themes)
- [Keycloak JS adapter — official securing apps guide](https://www.keycloak.org/securing-apps/javascript-adapter)
- [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
- [Curity — SPA OAuth best practices](https://curity.io/resources/learn/spa-best-practices/)
- [skycloak.io — JWT best practices: storage and rotation](https://skycloak.io/blog/jwt-best-practices-developers/)
- [NNG — Empty states as teachable moments](https://www.useronboard.com/onboarding-ux-patterns/empty-states/)
- [Smashing Magazine — Error messages UX design](https://www.smashingmagazine.com/2022/08/error-messages-ux-design/)
- [Docker Compose multi-service one-command setup (2026)](https://eastondev.com/blog/en/posts/dev/20260409-docker-compose-multi-service/)
- [keycloak/keycloak GitHub Discussion #25227 — minimalist theme](https://github.com/keycloak/keycloak/discussions/25227)
- [keycloak/keycloak GitHub Discussion #19508 — account theme limitations](https://github.com/keycloak/keycloak/discussions/19508)
