# Phase 1: Security Hardening - Research

**Researched:** 2026-04-26
**Domain:** Frontend XSS hardening (innerHTML → DOM API / DOMPurify), CORS null-origin bug, JWT audience reduction, stale wrangler config
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**XSS / innerHTML (SEC-01)**
- D-01: Scope is exactly three files: `dashboard.ts`, `tripDetail.ts`, `map.ts`. `widgets.ts`, `profile.ts`, `SearchBar.ts` are deferred.
- D-02: Create `frontend/src/modules/dom.ts` with exactly two functions: `setText(el: Element, text: string)` and `setStyle(el: HTMLElement, prop: string, value: string)`. No createElement, no setAttr.
- D-03: Inline style injection sites (`cover_image_url`, `day.color`) fixed via `setStyle()` using `el.style.setProperty()`. Browser CSS parser rejects script injection — no external sanitizer needed.

**DOMPurify / Leaflet popups (SEC-02)**
- D-04: DOMPurify used only in `buildPopup` and `buildHotelPopup` in `tripDetail.ts`. The `dom.ts` path uses `textContent`, needs no sanitization.
- D-05: Install via npm: `dompurify` + `@types/dompurify` in `frontend/package.json`.

**CORS (SEC-03)**
- D-06: Fix the null-origin fallback in `cors.ts:18` — return `null` instead of `'*'` when origin is null/absent. This makes the response spec-valid with `credentials: true`.

**JWT Audience (SEC-04)**
- D-07: Accept only `japan-trip-frontend` as valid audience. Remove both `'account'` and `'japan-trip-api'` from `validAudiences` in `keycloak.ts`.
- D-08: Update `keycloak/realm-export.json` to add an audience mapper for the `japan-trip-frontend` client.

**Stale D1 Binding (SEC-05)**
- D-09: Remove the `[[d1_databases]]` block from `backend/wrangler.toml` entirely. No placeholder comment needed.

### Claude's Discretion

- `@types/dompurify` version selection — pick latest compatible with DOMPurify 3.x
- Exact structure of the audience mapper in realm-export.json — standard Keycloak `Audience` protocol mapper targeting `japan-trip-frontend`
- Whether to add `/** @see SEC-01 */` or similar comments on dom.ts functions — keep consistent with project's comment style (no-comment-unless-why-is-nonobvious)

### Deferred Ideas (OUT OF SCOPE)

- innerHTML in `widgets.ts`, `profile.ts`, `SearchBar.ts` — future cleanup phase
- CSP response header via Hono middleware — explicitly deferred to future milestone per REQUIREMENTS.md
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | User-controlled strings never interpolated via `innerHTML`; `dom.ts` helper replaces all 11+ injection sites including inline style attributes | Injection sites catalogued in all three files; dom.ts API locked; `textContent` + `el.style.setProperty()` is the correct native pattern |
| SEC-02 | Leaflet popup HTML strings sanitized with DOMPurify in `buildPopup` / `buildHotelPopup` | DOMPurify 3.4.1 verified; bundled string path confirmed correct for Leaflet `bindPopup` |
| SEC-03 | CORS: null-origin fallback returns `null` not `'*'`; `credentials: true` removed | Bug at `cors.ts:18` confirmed; `credentials: true` is dead code — frontend uses `Authorization: Bearer` only, no `credentials: 'include'` anywhere [VERIFIED: grep frontend/src] |
| SEC-04 | JWT audience validation removes `'account'`; Keycloak client gets audience mapper for `japan-trip-frontend` | `validAudiences` at line 193 confirmed; realm-export.json structure verified; mapper JSON format documented |
| SEC-05 | Stale D1 binding removed from `wrangler.toml` | `[[d1_databases]]` block confirmed present at line 13 |
</phase_requirements>

---

## Summary

Phase 1 is a surgical, file-by-file hardening pass with no new architectural concepts — only correction of existing bugs and weak patterns. All five requirements have confirmed injection sites or misconfiguration found in the codebase; nothing is speculative.

