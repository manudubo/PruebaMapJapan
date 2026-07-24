# Phase 20: Critical Security - Research

**Researched:** 2026-07-24
**Domain:** Web security — CSPRNG, DOM XSS, Content Security Policy, Terraform secrets
**Confidence:** HIGH (all findings verified against actual source files)

## Summary

Phase 20 has four independent surgical changes. Three require no new dependencies; one
(Terraform) is a pure deletion. All source files were read with exact line numbers verified.

The OTP fix is a single-line replacement in `backend/src/routes/auth.ts:123`. The XSS
fix is confined to `renderList` in `frontend/src/modules/widgets.ts` — all other innerHTML
uses in that file operate on trusted data and are explicitly out of scope (D-03). The CSP
is the most complex deliverable: the policy string must reconcile inline scripts/styles
across all 13 HTML pages, a temporary Leaflet CDN dependency on 9 of those pages, two
CORS proxies, a build-time Keycloak URL, and a Keycloak silent-check-sso iframe. The
Terraform change removes a binding that is confirmed unused in every production route handler.

**Primary recommendation:** Write the four changes in dependency order: OTP fix (no deps),
XSS rewrite (no deps), Terraform deletion (independent), CSP last (depends on a complete
audit of all XSS and inline blocks being done first so the policy doesn't need revision).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Replace `Math.random()` at `backend/src/routes/auth.ts:123` with
  `crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000`, padded to 6 digits.
  No per-digit loop. Web Crypto global — no import needed.
- **D-02:** Rewrite `renderList` in `frontend/src/modules/widgets.ts` to use DOM API:
  `createElement` + `textContent` for title/source/date; `setAttribute('href', ...)` for links.
  No `innerHTML` on any RSS-sourced data.
- **D-03:** Weather widget (`renderWeather`, `createWidgetsSection`) retains `innerHTML`.
  Data sources are Open-Meteo structured numerics and internal `itinerary.ts` city names —
  neither is untrusted input. No change needed there.
- **D-04:** `DOMPurify` is NOT added to `widgets.ts` for this fix. DOM API rewrite is chosen.
  DOMPurify remains available (`^3.4.1`) for other uses if needed.
- **D-05:** CSP injected via inline Vite transform plugin in `frontend/vite.config.ts` —
  one source of truth, applied at build time to all HTML entry points. Zero new npm deps.
- **D-06:** All 13 HTML pages receive the CSP meta tag.
- **D-07:** `connect-src` must include `https://api.allorigins.win` and `https://corsproxy.io`.
- **D-08:** `connect-src` must also include `https://api.open-meteo.com` and
  `https://nominatim.openstreetmap.org`.
- **D-09:** `img-src` must include `https://*.tile.openstreetmap.org` and
  `https://*.basemaps.cartocdn.com`. *(See note below — OSM tiles not verified in code.)*
- **D-10:** CSP subject to 0-violation verification in devtools.
- **D-11:** Remove `resource "cloudflare_worker_secret" "kc_admin_client_secret"` from
  `terraform/cloudflare/main.tf`.
- **D-12:** Remove `var.kc_admin_client_secret` from `terraform/cloudflare/variables.tf`
  and any `.tfvars` files that reference it.
- **D-13:** E2E admin fixture reads `KC_ADMIN_CLIENT_SECRET` from local `.dev.vars` —
  not affected by Cloudflare binding removal.

### Claude's Discretion

The exact CSP directive string (all values for `default-src`, `script-src`, `style-src`,
`img-src`, `connect-src`, `font-src`, `frame-src`). Constraint: 0 CSP violations on page
load with news widget rendering and weather fetching.

### Deferred Ideas (OUT OF SCOPE)

- Removing the CORS proxy dependency (SEC-18, Phase 26)
- Two-tier CSP (city vs. app pages) — uniform chosen
- Weather/createWidgetsSection DOM API rewrite for consistency
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID     | Description                                                         | Research Support                                             |
|--------|---------------------------------------------------------------------|--------------------------------------------------------------|
| SEC-01 | OTP generation uses CSPRNG                                          | Single-line fix at auth.ts:123; crypto global confirmed      |
| SEC-02 | No untrusted HTML interpolation in renderList                       | Full sink audit complete; DOM API rewrite path clear         |
| SEC-03 | CSP applied to all pages via build-time injection                   | 13 entry points in vite.config.ts; transformIndexHtml hook   |
| SEC-04 | CSP covers all external connection origins; 0 violations            | Full origin inventory below; policy string provided          |
| SEC-14 | KC admin secret removed from Cloudflare binding                     | Confirmed unused in all production route handlers; 3-file deletion |
</phase_requirements>

## Architectural Responsibility Map

| Capability           | Primary Tier    | Secondary Tier | Rationale                                                    |
|----------------------|-----------------|----------------|--------------------------------------------------------------|
| OTP generation       | API / Backend   | —              | Cloudflare Worker generates and hashes the OTP server-side   |
| XSS prevention       | Frontend        | —              | DOM API rewrite is pure frontend; no backend change          |
| CSP enforcement      | CDN / Static    | Frontend       | Meta tag injected at build time; enforced by browser         |
| Secret binding mgmt  | Infrastructure  | —              | Terraform manages Cloudflare Worker secret bindings          |

## Standard Stack

No new dependencies are introduced in this phase. All work uses existing tooling.

| Asset              | Version    | Purpose                           | Status        |
|--------------------|------------|-----------------------------------|---------------|
| Web Crypto API     | global     | CSPRNG for OTP (`getRandomValues`)| Available in Cloudflare Workers runtime [VERIFIED: auth.ts uses `crypto.subtle` same global] |
| Vite               | ^6.x       | `transformIndexHtml` for CSP meta tag | Existing dep |
| DOMPurify          | ^3.4.1     | Available but NOT used (D-04)     | Existing dep, excluded from this fix |
| Terraform          | (existing) | Remove secret binding             | Existing infra |

## Current Code State

### SEC-01: OTP Generation (auth.ts:123)

[VERIFIED: read file with line numbers]

```typescript
// backend/src/routes/auth.ts:123 — CURRENT (vulnerable)
const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
```

```typescript
// REPLACEMENT (D-01)
const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
```

Context: `crypto.subtle` is already used at line 130 (`hashOtp`) in the same function,
confirming `crypto` is in scope as a global in this Workers runtime. No import needed.

**Modulo bias note:** `Uint32Array` range is 0–4,294,967,295. Max evenly divisible value
by 1,000,000 is 4,294,000,000. Bias is < 0.00000023% — negligible for 6-digit OTP use.
[ASSUMED — no official specification read for this calculation]

### SEC-02/03: Widget XSS Sink Audit (widgets.ts)

[VERIFIED: read file with line numbers]

**SINK 1 — Vulnerable, must be rewritten (D-02):**
```typescript
// frontend/src/modules/widgets.ts:190-203 — renderList
function renderList(container: HTMLElement, items: NewsItem[], type: 'news' | 'events', city: string): void {
  const listItems = items.map(item => {
    const title = cleanTitle(item.title);   // string split ONLY — NOT sanitization
    const date = formatDate(item.pubDate);
    let actionBtn = '';
    if (type === 'events') {
      const calUrl = createCalendarUrl(title, item.link, `${city}, Japan`);
      actionBtn = `<a href="${calUrl}" ...>...</a>`;  // RSS-sourced data in href
    }
    return `<li>...<span>${title}</span><span>${item.source}</span>...${actionBtn}</li>`;
  }).join('');
  container.innerHTML = `<ul>${listItems}</ul>`;  // SINK — all fields from RSS
}
```

RSS-sourced fields at the sink: `item.title`, `item.link`, `item.source`, `item.pubDate`,
and derived `calUrl`. All must be moved to DOM API (`textContent`, `setAttribute`).

`cleanTitle()` — `return title.split(' - ')[0].split(' | ')[0].trim()` — string splitting
only, no HTML escaping. Output is still injectable via innerHTML.

`createCalendarUrl()` — uses `URLSearchParams` which URL-encodes values; the resulting
`calUrl` string is safe as an `href` attribute value, but when calUrl is embedded inside
a template string that becomes innerHTML, the surrounding HTML structure is still vulnerable.

`item.link` as `javascript:` URI: after DOM API rewrite, assigning untrusted link to
`setAttribute('href', ...)` prevents HTML injection but does not prevent `javascript:` URIs.
Per D-04, DOMPurify is not added. The `isValidItem()` guard provides partial protection.
This residual risk is in scope for D-02 as decided — noting it for implementation awareness.

**SINK 2 — Trusted, keep as-is (D-03):**
```typescript
// widgets.ts:34-49 — createWidgetsSection
section.innerHTML = `...<h3>${cityName}</h3>...`;  // cityName from itinerary.ts (internal)
```
```typescript
// widgets.ts:101-106 — renderWeather
container.innerHTML = `...${temp}°C...<span class="${condClass}">${condText}</span>...`;
// temp: Open-Meteo numeric; condClass/condText: internal condition map lookup
```

**Non-sink innerHTML (literal strings — no user data, keep as-is):**
- Line 207 `renderEmptyState`: `'news' | 'events'` TypeScript literal
- Line 212 `renderError`: internal message string literal

**`renderList` is module-private (no export):** The XSS regression test cannot import it
directly. Two options: (a) export `renderList` for testing, or (b) drive it through
`loadDynamicData` with a mocked `fetch`. Option (a) is simpler and matches the existing
test pattern in `frontend/tests/`. Recommended: export `renderList` and test it directly.

Test shape (RED before GREEN):
```typescript
// tests/widgets.test.ts
it('renderList escapes malicious title', () => {
  const container = document.createElement('div');
  const items: NewsItem[] = [{
    title: '<img src=x onerror=alert(1)>',
    link: 'https://example.com',
    source: 'Test',
    pubDate: new Date().toISOString(),
  }];
  renderList(container, items, 'news', 'Tokyo');
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<img src=x');  // rendered as text
});
```

### SEC-04: Vite Config — Entry Points

[VERIFIED: read vite.config.ts]

All 13 HTML entry points in `rollupOptions.input`:
`main (index.html)`, `tokyo`, `nagoya`, `takayama`, `kyoto`, `osaka`, `naoshima`,
`hakone`, `tokyo2`, `dashboard`, `trip`, `profile`, `trip-edit`

No existing `transformIndexHtml` plugin — this will be the first.

### SEC-14: Terraform Files

[VERIFIED: read all three files]

**`terraform/cloudflare/main.tf`** — lines 8-13 to delete:
```hcl
resource "cloudflare_worker_secret" "kc_admin_client_secret" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "KC_ADMIN_CLIENT_SECRET"
  secret_text = var.kc_admin_client_secret
}
```

**`terraform/cloudflare/variables.tf`** — lines 17-20 to delete:
```hcl
variable "kc_admin_client_secret" {
  type      = string
  sensitive = true
}
```

**`terraform/cloudflare/local.tfvars.example`** — line 4 to delete:
```
kc_admin_client_secret = "REPLACE_WITH_KC_ADMIN_CLIENT_SECRET"
```

No actual `terraform/cloudflare/*.tfvars` file exists (only `terraform/keycloak/local.tfvars`).
[VERIFIED: Glob search found no cloudflare-directory tfvars file]

**KC_ADMIN_CLIENT_SECRET usage audit:**
- `backend/src/routes/auth.ts` — NOT used in any route handler [VERIFIED: grep]
- `backend/src/types/index.ts:34` — appears in `Env` interface type definition only
- `backend/src/index.ts:23` — dev server setup only
- Test mocks (E2E fixtures) — read from `process.env.KC_ADMIN_CLIENT_SECRET` (Node.js env,
  not Cloudflare binding) — unaffected by removing the Cloudflare Worker secret

**`backend/src/types/index.ts` type entry:** After removing the Cloudflare binding, the
`Env.KC_ADMIN_CLIENT_SECRET: string` type definition remains. This is intentional (D-13 says
local dev reads from `.dev.vars`). No type change required.

## CSP Audit: External Connection Inventory

[VERIFIED: read all relevant source files]

### Full External Origin Inventory

| Origin | Directive | Source File | Page Scope |
|--------|-----------|-------------|------------|
| `https://api.allorigins.win` | `connect-src` | widgets.ts:168 | All pages with news widget |
| `https://corsproxy.io` | `connect-src` | widgets.ts:170 | All pages with news widget |
| `https://api.open-meteo.com` | `connect-src` | widgets.ts:76 | All pages with weather widget |
| `https://nominatim.openstreetmap.org` | `connect-src` | geocoder.ts | trip-edit.html only |
| `${VITE_KEYCLOAK_URL}` | `connect-src` | keycloak.ts, profile.ts | All auth-aware pages |
| `https://*.basemaps.cartocdn.com` | `img-src` | theme.ts:7,11 | City pages (Leaflet map tiles) |
| `https://cdn-icons-png.flaticon.com` | `img-src` | index.html (apple-touch-icon) | index.html only |
| `https://unpkg.com` | `script-src`, `style-src` | All 9 city HTML files (Leaflet CDN) | Temporary — Phase 23 removes |
| Open-Meteo weather icons | `img-src` | widgets.ts (weather section) | Pages with weather widget |

**Keycloak XHR targets:** keycloak-js makes requests to `VITE_KEYCLOAK_URL` for OIDC
discovery, token refresh, and check-sso. `profile.ts:66` also fetches directly:
`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/account/credentials?type=webauthn-passwordless`.
Both are covered by a single `connect-src` entry for `${VITE_KEYCLOAK_URL}`.

**Open-Meteo icon check:** The weather widget at widgets.ts:101-106 builds condition text
from an internal map, not image URLs. No img-src entry needed for weather icons unless
Open-Meteo returns image URLs. [VERIFIED: renderWeather uses only text/class conditions]

**Note on D-09 discrepancy:** D-09 specifies `https://*.tile.openstreetmap.org` but
`frontend/src/modules/theme.ts` uses only CartoDB tiles:
- `'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'`
- `'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'`
No OSM tile URL exists in any source file. [VERIFIED: grep across all ts/html files]
The wildcard `https://*.basemaps.cartocdn.com` covers all CartoDB subdomains (a, b, c).
Including `https://*.tile.openstreetmap.org` in the policy (as D-09 specifies) is harmless
(no extra violations, no security weakening) and provides future-proofing. Planner should
include it to honor the locked decision, noting it does not match current code.

### Pages With Inline Blocks (drives script-src / style-src decisions)

**Pages with inline `<script>` blocks:**
- ALL 13 pages: theme detection script (FOUC prevention) in `<head>` — requires `'unsafe-inline'`
- index.html additionally: auth/countdown inline script, Keycloak init + hero inline module script
- City pages additionally: `fonts.ready` inline script after Leaflet CDN loads

**Pages with inline `<style>` blocks:**
- All 9 city pages: FOUC prevention CSS in `<head>`
- These drive the `style-src 'unsafe-inline'` requirement

**`dom.ts` style writes:** `setStyle` uses `el.style.setProperty()` — this is CSSOM,
NOT an `setAttribute('style', ...)` call, so it is not governed by `style-src`. The inline
`<style>` blocks in HTML files are the sole reason `'unsafe-inline'` is needed in `style-src`.
[VERIFIED: read dom.ts — only 7 lines]

**Pages with Leaflet CDN (`https://unpkg.com`) — 9 pages:**
`tokyo.html`, `nagoya.html`, `takayama.html`, `kyoto.html`, `osaka.html`, `naoshima.html`,
`hakone.html`, `tokyo2.html`, `trip.html`

Pages WITHOUT Leaflet CDN (4 pages):
`index.html`, `dashboard.html`, `profile.html`, `trip-edit.html`

Because the CSP is uniform across all 13 pages (D-06), `https://unpkg.com` must be in
`script-src` and `style-src` even for pages that don't use it. This is a temporary state
until Phase 23 removes the CDN dependency (SEC-15).

### Keycloak Silent Check-SSO iframe (frame-src)

[ASSUMED — keycloak-js silent-check-sso behavior; not verified in keycloak-js source]

keycloak-js `onLoad: 'check-sso'` creates a hidden `<iframe>` pointing to the Keycloak
authorize endpoint with `prompt=none`. The iframe then 302-redirects back to same-origin
`silent-check-sso.html`. `frame-src` governs iframe sources.

`frame-src 'self'` alone likely fails because the initial iframe src points to `VITE_KEYCLOAK_URL`
(cross-origin). The policy likely needs `frame-src 'self' ${VITE_KEYCLOAK_URL origin}`.

Affected pages: `index.html`, `dashboard.html`, `profile.html`, `trip.html`, `trip-edit.html`
(all pages that call `initKeycloak()` before or during load).

**`frame-ancestors` is NOT supported in `<meta>` CSP tags.** Only `<meta http-equiv>`
supports a subset of CSP directives; `frame-ancestors` requires an HTTP response header.
The Vite meta tag approach cannot set `frame-ancestors`. Do not add it to the meta tag.

### Proposed CSP Directive String

This policy is an informed recommendation based on the full audit above. The D-10
0-violation check in devtools is the authoritative verification gate.

```
default-src 'none';
script-src 'self' 'unsafe-inline' https://unpkg.com;
style-src 'self' 'unsafe-inline' https://unpkg.com;
img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://cdn-icons-png.flaticon.com;
connect-src 'self'
  https://api.allorigins.win
  https://corsproxy.io
  https://api.open-meteo.com
  https://nominatim.openstreetmap.org
  ${VITE_KEYCLOAK_URL};
font-src 'self' https://fonts.gstatic.com;
frame-src 'self' ${VITE_KEYCLOAK_URL};
manifest-src 'self';
worker-src 'self';
```

**`'unsafe-inline'` in script-src:** This makes the CSP's XSS protection for scripts
near-zero. `connect-src`, `img-src`, and `default-src` containment remain valuable.
The inline theme/FOUC scripts on every page require `'unsafe-inline'`. An alternative
is SHA-256 hash allowlisting via Node's built-in `crypto` (satisfies D-05's zero-new-deps):
```javascript
const hash = crypto.createHash('sha256').update(inlineScript).digest('base64');
// → script-src 'self' 'sha256-<hash>'...
```
This is more work (hash each inline script per page) but removes `'unsafe-inline'`.
**The planner should choose knowingly**: SHA-256 hashes are strictly stronger but require
extracting and hashing every inline script block across all 13 HTML files.

