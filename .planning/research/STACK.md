# Stack Research — v3.2 Security & Code Health Hardening

**Domain:** Fix-and-harden milestone (no new features). Scope limited to the 6 stack questions needed to implement SEC-01, SEC-04, INFRA-03/O-08, DEP-01, SEC-15, SEC-16 from `.planning/v3.2-CANDIDATE-REQUIREMENTS.md`.
**Researched:** 2026-07-24
**Confidence:** HIGH for versions/CVE data (verified via WebSearch + GitHub Security Advisories + official Cloudflare/Vite docs), HIGH for repo-specific facts (verified by reading actual source), MEDIUM for the exact `compatibility_date` recommendation (Cloudflare's own guidance is "pin a tested date," which is inherently a judgment call, not a single correct answer).

This is not a general ecosystem survey — existing stack (Hono/Workers, Drizzle/Neon, vanilla TS, Keycloak, Playwright, Terraform) is correct and out of scope per `PROJECT.md`'s Constraints. Every recommendation below is either a version bump of an already-installed package or a config/code change using APIs already native to the runtime (Web Crypto, Vite's built-in env replacement, `<meta http-equiv>`). **No new npm packages are recommended anywhere in this document.**

This file supersedes the prior `STACK.md` in this directory, which was Playwright-focused research for the v3.1 E2E stabilization milestone (now shipped) and is no longer the active milestone's stack question.

---

## 1. SEC-01 — OTP CSPRNG (`backend/src/routes/auth.ts:123`)

### The problem, precisely
```ts
const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
```
Two separate defects: `Math.random()` is not a CSPRNG (predictable/seedable), and even if you swap in `crypto.getRandomValues()` naively (`randomInt % 1_000_000`), you introduce **modulo bias** — `2^32 / 1_000_000` is not an integer, so digits near the wraparound boundary are statistically more likely.

### Fix — no library, `crypto.getRandomValues` is native to both runtimes this code executes in
`globalThis.crypto` (Web Crypto API) is built into the Cloudflare Workers runtime and, separately, into Node.js ≥ 19 (this repo requires Node 22+, confirmed in `PROJECT.md` Constraints) — meaning the **same code path works unmodified** in production (`wrangler dev`/deployed Worker) and in local dev (`backend/src/dev.ts`, which runs under `tsx`/Node, not Workers). No polyfill, no import.

```ts
function generateOtpCode(): string {
  const RANGE = 1_000_000; // 6 digits, 000000–999999
  // Largest multiple of RANGE that fits in a Uint32 — values >= this are
  // rejected and re-rolled, so every remaining value has exactly equal
  // probability (standard CSPRNG rejection-sampling pattern).
  const MAX_VALID = Math.floor(0x1_0000_0000 / RANGE) * RANGE; // 4_294_000_000
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= MAX_VALID);
  return String(n % RANGE).padStart(6, '0');
}
```
- **Why rejection sampling over `crypto.randomInt`:** Node's `crypto.randomInt(max)` (from `node:crypto`) already does unbiased rejection sampling internally, but it is a Node-only API — using it would break the Workers runtime execution path. `crypto.getRandomValues` is the one CSPRNG primitive available identically in both environments, hence the manual rejection loop.
- **Expected iterations:** `MAX_VALID / 2^32 ≈ 0.99986`, so the loop almost never re-rolls (expected ~1.0001 iterations). Not a performance concern.
- **What NOT to do:** don't add a package like `otp-generator` or `crypto-random-string` — this is one function, and pulling in a dependency for it adds an audit-surface liability (exactly the class of problem DEP-01 is about) for something native APIs already solve in 8 lines.

---

## 2. SEC-04 — CSP via `<meta http-equiv>` on GitHub Pages

### Constraint confirmed
GitHub Pages serves static files with no way to inject custom response headers, so `<meta http-equiv="Content-Security-Policy">` in every HTML `<head>` is correct and is genuinely the only lever available — no CDN/edge-function layer sits in front of it. **This means two CSP directives cannot be enforced at all for the frontend:** `frame-ancestors` and `sandbox` are explicitly ignored by browsers when set via `<meta>` (CSP spec requires them to come from an HTTP header) — confirmed via MDN and content-security-policy.com. Clickjacking protection for the frontend static site is therefore not achievable at this layer; it's a residual, accepted gap for this milestone (low severity for a personal-use travel app with no payment/PII-critical actions). The backend API already sends `X-Frame-Options: DENY` correctly (`backend/src/middleware/security.ts`) — that only protects API responses, not the HTML pages, but there's nothing further to do about the HTML pages without a hosting change, which is out of scope.

