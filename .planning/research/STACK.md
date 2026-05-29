# Stack Research

**Project:** TravelMap (PruebaMapJapan)
**Researched:** 2026-04-26 (v1.0) | Updated 2026-05-15 (v2.0)
**Note:** Version numbers verified via `npm show` against the live registry. Keycloak Account REST API usage verified against codebase. All DOMPurify findings HIGH confidence (npm registry + codebase-verified). WebSearch was unavailable; supplemental web claims are flagged.

---

## Existing Decisions (not to revisit)

| Layer | Technology | Version pinned |
|-------|-----------|----------------|
| Frontend | Vanilla TypeScript + Vite + Web Components | Vite 5.x, no framework |
| Backend | Hono on Cloudflare Workers | Hono 4.6 |
| Local dev server | @hono/node-server | matches Hono version |
| DB ORM | Drizzle ORM | current |
| DB (prod) | Neon PostgreSQL — serverless HTTP driver | @neondatabase/serverless |
| DB (local) | node-postgres (pg) via Pool | pg |
| Auth | Keycloak 26.6.1 with OIDC/PKCE + RS256 + WebAuthn | keycloak-js ^26.0.0 |
| Maps | Leaflet | 1.9 |
| Frontend deploy | GitHub Pages | — |
| Backend deploy | Cloudflare Workers (free tier) | — |
| Auth deploy | Railway hobby | — |
| DB deploy | Neon (free tier) | — |

---

## v1.0 Milestone: New Library Additions

### 1. DOMPurify — XSS Sanitization

**Add to:** `frontend/` (runtime dependency)

```bash
npm install dompurify@3.4.1
npm install -D @types/dompurify@3.2.0
```

**Why 3.x:** DOMPurify 3.x ships its own TypeScript types in `dist/purify.es.d.mts` (verified via `npm show dompurify@3.4.1`). The `@types/dompurify` package is a separate DefinitelyTyped mirror — pin `3.2.0` to match the `3.x` API. If both are installed, `dompurify`'s own types take precedence for the ESM path; `@types/dompurify` is a fallback safety net.

**Why it's needed:** `tripDetail.ts`, `dashboard.ts`, `profile.ts`, `map.ts`, `widgets.ts`, and `SearchBar.ts` all use `innerHTML` with user-controlled strings interpolated directly into templates — e.g., `trip.name`, `activity.name`, `hotel.name`, `day.label`. These values come from the Neon DB via the API and are set by the logged-in user during trip creation. An attacker could store `<script>` or `<img onerror=...>` payloads in any name/label field and have them execute for any viewer of that trip.

**Usage pattern for Vanilla TS (no SSR, browser-only):**

```typescript
import DOMPurify from 'dompurify';

// Sanitize before any innerHTML assignment
element.innerHTML = DOMPurify.sanitize(userString);

// For plain text that NEVER needs HTML — prefer textContent (no DOMPurify needed)
element.textContent = userString;
```

**Key decision: textContent vs DOMPurify.sanitize:**

Most `innerHTML` usages in the codebase mix user strings with hard-coded HTML structure. Two strategies:

1. **Pure text values** (`trip.name`, `dest.city_name`, `activity.name`, `hotel.name`, `day.label`): these should always be rendered as text, never as HTML. Use `textContent` or `createTextNode` where possible. Only use DOMPurify when you need the surrounding HTML structure to stay as `innerHTML`.

2. **Templates with user values interpolated**: sanitize the full string or extract the user parts, set them via `textContent` on child nodes, then assemble via DOM methods.

The simplest correct path for the trip builder: wrap any final `innerHTML` assignment that includes user data with `DOMPurify.sanitize(...)`. This is single-call, low-risk, and doesn't require rewriting template assembly logic.

**DOMPurify config for this app (no need for custom config):**

Default config strips all JS event handlers and script elements. No FORCE_BODY or ALLOWED_TAGS customization needed — the app only renders user-provided strings (names, labels, notes), not user-authored HTML.

**Confidence:** HIGH (version from npm registry; usage from codebase analysis).

---

### 2. No new library needed — Trip Builder UI

**The trip builder edit page is a form-heavy UI.** All data operations (CRUD) already have:
- A complete API client in `frontend/src/api/client.ts` — all endpoints exist
- TypeScript types in `frontend/src/types/index.ts` — `ApiTrip`, `ApiDestination`, `ApiDay`, `ApiActivity`, `ApiHotel`
- Hono + Zod validation schemas on the backend

**What's needed is a new HTML entry point + TS page module, not a new library.**

Add to `vite.config.ts` rollupOptions.input:
```typescript
edit: resolve(__dirname, 'edit.html'),
```

The page follows the same MPA pattern as `dashboard.ts` and `tripDetail.ts`:
- `edit.html` + `frontend/src/pages/edit.ts`
- Auth guard via `initKeycloak()` (same as profile.ts)
- DOM manipulation via standard Web APIs — no form library needed
- Leaflet reused from the existing chunk split for the map picker (click-to-set-coordinates for destinations and activities)

**What NOT to add for the trip builder:**

| Library | Why not |
|---------|---------|
| React / Vue / Svelte | Stack is locked to Vanilla TS; adds 40-100KB bundle; overkill for a form page |
| SortableJS / drag-and-drop library | Reordering activities is a `order_index` PATCH — a simple up/down button pair is sufficient for v1; saves a dependency |
| Flatpickr or similar date picker | `<input type="date">` is supported in all target browsers (Chrome, Firefox, Safari, Edge); native datepicker is sufficient for v1 |
| Alpine.js or htmx | Stack is locked Vanilla TS; these would add a second paradigm to a codebase already using Web Components |
| Zod on frontend | Validation is enforced server-side; frontend can use HTML5 `required`/`pattern` for UX; adding Zod front-end would duplicate backend logic without benefit for v1 |

**Coordinate input for destinations and activities:** Use Leaflet click-to-pick. The user clicks on a map, and the `lat`/`lng` inputs update. Leaflet is already bundled as a manual chunk. No geocoding library needed for v1 — users paste coordinates or click the map.

