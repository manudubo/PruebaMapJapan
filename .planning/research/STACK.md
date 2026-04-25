# Stack Research

**Project:** TravelMap (PruebaMapJapan)
**Researched:** 2026-04-25
**Note:** WebSearch, WebFetch, and Bash tools were restricted during this session. All web-verifiable facts (tier limits, pricing, patch versions) are flagged LOW confidence and sourced from training data (cutoff Aug 2025). Code-derived findings are HIGH confidence.

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
| Auth | Keycloak 25.0 with OIDC/PKCE + RS256 + WebAuthn | **LOCKED at 25.0** — keycloak-js compat |
| Maps | Leaflet | 1.9 |
| Frontend deploy | GitHub Pages | — |
| Backend deploy | Cloudflare Workers (free tier) | — |
| Auth deploy | Railway hobby | — |
| DB deploy | Neon (free tier) | — |

---

## Key Questions Answered

### 1. Keycloak 25 Passkeys/WebAuthn Configuration

**What exists in the codebase:**

The realm-export.json already has a well-structured passkeys setup:
- `webAuthnPolicyPasswordless*` block is configured: `authenticatorAttachment: "platform"`, `requireResidentKey: "Yes"`, `userVerificationRequirement: "required"`, algorithm `ES256`
- Custom auth flows `browser-passkey` and `passkey-forms` are defined, with `webauthn-authenticator-passwordless` as REQUIRED
- Registration is done via `keycloak.login({ action: 'webauthn-register', redirectUri })` in `profile.ts` — this is the correct Keycloak 25 pattern

**The one critical gap found in the config:**

`webAuthnPolicyPasswordlessRpId` is blank (`""`) in realm-export.json. This works for localhost but **will break in production**. The WebAuthn RP ID must exactly match the effective domain of the page that initiates the ceremony. For Railway-hosted Keycloak, this should be the Railway-assigned domain (e.g., `your-app.up.railway.app`) — or ideally the custom domain if one is configured.

**Other gaps:**

- `browserFlow` in realm-export.json is `"browser"` (standard), not `"browser-passkey"`. The passkey flow is defined but not set as the active browser flow. `apply-local-settings.sh` explicitly resets it to `"browser"`. This means passkeys work as a registration/credential management option, but login defaults to password. If the intent is passkey-first login, `browserFlow` must be set to `"browser-passkey"` and only in production (not local dev where you may want password fallback — hence the shell script pattern already in place is correct).

- The `japan-trip-api` client is `bearerOnly: true`. Keycloak 25 deprecated bearer-only clients — they still work but the recommended approach is a confidential client with `standardFlowEnabled: false`. Low urgency but worth noting for future Keycloak upgrades.

- The Account REST API endpoint used in profile.ts (`/realms/{realm}/account/credentials?type=webauthn`) is the correct v1 endpoint for Keycloak 25. It returns credentials with `type: "webauthn"` for standard WebAuthn and `type: "webauthn-passwordless"` for passwordless. The current code filters by `type === 'webauthn'` — this will miss passwordless credentials. Change filter to `c.type === 'webauthn' || c.type === 'webauthn-passwordless'` or remove the filter and check type field.

- `email` field in passkey-only flows: users who register via passkey (no password) may have no email. `user.ts` middleware already handles this with `email: jwtUser.email ?? ''` — acceptable for now. The schema should allow `email` as nullable rather than `''` as sentinel.

**Confidence:** HIGH (derived from codebase + Keycloak 25 docs knowledge).

---

### 2. Cloudflare Workers Free Tier + Hono Best Practices

**Free tier limits (as of training knowledge, verify at developers.cloudflare.com/workers/platform/limits):**
- 100,000 requests/day
- 10ms CPU time per request (wall clock time is longer due to I/O wait)
- 128MB memory
- 50 sub-requests per request (outbound fetches from Worker)
- No persistent TCP connections (relevant for Neon)