**Vite plugin reads `VITE_KEYCLOAK_URL` via `process.env`:**
```javascript
const keycloakUrl = process.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080';
```
This env var is available at Vite build time. In local dev, it defaults to localhost.

### Google Fonts Preconnect

`index.html` has `<link rel="preconnect" href="https://fonts.googleapis.com">` but no
actual `@font-face` load was found. `font-src` entry for `https://fonts.gstatic.com` is
a precaution; if no font is loaded, it causes no violations. [VERIFIED: grep of all CSS
and HTML files found no `fonts.googleapis.com` stylesheet link]

## Terraform Dependency Analysis

### Why KC_ADMIN_CLIENT_SECRET Is Safe to Remove from Cloudflare

[VERIFIED: grep across entire backend/src directory]

| Location | Usage | Safe to Delete Binding? |
|----------|-------|------------------------|
| `backend/src/routes/auth.ts` | NOT present | Yes |
| `backend/src/types/index.ts:34` | Type definition only (`Env` interface) | Yes — type stays |
| `backend/src/index.ts:23` | Dev server env setup | Yes — local dev only |
| `tests/e2e/fixtures/kc-admin.ts:13` | `process.env.KC_ADMIN_CLIENT_SECRET` (Node env) | Yes — different from Worker binding |

No production route handler reads `c.env.KC_ADMIN_CLIENT_SECRET`. The binding is inert
in the deployed (or future-deployed) Worker.