The largest task is SEC-01: replacing 11+ `innerHTML` assignment sites across three files with the locked `dom.ts` helper API (`setText` / `setStyle`). Because the locked API is intentionally minimal (two functions only), sites that previously built nested HTML strings must be rewritten to explicit `document.createElement` chains. The popup builders in `tripDetail.ts` and `map.ts` also hold HTML-string templates that are beyond `dom.ts` scope — those go through DOMPurify (SEC-02). The two backend tasks (SEC-03, SEC-04) are single-line changes plus a JSON edit; SEC-05 is a three-line TOML deletion.

**Primary recommendation:** Implement in dependency order — dom.ts first, then all innerHTML replacements, then DOMPurify, then backend changes. SEC-03 fix includes both the null-origin change and removing `credentials: true` (frontend uses bearer tokens only — verified). The `map.ts` popup scope is a plan blocker — see Open Questions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DOM text/style injection safety (SEC-01) | Browser / Client | — | Injection happens at DOM assignment time in page modules |
| Popup HTML sanitization (SEC-02) | Browser / Client | — | Leaflet binds popup content via innerHTML in the browser; sanitize before binding |
| CORS null-origin fix (SEC-03) | API / Backend | — | CORS headers are set by the Hono middleware in the Cloudflare Worker |
| JWT audience validation (SEC-04) | API / Backend | — | Token verification is performed by `keycloak.ts` in the Worker |
| Keycloak audience mapper (SEC-04) | External service (Keycloak) | — | Configuration lives in `realm-export.json`; changes require realm re-import |
| Stale D1 binding removal (SEC-05) | API / Backend | — | `wrangler.toml` is the Worker deployment manifest |

**Out-of-scope (same files, different sites):** `frontend/src/modules/utils.ts:51` has `el.innerHTML = html;` — noted in CONTEXT.md as lower-risk, deferred. The planner must not include this file in the task list.

---

## Standard Stack

### Core (already installed, no additions needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.6.3 | Strict typing for dom.ts and file edits | Already enforced via `strict: true` |
| Leaflet | ^1.9.4 | Map popup binding | Already installed; `bindPopup(string)` accepts sanitized HTML strings |
| hono/cors | (bundled with Hono) | CORS middleware | Already in use; one-line fix |

### New Additions (SEC-02 only)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| dompurify | 3.4.1 | Sanitize HTML before Leaflet popup binding | Industry standard, zero dependencies, browser-native, ships own type defs |

**Version verification:** [VERIFIED: npm registry, 2026-04-26]
- `dompurify@3.4.1` — current, no deprecation warning
- `@types/dompurify@3.2.0` — **DEPRECATED** (see Assumptions Log A1)

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DOMPurify | sanitize-html | Not locked by user; sanitize-html is Node-centric, heavier; DOMPurify is the correct browser-side choice |
| textContent (dom.ts) | DOMPurify on all innerHTML | dom.ts textContent needs no sanitizer — cleaner; DOMPurify only where HTML structure is legitimately needed (popups) |

**Installation (SEC-02 only):**
```bash
cd frontend && npm install dompurify
```
Do NOT install `@types/dompurify` — it is deprecated; DOMPurify 3.x ships its own type definitions (`dist/purify.cjs.d.ts`). [VERIFIED: npm registry]

---

## Architecture Patterns

### System Architecture Diagram