**The `wrangler.toml` issues found:**

1. `compatibility_date = "2024-01-01"` is stale. Recommend updating to `2024-09-23` or later. The `nodejs_compat` compatibility flag requires a recent date to get the latest Node.js API shims (crypto, Buffer, etc.). The correct date to use is the most recent date before the production deploy — use `2025-03-01` or current date at deploy time. Stale compatibility dates mean you miss bug fixes in the compat layer.

2. The fake D1 binding block:
   ```toml
   [[d1_databases]]
   binding = "DB_PLACEHOLDER"
   database_name = "placeholder"
   database_id = "placeholder"
   ```
   This is stale scaffolding. `wrangler deploy` will attempt to validate this binding and may warn or fail. Remove it. The actual database is Neon via `DATABASE_URL` secret, confirmed in both `db/index.ts` and the deploy workflow.

3. `KEYCLOAK_URL` and `KEYCLOAK_REALM` are in `[vars]` as empty strings. Non-secret config for the Cloudflare dashboard. For production, set these via `wrangler.toml` vars or via the Cloudflare dashboard — not as secrets (they're not sensitive). This is correct.

**Hono on Workers best practices:**

- The `nodejs_compat` flag is required for `@neondatabase/serverless` (uses Node.js crypto) and `node-postgres` path (local only). Already set.
- CORS: current setup uses `Access-Control-Allow-Origin: *` with `credentials: true`. This combination is spec-invalid (browsers reject credentialed requests to wildcard origins). Fix: set `origin` to the specific GitHub Pages URL (e.g., `https://username.github.io`). Hono's `cors()` middleware accepts a string or array of allowed origins.
- CPU time: Neon HTTP calls are I/O, not CPU, so the 10ms CPU limit is not a concern for typical CRUD. The JWT verify (using Workers Web Crypto) is also fast.

**Confidence:** MEDIUM (tier limits from training, code-derived issues are HIGH).

---

### 3. Neon Free Tier Connection Management

**The actual production code (from `db/index.ts`):**

```typescript
export function createDb(databaseUrl: string): any {
  const isLocal = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
  if (isLocal) {
    const pool = new Pool({ connectionString: databaseUrl });
    return drizzlePg(pool, { schema });
  }
  const sql = neon(databaseUrl);
  return drizzleNeon(sql, { schema });
}
```

And this is called on every request:
```typescript
const db = getDb(c.env.DATABASE_URL);
```

**Production (Neon HTTP driver):** `neon()` creates an HTTP client — no TCP connection pool. Each call to `neon(url)` is cheap. There is no connection pool to exhaust on the Cloudflare Workers side. This is the correct pattern for serverless. The concern in PROJECT.md about "DB connection pool not reused across requests" applies only to local dev.

**Local dev (node-postgres Pool):** `new Pool()` is created on every request in local dev. Each Pool maintains a connection pool and will open connections that aren't reused. With low local dev traffic this doesn't cause practical exhaustion, but it leaks pool resources across requests. Fix for local dev: create the Pool once at module level (in `db/index.ts`) and cache it by connection string. This is purely a local dev concern — production is unaffected.

**Neon free tier limits (training knowledge — verify at neon.tech/docs/introduction/plans):**
- 0.5 GiB storage
- 190 compute hours/month (autosuspend after 5 minutes of inactivity)
- 10 projects max (1 is enough)
- No branching on free tier
- HTTP driver is not subject to connection limits (uses REST API)
- Autosuspend means first request after idle period adds ~300-500ms cold start (the Neon compute wakes up)

**What NOT to do with Neon:**
- Do not use websocket/TCP connections from Cloudflare Workers — use the HTTP driver (`drizzle-orm/neon-http`)
- Do not set `?pgbouncer=true` in the DATABASE_URL for HTTP-driver connections — that's for PgBouncer proxy configs, not applicable here
- Do not use `neon()` with a hardcoded URL in module scope in Cloudflare Workers — Workers may reuse isolates across requests but the `Env` bindings (including `DATABASE_URL`) are per-request. The current pattern of calling `getDb(c.env.DATABASE_URL)` per-request handler is correct.

**Confidence:** HIGH for the code analysis. LOW for specific free tier numbers (verify at neon.tech).

---

### 4. GitHub Pages + Vite MPA Deployment

**Current setup in `vite.config.ts`:**

```typescript
base: '/PruebaMapJapan/',
rollupOptions: {
  input: { main, tokyo, nagoya, ..., dashboard, trip, profile },
  output: { manualChunks: { leaflet: ['leaflet'] } }
}
```

**Deploy workflow (`deploy-frontend.yml`) — gaps identified:**

1. **No `VITE_API_URL` guard.** The workflow correctly passes `VITE_API_URL: ${{ secrets.VITE_API_URL }}` — if the secret is unset, Vite receives an empty string, NOT the localhost default. The `profile.ts` uses `import.meta.env['VITE_KEYCLOAK_URL'] ?? 'http://localhost:8080'` as fallback — this anti-pattern (silent localhost fallback) is present in `profile.ts` and possibly other pages. PROJECT.md explicitly flags this. A silent fallback to localhost in a production build is a hidden misconfiguration. Fix: use `vite-plugin-checker` or an inline build-time assertion in `vite.config.ts` that throws if `VITE_API_URL` is empty.

   Simplest fix (no extra plugin): add to `vite.config.ts`:
   ```typescript
   // In defineConfig callback before returning
   if (process.env.NODE_ENV === 'production') {
     if (!process.env.VITE_API_URL) throw new Error('VITE_API_URL must be set for production builds');
   }
   ```

2. **Cache-busting:** Vite's default content-hash filenames (`assets/index-[hash].js`) handle cache-busting correctly for JS/CSS assets. The HTML entry points themselves (`index.html`, `dashboard.html`, etc.) are NOT content-hashed and GitHub Pages does NOT add cache headers for `.html` files by default — they are served with short cache lifetimes. This is acceptable behavior; no action needed.

3. **`base` URL and hash routing:** The `base: '/PruebaMapJapan/'` is set for this specific repo. If the repo is renamed or moved to a custom domain, update `base` or set it to `'/'`. GitHub Pages custom domains use root-relative URLs. The current Leaflet chunk split is correct — it separates the large Leaflet bundle from the main app code.

4. **MPA 404 handling:** GitHub Pages serves `404.html` for unknown paths. With MPA (multiple separate HTML entry points), deep links like `/PruebaMapJapan/dashboard.html` work fine as static files. No `404.html` redirect hack needed. Only SPA apps with client-side routing need the 404 redirect trick.

5. **`manualChunks` for Leaflet:** Correct. Leaflet (~150KB minified) only needs to load on map pages. The split works when pages explicitly import from 'leaflet'.

**Confidence:** HIGH (all derived from codebase + Vite docs knowledge).

---

### 5. Railway for Keycloak — Resource Limits and Persistence

**Current config (`railway.toml`, `keycloak/Dockerfile` implied):**
- Build: Dockerfile
- Start: `start --optimized --db=postgres`
- Health check: `/health/ready`
- Restart: on_failure

**Railway pricing (training knowledge — verify at railway.app/pricing, has changed multiple times):**

Railway eliminated the free tier in August 2023. As of training knowledge:
- **Hobby plan:** $5/month credit, then usage-based (~$5 is generally sufficient for a low-traffic Keycloak instance if resources are tuned down)
- **Resources default:** 512MB RAM, 0.5 vCPU — adequate for Keycloak in `--optimized` mode
- **Persistence:** Railway volumes are persistent. The Keycloak `--db=postgres` flag means Railway uses an external PostgreSQL database (must be provisioned separately — either Railway-managed Postgres or another service). Without a persistent DB, realm configuration and users are lost on redeploy.

**Critical missing config found:**

The `railway.toml` specifies `--db=postgres` but there is no Railway PostgreSQL environment variable configuration in the repo. Keycloak needs these env vars at runtime:
```
KC_DB=postgres
KC_DB_URL=jdbc:postgresql://host:port/db
KC_DB_USERNAME=...
KC_DB_PASSWORD=...
KC_HOSTNAME=https://your-railway-url.up.railway.app
KC_HOSTNAME_STRICT=false (if using both custom domain and railway default)
KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true
```

Without `KC_HOSTNAME` set to the actual Railway URL, the realm's `frontendUrl` (currently blank in realm-export.json) is inferred from the request host. This usually works but can break token issuer validation if Keycloak is accessed via multiple hostnames. The backend validates JWTs against `issuer = {KEYCLOAK_URL}/realms/{realm}` — this must match exactly.

**Confidence:** MEDIUM for Railway limits (pricing changes; verify current). HIGH for Keycloak env var requirements.

---

## Version & Config Recommendations

### `wrangler.toml` — Fix immediately

```toml
name = "prueba-map-japan-api"
main = "src/index.ts"
compatibility_date = "2025-03-01"   # Update from stale 2024-01-01
compatibility_flags = ["nodejs_compat"]

[vars]
KEYCLOAK_URL = "https://your-keycloak.up.railway.app"
KEYCLOAK_REALM = "japan-trip"

# Secrets (set via: wrangler secret put DATABASE_URL)
# DATABASE_URL — Neon connection string
```

Remove the entire `[[d1_databases]]` block — it's dead scaffolding and may cause wrangler validation warnings.

### Keycloak Realm — Production checklist

These must be set when deploying to Railway (not committed to realm-export.json since they're environment-specific):

1. **`webAuthnPolicyPasswordlessRpId`** = the effective domain of the GitHub Pages site (e.g., `manud.github.io`). Not the full URL, just the domain. If using a custom domain, use that instead.

2. **`attributes.frontendUrl`** = the full Railway URL (e.g., `https://your-app.up.railway.app`). Currently blank in realm-export.json.

3. **Client redirect URIs** — currently `https://*.github.io/*`. The wildcard subdomain match is supported in Keycloak 25. Fine for now, but tighten to the specific GitHub Pages URL for production: `https://manud.github.io/PruebaMapJapan/*`.

4. If passkey-first login is desired in production: update `browserFlow` to `"browser-passkey"` via the admin API (not via realm-export.json re-import, which would reset everything).

### Keycloak Account REST API — Passkey credential type fix

In `profile.ts`, line 70:
```typescript
const webauthn = credentials.filter((c) => c.type === 'webauthn');
```
Should be:
```typescript
const webauthn = credentials.filter(
  (c) => c.type === 'webauthn' || c.type === 'webauthn-passwordless'
);
```
Keycloak 25 uses `'webauthn-passwordless'` as the type for credentials registered via the passwordless authenticator.

### Neon — Local dev Pool fix

In `backend/src/db/index.ts`, cache the local Pool to avoid creating a new pool per request:

```typescript
const localPoolCache = new Map<string, pg.Pool>();

export function createDb(databaseUrl: string) {
  const isLocal = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
  if (isLocal) {
    if (!localPoolCache.has(databaseUrl)) {
      localPoolCache.set(databaseUrl, new Pool({ connectionString: databaseUrl }));
    }
    return drizzlePg(localPoolCache.get(databaseUrl)!, { schema });
  }
  const sql = neon(databaseUrl);
  return drizzleNeon(sql, { schema });
}
```

### CORS fix (backend)

Replace the wildcard CORS origin with the specific GitHub Pages origin:
```typescript
app.use('*', cors({
  origin: 'https://manud.github.io',
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

For local dev, add `'http://localhost:5173'` to the allowed origins. Use an env var (`ALLOWED_ORIGIN`) to pass the production origin at deploy time.

### Vite — Build-time guard for `VITE_API_URL`

In `frontend/vite.config.ts`, add before the `defineConfig`:
```typescript
if (process.env.NODE_ENV === 'production' && !process.env.VITE_API_URL) {
  throw new Error('VITE_API_URL must be set for production builds');
}
```

Remove the `?? 'http://localhost:8080'` fallbacks from `profile.ts` (and any other page that has them) — they silently mask misconfiguration in prod builds.

---

## What NOT to Do

| Anti-pattern | Why | Fix |
|---|---|---|
| `Access-Control-Allow-Origin: *` with `credentials: true` | Spec-invalid; browsers reject it | Explicit origin list in `cors()` |
| `new Pool()` on every request | Leaks connections in local dev, exhausts pool | Cache Pool at module scope |
| `compatibility_date = "2024-01-01"` | Stale; misses nodejs_compat bug fixes | Update to `2025-03-01` |
| `[[d1_databases]]` placeholder | Dead binding; confuses wrangler validation | Remove block entirely |
| Blank `webAuthnPolicyPasswordlessRpId` | WebAuthn ceremonies fail in production | Set to production domain |
| `?? 'http://localhost:8080'` fallbacks in prod builds | Silently points prod app at localhost | Assert env vars exist at build time |
| Filtering passkeys by `type === 'webauthn'` only | Misses passwordless credentials in Keycloak 25 | Include `'webauthn-passwordless'` type |
| `email: jwtUser.email ?? ''` for passkey users | Empty string stored instead of NULL | Make `email` nullable in schema |
| `bearer-only: true` on `japan-trip-api` client | Deprecated in Keycloak 25+ | Low urgency; note for future upgrades |
| Using Neon TCP driver from Cloudflare Workers | Workers have no persistent TCP | Already using HTTP driver; don't switch |

---

## Confidence Levels

| Topic | Confidence | Reason |
|---|---|---|
| Keycloak realm config gaps (rpId, frontendUrl, credential type filter) | HIGH | Derived directly from realm-export.json and profile.ts source |
| WebAuthn flow structure (browser-passkey, passkey-forms) | HIGH | Derived from realm-export.json, consistent with Keycloak 25 docs knowledge |
| CORS bug (`*` + credentials) | HIGH | Spec-defined behavior, codebase-verified |
| `wrangler.toml` D1 placeholder removal | HIGH | Wrangler behavior well-known; placeholder is visibly stale |
| Neon HTTP driver is connection-pool-safe | HIGH | Architecture-derived from @neondatabase/serverless design |
| Local dev Pool leak | HIGH | Confirmed: `new Pool()` called per request in routes handler |
| Vite MPA cache-busting behavior | HIGH | Vite docs stable, codebase-verified |
| VITE_API_URL guard absence in profile.ts | HIGH | Confirmed `?? 'http://localhost:8080'` in source |
| Cloudflare Workers free tier request limits | LOW | Training data (Aug 2025); verify at developers.cloudflare.com/workers/platform/limits |
| Cloudflare Workers CPU time (10ms) | MEDIUM | Stable limit for years; verify current |
| `compatibility_date` recommendation (`2025-03-01`) | MEDIUM | Pattern is correct; specific date needs verification |
| Neon free tier storage/compute hours | LOW | Training data (Aug 2025); verify at neon.tech/docs/introduction/plans |
| Railway Hobby plan pricing ($5/mo) | LOW | Training data; Railway has changed pricing multiple times — verify at railway.app/pricing |
| Railway Keycloak DB env vars required | HIGH | Keycloak 25 startup requirements are stable and well-documented |
| Keycloak 25.0.x latest patch | LOW | Could not verify; check hub.docker.com/r/keycloak/keycloak for latest 25.0.x tag |
| `webauthn-passwordless` credential type string | MEDIUM | Consistent with Keycloak source/docs but not verifiable via live API in this session |