**Confidence:** HIGH (derived from existing codebase structure and API completeness).

---

### 3. No new library needed — CORS Fix

The CORS fix is a configuration change, not a new library. The existing `hono/cors` middleware is already in use (`backend/src/middleware/cors.ts`). The fix is to tighten the `origin` callback.

**Current bug:** When `origin` is unrecognized, the callback returns `null` (correct). But when called from a browser without an Origin header (same-origin request or curl), it returns `'*'`. The Hono cors middleware will set `Access-Control-Allow-Origin: *` on those responses. For credentialed cross-origin requests, the origin callback returns the specific allowed origin string — this is actually correct behavior. The spec-invalid combination (`*` + `credentials`) only occurs when `origin` is set to `'*'` as a string, not when the callback returns the request origin. **The current cors.ts is already correct** — it returns the specific origin string, not `'*'`, for requests from allowed origins.

The actual remaining fix: add `http://localhost:5173` to the allowed origins list if it's not already there for local dev (currently it is). For production, `KEYCLOAK_URL` and CORS origin should come from environment variables, not be hardcoded. No new library needed.

**Confidence:** HIGH (code-derived from `backend/src/middleware/cors.ts`).

---

### 4. No new library needed — JWT Audience Validation

The JWT audience validation is already implemented in `backend/src/auth/keycloak.ts` (lines 192-199). It validates against `['japan-trip-api', 'japan-trip-frontend', 'account']`. The hardening task is to:

1. Remove `'account'` from `validAudiences` — the `account` audience is issued by Keycloak's own Account Service tokens, not by API tokens. Accepting it means any token issued for the Keycloak Account UI can be used against the API. The API should only accept tokens with `aud: 'japan-trip-api'`.

2. Configure the Keycloak `japan-trip-api` client to add an audience mapper that includes `japan-trip-api` in the `aud` claim of access tokens issued via `japan-trip-frontend`. Without this mapper, access tokens issued to `japan-trip-frontend` may only have `aud: ['account']` by default.

This is a Keycloak realm configuration change (add Audience mapper to `japan-trip-api` client) + a one-line code change in `auth/keycloak.ts`. No new library.

**Confidence:** HIGH (code-derived; Keycloak audience mapper behavior is stable across versions).

---

### 5. No new library needed — Passkeys/WebAuthn via Keycloak Account REST API

The passkey management UI in `profile.ts` is already functionally implemented:
- `loadPasskeys()` calls `GET /realms/{realm}/account/credentials?type=webauthn` — correct Keycloak 25 endpoint
- `registerPasskey()` calls `keycloak.login({ action: 'webauthn-register' })` — correct Keycloak 25 pattern

**No WebAuthn library (SimpleWebAuthn, fido2-lib, etc.) is needed.** The Keycloak Account REST API abstracts the entire WebAuthn ceremony. The frontend never calls `navigator.credentials.create()` or `navigator.credentials.get()` directly — Keycloak handles that in its own UI flow via the login redirect.

**What the v1.0 work actually requires:**

1. Fix the credential type filter in `profile.ts` to include `'webauthn-passwordless'` (code fix, no library)
2. Add delete passkey functionality — `DELETE /realms/{realm}/account/credentials/{id}` using the existing `keycloak.token` pattern (code addition, no library)
3. Configure the Keycloak realm: set `webAuthnPolicyPasswordlessRpId` to the production domain (realm config, not code)
4. Set `browserFlow` to `'browser-passkey'` in the Keycloak admin UI for production (realm config, not code)

**What NOT to add:**

| Library | Why not |
|---------|---------|
| `@simplewebauthn/browser` | The app delegates WebAuthn to Keycloak's UI flow. Adding SimpleWebAuthn would bypass Keycloak and require a custom ceremony/server-side verification implementation — far more work for no benefit |
| `@simplewebauthn/server` | Same reason; also only relevant if running own WebAuthn server, not applicable with Keycloak |
| Any other FIDO2/WebAuthn library | Keycloak 25 already handles the full passkey lifecycle; adding a client library would create parallel, conflicting auth paths |

**Confidence:** HIGH (derived from profile.ts implementation + Keycloak 25 Account REST API pattern).

---

### 6. No new library needed — Public Trip Sharing UI

The backend already has `GET /api/public/trips/:id` (unauthenticated) and `is_public: boolean` on the `ApiTrip` type. The toggle is a PATCH to `updateTrip(tripId, { is_public: !trip.is_public })` using the existing `client.ts` function.

The shareable link is `window.location.origin + '/PruebaMapJapan/trip.html?tripId=' + trip.id`. The "copy link" button uses `navigator.clipboard.writeText()` — Web API, no library needed.

**What NOT to add:** No URL shortening service (adds external dependency, complexity); no QR code library (overkill for v1).

**Confidence:** HIGH (all pieces already exist in codebase).

---

## Complete v1.0 Frontend Installation Delta

```bash
# In frontend/ — only one new runtime dep
npm install dompurify@3.4.1
npm install -D @types/dompurify@3.2.0
```

No backend dependencies change. No new infrastructure. No new Cloudflare bindings.

---

## What NOT to Add (Master List for v1.0)

| Package | Why not |
|---------|---------|
| React / Vue / Svelte | Stack locked to Vanilla TS |
| `@simplewebauthn/browser` | Keycloak handles WebAuthn ceremony; adding this creates conflicting auth paths |
| SortableJS | Up/down reorder buttons sufficient for v1; saves dependency |
| Flatpickr / date-fns | Native `<input type="date">` sufficient; date-fns is large (~200KB) for minimal gain |
| Zod (frontend) | Backend validates; HTML5 constraint validation sufficient for UX |
| Alpine.js / htmx | Adds a second paradigm alongside existing Web Components |
| `isomorphic-dompurify` | SSR wrapper — this app is browser-only; plain `dompurify` is correct |
| `sanitize-html` | Node-centric; larger than DOMPurify; no TypeScript types built in |
| Any URL shortener SDK | External dependency, not needed for trip sharing |
| Geocoding library (Nominatim client, etc.) | Click-to-pick on Leaflet map is sufficient; avoids rate-limit concerns on third-party geocoding APIs |