```
User-controlled data (API response fields)
        │
        ▼
┌──────────────────────────────────────────────────────┐
│                  Frontend Page Modules               │
│                                                      │
│  dashboard.ts ──── trip.name, trip.description,      │
│                    trip.cover_image_url              │
│                         │                            │
│  tripDetail.ts ─── dest.city_name, day.label,        │
│                    activity.name, activity.notes,    │
│                    hotel.name, day.color              │
│                         │                            │
│  map.ts ────────── day.color, activity.name,         │
│                    day.label, hotel.name             │
│                         │                            │
│             [injection decision point]               │
│             ┌───────────┴──────────────┐             │
│             │                          │             │
│     Text/style content           HTML structure      │
│    (names, labels, colors)      (popup: links+SVGs)  │
│             │                          │             │
│       dom.ts helper              DOMPurify.sanitize  │
│    setText() / setStyle()              │             │
│    (textContent + style.             bindPopup()     │
│     setProperty — safe)           in tripDetail.ts   │
└──────────────────────────────────────────────────────┘

Backend Worker (Cloudflare)
┌─────────────────────────────────────────────┐
│  CORS middleware (cors.ts)                  │
│    origin=null → return null (not '*')      │
│                                             │
│  JWT middleware (keycloak.ts)               │
│    validAudiences = ['japan-trip-frontend'] │
│                                             │
│  wrangler.toml — [[d1_databases]] removed   │
└─────────────────────────────────────────────┘

Keycloak (external, Docker local / Railway prod)
┌──────────────────────────────────────────────┐
│  realm-export.json                           │
│    japan-trip-frontend client                │
│    + protocolMappers: oidc-audience-mapper   │
│      included.client.audience=japan-trip-    │
│      frontend                                │
└──────────────────────────────────────────────┘
```

### Recommended Project Structure

No structural changes needed beyond adding one file:

```
frontend/src/
├── modules/
│   ├── dom.ts          ← NEW (SEC-01)
│   ├── map.ts          ← EDIT (SEC-01)
│   ├── theme.ts
│   └── utils.ts        (NOT in scope — has innerHTML at :51, deferred)
├── pages/
│   ├── dashboard.ts    ← EDIT (SEC-01)
│   └── tripDetail.ts   ← EDIT (SEC-01 + SEC-02)
backend/src/
├── middleware/
│   └── cors.ts         ← EDIT (SEC-03)
├── auth/
│   └── keycloak.ts     ← EDIT (SEC-04)
backend/
└── wrangler.toml       ← EDIT (SEC-05)
keycloak/
└── realm-export.json   ← EDIT (SEC-04)
```

### Pattern 1: dom.ts setText / setStyle

**What:** Two named exports providing injection-safe DOM mutation.
**When to use:** Any site that previously used `el.innerHTML = someUserString` where the goal is plain text or a style value (not HTML structure).

```typescript
// frontend/src/modules/dom.ts
export function setText(el: Element, text: string): void {
  el.textContent = text;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(prop, value);
}
```

[VERIFIED: MDN — `textContent` is XSS-safe; `style.setProperty` is CSS-parser-sandboxed]

### Pattern 2: Converting a card render (dashboard.ts SEC-01 workload example)

`renderTripCard` in `dashboard.ts` currently builds a nested HTML string and assigns it via `grid.innerHTML = trips.map(t => renderTripCard(t)).join('')`. After the fix:

The function signature must change from returning a string to accepting a container and building DOM nodes imperatively, OR the grid population logic must switch to `document.createElement` per card. Example of the `trip.name` injection site:

```typescript
// BEFORE (dashboard.ts, inside renderTripCard string template):
<h3 class="trip-card-title">${trip.name}</h3>

// AFTER (imperative DOM, inside a create-and-append approach):
const h3 = document.createElement('h3');
h3.className = 'trip-card-title';
setText(h3, trip.name);
```

The full `renderTripCard` has 5 user-controlled string sites: `trip.name`, `trip.description`, `trip.cover_image_url` (style), the cover `style` attribute, and `trip.name` again in `aria-label`. The planner should budget for ~25-40 lines of DOM construction replacing each template function.

**Important:** `trip.cover_image_url` is a URL injected into a `style` attribute, not a text node. The correct fix is `setStyle(coverEl, 'background-image', url('${trip.cover_image_url}'))`. However, the CSS `url()` value is still attacker-controlled — the CSS parser isolates it but does not validate the URL. Since D-03 explicitly scopes this to `setStyle`, and the CSS parser prevents script injection (only CSS-based attacks like `expression()` are possible, and those are IE6-era), this is acceptable per the user's decision.

### Pattern 3: DOMPurify on popup strings (SEC-02)

```typescript
// At top of tripDetail.ts:
import DOMPurify from 'dompurify';

// Inside buildPopup and buildHotelPopup — sanitize the assembled HTML string:
function buildPopup(activity: Activity, day: Day, mapsUrl: string | null): string {
  let html = `...`; // existing template
  return DOMPurify.sanitize(html);
}
```

