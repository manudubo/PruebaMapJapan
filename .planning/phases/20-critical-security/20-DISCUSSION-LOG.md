# Phase 20: Critical Security - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 20-critical-security
**Areas discussed:** Widget XSS fix method, CSP page scope, CSP injection method, Terraform cleanup depth

---

## Widget XSS Fix Method

| Option | Description | Selected |
|--------|-------------|----------|
| DOM API rewrite | Rewrite renderList to use createElement + textContent for title/source/date, setAttribute('href') for links. No innerHTML on untrusted data at all. Most structurally correct. | ✓ |
| DOMPurify.sanitize() per field | Wrap each RSS field in DOMPurify.sanitize() before template literal. Consistent with map.ts pattern, less code change. | |
| DOMPurify on full rendered string | Sanitize the entire listItems string once before innerHTML assignment. | |

**User's choice:** DOM API rewrite

**Notes:** Weather widget (renderWeather, createWidgetsSection) retains innerHTML — Open-Meteo returns structured numeric data and city name comes from internal itinerary.ts. No XSS surface there; no change needed.

---

## CSP Page Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All 13 pages | 9 city pages + index.html + trip.html + dashboard.html + profile.html + trip-edit.html. Consistent policy across the whole app. | ✓ |
| 10 pages only | 9 city pages + trip.html (as in success criteria). Dashboard/profile/trip-edit excluded. | |
| Two-tier CSP | Different policy values for city pages vs TravelMap app pages. | |

**User's choice:** All 13 pages

**Notes:** CORS proxies (allorigins.win, corsproxy.io) will be included in connect-src so the news widget continues to render. Removing the proxy dependency is deferred to Phase 26 (SEC-18).

---

## CSP Injection Method

| Option | Description | Selected |
|--------|-------------|----------|
| Vite transform plugin | Inline plugin in vite.config.ts using transformIndexHtml hook. One source of truth, zero new deps. | ✓ |
| Manual | Add <meta http-equiv> to each of the 13 HTML files by hand. Simple but error-prone as pages are added. | |

**User's choice:** Vite transform plugin

---

## Terraform Cleanup Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Remove resource + variable | Remove cloudflare_worker_secret resource AND var.kc_admin_client_secret from variables.tf and .tfvars files. Clean state. | ✓ |
| Resource only | Remove only the cloudflare_worker_secret resource, leave the variable declared. | |

**User's choice:** Remove both resource and variable

**Notes:** The japan-trip-worker Keycloak client is retained. E2E admin fixture reads KC_ADMIN_CLIENT_SECRET from backend .dev.vars (local env) — removing from Cloudflare doesn't affect local test runs.

---

## Claude's Discretion

- Exact CSP directive string (all values for default-src, script-src, style-src, img-src, connect-src, etc.) — researcher should audit the full external connection surface and finalize.

## Deferred Ideas

- Routing news widget through backend Worker (SEC-18) — Phase 26
- Two-tier CSP (city pages vs TravelMap app pages) — user chose uniform coverage
- Switching weather widget to DOM API for consistency — not needed (data is trusted)