---

## Integration Points Summary

| Feature | Library delta | Config change | Code change |
|---------|--------------|---------------|-------------|
| Trip builder edit page | None | Add `edit` entry to `vite.config.ts` rollupOptions | New `edit.html` + `frontend/src/pages/edit.ts` |
| XSS hardening | `dompurify@3.4.1` + `@types/dompurify@3.2.0` | None | Wrap `innerHTML` assignments with `DOMPurify.sanitize()` in `tripDetail.ts`, `dashboard.ts`, `map.ts`, `widgets.ts`, `SearchBar.ts` |
| CORS fix | None | None | Remove `account` from `corsMiddleware` if present; confirm origin list matches production URL |
| JWT audience tightening | None | Keycloak: add Audience mapper to `japan-trip-api` client | Remove `'account'` from `validAudiences` array in `auth/keycloak.ts` |
| Passkeys functional | None | Keycloak realm: set RP ID, set `browserFlow`, wire required actions | Fix credential type filter; add delete passkey button |
| Public trip sharing | None | None | Add toggle button to trip detail/dashboard; copy-link using `navigator.clipboard` |

---

## Confidence Levels (v1.0)

| Topic | Confidence | Reason |
|-------|------------|--------|
| DOMPurify version (3.4.1) | HIGH | Verified via `npm show dompurify dist-tags` |
| `@types/dompurify` version (3.2.0) | HIGH | Verified via `npm show @types/dompurify version` |
| DOMPurify ESM compatibility with Vite 5 | HIGH | Package ships `dist/purify.es.mjs` as `module` field; Vite picks it up automatically |
| XSS surface (innerHTML with user data) | HIGH | Derived from full grep of codebase |
| No new library for trip builder | HIGH | API client and types are complete; MPA pattern is established |
| CORS fix is config-only | HIGH | Derived from `cors.ts` implementation |
| JWT audience fix is code-only | HIGH | Derived from `auth/keycloak.ts` lines 192-199 |
| Passkeys use Keycloak Account REST API (no WebAuthn library) | HIGH | Derived from `profile.ts` implementation |
| Public sharing uses existing API + clipboard | HIGH | `getPublicTrip()` and `is_public` field already exist |
| Keycloak Audience mapper behavior | MEDIUM | Training knowledge, not live-verified; but behavior is stable across Keycloak versions |

---

---

# Stack Research — v2.0 Auth Infrastructure & Hardening

**Researched:** 2026-05-15
**Confidence:** HIGH (all critical items verified against official sources, GitHub releases, and current npm registry)

---

## New Dependencies (v2.0)

### npm — backend (`backend/`)

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `resend` | `^6.0.0` | Email OTP delivery via HTTP API from Workers | Uses `fetch()` internally; no SMTP socket needed. Official CF tutorial + GitHub example exist. Current latest: `6.12.3` (verified via `npm show resend version`). |

No other backend npm changes. `@hono/zod-validator`, `hono`, `zod` already present.

### npm — tests (`tests/`)

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@playwright/test` | `^1.60.0` | Upgrade from `^1.48.0` for Virtual Authenticator API stability and `addInitScript` bug fixes | Current latest: `1.60.0` (published ~May 2026). Also run `npx playwright install` after upgrade to sync browser binaries. |

### npm — frontend (`frontend/`)

No new dependencies. `keycloak-js ^26.0.0` already matches KC `26.6.1` in Docker.

---

## Terraform Providers

### Keycloak: `keycloak/keycloak`

| Field | Value |
|-------|-------|
| Registry source | `keycloak/keycloak` |
| Current stable | `5.7.0` (released 2026-02-20) |
| Recommended pin | `>= 5.7.0, < 6.0.0` |
| KC 26 support | YES — v5.x explicitly targets KC 24/26 |
| Status | Actively maintained — official Keycloak org took ownership from `mrparkers` with v5.0 release (Jan 2025) |

Do NOT use `mrparkers/keycloak`. The mrparkers namespace still exists on the Terraform Registry but is no longer receiving updates. All active development is under `keycloak/keycloak`.

```hcl
terraform {
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = ">= 5.7.0, < 6.0.0"
    }
  }
}