`bindPopup(string)` in Leaflet 1.9.4 sets the popup content via innerHTML inside a Leaflet-managed container. DOMPurify on the input string is the correct interception point. The `sanitize()` default returns a string — no `RETURN_DOM_FRAGMENT` option needed. [VERIFIED: Leaflet 1.9.4 source uses `this._contentNode.innerHTML`]

**Note:** `buildPopup`/`buildHotelPopup` also exist in `map.ts` (as `createPopupContent` / `createHotelPopup`). These use the same pattern — check whether they too need DOMPurify. D-04 says "only in `buildPopup` and `buildHotelPopup` in `tripDetail.ts`". The `map.ts` equivalents are called with `activity.name` and `day.label` which are user-controlled. The planner must decide whether `map.ts` popup strings require DOMPurify (D-04 as written restricts to `tripDetail.ts` — flag for confirmation).

### Pattern 4: Keycloak audience mapper JSON

Add to `clients[0].protocolMappers` (the `japan-trip-frontend` client entry) in `realm-export.json`:

```json
{
  "name": "audience-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-audience-mapper",
  "consentRequired": false,
  "config": {
    "included.client.audience": "japan-trip-frontend",
    "id.token.claim": "false",
    "access.token.claim": "true"
  }
}
```

[CITED: Keycloak community patterns, multiple realm-export.json examples — field names `included.client.audience`, `access.token.claim`, `protocolMapper: "oidc-audience-mapper"` are standard across Keycloak 18+]

**Required post-edit action:** After editing `realm-export.json`, the realm must be re-imported in the Keycloak admin console for the local Docker dev setup to reflect the mapper. This is a **manual step** that must appear in the plan.

### Pattern 5: CORS null-origin fix (SEC-03)

```typescript
// cors.ts line 17-18 — BEFORE:
if (!origin || allowed.includes(origin)) {
  return origin ?? '*';
}

// AFTER:
if (!origin || allowed.includes(origin)) {
  return origin ?? null;
}
```

Two changes for SEC-03:

1. `return origin ?? null` — when origin is null/absent, omit the header instead of returning `'*'`
2. Remove `credentials: true` from the cors() config — the frontend sends `Authorization: Bearer` headers only; there is no `credentials: 'include'` anywhere in `frontend/src/` [VERIFIED: grep]. Keeping `credentials: true` serves no purpose and was the root cause of the original spec violation.

The fixed config should omit the `credentials` key entirely (defaults to false).

### Anti-Patterns to Avoid

- **Sanitizing with DOMPurify on dom.ts paths:** `textContent` is already safe. Adding DOMPurify there wastes CPU and signals the reviewer that the architecture is not understood.
- **Replacing innerHTML with innerHTML:** Do not DOMPurify text-only content and re-assign to innerHTML. Use `textContent`.
- **Leaving `map.ts` popup functions unsanitized if they duplicate `tripDetail.ts` popup logic:** Both files have popup builders with user-controlled strings — the planner must address both or explicitly defer `map.ts` popups.
- **Adding `@types/dompurify` to package.json:** It is deprecated. DOMPurify 3.x has bundled types. Installing the stub will generate a deprecation warning without adding value.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML sanitization | Custom allowlist parser | DOMPurify 3.4.1 | Parsing HTML safely is a known-hard problem; DOMPurify is hardened against parser differentials |
| Safe DOM text setting | Custom escaping (`&amp;` etc.) | `el.textContent = value` | textContent never interprets as HTML — no escaping needed |
| Safe style injection | Custom CSS escaping | `el.style.setProperty(prop, value)` | Browser CSS parser sandboxes the value |
| CORS spec compliance | Manual header construction | Hono built-in cors() (already used) | Already in use; just fix the null return value |

**Key insight:** XSS mitigations look simple but have well-known bypass vectors. `textContent` + `style.setProperty` + DOMPurify covers all three cases without any hand-rolled logic.

---

## Common Pitfalls