### Actual sources this app loads — verified by reading the code, not assumed
| Directive | Value | Why (file:line evidence) |
|---|---|---|
| `default-src` | `'self'` | baseline deny |
| `script-src` | `'self'` (+ `https://unpkg.com` **only if you keep the CDN Leaflet `<script>` tag** — see Section 5, recommendation is to remove it) | `main.ts`/module scripts are same-origin; `unpkg.com/leaflet@1.9.4/dist/leaflet.js` is loaded via `<script src>` on all 9 city pages + `trip.html` |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` (+ `https://unpkg.com` only if CDN Leaflet CSS kept) | `src/styles/main.css:2` does `@import url('https://fonts.googleapis.com/css2?...')`; every page has 1-2 inline `<style>` blocks for FOUC prevention (`index.html:18`, `tokyo.html:12`, etc.) |
| `font-src` | `https://fonts.gstatic.com` | Google Fonts serves the actual `.woff2` files from `gstatic.com`, not `googleapis.com` |
| `img-src` | `'self' https://*.basemaps.cartocdn.com https://cdn-icons-png.flaticon.com data:` | map tiles: `'https://{s}.basemaps.cartocdn.com/{light,dark}_all/...'` (`src/modules/theme.ts:7,11`); `data:` for any inline SVG/base64 icons in CSS; `cdn-icons-png.flaticon.com` is the remote PWA icon (`index.html:13`, `apple-touch-icon` + manifest icons, PWA-01) — **contingent**: if PWA-01 (Cluster 6) is fixed to serve first-party icons before or alongside this CSP work, drop this origin; until then it must stay or the icon silently fails to load and the console fills with CSP violations |
| `connect-src` | `'self' https://api.open-meteo.com https://api.allorigins.win https://corsproxy.io https://nominatim.openstreetmap.org %VITE_API_URL% %VITE_KEYCLOAK_URL%` | weather widget (`widgets.ts:76`), news RSS proxies (`widgets.ts:169-170`), geocoder (`geocoder.ts:13`); the last two are the Worker and Keycloak origins — see build-time substitution below |
| `frame-src` | `%VITE_KEYCLOAK_URL%` | **Required, not optional — verified in `frontend/src/auth/keycloak.ts:43-48`.** `keycloak.init({ onLoad: 'check-sso', silentCheckSsoRedirectUri, checkLoginIframe: false, ... })`: `checkLoginIframe` is explicitly `false`, so KC's periodic login-status iframe is not in play — but `onLoad: 'check-sso'` **is** active, and keycloak-js implements silent SSO restoration by opening a hidden `<iframe>` pointed at the Keycloak authorization endpoint (same origin as `%VITE_KEYCLOAK_URL%`) to check for an existing session without a full-page redirect. `frame-src` falls back to `default-src 'self'` when unset, which would silently block that iframe — the failure mode is subtle (session restoration just stops working, no obvious error) and exactly the kind of thing this CSP work is meant to prevent, not cause. `PROJECT.md`'s Key Decisions table independently corroborates check-sso is live in production code ("`keycloak-js getToken()` only refreshes when `isTokenExpired(30)`... post silent-check-sso"). |
| `object-src` | `'none'` | no plugins/embeds anywhere |
| `base-uri` | `'self'` | defense-in-depth, cheap to add |
| `form-action` | `'self'` | `dashboard.html:197`/`trip-edit.html:78` forms are both handled by `preventDefault()` + `fetch()` in TS, never a native submit to an external origin — confirmed by reading both handlers |

**`frame-ancestors` and `sandbox`:** omit — they're inert in a meta tag and their presence there can misleadingly suggest protection that isn't happening (flagged by the same content-security-policy.com source as a common false-security trap).