provider "keycloak" {
  client_id = "admin-cli"
  username  = var.keycloak_admin_user
  password  = var.keycloak_admin_password
  url       = var.keycloak_url
}
```

Key resources for this milestone:
- `keycloak_realm` — realm settings, WebAuthn passwordless policy, OTP policy, session timeouts
- `keycloak_openid_client` — travel-app PKCE client config
- `keycloak_required_action` — enable `webauthn-register-passwordless`
- `keycloak_authentication_flow` + `keycloak_authentication_subflow` + `keycloak_authentication_execution` — passkey-first browser flow
- `keycloak_realm_user_profile` — make email optional (passkey-only accounts have no email)
- `keycloak_openid_client_default_scopes` — scope binding

### Cloudflare: `cloudflare/cloudflare`

| Field | Value |
|-------|-------|
| Registry source | `cloudflare/cloudflare` |
| Current stable | `5.19.1` (published 2026-04-30) |
| Recommended pin | `~> 5.19` |
| Status | GA since Feb 2025; auto-generated from OpenAPI. Major breaking changes from v4. |

Start new Terraform configs at v5.19 directly — do not start at v5.0 and upgrade, as state-breaking changes accumulated across v5.x minor releases (v5.16→5.17 required an intermediate step).

Resources relevant to this milestone:
- `cloudflare_worker_secret` — manage `RESEND_API_KEY` and `DATABASE_URL` as Worker secrets (v5-only resource)
- `cloudflare_worker_script` — optional; prefer `wrangler deploy` for code, use TF only for config/secrets
- `cloudflare_pages_project` — NOT needed; frontend stays on GitHub Pages

```hcl
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
```

### Neon: `kislerdm/neon`

| Field | Value |
|-------|-------|
| Registry source | `kislerdm/neon` |
| Current stable | `0.9.0` (released 2025-02-25) |
| Recommended pin | `>= 0.9.0, < 1.0.0` |
| Status | Community-maintained (NOT officially by Neon), but linked from Neon's own docs at `neon.com/docs/reference/terraform` |

Use for: `neon_project`, `neon_database`, `neon_role`, `neon_branch`. Do not expose Neon connection strings via Terraform outputs — pass them directly as wrangler secrets.

### Terraform version requirement

```hcl
terraform {
  required_version = ">= 1.9.0, < 2.0.0"
}
```

Note: `kislerdm/neon 0.9.0` changelog mentions Go 1.23.6 dependency update but does not impose a specific Terraform version constraint beyond `>= 1.0.0`. `keycloak/keycloak 5.7.0` and `cloudflare/cloudflare 5.19.x` both work with Terraform 1.9+.

### State Backend: HCP Terraform (Terraform Cloud)

HCP Terraform free tier is available and covers this project's scale (~15-20 managed resources).

- Legacy Free plan EOL'd on **2026-03-31** (already past); the enhanced Free tier is now the only Free option: 500 managed resources, unlimited workspaces, 1 concurrent run — sufficient for this project
- Alternative: Terraform S3 backend against a Cloudflare R2 bucket (S3-compatible, free tier, no HashiCorp dependency)

```hcl
terraform {
  cloud {
    organization = "<your-org>"
    workspaces {
      name = "prueba-map-japan-prod"
    }
  }
}
```

---

## Email for Cloudflare Workers

**Use Resend. No other option meets all constraints.**

Workers run in V8 isolates with no TCP socket support. SMTP is impossible at the protocol level. All email must use `fetch()` over HTTPS.

Cloudflare's MailChannels Workers integration was discontinued in mid-2024. There is no free Cloudflare-native email option.

| Option | Workers-compatible | Free tier | Verdict |
|--------|-------------------|-----------|---------|
| **Resend** | YES — SDK uses `fetch()` | 3,000 emails/month | **Use this** |
| SendGrid HTTP API | YES — `fetch()` to API | 100/day | Viable fallback if Resend is unavailable |
| MailChannels | NO — discontinued | — | Do not use |
| nodemailer / SMTP | NO — TCP socket required | — | Impossible in Workers |

**Integration in Hono worker (`backend/src/routes/otp.ts`):**

```typescript
import { Resend } from 'resend';

// Env type addition in backend/src/index.ts:
// RESEND_API_KEY: string;
// ENVIRONMENT: string;

export function sendOtpEmail(env: Env, to: string, code: string) {
  const resend = new Resend(env.RESEND_API_KEY);
  return resend.emails.send({
    from: 'noreply@yourdomain.com',
    to,
    subject: 'Your login code',
    html: `<p>Your code: <strong>${code}</strong>. Expires in 10 minutes.</p>`,
  });
}
```

**wrangler.toml additions:**

```toml
[vars]
ENVIRONMENT = "development"

# Secrets — set via: wrangler secret put RESEND_API_KEY
# RESEND_API_KEY is NOT in [vars]; it's a secret
```

**Local dev**: The Hono `dev.ts` uses `@hono/node-server` (already in devDeps). In `ENVIRONMENT=development`, bypass Resend and send SMTP to Mailpit using `nodemailer` (Node.js can open TCP sockets). Switch transport via env var check. This keeps the Workers production path clean while allowing full email inspection locally.

---

## KC Theme Extensions

Current state in `keycloak/themes/japan-trip/login/`:
- `theme.properties` — parent=keycloak, styles=css/login.css
- `resources/css/login.css`

No FreeMarker templates or message bundles exist yet.

### What to add

```
keycloak/themes/japan-trip/login/
  theme.properties          # MODIFY: add scripts= line
  resources/
    css/
      login.css             # existing — no change
    js/
      passkey-hint.js       # NEW: client-side passkey availability check
  messages/
    messages_es.properties  # NEW: Spanish string overrides
  login.ftl                 # NEW: override login page layout for OTP/passkey UX
  login-otp.ftl             # NEW: override OTP entry page
  error.ftl                 # NEW: friendlier error messages
```

### theme.properties update

```properties
parent=keycloak
import=common/keycloak

styles=css/login.css
scripts=js/passkey-hint.js
kcHtmlClass=login-pf
kcBodyClass=login-pf-background
```

The `scripts=` property in `theme.properties` injects the JS file into **every page** in the theme type (login). It is global to the theme type, not per-template. To inject JS only on a specific page (e.g., only on the passkey prompt), use a `<#if>` conditional inside the specific `.ftl` template:

```freemarker
<#-- Inside login.ftl, section="scripts" -->
<#if section = "scripts">
  <script src="${url.resourcesPath}/js/passkey-hint.js" type="text/javascript"></script>
</#if>
```

### FreeMarker template structure (KC 26)

KC 26 login templates follow a two-layer pattern. Only override what you need:

1. `template.ftl` — base layout. Do NOT copy unless structural HTML changes are needed. The parent theme's `template.ftl` fills `<#nested>` blocks from child pages.
2. Individual page `.ftl` files import and call `template.ftl` via `<@layout.registrationLayout>`.

**Minimal page override pattern:**

```freemarker
<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password')
                             displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??>
  <#if section = "header">
    ${msg("loginAccountTitle")}
  <#elseif section = "form">
    <form id="kc-form-login" action="${url.loginAction}" method="post">
      <!-- custom passkey + OTP layout -->
    </form>
  <#elseif section = "scripts">
    <script src="${url.resourcesPath}/js/passkey-hint.js" type="text/javascript"></script>
  </#if>
</@layout.registrationLayout>
```