### Pitfall 1: DOMPurify.sanitize removes SVG content
**What goes wrong:** The popup HTML templates in `buildPopup` / `buildHotelPopup` contain inline SVG elements (location pin icons). DOMPurify's default config strips SVG that contains `xlink:href`. The icons use `stroke` and `viewBox` only — no `xlink` — so default config should preserve them.
**Why it happens:** DOMPurify's `ALLOWED_TAGS` default includes `svg`, `path`, `circle` but does NOT include `use` (which requires `xlink:href`).
**How to avoid:** Use default config. Visually verify popup icons render after the change. If SVGs disappear, add `{ ALLOWED_TAGS: DOMPurify.ALLOWED_TAGS.concat(['svg','path','circle']) }` — but this should not be needed.
**Warning signs:** Popup shows text links but missing icon glyphs.

### Pitfall 2: Keycloak realm re-import required after JSON edit
**What goes wrong:** Developer edits `realm-export.json`, verifies code, but forgets to re-import the realm. Tokens continue to be issued without the `japan-trip-frontend` audience claim. The hardened `keycloak.ts` (accepting only `japan-trip-frontend`) then rejects all tokens. Every authenticated request returns 401.
**Why it happens:** `realm-export.json` is a source-of-truth file for Docker Compose setup but is NOT automatically re-applied to a running Keycloak instance.
**How to avoid:** Include a plan step for: Keycloak admin → Realm → Import → check "Skip if exists" OFF → import `realm-export.json`.
**Warning signs:** All authenticated API calls return 401 after the JWT audience change is deployed.

### Pitfall 3: `noUnusedLocals` breaks if DOM helper import is added without use
**What goes wrong:** TypeScript strict mode includes `noUnusedLocals: true`. If dom.ts is imported but `setText` or `setStyle` is not called in a given file, the build fails.
**Why it happens:** Compiler enforced, not optional.
**How to avoid:** Only import what is used. Each file's import line must match which dom.ts functions it calls.

### Pitfall 4: `renderTripCard` is a string-returning function used in `.join('')`
**What goes wrong:** `dashboard.ts:58` does `grid.innerHTML = trips.map(t => renderTripCard(t)).join('')`. If SEC-01 converts `renderTripCard` to an imperative DOM builder (returning void/HTMLElement), the call site must also change.
**Why it happens:** The locked dom.ts API (setText + setStyle only) means card rendering cannot stay as string templates — it must become a DOM construction function.
**How to avoid:** Change `renderTripCard(trip: ApiTrip): string` to `renderTripCard(trip: ApiTrip, container: HTMLElement): void`, or create elements and return `HTMLElement`. Update the `.join('')` + `innerHTML` call site to a `forEach` + `appendChild` loop.

### Pitfall 5: `map.ts` popup builders have the same XSS surface as `tripDetail.ts`
**What goes wrong:** D-04 scopes DOMPurify to `tripDetail.ts` only. But `map.ts` has `createPopupContent` (line 45) and `createHotelPopup` (line 56) that build the same HTML strings with user-controlled data and call `bindPopup()`. If SEC-02 is applied only to `tripDetail.ts`, `map.ts` popups remain unsanitized.
**Why it happens:** Both files mirror the same pattern; D-04 explicitly names only `tripDetail.ts`.
**How to avoid:** Planner should raise this with the user: apply DOMPurify to `map.ts` popup builders too, or explicitly defer. Do not implement only half of the surface.

---

## Code Examples

### dom.ts (complete, locked by D-02)
```typescript
// Source: D-02 locked decision
export function setText(el: Element, text: string): void {
  el.textContent = text;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(prop, value);
}
```

### keycloak.ts audience fix (SEC-04, line 193)
```typescript
// BEFORE:
const validAudiences = ['japan-trip-api', 'japan-trip-frontend', 'account'];

// AFTER (D-07):
const validAudiences = ['japan-trip-frontend'];
```

### cors.ts null-origin fix (SEC-03, line 18)
```typescript
// BEFORE:
return origin ?? '*';

// AFTER (D-06):
return origin ?? null;
```