### Verification: SC-4 Unsatisfiable as Written

The Phase 20 success criteria (SC-4) specifies "`wrangler tail` shows no KC_ADMIN_CLIENT_SECRET
binding." Both parts of this are problematic:

1. There is no deployed Worker. `wrangler deploy` currently fails due to the `string_decoder`
   builtin gap (INFRA-03, Phase 21). SC-4's post-deploy verification cannot run this phase.
2. `wrangler tail` streams HTTP request logs — it does not enumerate secret bindings.

**Substitute verification:** `terraform plan -target=cloudflare_worker_secret.kc_admin_client_secret`
showing exactly one resource to destroy, plus `wrangler secret list` (when a deploy exists).
The planner must restate SC-4's verification clause — the intent (secret not bound in Cloudflare)
is sound, the specific tool cited cannot check it.

### E2E Admin Fixture — Confirmed Unaffected

`tests/e2e/fixtures/kc-admin.ts:13` reads `process.env.KC_ADMIN_CLIENT_SECRET` — this is
the Node.js environment, populated from local `.env` files or CI secrets, not from the
Cloudflare Worker binding. Removing the Cloudflare resource does not affect E2E test runs.

## Implementation Notes

### Build vs. Dev Server Verification (Critical)

Verify the CSP against the **built output**, not the dev server.
`transformIndexHtml` runs in both modes, but Vite injects additional tags into the built HTML
(module preload scripts, etc.) that can create violations absent in dev mode.