Available context variables in KC 26 login templates:
- `realm`, `url`, `locale`, `auth`, `registrationDisabled`, `messagesPerField`, `login`
- `msg("key")` — message bundle lookup (uses `messages_<locale>.properties`)
- `properties` — theme.properties values

### messages_es.properties

File: `keycloak/themes/japan-trip/login/messages/messages_es.properties`

KC 24+ handles UTF-8 natively in theme `.properties` files — use raw UTF-8 characters directly.

Key overrides for this milestone:

```properties
# OTP flow
loginOtpTitle=Introduce tu código
loginOtpOneTime=Código de un uso
loginTotpCode=Código de verificación

# Passkey / WebAuthn flow
passkey-unsupported-browser-text=Tu navegador no admite llaves de acceso.
webauthn-login-title=Iniciar sesión con llave de acceso
webauthn-registration-title=Registrar llave de acceso
webauthn-error-auth-verification=No se pudo verificar la llave de acceso.

# Error page
errorTitle=Error de autenticación
backToApplication=Volver a la aplicación
```

### No Java SPIs

All KC customization in this milestone via:
- FreeMarker `.ftl` templates (file overrides in mounted `themes/` volume)
- Message bundles (`messages_*.properties`)
- `theme.properties`
- KC 26 built-in flows + `keycloak/keycloak` Terraform provider for realm config

Do NOT add: Keycloak SPI JARs, custom authenticator Java classes, custom KC REST endpoints, KC extension providers, Maven builds of theme JARs.

---

## Playwright Auth Pattern

### Current state

`tests/e2e/auth.spec.ts` mocks all KC endpoints with `page.route('**/realms/**', ...)`. No real auth happens. `@playwright/test` is pinned at `^1.48.0` — needs upgrade to `^1.60.0`.

### The sessionStorage problem

`keycloak-js` stores tokens in `sessionStorage` (confirmed by `auth.spec.ts` usage of `sessionStorage.setItem('kc_token', ...)`).

Playwright's `context.storageState()` captures cookies and `localStorage` only. It does NOT capture `sessionStorage`. This is a confirmed limitation — open feature request on the Playwright repo (issue #31108) with no resolution in 1.60.0.

### Pattern 1: initScript workaround (recommended)

Perform a real login once per worker, serialize sessionStorage manually, restore it in each test context via `addInitScript`:

```typescript
// tests/e2e/fixtures/auth.ts
import { test as base, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_FILE = path.join(__dirname, '.kc-session.json');

export const test = base.extend<{ authedContext: BrowserContext }>({
  authedContext: [async ({ browser }, use) => {
    if (!fs.existsSync(SESSION_FILE)) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(process.env.FRONTEND_URL + '/dashboard.html');
      // KC redirect fires — fill login form
      await page.fill('#username', process.env.TEST_KC_USER!);
      await page.fill('#password', process.env.TEST_KC_PASSWORD!);
      await page.click('#kc-login');
      await page.waitForURL('**/dashboard.html**', { timeout: 15000 });
      const data = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
      fs.writeFileSync(SESSION_FILE, data);
      await ctx.close();
    }
    const sessionData = fs.readFileSync(SESSION_FILE, 'utf-8');
    const ctx = await browser.newContext();
    await ctx.addInitScript((data: string) => {
      const items = JSON.parse(data) as Record<string, string>;
      for (const [k, v] of Object.entries(items)) sessionStorage.setItem(k, v);
    }, sessionData);
    await use(ctx);
    await ctx.close();
  }, { scope: 'worker' }],
});
```

KC tokens expire (default session max). The `SESSION_FILE` must be regenerated in CI per run. Add to `.gitignore`. Set `TEST_KC_USER` and `TEST_KC_PASSWORD` as CI secrets.

### Pattern 2: KC cookie-based auth (cleaner, requires realm config)

Configure KC realm `SSO Session Max` to a long value and ensure `checkLoginIframe: false` in keycloak-js config. KC sets a `KEYCLOAK_SESSION` cookie that IS captured by `storageState`. This is the recommended path if you have control over KC realm settings — it removes the sessionStorage workaround entirely.

### Virtual Authenticator API (passkey tests)

The CDP Virtual Authenticator API is **Chromium-only**. Firefox and WebKit do not expose CDP WebAuthn APIs.

Add a dedicated Playwright project in `playwright.config.ts` scoped to the passkey spec file and Chrome only. Do not add passkey tests to the existing multi-browser projects:

```typescript
// In playwright.config.ts, add to projects array:
{
  name: 'chromium-passkeys',
  use: { ...devices['Desktop Chrome'] },
  testMatch: '**/passkeys.spec.ts',
},
```

CDP virtual authenticator usage in test:

```typescript
import { CDPSession } from '@playwright/test';

test('register passkey', async ({ page, context }) => {
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });

  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // trigger passkey registration on page, then:
  await cdp.send('WebAuthn.disable');
});
```

### Mailpit API integration for OTP tests

After triggering an OTP email in a test, read the code from Mailpit's REST API:

```typescript
async function getLatestOtp(to: string): Promise<string> {
  const res = await fetch('http://localhost:8025/api/v1/messages?limit=1');
  const { messages } = await res.json();
  const code = messages[0]?.Snippet?.match(/\d{6}/)?.[0];
  if (!code) throw new Error('OTP not found in Mailpit');
  return code;
}
```

---

## Local SMTP: Mailpit (not MailHog)

The milestone brief says "MailHog" — use **Mailpit** instead. MailHog has had no releases since 2020 and is effectively abandoned. Mailpit is the maintained drop-in replacement with identical default ports.

| | MailHog | Mailpit |
|---|---|---|
| Last release | 2020 (abandoned) | v1.29.7 (2026-04-16) |
| Docker image | `mailhog/mailhog` | `axllent/mailpit` |
| SMTP port default | 1025 | 1025 |
| Web UI port default | 8025 | 8025 |
| REST API | Basic | Full (supports message search, delete, attachments) |
| TLS SMTP | No | Yes |
| Migration effort | — | One-line image swap |