### wrangler.toml SEC-05 — remove lines 13-18 entirely
```toml
# Remove this block (lines 13-18 in current file):
[[d1_databases]]
# Placeholder — actual database is Neon (PostgreSQL) via DATABASE_URL env var.
# Remove or replace this block if you add a D1 database in the future.
binding = "DB_PLACEHOLDER"
database_name = "placeholder"
database_id = "placeholder"
```

---

## Runtime State Inventory

> Greenfield edits only — no rename/migration. Skipped per instructions.

Not applicable. This phase modifies source files and config; it introduces no stored data, OS registrations, or artifact renames.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | DOMPurify install, frontend build | ✓ | (project enforces >=20) | — |
| Keycloak admin console | realm-export.json re-import (SEC-04) | Unknown — not testable from shell | — | Developer performs re-import manually |
| Docker Compose | Keycloak local instance | [ASSUMED] — not probed | — | Re-import step is manual regardless |

**Missing dependencies with no fallback:** None that block code changes. The Keycloak re-import is a runtime/ops step that cannot be automated in a plan task but must be documented.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@types/dompurify` is deprecated — do NOT install it; DOMPurify 3.x ships own types | Standard Stack, Anti-Patterns | Low — npm will warn and install a stub; types will still resolve but it signals confusion. [VERIFIED: npm registry stub message] |
| A2 | Keycloak audience mapper JSON field names (`included.client.audience`, `access.token.claim`, `protocolMapper: "oidc-audience-mapper"`) are stable across Keycloak 18-25 | Code Examples — Pattern 4 | Medium — if field names differ in the project's Keycloak version, the mapper silently fails and all tokens are rejected after JWT hardening. [CITED: community realm-export.json examples; not verified against this project's specific Keycloak version] |
| A3 | Leaflet 1.9.4 `bindPopup(string)` sets popup content via `innerHTML` — DOMPurify on the string input is the correct interception point | Architecture Patterns — Pattern 3 | Low — this is Leaflet's documented and long-standing behavior; changing it would be a major breaking change |
| A4 | Docker Compose local Keycloak is running during development and the developer knows how to re-import a realm | Common Pitfalls — Pitfall 2 | Medium — if not running or unfamiliar, the SEC-04 code change will break all auth until re-import is done |

---

## Open Questions

1. **PLAN BLOCKER: map.ts popup builders — D-04 vs. phase success criterion #2**
   - What we know: Phase success criterion #2 is "Leaflet popups pass all HTML through DOMPurify before binding." `map.ts` has `createPopupContent` (line 45) and `createHotelPopup` (line 56) that call `bindPopup()` with user-controlled HTML strings (`activity.name`, `activity.notes`, `day.label`, `hotel.name`). These functions are NOT covered by D-04, which restricts DOMPurify to `tripDetail.ts` only.
   - What's blocked: If D-04 is followed literally, success criterion #2 cannot pass verification — `map.ts` popups remain unsanitized. The plan cannot proceed without resolution.
   - Resolution options: (a) Expand D-04 to also cover `map.ts` popup builders — same one-line sanitize pattern, minimal extra work. (b) Revise success criterion #2 to explicitly exclude `map.ts`. Option (a) is recommended; it closes the XSS surface completely with negligible added scope.

2. **RESOLVED: SEC-03 `credentials: true`**
   - Status: RESOLVED — REQUIREMENTS.md is correct. The frontend uses `Authorization: Bearer` headers only. Grep of `frontend/src/` confirms zero occurrences of `credentials: 'include'`. `credentials: true` in the backend cors config is dead code. The SEC-03 fix must include both: (1) null-origin returns `null`, and (2) remove `credentials: true`. [VERIFIED: codebase grep 2026-04-26]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && npm run test:run` |