### The `%VITE_API_URL%`/`%VITE_KEYCLOAK_URL%` problem — solved with Vite's built-in env replacement, no library
Backend/Keycloak origins differ per environment (`localhost:8787`/`localhost:8080` in dev, Cloudflare Workers/Railway hostnames in prod) and are already exposed to the app via `VITE_API_URL`/`VITE_KEYCLOAK_URL` (`frontend/src/api/client.ts:24`, `frontend/src/auth/keycloak.ts:7-8`). Vite has **native, zero-config HTML env substitution**: any `import.meta.env` property (i.e. anything `VITE_`-prefixed) can be referenced in HTML source as `%VITE_VARIABLE_NAME%`, and Vite replaces it at build time — this applies to every entry in a multi-page build (confirmed: this repo's `vite.config.ts` already lists all 13 HTML files as `rollupOptions.input`, and Vite's HTML transform runs per-entry). (HIGH confidence — official Vite docs, `vite.dev/guide/env-and-mode`.)

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; connect-src 'self' https://api.open-meteo.com https://api.allorigins.win https://corsproxy.io https://nominatim.openstreetmap.org %VITE_API_URL% %VITE_KEYCLOAK_URL%; frame-src %VITE_KEYCLOAK_URL%; ...">
```
Caveat: `%VITE_API_URL%` includes the full URL with path (e.g. `http://localhost:8787/api`) — CSP source expressions want an origin, not a path; strip the path when defining a second env var, or just accept that CSP silently ignores the path component of a source expression (it does — browsers only match scheme+host+port from a `connect-src`/`frame-src` entry, so a raw `http://localhost:8787/api` string entry actually works correctly in practice, verified against the CSP spec's source-matching algorithm, but the cleaner approach is a path-free `VITE_API_ORIGIN`-style var). **This is a one-time template edit repeated across 13 HTML files** (or centralize by generating the `<head>` boilerplate — but that's a build-process change beyond this milestone's scope; a small find-and-replace across the 13 files is proportionate for a fix-and-harden milestone).

### What NOT to add
No CSP-management npm package (e.g. `helmet`, `csp-html-webpack-plugin`) — those solve header-injection or webpack-specific templating problems this repo doesn't have (no webpack; Vite's own `%VAR%` substitution already solves the one templating need). A hand-written meta tag, repeated across 13 static HTML files, is the correct amount of engineering for 10 directives on a GitHub Pages site.

### Sequencing note for the roadmap
The proposed phase breakdown puts SEC-04 (CSP) in Phase 20 and SEC-15 (Leaflet SRI/bundling) in Phase 23. **If Phase 20 ships first**, the CSP must temporarily include `https://unpkg.com` in `script-src`/`style-src` to avoid breaking the map on every page. If Section 5's recommendation (stop loading Leaflet from the CDN at all — it's already bundled via npm) lands first or in the same phase, the CSP is simpler and tighter from day one. Recommend flagging this dependency explicitly when phase-planning 20/23, or doing the Leaflet-debundling fix in Phase 20 alongside CSP since it's a ~15-minute change (delete 2 lines × 10 files) that meaningfully shrinks the CSP's trusted-origin list. The same applies to `img-src`'s flaticon.com entry and PWA-01 (Cluster 6) — not scheduled until Phase 24, so `img-src` will need the flaticon origin at least through Phase 20-23.

---

## 3. INFRA-03/O-08 — `wrangler.toml` `compatibility_date` bump

### Root cause, confirmed by reading the code
`backend/src/db/index.ts` unconditionally imports both `drizzle-orm/node-postgres` and `pg` at module scope (`createDb()` branches on the connection string at runtime, but both driver imports are static, so wrangler's bundler pulls in `pg`'s dependency tree regardless of which branch actually executes at runtime). `pg`'s transitive dependency `split2` uses `require('string_decoder')` — an unprefixed Node builtin. `compatibility_date = "2024-01-01"` predates `nodejs_compat_v2`, whose expanded builtin-module coverage is what lets `string_decoder` resolve at all under `nodejs_compat`.