**docker-compose.yml addition:**

```yaml
  mailpit:
    image: axllent/mailpit:v1.29
    ports:
      - "1025:1025"   # SMTP (for local @hono/node-server dev)
      - "8025:8025"   # Web UI + REST API
    environment:
      MP_MAX_MESSAGES: 500
    restart: unless-stopped
```

Use `axllent/mailpit:v1.29` (minor version pin) rather than `:latest` for reproducibility in CI.

---

## What NOT to Add (v2.0)

| Item | Why excluded |
|------|--------------|
| `mrparkers/keycloak` Terraform provider | Archived; replaced by `keycloak/keycloak` org-maintained provider (v5.7.0) |
| Cloudflare Terraform provider v4 | Do not start new infra on v4; v5 is GA since Feb 2025 |
| `mailhog/mailhog` Docker image | Unmaintained since 2020; use `axllent/mailpit:v1.29` |
| Cloudflare MailChannels Workers binding | Discontinued mid-2024; not available |
| `nodemailer` in Workers production code | TCP socket required for SMTP; impossible in CF Workers V8 isolate |
| Keycloak SPI JARs / Java authenticators | Explicitly excluded per milestone scope |
| `@simplewebauthn/browser` or `/server` | Keycloak handles WebAuthn ceremony end-to-end; adding these creates a conflicting parallel auth path |
| React / Vue frontend migration | Stack is locked to Vanilla TS per PROJECT.md constraints |
| Playwright passkey tests on Firefox / WebKit | CDP Virtual Authenticator is Chromium-only; not possible on other engines |
| Terraform local state backend | Breaks CI state sharing; use HCP Terraform or R2 S3 backend |
| AWS SES | Requires AWS account; no native Workers integration; overkill |
| `keycloak-js` version change | Already at `^26.0.0` matching KC 26.6.1; no change |

---

## Confidence Levels (v2.0)

| Topic | Confidence | Source |
|-------|------------|--------|
| `keycloak/keycloak` provider — v5.7.0, org-maintained | HIGH | keycloak.org announcement + GitHub releases |
| `mrparkers/keycloak` deprecated | HIGH | keycloak.org blog Jan 2025 |
| Cloudflare provider — v5.19.1 current | HIGH | Cloudflare changelog + Terraform Registry |
| `kislerdm/neon` — v0.9.0 current | HIGH | GitHub releases + Terraform Registry |
| HCP Terraform free tier available | HIGH | HashiCorp blog (Dec 2025) — enhanced free tier active |
| Resend Workers-compatible | HIGH | Official CF Workers tutorial + GitHub example |
| Resend free tier (3,000/month) | HIGH | Resend pricing page (verified May 2026) |
| MailHog abandoned / Mailpit replacement | HIGH | Multiple 2025-2026 sources; Mailpit v1.29.7 April 2026 |
| Playwright sessionStorage not in storageState | HIGH | Official PW docs + GitHub issue #31108 (unresolved) |
| Virtual Authenticator CDP is Chromium-only | HIGH | PW GitHub issue #26621 + Corbado blog verification |
| KC 26 theme `scripts=` is global to theme type | MEDIUM | Official Red Hat KC 26 theme docs (not template-scoped) |
| KC 26 FreeMarker `<#if section = "scripts">` pattern | MEDIUM | Verified against published theme examples; official docs confirm section blocks |

---

## v2.0 Installation Delta

```bash
# backend/ — add email sender
npm install resend@^6.0.0

# tests/ — upgrade Playwright
npm install -D @playwright/test@^1.60.0
npx playwright install  # sync browser binaries
```

No frontend npm changes. No wrangler.toml structural changes (add `RESEND_API_KEY` secret via `wrangler secret put`).

Add to `docker-compose.yml`: mailpit service (see above).

Create new directory: `keycloak/themes/japan-trip/login/messages/` and `keycloak/themes/japan-trip/login/*.ftl` files.

Create new directory: `terraform/` with provider configs, realm config, and Cloudflare Workers secret management.

---

## Sources (v2.0)