| Full suite command | `cd frontend && npm run test:coverage` |
| Backend test command | `cd backend && npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | `dom.ts` `setText` sets `textContent`, `setStyle` calls `style.setProperty` | unit | `cd frontend && npm run test:run -- --reporter=verbose` | ❌ Wave 0 |
| SEC-02 | DOMPurify called in popup builder functions; sanitized output bound to `bindPopup` | unit (light) | `cd frontend && npm run test:run` | ❌ Wave 0 |
| SEC-03 | CORS middleware returns `null` (not `'*'`) when origin is null | unit (backend) | `cd backend && npm test` | ❌ Wave 0 |
| SEC-04 | Audience check in `verifyJwt` rejects `account`; accepts `japan-trip-frontend` | integration-unit (requires mocking `getKeycloakJwks` or extracting pure helper — see Wave 0 note) | `cd backend && npm test` | ❌ Wave 0 |
| SEC-05 | `wrangler.toml` contains no `[[d1_databases]]` block | static check / grep | `grep -c 'd1_databases' backend/wrangler.toml` (expect 0) | n/a — file edit |

### Sampling Rate
- **Per task commit:** `cd frontend && npm run test:run` (< 5s) AND `cd backend && npm test` (< 10s)
- **Per wave merge:** Full coverage run: `cd frontend && npm run test:coverage`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `frontend/tests/dom.test.ts` — covers SEC-01: setText, setStyle behavior
- [ ] `backend/src/middleware/cors.test.ts` — covers SEC-03: null origin returns null
- [ ] `backend/src/auth/keycloak.test.ts` — covers SEC-04: audience validation. NOTE: `verifyJwt` is monolithic (JWKS fetch + expiry + issuer + audience + signature in one call). Testing audience logic in isolation requires either (a) extracting audience check to a pure helper — testable without JWKS mock — or (b) a full integration test with a signed JWT fixture. Option (a) is a small refactor that should be part of the SEC-04 task, not a separate plan item.

*(Existing `backend/src/index.test.ts` tests auth at the route level — 401 for missing header — but does not test audience claim logic specifically.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (partial) | JWT audience hardening — `keycloak.ts` |
| V3 Session Management | no | No session cookies; bearer token auth |
| V4 Access Control | no | Not in scope for this phase |
| V5 Input Validation | yes | All user-controlled strings sanitized before DOM insertion |
| V6 Cryptography | no | JWT crypto already uses RS256; no changes |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored XSS via trip name / description | Tampering | `textContent` via dom.ts (no HTML interpretation) |
| Reflected XSS via URL params rendered to DOM | Tampering | `textContent` via dom.ts |
| HTML injection via Leaflet popup | Tampering | DOMPurify before `bindPopup()` |
| CSS injection via `cover_image_url` or `day.color` | Tampering | `style.setProperty` (CSS parser sandboxes values) |
| CORS credential bypass (null origin → `*`) | Elevation of Privilege | Return `null` for null origin |
| JWT audience confusion (accept `account` token) | Spoofing | Restrict `validAudiences` to `['japan-trip-frontend']` |
| Stale D1 binding exposing unexpected binding in Worker | Tampering | Remove `[[d1_databases]]` block |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: npm registry `npm view dompurify`] — version 3.4.1, current, ships own types in `dist/purify.cjs.d.ts`
- [VERIFIED: npm registry `npm view @types/dompurify`] — deprecated stub, do not install
- Codebase direct reads: `cors.ts`, `keycloak.ts`, `wrangler.toml`, `tripDetail.ts`, `dashboard.ts`, `map.ts`, `realm-export.json`, `frontend/package.json`, `vitest.config.ts`, `index.test.ts`

### Secondary (MEDIUM confidence)
- [CITED: Keycloak community realm-export.json examples] — protocolMapper field names for `oidc-audience-mapper`
- [CITED: MDN — `Element.textContent`] — confirmed XSS-safe (no HTML interpretation)
- [CITED: MDN — `CSSStyleDeclaration.setProperty()`] — CSS parser sandboxes injected values

### Tertiary (LOW confidence)
- None — all claims verified against codebase or official sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm registry
- Architecture (injection sites): HIGH — confirmed by reading source files directly
- Keycloak mapper JSON format: MEDIUM — standard pattern, not verified against this project's exact Keycloak version
- Pitfalls: HIGH — derived from actual code patterns observed in the three target files

**Research date:** 2026-04-26
**Valid until:** 2026-05-26 (stable stack; DOMPurify version changes within 3.x are non-breaking)