```bash
npm run build && npm run preview
```

Then open devtools against `http://localhost:4173` (preview port). Check the Network tab for
CSP violations on each page type: a city page (tokyo.html), index.html, trip-edit.html.

After verifying, grep the dist output to confirm the meta tag is present:
```bash
grep -l "Content-Security-Policy" dist/*.html
```

**Note:** The `dist/` directory currently contains stale artifacts from a prior build.
Run a fresh build before reading from it.

### Service Worker Cache Interference

`frontend/public/sw.js` has `CACHE_NAME = 'japan-trip-v3'` (hardcoded — Phase 23 SEC-16
changes this). For a returning browser with a primed cache, the service worker serves
pre-CSP HTML. The "0 violations" check passes for the wrong reason — old HTML has no CSP,
so no violations are reported.

Verification must include: unregister SW + clear site storage + hard reload. In Chrome DevTools:
Application → Service Workers → Unregister; Application → Storage → Clear site data.

### Modulo Bias (OTP)

`Uint32Array` range is 0–4,294,967,295. The maximum evenly divisible multiple of 1,000,000
within that range is 4,294,000,000. Values from 4,294,000,000 to 4,294,967,295 (967,296 values)
introduce slight bias toward OTP values 0–967,295. Bias probability ≈ 0.023% per draw.