### Fix
```toml
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```
- **Why exactly this date and not a later one:** `nodejs_compat_v2` auto-activates for any `compatibility_date >= 2024-09-23` when `nodejs_compat` is set (confirmed: Cloudflare's own compatibility-flags docs and the 2025 "year of Node.js compat" blog post). This is the *minimum* date that resolves the `string_decoder` build failure — it is the smallest possible diff that unblocks the build, which matters because compatibility-date bumps are otherwise-unrelated-behavior-change grab bags and the smallest defensible bump is the lowest-risk one for a milestone whose goal is "fix the broken build," not "modernize the Workers runtime."
- **Two later auto-enable thresholds worth knowing about (not required for this fix, but will matter if you bump the date further in a future milestone):** `enable_nodejs_http_modules` auto-enables at `compatibility_date >= 2025-09-01` (bundles `node:http`), and `remove_nodejs_compat_eol_v23` auto-enables at `>= 2025-12-04` (strips Node ≤23 EOL APIs). Neither should affect this codebase — production only touches `@neondatabase/serverless` (HTTP-based), never `node:http`/`node:net` directly — but they're the kind of "worked yesterday, doesn't today" surprise worth a comment in `wrangler.toml` if this date is ever bumped again.
- **This is a config-only fix, verify by rebuilding**: after the change, re-run `npm run build` (= `wrangler deploy --dry-run`) in `backend/`. ANALISIS-REPO.md's own finding notes "may surface more `nodejs_compat` gaps once fixed" — treat a clean dry-run as the actual acceptance criterion, not the date bump in isolation.

### Wrangler CLI version — separate, lower-priority concern (do not conflate with this fix)
`backend/package.json` pins `"wrangler": "^3.101.0"` (devDependency), but `deploy-backend.yml:21` runs `npx wrangler deploy`, which resolves the latest published `wrangler` from the registry rather than the pinned local version (this is INFRA-04's actual finding — "unpinned," not a v3-vs-v4 problem per se). Current `wrangler` on npm is **4.113.0** (verified July 2026) — Wrangler v3 is past its practical support window. Two independent fixes, don't merge them into one CL:
1. **INFRA-04 fix (this milestone, low-risk):** change the CI step to `npm run deploy` / `npx --no-install wrangler deploy` so it uses the pinned `node_modules` binary, not whatever `npx` fetches fresh.
2. **Wrangler 3→4 upgrade (optional, separate CL, only if time allows):** `compatibility_date = "2024-09-23"` is supported by both v3.101 and v4.x, so the build-fix above does **not** require the CLI upgrade. If upgraded anyway, check `wrangler.toml` syntax — v4 still supports the TOML format used here (no forced migration to `wrangler.jsonc`), so this should be a version-bump-only change, but re-run `npm run build` after to confirm.

---

## 4. DEP-01 — `drizzle-orm` 0.38.4 → 0.45.2+

### The vulnerability, precisely
**GHSA-gpj5-g38j-94v9 / CVE-2026-39356** — Drizzle's per-dialect `escapeName()` implementations didn't escape embedded quote/backtick delimiters before wrapping identifiers, so any code path that passes attacker-controlled strings into `sql.identifier()` or `.as()` can break out of the quoted identifier and inject SQL. **Fixed in 0.45.2** (and `1.0.0-beta.20`). Affects Postgres/MySQL/SQLite/SingleStore/Gel dialects — i.e. this repo's Postgres usage is in scope. The candidate-requirements doc's own risk assessment ("low practical exploitability — all identifiers in this codebase are static schema names, not user input") still holds after verification: `db.query.trips.findFirst(...)` and friends (grep-confirmed at `destinations.ts:108`, `trips.ts:57,144`) use Drizzle's relational query API with statically-defined schema objects, never a string built from request data — so this repo isn't exploitable *today*, but it's a runtime-shipped HIGH-severity CVE regardless, and the fix is a version bump, not a workaround.

### Version target and compatible tooling
```json
"drizzle-orm": "^0.45.2",
"drizzle-kit": "^0.31.10"
```
`drizzle-kit` 0.31.x is the generation/migration CLI paired with `drizzle-orm` 0.44–0.45.x (community-confirmed pairing; `drizzle-kit` has no independent breaking surface relevant here since this repo only uses `db:generate`/`db:migrate`/`db:push`/`db:studio`, none of which touch the relational-query API).

### What changed 0.38 → 0.45 that touches this repo's actual usage
Checked against this repo's actual API surface (`db.query.X.findFirst`, `drizzle(pool, { schema })` / `drizzle(sql, { schema })` dual-driver setup, standard `eq()`/`and()` where-builders):
- **Relational Queries v1 (RQBv1) — the API this repo uses — is untouched through the 0.4x line.** The breaking RQBv2 rewrite (`defineRelations()`, replacing the `schema`-object-passed-to-`drizzle()` pattern) ships in `1.0.0-beta` only, not in any 0.4x release. **Do not** target `drizzle-orm@1.0.0-beta.x` or later in this milestone — that's a genuine breaking migration (new relations API, different config shape) and is explicitly out of scope for a hardening milestone whose goal is closing a CVE, not migrating query APIs. Pin to the last pre-1.0 line: `^0.45.2` (not `^1.0.0-beta`, not a bare `latest`).
- **`neon-http` and `node-postgres` driver constructors are unchanged** — `drizzle(pool, { schema })` (node-postgres) and `drizzle(sql, { schema })` (neon-http) signatures are stable across this range, so `backend/src/db/index.ts`'s dual-driver factory needs no code changes beyond the version bump.
- **Practical verification step (do this regardless of what the changelog claims):** ANALISIS-REPO.md's own status note ties this bump to ARCH-06/ARCH-03 landing first ("a regression is catchable") — meaning: point the test `DATABASE_URL` at a real ephemeral Postgres (fixing the vacuous-assertion test bug) *before* or *alongside* this bump, then run the full `trips.ts` test suite against both the old and new version to catch anything the changelog doesn't mention. Given `createDb` returns `any` (ARCH-01), TypeScript won't catch a signature drift here — only a real DB-backed test run will.

### `dompurify` — verify sanitizer default-config usage, no breaking change
Every call site in this repo (`tripDetail.ts:131,149`, `map.ts:59,68,396`) uses the single-argument default-config form: `DOMPurify.sanitize(html)`. Current safe version is **3.4.12** (released ~2026-07-11), fixing a hook-policy inconsistency (custom-element handling bypassing `afterSanitizeElements`) that only matters if `CUSTOM_ELEMENT_HANDLING`/`tagNameCheck` config or hooks are used — this repo uses neither, confirmed by grep (no `ALLOWED_TAGS`, `CUSTOM_ELEMENT_HANDLING`, or `addHook` calls anywhere). The plain `sanitize(dirty: string): string` signature has been stable across the entire 3.x line — **zero code changes needed**, this is a pure `npm install dompurify@^3.4.12` version bump.
```json
"dompurify": "^3.4.12"
```

---

## 5. SEC-15 — Leaflet Subresource Integrity / CDN dependency

### Actual finding, corrected by reading the code — this is better than a simple SRI-hash fix
`frontend/package.json` already lists `"leaflet": "^1.9.4"` as an npm dependency, and it's already imported as an ES module in `src/modules/map.ts:1` (`import * as L from 'leaflet'`) and `src/pages/tripDetail.ts:16` — meaning **Leaflet's JS is already bundled by Vite into `main.ts`'s output** (confirmed: `vite.config.ts` even has `manualChunks: { leaflet: ['leaflet'] }`, a Vite config specifically for this bundle). The `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js">` tag present on all 9 city pages + `trip.html` is loading a **second, redundant copy** of Leaflet from an unauthenticated third-party CDN.

**Verified precondition for deleting the CDN `<script>` tags:** grepped every HTML file in `frontend/` for any inline-script reference to the CDN's global `window.L`/`L.` (the risk being that some page's inline script might rely on the CDN-defined global rather than the module import) — **zero matches across all 10 pages**. `trip.html`'s only inline script (`document.fonts.ready...`) and every city page's font-ready/theme-flash inline scripts don't touch `L` at all. It is safe to delete the CDN `<script>` tags; nothing in this codebase depends on the CDN-provided global.

The CSS (`leaflet.css`) is different: it is **only** loaded via the CDN `<link>` tag — no `.ts` file does `import 'leaflet/dist/leaflet.css'`, so removing the CDN link without replacing it would visibly break map rendering.

### Recommended fix (stronger than SRI, same effort)
1. Delete the `<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js">` tag from all 10 HTML files — verified nothing depends on it (see precondition check above).
2. Add `import 'leaflet/dist/leaflet.css';` once, at the top of `src/modules/map.ts` (or `main.ts`, since it's the shared entry). Vite bundles CSS imports automatically, emitting a hashed, same-origin `.css` file — this simultaneously eliminates the CDN dependency, gets automatic cache-busting via Vite's content hash (a for-free partial fix toward SEC-16's build-hash-versioning goal, at least for this one asset), and removes the need for `https://unpkg.com` in the CSP's `script-src`/`style-src` entirely (see Section 2's sequencing note).
3. Delete the now-redundant `<link rel="stylesheet" href="https://unpkg.com/...">` tag from all 10 HTML files.

**Why this beats "add `integrity`+`crossorigin` to the existing tags" (the fix literally suggested in the finding text):** SRI mitigates a compromised-CDN attack but keeps the third-party runtime dependency, the double-shipped bytes, and the unpkg entry in `img-src`/`script-src`/`style-src`/CSP `connect-src` bookkeeping forever. Since Leaflet is *already* an installed, already-imported npm dependency, deleting the CDN reference is strictly less total-system complexity than adding and maintaining SRI hashes for a dependency that shouldn't be fetched from a CDN at all. It also directly resolves INFRA-06 (the dead `EXTERNAL_ASSETS` array in `sw.js` was trying to precache exactly these two CDN URLs for offline support — once Leaflet is same-origin, it's precached automatically as part of the normal Vite build output, and `EXTERNAL_ASSETS` can simply be deleted rather than "wired up").

### If SRI is still wanted as a defense-in-depth measure elsewhere (fallback reference only)
No npm package is needed to generate SRI hashes — `openssl` (already on any dev/CI machine) computes them directly:
```bash
curl -sL https://unpkg.com/leaflet@1.9.4/dist/leaflet.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -sL https://unpkg.com/leaflet@1.9.4/dist/leaflet.css | openssl dgst -sha384 -binary | openssl base64 -A
```
(Computed live during this research pass, 2026-07-24, for reference — recompute before use, don't trust a stale value in a doc: `leaflet.js` → `sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH`; `leaflet.css` → `sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H`.) This is a fallback for a scenario where npm-bundling isn't chosen — it is not the primary recommendation.

### What NOT to add
No SRI-generation npm package (`sri-toolbox`, webpack's `subresource-integrity` plugin, etc.) — `openssl` covers the fallback path, and the primary fix needs no tooling at all, just deleting two tags per file and one `import` statement.

---

## 6. SEC-16 — Service worker cache-versioning tied to build hash

### The actual bug
`public/sw.js:1` hardcodes `const CACHE_NAME = 'japan-trip-v3';`. Files in Vite's `public/` directory are copied to `dist/` **verbatim** — they are not processed by Vite's bundler, so `import.meta.env`/`define()` substitution (the mechanism used in Section 2 for HTML) does **not** apply to `sw.js` as-is. The `activate` handler's cache-purge logic (`sw.js:43-49`) is correct and will work fine — it's just never triggered because `CACHE_NAME` never changes between deploys.

### Fix — a small build-time script, no new package
Two viable patterns, both using only Node's built-in `crypto` module (already used elsewhere in this repo's build/test tooling patterns) or the already-installed `vite` build output:

**Option A (recommended — simplest, no Vite plugin needed):** a ~15-line Node script run as a `postbuild` npm script, after `vite build` has already emitted hashed asset filenames to `dist/`:
```js
// scripts/version-sw.js
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const assetFiles = readdirSync('dist/assets').sort().join(',');
const buildHash = createHash('sha256').update(assetFiles).digest('hex').slice(0, 10);

const swPath = 'dist/sw.js';
const sw = readFileSync(swPath, 'utf-8');
writeFileSync(swPath, sw.replace('__BUILD_HASH__', buildHash));
```
```json
// frontend/package.json
"scripts": {
  "build": "tsc && vite build && node scripts/version-sw.js"
}
```
```js
// public/sw.js
const CACHE_NAME = `japan-trip-__BUILD_HASH__`;
```
This hashes the *set of asset filenames Vite already content-hashes* — since Vite renames JS/CSS chunks whenever their content changes, hashing the directory listing changes `CACHE_NAME` exactly when the underlying assets actually changed, which is precisely the invalidation trigger SEC-16 wants.

**Option B (equivalent, simpler, less precise):** use `package.json`'s `version` field (bump it as part of the normal release process) instead of a content hash — trades "automatic, zero-maintenance" for "one more thing to remember to bump." Given this repo doesn't currently have a version-bump discipline in its release flow (`package.json` version is `2.1.0`, last touched who-knows-when relative to actual deploys), Option A is more robust for this codebase specifically.

**Also fix the caching *strategy*, not just the name (part of the same finding):** the `fetch` handler is cache-first for everything not in `NETWORK_ONLY_DOMAINS` (`sw.js:51-70`), including navigations/HTML — meaning even with correct `CACHE_NAME` versioning, a user who already has the SW installed only picks up a new deploy on their *second* visit after the new SW activates (standard SW lifecycle latency), which is normal and acceptable, but the specific bug report ("returning users get stuck on stale app versions indefinitely") is really about `CACHE_NAME` never rotating at all, which Option A fixes. If tighter freshness is wanted, switch just the navigation-request branch to network-first — no library needed, an `if (event.request.mode === 'navigate')` branch with a `fetch().catch(() => caches.match(...))` fallback (already partially present in the existing catch handler at `sw.js:64-68`, just needs to become the primary strategy for navigations rather than the offline fallback only).

### What NOT to add
**Do not adopt `vite-plugin-pwa` / Workbox for this fix.** It is the ecosystem-standard tool for exactly this problem (`generateSW`/`injectManifest` strategies handle build-hash cache versioning, precaching, and navigation strategies out of the box) — worth knowing it exists for a future PWA-focused milestone — but adopting it now means replacing this repo's ~70-line hand-rolled `sw.js` with a generated one, re-verifying all of `PWA-01`/`INFRA-06`/offline behavior from scratch, and taking on Workbox as a new build-time dependency and mental model. That's disproportionate to a two-line-conceptually bug fix ("the cache name never changes") in a milestone explicitly scoped to fixing, not rearchitecting. Revisit `vite-plugin-pwa` only if a future milestone decides to invest in real offline support as a first-class feature.

---

## Installation summary

```bash
# backend/
npm install drizzle-orm@^0.45.2
npm install -D drizzle-kit@^0.31.10

# frontend/
npm install dompurify@^3.4.12
# leaflet: no version change needed (already ^1.9.4); usage pattern changes (see Section 5)
```

```toml
# backend/wrangler.toml
compatibility_date = "2024-09-23"   # was "2024-01-01"
```

No `npm install` needed for Sections 1, 2, or 6 — those are code/config changes using APIs already present in the runtime or already-installed tooling (Vite, Node's `crypto`).

## Alternatives Considered

| Recommended | Alternative | Why Not |
|---|---|---|
| `crypto.getRandomValues` + manual rejection sampling for OTP | Node's `crypto.randomInt(max)` | Node-only API; would break when this same route code runs on the Workers runtime in production |
| Hand-written `<meta http-equiv="CSP">`, one per HTML file, `%VITE_VAR%` substitution | A CSP-generation library/webpack plugin | No webpack in this repo; Vite's built-in HTML env replacement already solves the one dynamic-value need |
| `compatibility_date = "2024-09-23"` (minimum fix) | Bump to "today's date" for max freshness | Smallest defensible diff for a build-unblocking fix; later auto-enabled flags (2025-09-01, 2025-12-04) are unverified against this codebase and better evaluated in a dedicated future pass |
| `drizzle-orm@^0.45.2` (last pre-1.0 line) | `drizzle-orm@1.0.0-beta.x` | RQBv2 is a breaking relational-query-API rewrite; out of scope for a CVE-driven hardening bump |
| Bundle Leaflet via existing npm import, delete CDN `<script>`/`<link>` tags | Add `integrity`/`crossorigin` to the existing unpkg tags | Leaflet is already an installed, already-imported dependency — removing the redundant CDN copy is less total complexity than adding and maintaining SRI hashes for a dependency that shouldn't be CDN-fetched at all |
| Postbuild Node script hashing `dist/assets` for SW `CACHE_NAME` | `vite-plugin-pwa`/Workbox | Solves the actual bug (name never rotates) without replacing a working hand-rolled `sw.js` or adopting a new build-time dependency; Workbox is the right call only if a future milestone invests in offline-first as a real feature |

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `Math.random()` anywhere security-relevant | Not a CSPRNG, predictable | `crypto.getRandomValues` (native, both runtimes) |
| A CSP-management npm package | Solves problems (header injection, webpack templating) this repo doesn't have | Hand-written `<meta http-equiv>` + Vite's native `%VITE_VAR%` substitution |
| `drizzle-orm@1.0.0-beta.x` in this milestone | Breaking RQBv2 relational-query API rewrite | `drizzle-orm@^0.45.2` (CVE-fixed, API-stable) |
| SRI-hash-generation npm packages | `openssl` (already available) computes SHA-384 hashes directly | `openssl dgst -sha384 -binary \| openssl base64 -A` |
| `vite-plugin-pwa`/Workbox for this fix | Disproportionate — replaces a working hand-rolled SW for a one-line-conceptually bug | Postbuild Node script using built-in `crypto.createHash` |
| `npx wrangler deploy` in CI | Resolves latest wrangler from registry, ignoring the pinned devDependency (INFRA-04, separate from this fix) | `npm run deploy` / pinned local binary |
| Omitting `frame-src` from the CSP because no `<iframe>` appears in HTML source | `keycloak-js`'s `onLoad: 'check-sso'` injects a hidden iframe at runtime for silent SSO restoration — a static `grep <iframe>` cannot see it | `frame-src %VITE_KEYCLOAK_URL%` (see Section 2) |

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `drizzle-orm@0.45.2` | `drizzle-kit@0.31.10`, `@neondatabase/serverless@^0.10.4` (unchanged), `pg@^8.13.1` (unchanged) | Dual-driver constructor signatures (`drizzle(pool/sql, { schema })`) unchanged across this bump |
| `compatibility_date = "2024-09-23"` | `wrangler@^3.101.0` (current pin) and `wrangler@^4.x` | Date bump does not require a wrangler CLI major upgrade; verify with a fresh `npm run build` regardless |
| `dompurify@3.4.12` | Existing single-arg `.sanitize(html)` call sites (`tripDetail.ts`, `map.ts`) | API signature stable across entire 3.x line; only relevant if `CUSTOM_ELEMENT_HANDLING`/hooks were used, which this repo doesn't |
| Leaflet CSS import (`leaflet/dist/leaflet.css`) | Vite's built-in CSS bundling (already used implicitly for `src/styles/main.css`) | No plugin needed; Vite handles `.css` imports from `node_modules` natively |
| `keycloak-js@^26.0.0` `onLoad: 'check-sso'` | CSP `frame-src` directive | Silent-check-sso's hidden iframe is a runtime-injected DOM element, invisible to static HTML grep — verify against actual `keycloak.init()` call options, not HTML source |

## Sources

- Drizzle ORM security advisory GHSA-gpj5-g38j-94v9 / CVE-2026-39356 — https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9 (HIGH confidence, official GitHub Security Advisory)
- Drizzle ORM 0.45.2 release notes — https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.2 (HIGH)
- Drizzle ORM v0→v1 migration notes (confirms RQBv2 is 1.0-only) — https://orm.drizzle.team/docs/v0-v1-changes (HIGH, official docs)
- DOMPurify 3.4.12 release / CUSTOM_ELEMENT_HANDLING advisory — GHSA (via WebSearch, cross-referenced against npm package page) (MEDIUM-HIGH, not Context7-verified directly but multiple independent sources agree)
- Cloudflare Workers compatibility flags / `nodejs_compat_v2` — https://developers.cloudflare.com/workers/configuration/compatibility-flags/ (HIGH, official docs)
- Cloudflare "A year of improving Node.js compatibility in Cloudflare Workers" (2025 blog post, confirms 2024-09-23 threshold) — https://blog.cloudflare.com/nodejs-workers-2025/ (HIGH, official)
- Vite HTML env replacement (`%VITE_VAR%`) — https://vite.dev/guide/env-and-mode (HIGH, official docs)
- CSP meta-tag limitations (`frame-ancestors`/`sandbox` ignored) — https://content-security-policy.com/examples/meta/, MDN CSP docs (HIGH, cross-referenced across 2 independent sources)
- keycloak-js `check-sso`/silent-check-sso iframe behavior — inferred from `frontend/src/auth/keycloak.ts:43-48`'s actual `init()` call plus `PROJECT.md`'s Key Decisions table corroboration; not independently re-verified against keycloak-js's own docs in this pass (MEDIUM — repo evidence is strong, upstream keycloak-js doc citation would raise to HIGH)
- wrangler current version (4.113.0, July 2026) — npm registry via WebSearch (MEDIUM, single-source but low-stakes/easily-reverified claim)
- Repo source: `backend/src/routes/auth.ts`, `backend/src/db/index.ts`, `backend/wrangler.toml`, `backend/package.json`, `frontend/src/modules/{widgets,map,theme,geocoder}.ts`, `frontend/src/pages/tripDetail.ts`, `frontend/src/auth/keycloak.ts`, `frontend/public/sw.js`, `frontend/vite.config.ts`, `frontend/*.html`, `.github/workflows/deploy-backend.yml` — read directly (HIGH confidence, primary source)
- SRI hashes for `leaflet@1.9.4` — computed directly via `curl` + `openssl` against the live unpkg CDN, 2026-07-24 (HIGH confidence but time-bound — recompute before use)

---
*Stack research for: v3.2 Security & Code Health Hardening (Phases 20-21 focus)*
*Researched: 2026-07-24*