- [keycloak/terraform-provider-keycloak GitHub](https://github.com/keycloak/terraform-provider-keycloak)
- [Keycloak Terraform Provider Release 5 — keycloak.org](https://www.keycloak.org/2025/01/terraform-provider-release-5)
- [Cloudflare Terraform Provider v5 GA — Cloudflare Changelog](https://developers.cloudflare.com/changelog/post/2025-02-03-terraform-v5-provider/)
- [Cloudflare Terraform Provider v5.19.1 — Terraform Registry](https://registry.terraform.io/providers/cloudflare/cloudflare/latest)
- [kislydm/neon Terraform Provider — Terraform Registry](https://registry.terraform.io/providers/kislerdm/neon/latest)
- [Neon Terraform docs — neon.com](https://neon.com/docs/reference/terraform)
- [Send Emails With Resend — Cloudflare Workers Docs](https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/)
- [resend-cloudflare-workers-example — GitHub](https://github.com/resend/resend-cloudflare-workers-example)
- [Mailpit GitHub — axllent/mailpit](https://github.com/axllent/mailpit)
- [Mailpit v1.29.7 release](https://github.com/axllent/mailpit/releases/tag/v1.29.7)
- [Playwright Authentication docs](https://playwright.dev/docs/auth)
- [Playwright sessionStorage not captured — Issue #31108](https://github.com/microsoft/playwright/issues/31108)
- [Virtual Authenticator Webkit not supported — PW Issue #26621](https://github.com/microsoft/playwright/issues/26621)
- [Passkeys E2E Playwright — Corbado blog](https://www.corbado.com/blog/passkeys-e2e-playwright-testing-webauthn-virtual-authenticator)
- [Keycloak 26 Server Developer Guide — Themes — Red Hat Docs](https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.0/html/server_developer_guide/themes)
- [HCP Terraform Free Tier Changes — Spacelift](https://spacelift.io/blog/terraform-cloud-free-tier)
- [HCP Terraform enhanced free tier — HashiCorp blog](https://www.hashicorp.com/en/blog/continuing-hcp-terraform-s-enhanced-free-tier-experience)

---

---

# Stack Research — v3.0 Quality, Polish & DevX

**Researched:** 2026-05-28
**Confidence:** HIGH (versions verified via web search against npm registry and official Docker docs)

---

## New Dependencies (v3.0)

### npm — root workspace

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `concurrently` | `^9.2.1` | Run Wrangler dev + Vite dev in parallel after services are up | 8.6M weekly downloads; battle-tested for Node monorepo multi-process orchestration. Pin v9 (stable). v10.0.0 released 2026-05-28 — too fresh to pin yet. |
| `wait-on` | `^9.0.10` | Poll HTTP endpoints and TCP ports before starting app processes | Cross-platform port/URL readiness; no daemon; works with `http://localhost:8080/realms/japan-trip` and `tcp:1025` syntax. |

Both go in **root** `package.json` devDependencies only. They are dev orchestration tools, not app dependencies.

### npm — backend (`backend/`)

| Package | Version | Purpose | When to Add |
|---------|---------|---------|-------------|
| `eslint-plugin-security` | `^4.0.0` | Static analysis: flags unsafe regex, `eval`, prototype pollution, path traversal | Add only if ESLint is already configured in `backend/`; skip if it requires standing up ESLint from scratch solely for this plugin |

### npm — frontend (`frontend/`)

No new dependencies.

### npm — tests (`tests/`)

No new dependencies. Playwright version is already current from v2.0.

---

## Dev Environment Script

### Architecture

One Node.js ESM script at `scripts/dev.mjs` in the repo root. Invoked via `npm run dev` added to root `package.json`:

```json
{
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "dev:frontend": "npm run dev --workspace=frontend",
    "dev:backend": "npm run dev --workspace=backend"
  }
}
```

The script performs these steps in sequence:

1. **Docker daemon check:** spawn `docker info` — exit 0 means running
2. **Start Docker Desktop if not running:** issue `docker desktop start` (Docker Desktop 4.37+ CLI), then poll `docker info` every 3s up to 60s timeout
3. **Start services:** `docker compose -f keycloak/docker-compose.yml up -d`
4. **Wait for services:** `wait-on` polls `http://localhost:8080/realms/japan-trip` (Keycloak) and `tcp:1025` (Mailpit SMTP)
5. **Start app processes:** `concurrently` starts `npm run dev --workspace=backend` and `npm run dev --workspace=frontend`

### Docker Desktop Detection

| Step | Command | Notes |
|------|---------|-------|
| Detect daemon running | `docker info` (exit 0 = running) | Universal — works on all platforms and Docker Desktop versions |
| Start Desktop (primary) | `docker desktop start` | Docker Desktop CLI, introduced in 4.37 (Windows/macOS/Linux). Preferred — no path guessing. |
| Start Desktop (macOS fallback) | `open -a Docker` | For DD < 4.37 on macOS |
| Start Desktop (Windows fallback) | `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` | For DD < 4.37 on Windows; path may vary |
| Start Desktop (Linux fallback) | `systemctl --user start docker-desktop` | For DD < 4.37 on Linux |

Use `process.platform` (`'win32'` / `'darwin'` / `'linux'`) for fallback branching. Try `docker desktop start` first universally; fall back to platform-specific only on non-zero exit.

### Why not dual PowerShell + Bash scripts

- Node 22+ is already required — no additional runtime to install
- Two scripts = duplicated logic, certain to drift
- `process.platform` handles all platform differences in one place
- `concurrently` and `wait-on` provide cross-platform process management without shell quoting differences

### Why not task runners (just, mask, turbo, nx)

Four processes to orchestrate (Keycloak, Mailpit, Wrangler, Vite) plus Docker Desktop detection does not justify a task runner dependency. `concurrently` + `wait-on` + Node script is the minimal surface that solves exactly this problem.

---

## OAuth/OIDC Security Audit

### Approach: Checklist-driven review, no new runtime dependencies

The audit is a process against RFC 9700 (IETF, January 2025 — the current authoritative OAuth 2.0 Security BCP). The existing stack already implements the correct patterns (PKCE, RS256 JWT, audience validation, no ROPC). The work is verifying compliance, not installing a library.

**Audit surface for this stack:**

| Area | What to verify | RFC 9700 reference |
|------|---------------|-------------------|
| Frontend (`keycloak-js`) | `response_type=code` enforced, PKCE enabled (`code_challenge_method=S256`), no token in URL fragment, `state` param present | §2.1, §2.1.1 |
| Backend JWT validation | `iss`, `aud`, `exp`, `nbf` all validated; no `alg: none` accepted; `VALID_AUDIENCES` locked to `['japan-trip-api']` | §2.1.3 |
| Keycloak realm config | Implicit Flow disabled, ROPC unavailable to public clients, refresh token rotation enabled | §2.1.2, §2.6 |
| CSRF | `state` param validated on callback; `nonce` included in ID token requests | §4.7 |
| Redirect URI | Exact match enforced in KC client config (no wildcard, no open redirect) | §4.1 |
| Token storage | `keycloak-js` stores tokens in sessionStorage — acceptable for SPA; document the choice | §4.2 |

**No new tools needed for the audit itself.** OWASP ZAP can be run ad-hoc externally if desired; it is not a repo dependency.

### Optional: `eslint-plugin-security` (backend only)

- Version: `^4.0.0` (published ~Feb 2026, actively maintained by eslint-community)
- Detects: unsafe regex (ReDoS), `eval`, prototype pollution patterns, path traversal via string concat
- Add to `backend/` only — the frontend is browser code where the threat model differs and the plugin is less applicable
- Condition: add only if `eslint` is already configured or being configured for the backend in v3.0; do not introduce ESLint solely for this plugin

---

## Keycloak FreeMarker Theme Tooling

### No new build tooling needed

The existing setup (`docker-compose.yml` volume mount of `./keycloak/themes` + `start-dev` command) already gives near-instant reload for `.ftl` edits. In `start-dev` mode, Keycloak does not cache FreeMarker templates by default.

**To ensure caching is fully disabled, add these flags to the `docker-compose.yml` keycloak command:**

```yaml
command: >
  start-dev
  --spi-theme-static-max-age=-1
  --spi-theme-cache-themes=false
  --spi-theme-cache-templates=false
```

Edit `.ftl` file → refresh browser → change visible immediately. No Keycloak restart required.

### VSCode Extension (add to `.vscode/extensions.json`)

| Extension | ID | Last Updated | Status |
|-----------|----|-------------|--------|
| Freemarker Template Language Support (Nokia) | `Nokia.lsp-for-freemarker` | April 2026 | Actively maintained — PREFERRED |
| Freemarker Plus | `sj1cn.freemarker-plus` | June 2025 | Actively maintained — fallback |

Avoid `dcortes92.FreeMarker` — unmaintained per the author.

### What NOT to add for FreeMarker development

| Tool | Why not |
|------|---------|
| Keycloakify | Requires React; explicitly out of scope (PROJECT.md: "all KC customization via built-in flows + FreeMarker themes only") |
| Maven/Gradle + theme JAR build | No JVM toolchain in project; theme lives in volume mount, not a JAR |
| Chromatic / Percy visual diffing | External paid service; overkill for a personal portfolio project |
| Separate FreeMarker test harness | Playwright covers login flow visually already; no separate FreeMarker runner needed |

---

## What NOT to Add (v3.0)

| Item | Why excluded |
|------|--------------|
| Dual `.ps1` + `.sh` dev scripts | Logic duplication, drift; Node script is universal |
| `npm-run-all` | Fewer features than `concurrently` for this use case; lower weekly downloads |
| `just`, `mask`, `turbo`, `nx` | Overkill for 4-process orchestration |
| Keycloakify | Requires React; out of scope by PROJECT.md |
| `eslint-plugin-security` on frontend | Browser threat model differs; less applicable; add to backend only if ESLint is already there |
| Snyk, Burp Suite, Checkmarx | Paid tools; violates "free or minimal" cost constraint |
| OWASP ZAP as repo dependency | External scanner; run ad-hoc if needed; not a commit-able dependency |
| `oidc-provider` or alternative OIDC server | Project is committed to Keycloak; stack change is out of scope |
| Any Playwright upgrade | Already at current version from v2.0 |
| Any new Terraform providers | v3.0 scope is Terraform expansion of existing KC provider, not new providers |

---

## v3.0 Installation Delta

```bash
# Root workspace — dev orchestration
npm install -D concurrently@^9.2.1 wait-on@^9.0.10

# Backend workspace — optional static analysis (only if ESLint already configured)
npm install -D eslint-plugin-security@^4.0.0 --workspace=backend
```

New files to create:
- `scripts/dev.mjs` — Node.js dev orchestration script
- Update root `package.json` scripts: add `"dev": "node scripts/dev.mjs"`
- Update `keycloak/docker-compose.yml`: add cache-disable flags to keycloak command
- Add `.vscode/extensions.json` with FreeMarker extension recommendation

---

## Confidence Levels (v3.0)

| Topic | Confidence | Source |
|-------|------------|--------|
| `concurrently` v9.2.1 latest stable | HIGH | npm registry search (v10.0.0 just released 2026-05-28 — confirmed too fresh; GitHub releases show v9.2.1 as last stable) |
| `wait-on` v9.0.10 latest | HIGH | npm registry (published ~May 2026) |
| `docker desktop start` CLI (DD 4.37+) | HIGH | Docker Desktop 4.37 release blog; Docker Desktop CLI docs |
| RFC 9700 as current OAuth BCP | HIGH | IETF Datatracker — published January 2025 |
| `eslint-plugin-security` v4.0.0 | HIGH | npm registry (published ~Feb 2026, eslint-community org) |
| KC `start-dev` + volume mount = no cache | MEDIUM | Keycloak GitHub discussions; cache flags documented but default behavior in `start-dev` not explicitly stated in official docs — adding flags explicitly is safer |
| Nokia FreeMarker LSP extension actively maintained | HIGH | VS Marketplace — last updated April 2026 |
| Keycloakify requires React | HIGH | Keycloakify official docs; confirmed in PROJECT.md out-of-scope |

---

## Sources (v3.0)

- [concurrently npm page](https://www.npmjs.com/package/concurrently) — v9.2.1 latest stable; v10.0.0 released 2026-05-28
- [concurrently GitHub releases](https://github.com/open-cli-tools/concurrently/releases)
- [wait-on npm page](https://www.npmjs.com/package/wait-on) — v9.0.10 latest (May 2026)
- [Docker Desktop 4.37 release blog](https://www.docker.com/blog/docker-desktop-4-37/) — `docker desktop start` CLI introduced
- [Docker Desktop CLI docs](https://docs.docker.com/desktop/features/desktop-cli/)
- [RFC 9700 at IETF Datatracker](https://datatracker.ietf.org/doc/rfc9700/) — OAuth 2.0 Security BCP, January 2025
- [eslint-plugin-security npm](https://www.npmjs.com/package/eslint-plugin-security) — v4.0.0 (eslint-community)
- [eslint-plugin-security GitHub](https://github.com/eslint-community/eslint-plugin-security)
- [Keycloak theme caching discussion](https://github.com/keycloak/keycloak/discussions/12595) — `start-dev` + volume mount hot reload
- [Nokia LSP for FreeMarker — VS Marketplace](https://marketplace.visualstudio.com/items?itemName=Nokia.lsp-for-freemarker) — updated April 2026
- [Freemarker Plus — VS Marketplace](https://marketplace.visualstudio.com/items?itemName=sj1cn.freemarker-plus) — updated June 2025