For 6-digit email OTP use cases, this is negligible. Rejection sampling (`while val >= 4_294_000_000`)
eliminates bias entirely but adds complexity with no practical security benefit here.
[ASSUMED — bias calculation; verified arithmetic via mental model]

### D-09 Tile Origin Discrepancy

D-09 locks `https://*.tile.openstreetmap.org` in `img-src`. The code uses only CartoDB.
Both origins should be included in the plan (honors the locked decision; OSM entry is
harmless and future-proofs for potential tile source changes). Do not drop D-09.

## Architecture Patterns

### Vite `transformIndexHtml` Plugin Shape

[CITED: https://vite.dev/guide/api-plugin.html#transformindexhtml]

```typescript
// frontend/vite.config.ts — inline plugin (no new dep)
function cspPlugin(): Plugin {
  const keycloakUrl = process.env['VITE_KEYCLOAK_URL'] ?? 'http://localhost:8080';
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' https://unpkg.com`,
    `style-src 'self' 'unsafe-inline' https://unpkg.com`,
    `img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://cdn-icons-png.flaticon.com`,
    `connect-src 'self' https://api.allorigins.win https://corsproxy.io https://api.open-meteo.com https://nominatim.openstreetmap.org ${keycloakUrl}`,
    `font-src 'self' https://fonts.gstatic.com`,
    `frame-src 'self' ${keycloakUrl}`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
  ].join('; ');

  return {
    name: 'csp-meta',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`
      );
    },
  };
}
```

### renderList DOM API Rewrite Pattern

```typescript
// frontend/src/modules/widgets.ts — DOM API rewrite (D-02)
export function renderList(  // exported for testability
  container: HTMLElement,
  items: NewsItem[],
  type: 'news' | 'events',
  city: string
): void {
  container.setAttribute('aria-busy', 'false');
  const ul = document.createElement('ul');
  ul.className = 'widget-list';
  ul.setAttribute('role', 'list');

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'widget-list-item';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'widget-link-title';
    titleSpan.textContent = cleanTitle(item.title);  // safe: textContent, not innerHTML

    const sourceSpan = document.createElement('span');
    sourceSpan.textContent = item.source;

    const time = document.createElement('time');
    time.setAttribute('datetime', item.pubDate);
    time.textContent = formatDate(item.pubDate);

    li.appendChild(titleSpan);
    li.appendChild(sourceSpan);
    li.appendChild(time);

    if (type === 'events') {
      const calUrl = createCalendarUrl(cleanTitle(item.title), item.link, `${city}, Japan`);
      const a = document.createElement('a');
      a.setAttribute('href', calUrl);      // safe: setAttribute, not innerHTML
      // ... class/target/rel attributes
      li.appendChild(a);
    }

    ul.appendChild(li);
  }

  container.innerHTML = '';  // clear previous — safe: no user data
  container.appendChild(ul);
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML sanitization | Custom regex/strip | DOM API (`textContent`) | Regex parsers always have edge cases |
| Iframe origin handling | Manual URL parsing | Read from `process.env.VITE_KEYCLOAK_URL` | Already the standard pattern in keycloak.ts |
| CSP hash generation | Custom script parser | Node `crypto.createHash` if hashes chosen | Built-in; no dep needed |

## Common Pitfalls

### Pitfall 1: Dev Server vs. Build Output CSP Mismatch
**What goes wrong:** Policy verified in `npm run dev` passes, but `npm run build && preview` fails with violations because Vite injects additional module preload scripts into the built HTML.
**How to avoid:** Always run the build before CSP verification. Check `dist/*.html` for injected tags.

### Pitfall 2: Service Worker Serving Stale HTML
**What goes wrong:** Devtools show 0 violations because the SW serves cached HTML without the CSP tag.
**How to avoid:** Unregister SW and clear site data before every CSP verification run.

### Pitfall 3: `frame-src 'self'` Breaks Keycloak Check-SSO
**What goes wrong:** `check-sso` iframe points to `VITE_KEYCLOAK_URL` (cross-origin). `frame-src 'self'` blocks it, breaking silent auth on index/dashboard/profile/trip/trip-edit.
**How to avoid:** Include `${VITE_KEYCLOAK_URL}` in `frame-src`. Test auth flow on index.html.

### Pitfall 4: SC-4 Verification Tool Is Wrong
**What goes wrong:** `wrangler tail` cannot enumerate secret bindings and there is no deployed Worker to tail.
**How to avoid:** Use `terraform plan` to confirm one destroy, `wrangler secret list` when a deploy exists. Planner must restate SC-4's verification clause.

### Pitfall 5: `renderList` Not Exported Blocks XSS Test
**What goes wrong:** The function is module-private; the RED test can't import it.
**How to avoid:** Export `renderList` as part of the fix (not a separate commit — same change).

### Pitfall 6: Modulo Bias Warning on Code Review
**What goes wrong:** Reviewer flags `% 1_000_000` as biased — technically true but negligible for OTP.
**How to avoid:** Add a brief comment explaining the bias magnitude (<0.023%) and why rejection sampling is skipped.

### Pitfall 7: Terraform Apply Without Plan First
**What goes wrong:** Running `terraform apply` without `terraform plan` first can cause unintended changes if state has drifted.
**How to avoid:** Run `terraform plan -target=cloudflare_worker_secret.kc_admin_client_secret` first; confirm exactly one resource shown for destroy.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (frontend) | Vitest + jsdom |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `npm run test:run` (in `frontend/`) |
| Full suite command | `npm run typecheck && npm run test:run` (in `frontend/`) |
| Framework (backend) | Vitest (defaults, no config file) |
| Backend test command | `npm run test` (in `backend/`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | OTP uses `crypto.getRandomValues`, not `Math.random` | Unit | `npm run test:run -- --reporter=verbose` (backend) | ❌ Wave 0 |
| SEC-02 | `renderList` does not inject malicious title into DOM | Unit | `npm run test:run -- --reporter=verbose` (frontend) | ❌ Wave 0 |
| SEC-02 | `renderList` does not inject malicious source into DOM | Unit | Same | ❌ Wave 0 |
| SEC-03 | All 13 built HTML files contain CSP meta tag | Build + grep | `npm run build && grep -c "Content-Security-Policy" dist/*.html` | ❌ Wave 0 |
| SEC-04 | 0 CSP violations on city page load | Manual (devtools) | Preview server + browser check | Manual only |
| SEC-04 | 0 CSP violations on index.html with auth | Manual (devtools) | Preview server + browser check | Manual only |
| SEC-14 | `terraform plan` shows kc_admin_client_secret to be destroyed | Manual (CLI) | `terraform plan -target=...` | Manual only |
| SEC-14 | E2E admin fixture still passes after Terraform change | E2E | Playwright `npm run test:e2e` | Exists |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run test:run` in the changed tier
- **Per wave merge:** Full suite: `npm run typecheck && npm run test:run` (both frontend/ and backend/)
- **Phase gate:** All automated tests green + 0-violation manual CSP devtools check on preview build

### Wave 0 Gaps

- [ ] `backend/tests/otp-csprng.test.ts` — SEC-01: verify `crypto.getRandomValues` is called (mock `crypto`, assert `Math.random` not called)
- [ ] `frontend/tests/widgets-xss.test.ts` — SEC-02: inject malicious title/source; assert no IMG element; assert raw string appears as textContent
- [ ] Build verification script or CI step for SEC-03 (CSP meta tag presence in all 13 dist HTML files)

**No framework install needed** — Vitest already set up in both frontend/ and backend/.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | keycloak-js `check-sso` uses an iframe pointing to VITE_KEYCLOAK_URL (not self-origin) | CSP Audit: frame-src | If wrong, `frame-src 'self'` suffices; verify by checking devtools on index.html |
| A2 | Modulo bias for `Uint32Array % 1_000_000` is < 0.023% | Implementation Notes | Immaterial for OTP; bias exists regardless of exact magnitude |
| A3 | `fonts.googleapis.com` preconnect in index.html does not trigger a `font-src` fetch | CSP Audit | If wrong, add `https://fonts.googleapis.com` to `font-src` |
| A4 | Vite build injects module preload scripts that may add origins not in the policy | Pitfall 1 | Low risk — module preloads are same-origin `<link rel="modulepreload">`, not cross-origin |

**If this table is empty, all claims were verified** — it is not empty; A1 is the highest-risk assumption and should be confirmed by the implementer before finalizing the frame-src value.

## Open Questions

1. **SC-4 verification clause must be restated**
   - What we know: `wrangler tail` cannot verify binding absence; no deployed Worker exists this phase.
   - What's unclear: What the planner intends as the authoritative Terraform-removal check.
   - Recommendation: Substitute "`terraform plan` shows one destroy + `wrangler secret list` post-deploy" in the success criteria.

2. **Keycloak `frame-src` exact origin**
   - What we know: `VITE_KEYCLOAK_URL` defaults to `http://localhost:8080`; production value unknown.
   - What's unclear: Whether production Keycloak URL uses the same env var.
   - Recommendation: The Vite plugin reads `process.env.VITE_KEYCLOAK_URL` at build time; the same env var is already used across the codebase. No additional config needed.

3. **`item.link` `javascript:` URI risk**
   - What we know: After DOM API rewrite, `setAttribute('href', calUrl)` prevents HTML injection but allows `javascript:` URIs. `isValidItem()` provides partial protection.
   - What's unclear: Whether `isValidItem()` validates URL schemes.
   - Recommendation: Out of scope per D-02/D-04. Note for future hardening.

## Environment Availability

| Dependency | Required By | Available | Fallback |
|------------|-------------|-----------|----------|
| Node.js (Vite build) | CSP meta tag injection | Yes (Node 22) | — |
| Terraform CLI | SEC-14 verification | [ASSUMED — installed, path not checked] | — |
| Wrangler CLI | SC-4 (partial) | Yes (in backend package.json) | terraform plan suffices |
| `dist/` artifacts | CSP grep verification | Stale — requires fresh build | Run `npm run build` first |

## Sources

### Primary (HIGH confidence)
- `backend/src/routes/auth.ts` — read with line numbers (auth flow, OTP generation)
- `frontend/src/modules/widgets.ts` — read with line numbers (all innerHTML sinks)
- `frontend/vite.config.ts` — read (13 entry points, no existing transform plugins)
- `terraform/cloudflare/main.tf` — read (full 13-line file, resource to delete)
- `terraform/cloudflare/variables.tf` — read (variable to delete)
- `terraform/cloudflare/local.tfvars.example` — read (example line to delete)
- `frontend/src/modules/theme.ts` — read (CartoDB tile URLs only, no OSM tiles)
- `frontend/src/modules/dom.ts` — read (setStyle uses `.style.setProperty()`, not attribute)
- `frontend/src/modules/geocoder.ts` — read (Nominatim URL)
- `frontend/src/auth/keycloak.ts` — read (VITE_KEYCLOAK_URL usage)
- `frontend/public/sw.js` — read (cache name, NETWORK_ONLY_DOMAINS)
- `frontend/src/modules/utils.ts` — read (cleanTitle, createCalendarUrl)
- `tests/e2e/fixtures/kc-admin.ts` — read (KC_ADMIN_CLIENT_SECRET from process.env)
- All 13 HTML files — grep verified (inline script counts, Leaflet CDN pages)
- `.planning/phases/20-critical-security/20-CONTEXT.md` — read (all locked decisions)

### Secondary (MEDIUM confidence)
- Vite `transformIndexHtml` API — cited from https://vite.dev/guide/api-plugin.html#transformindexhtml

### Tertiary (LOW confidence / ASSUMED)
- keycloak-js silent-check-sso iframe behavior (A1)
- Modulo bias arithmetic (A2)

## Metadata

**Confidence breakdown:**
- OTP fix: HIGH — one-line change, crypto global confirmed in same file
- XSS rewrite: HIGH — all sinks read and classified
- CSP policy: MEDIUM — frame-src assumption (A1) unverified; all origins verified
- Terraform cleanup: HIGH — no production usage confirmed by grep

**Research date:** 2026-07-24
**Valid until:** 2026-08-24 (stable domain; keycloak-js behavior assumption is the only volatility risk)
