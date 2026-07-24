# Phase 20: Critical Security - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the two highest-exploitability vulnerabilities (OTP RNG, RSS widget XSS), ship a second-line-of-defense CSP across all HTML pages via Vite build-time injection, and remove the unused KC admin credential from the production Cloudflare environment.

Requirements: SEC-01, SEC-02, SEC-03, SEC-04, SEC-14

</domain>

<decisions>
## Implementation Decisions

### SEC-01: OTP CSPRNG
- **D-01:** Replace `Math.random()` at `backend/src/routes/auth.ts:123` with a single `crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000` draw, padded to 6 digits. No per-digit `% 10` loop. This is the Web Crypto API available natively in Cloudflare Workers — no import needed.

### SEC-02/03: Widget XSS Fix
- **D-02:** Rewrite `renderList` in `frontend/src/modules/widgets.ts` to use DOM API: `createElement` + `textContent` for title/source/date fields; `setAttribute('href', ...)` for links. No `innerHTML` on any RSS-sourced data.
- **D-03:** Weather widget (`renderWeather`, `createWidgetsSection`) retains `innerHTML` — data sources are Open-Meteo structured numerics and internal `itinerary.ts` city names, neither is untrusted input. No change needed there.
- **D-04:** `DOMPurify` is NOT added to `widgets.ts` for this fix. The DOM API rewrite is the chosen approach. DOMPurify remains available (already a dep at `^3.4.1`) for other uses if needed.

### SEC-04: Content Security Policy
- **D-05:** CSP is injected via an inline Vite transform plugin in `frontend/vite.config.ts` — one source of truth, applied at build time to all HTML entry points. Zero new npm dependencies.
- **D-06:** All 13 HTML pages receive the CSP meta tag (9 city pages + index.html + trip.html + dashboard.html + profile.html + trip-edit.html). Uniform coverage across the whole app.
- **D-07:** `connect-src` must include the two CORS proxy origins used by the news widget: `https://api.allorigins.win` and `https://corsproxy.io`. This keeps the news widget functional (0 CSP violations) per success criteria. Removing the proxy dependency is deferred to Phase 26 (SEC-18).
- **D-08:** `connect-src` must also include `https://api.open-meteo.com` (weather widget) and `https://nominatim.openstreetmap.org` (geocoder).
- **D-09:** `img-src` must include tile server origins: `https://*.tile.openstreetmap.org` and `https://*.basemaps.cartocdn.com` (CartoDB tiles used by Leaflet).
- **D-10:** The CSP directive values are subject to 0-violation verification in devtools — the researcher/planner should audit all external connections to ensure the policy is complete before finalizing the string.

### SEC-14: Terraform Cleanup
- **D-11:** Remove `resource "cloudflare_worker_secret" "kc_admin_client_secret"` from `terraform/cloudflare/main.tf`.
- **D-12:** Also remove `var.kc_admin_client_secret` from `terraform/cloudflare/variables.tf` and any `.tfvars` files that reference it (local.tfvars, etc.) — clean state, no orphaned variable declarations.
- **D-13:** The `japan-trip-worker` Keycloak client is retained. The E2E admin fixture (`resetCredentials`, `createUser`, `deleteUser`) reads `KC_ADMIN_CLIENT_SECRET` from the backend `.dev.vars` (local) — removing it from Cloudflare does not affect local test runs.

### Claude's Discretion
- The exact CSP directive string (all values for `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, `font-src`, `frame-ancestors`): researcher should audit the full external connection surface and finalize the policy. The key constraint is 0 CSP violations on page load with news widget rendering and weather fetching.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §"Security: Critical & High — Phase 20" — SEC-01 through SEC-14 acceptance criteria
- `.planning/v3.2-CANDIDATE-REQUIREMENTS.md` — full audit findings and per-item verification status

### Source Files to Modify
- `backend/src/routes/auth.ts` line 123 — OTP generation (Math.random → crypto.getRandomValues)
- `frontend/src/modules/widgets.ts` — renderList function (DOM API rewrite for XSS fix)
- `frontend/vite.config.ts` — add inline Vite transform plugin for CSP injection
- `terraform/cloudflare/main.tf` — remove kc_admin_client_secret resource
- `terraform/cloudflare/variables.tf` — remove kc_admin_client_secret variable

### Existing Patterns to Follow
- `frontend/src/modules/map.ts` — DOMPurify import/usage pattern (established in Phase 1; not used for this fix but shows the established security pattern)
- `frontend/src/modules/dom.ts` — existing DOM helper (setText, setStyle); may be extended if helpers are extracted from the renderList rewrite

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DOMPurify ^3.4.1` in `frontend/package.json` — already a dep, available if sanitization is needed for the calendar URL attribute in renderList's event action button
- `crypto.subtle` — already used in `backend/src/routes/auth.ts` for HMAC (hashOtp); `crypto.getRandomValues` is the same global in Cloudflare Workers

### Established Patterns
- `map.ts` imports DOMPurify and uses `DOMPurify.sanitize()` for popup content — the pattern exists if needed
- Vite config already has `rollupOptions.input` with all 13 HTML pages explicitly listed — the transform plugin can iterate over them or run on all HTML transforms
- No existing Vite HTML transform plugins in use — this will be the first one in the config

### Integration Points
- Vite CSP plugin: hook into `transformIndexHtml` (Vite's built-in HTML transform API) — no external plugin needed
- OTP fix is self-contained to `auth.ts:123` — one line change
- renderList rewrite is self-contained to `widgets.ts` — no upstream changes needed
- Terraform `terraform apply` must be run after the main.tf change; E2E admin fixture must be verified still passing

</code_context>

<specifics>
## Specific Ideas

- The `renderList` calendar action button (`calUrl` from `createCalendarUrl`) generates a URL from the item title and link — the `href` attribute for this anchor also needs `setAttribute` (not inline template) since it contains user-influenced data.
- The `item.source` field in renderList is RSS-sourced and goes into the template — must be covered by the DOM API rewrite.
- Vite's `transformIndexHtml` hook receives the HTML string and returns a modified version — inject the `<meta>` tag as the first child of `<head>` for consistent placement.

</specifics>

<deferred>
## Deferred Ideas

- Removing the CORS proxy dependency from the news widget (routing through the backend Worker) — this is SEC-18, deferred to Phase 26
- Two-tier CSP (different policies for city pages vs TravelMap app pages) — user chose uniform coverage across all 13 pages instead
- Switching weather/createWidgetsSection to DOM API for consistency — deemed unnecessary since those sources are trusted

</deferred>

---

*Phase: 20-critical-security*
*Context gathered: 2026-07-24*
