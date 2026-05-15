# Architecture Research — v2.0 Auth Infrastructure & Hardening

**Researched:** 2026-05-15
**Overall confidence:** HIGH (primary sources: existing codebase read in this session)

---

## New Components

| Path | Type | Purpose |
|------|------|---------|
| `terraform/keycloak/` | NEW dir | HCL module: realm, client, flows, required actions |
| `terraform/cloudflare/` | NEW dir | HCL module: Worker script binding + secrets |
| `terraform/neon/` | NEW dir | HCL module: DB branch/role provisioning |
| `terraform/environments/local/` | NEW dir | TF root for localhost KC + local PG |
| `terraform/environments/prod/` | NEW dir | TF root for Railway KC + Neon + Cloudflare |
| `backend/src/routes/auth.ts` | NEW file | `/auth/otp-request`, `/auth/otp-verify`, `/auth/set-password` |
| `backend/src/services/mailer.ts` | NEW file | Resend HTTP API wrapper (fetch-only, Workers-safe) |
| `backend/src/services/keycloak-admin.ts` | NEW file | KC Admin REST client: user lookup, required-action trigger |
| DB migration: `email_otp_codes` | NEW migration | Table: user_id, code_hash, expires_at, used_at, attempts |
| `frontend/src/auth/passkey-detection.ts` | NEW file | `isWebAuthnSupported()` + sets detection cookie |
| `frontend/src/auth/error-handler.ts` | NEW file | KC error code -> friendly message map |
| `frontend/passkey-fallback.html` | NEW file | Vite MPA entry: standalone OTP fallback flow UI |
| `keycloak/themes/japan-trip/login/passkey-campaign.ftl` | NEW file | FreeMarker override for `webauthn-register-passwordless` Required Action UI |
| `keycloak/themes/japan-trip/login/messages/messages_es.properties` | NEW file | Spanish locale for KC error strings |
| `tests/fixtures/auth.ts` | NEW file | Playwright `storageState` fixture (real KC tokens) |
| `tests/fixtures/keycloak-admin.ts` | NEW file | Playwright KC Admin API helper fixture |

---

## Modified Components

| Path | What Changes |
|------|-------------|
| `keycloak/docker-compose.yml` | Add `mailhog` service (SMTP on :1025, web UI on :8025); remove `--import-realm` once TF owns realm |
| `keycloak/realm-export.json` | **Deprecate**: superseded by Terraform. Retain as historical snapshot only; remove from `--import-realm` command |
| `backend/src/routes/index.ts` | Mount `authRoute` at `/auth` (the route itself decides what needs auth vs not) |
| `backend/src/db/schema.ts` | Add `email_otp_codes` table export |
| `backend/src/types/index.ts` | `Env` gains `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET`, `RESEND_API_KEY`; `KeycloakJwtPayload.email` relaxed to `email?: string` |
| `backend/wrangler.toml` | Add `KC_ADMIN_CLIENT_ID` to `[vars]`; add `KC_ADMIN_CLIENT_SECRET` and `RESEND_API_KEY` as secrets |
| `frontend/vite.config.ts` | Add `'passkey-fallback': resolve(__dirname, 'passkey-fallback.html')` to `rollupOptions.input` |
| `frontend/src/auth/keycloak.ts` | Call `passkey-detection.ts` during init; pass `kc_action` hint to `login()` when directing to OTP path |
| `tests/global-setup.ts` | Add real KC login via Playwright headless + write `storageState.json` to `tests/.auth/` |
| `tests/playwright.config.ts` | Add `storageState` to authenticated project `use:` block; add `setup` project dependency |

---

## Data Flow Changes

### 1. passkey-campaign Required Action Flow

`passkey-campaign.ftl` is a FreeMarker template override for the `webauthn-register-passwordless` Required Action. It runs **inside Keycloak's authentication session**, not in the SPA. The SPA never renders this screen.

```
Browser                  Keycloak                   SPA
  |                          |                        |
  |-- register (KC flow) --->|                        |
  |                          | registration complete  |
  |                          | evaluate required      |
  |                          | actions                |
  |                          | -> webauthn-register-  |
  |                          |    passwordless fires  |
  |<-- passkey-campaign.ftl -|                        |
  |   (served by KC,         |                        |
  |    FreeMarker template)  |                        |
  | user registers passkey   |                        |
  |-- POST /actions/submit ->|                        |
  |                          | action satisfied       |
  |                          | issues tokens          |
  |                          |-- redirect with code ->|
  |                          |                        |
  |<----- SPA receives code and exchanges for tokens -|
```

**Key facts:**
- Terraform sets `webauthn-register-passwordless` as a default required action on the realm.
- Terraform also sets `browser_flow = "browser-passkey"` (currently `"browserFlow": "browser"` in the JSON — not active).
- `passkey-campaign.ftl` is a theme override for the Required Action's login page template; it must be placed in `keycloak/themes/japan-trip/login/` and KC will pick it up automatically because the realm uses the `japan-trip` theme.
- No Java SPI / custom RequiredActionProvider is needed — the built-in `webauthn-register-passwordless` provider is used as-is; only its FreeMarker UI template is customized.

### 2. OTP Fallback Flow

Trigger: `passkey-detection.ts` detects `isWebAuthnSupported() === false`, OR `error-handler.ts` maps a KC error query param to `WEBAUTHN_NOT_SUPPORTED`.

```
Browser             SPA (frontend)       Backend (Worker)      KC Admin REST
  |                      |                     |                     |
  | passkey-detection    |                     |                     |
  | isWebAuthn=false     |                     |                     |
  | navigate to          |                     |                     |
  | passkey-fallback.html|                     |                     |
  | enter email          |                     |                     |
  |--POST /api/auth/otp-request (email)------->|                     |
  |                      |                     |-- GET /admin/realms/ |
  |                      |                     |   {realm}/users      |
  |                      |                     |   ?email={email} --->|
  |                      |                     |<-- user sub ---------|
  |                      |                     | generate OTP (6 dig) |
  |                      |                     | SHA-256(code+salt)   |
  |                      |                     | INSERT email_otp_codes|
  |                      |                     | fetch Resend API     |
  |<-- 200 OK -----------|---------------------|                     |
  | enter OTP            |                     |                     |
  |--POST /api/auth/otp-verify (email, code)-->|                     |
  |                      |                     | verify hash, expiry  |
  |                      |                     | check attempts <=5   |
  |                      |                     | mark used_at         |
  |                      |                     |-- POST /admin/realms/|
  |                      |                     |   {realm}/users/     |
  |                      |                     |   {id}/execute-      |
  |                      |                     |   actions-email      |
  |                      |                     |   (or direct login   |
  |                      |                     |   via token exchange)|
  |<-- redirect to KC login with login_hint=email, acr_values=0 -----|
  | KC issues tokens     |                     |                     |
  |<-- SPA receives tokens ------------------------------------------|
```

**Critical architectural dimension — KC Admin client:**

The backend currently only reads JWKS (no write access to KC). The OTP flow requires a new admin credential path:

- `japan-trip-api` KC client must change from `bearerOnly: true` to `serviceAccountsEnabled: true` with `realm-admin` or scoped `manage-users` role
- New `Env` fields: `KC_ADMIN_CLIENT_ID`, `KC_ADMIN_CLIENT_SECRET`
- `keycloak-admin.ts` acquires an admin token via `client_credentials` grant and caches it module-level (same pattern as `jwksCache` in `auth/keycloak.ts`; refresh on 401, not on a timer)

**OTP rate-limiting must be DB-backed** (not Worker memory — isolates do not share state across requests). The `attempts` column on `email_otp_codes` is the counter; increment on each failed verify, block at `attempts >= 5`.

### 3. Terraform Bootstrap Sequence

Same Terraform `keycloak/` module, two environment roots with different provider configs.

```
LOCAL DEV:
  docker-compose up postgres keycloak mailhog
       |
       | (wait for KC healthy on :8080)
       v
  cd terraform/environments/local && terraform apply
       |
       | KC provider points at http://localhost:8080
       | Sets: browser_flow=browser-passkey, required actions,
       |       japan-trip-api as confidential+service-account
       v
  wrangler dev        (KC_URL=http://localhost:8080)
  vite dev            (VITE_KEYCLOAK_URL=http://localhost:8080)

PROD:
  railway deploy keycloak container
       |
       | (Railway URL confirmed: https://kc.railway.app)
       v
  cd terraform/environments/prod && terraform apply
       |
       | KC provider points at Railway URL
       | Cloudflare module creates Worker env secrets
       | Neon module provisions DB branch
       v
  wrangler secret put KC_ADMIN_CLIENT_SECRET
  wrangler secret put RESEND_API_KEY
  wrangler deploy
```

**Dual source of truth risk:** As long as `docker-compose.yml` uses `--import-realm` AND Terraform manages the realm, every `docker-compose up` risks overwriting TF-managed config. Resolution: remove `--import-realm` flag from the KC command once the TF local environment is confirmed working. Keep `realm-export.json` only as a reference snapshot.

---

## Integration Points

### A. KC Admin Client Promotion

| Attribute | Current state | Required for v2.0 |
|-----------|--------------|-------------------|
| `japan-trip-api` `bearerOnly` | `true` | `false` |
| `serviceAccountsEnabled` | `false` | `true` |
| Service account role | none | `manage-users` (or `realm-admin`) |
| `Env.KC_ADMIN_CLIENT_ID` | absent | new `[vars]` entry in `wrangler.toml` |
| `Env.KC_ADMIN_CLIENT_SECRET` | absent | new secret via `wrangler secret put` |

This change is managed by Terraform — not by editing `realm-export.json` directly.

### B. `email_otp_codes` Schema

Attaches to the existing `users` table. Proposed shape:

```typescript
export const email_otp_codes = pgTable('email_otp_codes', {
  id: serial('id').primaryKey(),
  user_id: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code_hash: varchar('code_hash', { length: 64 }).notNull(),  // SHA-256 hex
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Drizzle migration must run before any `/api/auth/*` endpoint is deployed.

### C. `passkey-fallback.html` as Vite MPA Entry

Follows the same pattern as `dashboard.html`. Add to `vite.config.ts`:

```typescript
'passkey-fallback': resolve(__dirname, 'passkey-fallback.html'),
```

This page does NOT use `<auth-guard>` — the OTP flow IS authentication. It has no prior auth requirement and must be publicly accessible without a KC redirect.

### D. KC Flow Activation via Terraform

`browser-passkey` flow is defined in the realm but `"browserFlow": "browser"` is the active flow (line 197 of `realm-export.json`). Terraform `keycloak_realm` resource must set `browser_flow = "browser-passkey"`. This is the single most impactful UX change in the milestone. It should be done in Terraform, not by patching the JSON, to avoid re-import surprises.

### E. Playwright Real-Auth Overhaul

Current `tests/global-setup.ts` only polls for server readiness. New version must:
1. Launch headless Chromium
2. Navigate to the app and trigger KC login
3. Complete the login flow against a live local KC
4. Write `storageState` to `tests/.auth/user.json`

The `playwright.config.ts` must add a `setup` project that depends on `global-setup.ts`, and the other projects must declare `dependencies: ['setup']` and `storageState: 'tests/.auth/user.json'`.

Note on WebAuthn in CI: Playwright's headless Chromium supports simulated WebAuthn via `cdpSession.send('WebAuthn.enable', { enableUI: false })`. If the `setup` project must register a passkey, this CDP approach is required. Alternatively, configure a test user in KC with a password credential (bypassing passkey-only flow) solely for Playwright setup — simpler and sufficient for auth fixture purposes.

---

## Suggested Build Order

Dependencies are the discriminator. Each step unlocks the next at runtime, not just logically.

### Step 1 — Local Infrastructure Foundation
What: MailHog in `docker-compose.yml`, `terraform/keycloak/` module, `terraform/environments/local/`  
Goal: `docker-compose up` brings KC + PG + MailHog; `terraform apply` idempotently sets browser_flow, required actions, admin client credentials  
Unlocks: everything downstream (KC admin creds exist, passkey flow is active, SMTP works locally)

### Step 2 — DB Migration + KC Admin Client Wiring
What: `email_otp_codes` Drizzle migration; `backend/src/services/keycloak-admin.ts`  
Modified: `backend/src/db/schema.ts`, `backend/src/types/index.ts`, `backend/wrangler.toml`  
Goal: Table exists in DB; backend can obtain and cache a KC Admin token  
Unlocks: OTP routes (Step 3)  
Depends on: Step 1 (KC admin credentials must exist)

### Step 3 — Backend OTP Routes + Mailer
What: `backend/src/routes/auth.ts`, `backend/src/services/mailer.ts`  
Modified: `backend/src/routes/index.ts`  
Goal: `POST /api/auth/otp-request` and `otp-verify` work end-to-end; MailHog captures OTP email  
Unlocks: Frontend fallback page (Step 5), Playwright OTP E2E (Step 6)  
Depends on: Step 2

### Step 4 — KC Theme Extensions (parallel with Step 3)
What: `passkey-campaign.ftl`, `messages_es.properties`  
KC config change: `webauthn-register-passwordless` as default required action (via TF)  
Goal: Post-registration passkey campaign fires using the custom theme; Spanish errors render  
Depends on: Step 1 (TF must manage KC)  
Unlocks: E2E tests for the passkey-campaign happy path

### Step 5 — Frontend Passkey Detection + Fallback Page
What: `passkey-detection.ts`, `error-handler.ts`, `passkey-fallback.html`  
Modified: `vite.config.ts`, `frontend/src/auth/keycloak.ts`  
Goal: Browsers without WebAuthn land on the OTP fallback page; KC error params map to friendly messages  
Depends on: Step 3 (fallback page calls backend OTP endpoints)  
Unlocks: Full user-facing flow

### Step 6 — Playwright Real-Auth + Fixtures + E2E Tests
What: `tests/fixtures/auth.ts`, `tests/fixtures/keycloak-admin.ts`  
Modified: `tests/global-setup.ts`, `tests/playwright.config.ts`  
Goal: E2E suite authenticates against real KC; happy path and OTP fallback path are covered  
Depends on: Steps 1-5 (live KC + backend OTP routes + fallback page all required)

### Step 7 — Production Terraform
What: `terraform/environments/prod/`, `terraform/cloudflare/` module, `terraform/neon/` module  
Goal: Prod KC/Cloudflare/Neon state managed in code; secrets deployed via `wrangler secret put`  
Depends on: Step 1 (module exists), everything else proven locally

---

## Cloudflare Workers Constraints

`wrangler.toml` already has `nodejs_compat` — this allows Node-compatible modules in local dev (enables `pg` via TCP). The runtime remains a V8 isolate.

| Constraint | Impact | Pattern to follow |
|-----------|--------|------------------|
| No SMTP socket / no `nodemailer` | `mailer.ts` must use Resend HTTP API via `fetch()` | `fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ...' }, body: JSON.stringify({...}) })` |
| No `crypto.createHash` (Node API) | OTP hashing must use Web Crypto | `crypto.subtle.digest('SHA-256', new TextEncoder().encode(code+salt))` — see `auth/keycloak.ts:base64urlToArrayBuffer` as reference pattern |
| No shared isolate memory across requests | Rate-limit (OTP `attempts`) must live in the DB row, not in module-level state | `attempts` column on `email_otp_codes`, incremented via UPDATE on each failed verify |
| Module-level cache is per-isolate (not per-request) | Admin token cache is fine — same TTL assumption as JWKS cache | Refresh on 401, not on timer, since admin token TTL is long (~10 min default) |
| `env` bindings only accessible via `c.env` | New secrets must be declared in `wrangler.toml` and in the `Env` interface | Add to `types/index.ts` `Env` interface |
| No persistent TCP connections | Neon HTTP driver already handles this; local `pg.Pool` only via `nodejs_compat` dev path | Existing dual-driver pattern in `db/index.ts` — no change needed |

---

## Key Architectural Risks

**1. `japan-trip-api` client promotion is a breaking-direction change.**  
Promoting it from `bearerOnly` to a service account client changes its semantics in KC. Verify nothing else currently treats it as a bearer validator (introspection endpoint). Currently the backend validates via JWKS directly — the client is not used for introspection — so the change is safe, but must be confirmed before touching prod.

**2. `realm-export.json` dual source of truth.**  
Once TF local env works, `docker-compose.yml` must not pass `--import-realm`. If it does, `docker-compose up` will re-import the JSON and overwrite TF-managed config (e.g., the admin client secret, the browserFlow assignment). Remove the flag at Step 1 completion.

**3. `email` NOT NULL in `users` table vs passkey-only users.**  
`KeycloakJwtPayload.email` is typed non-optional but may be absent. `ensureUserProvisioned` already handles `email ?? ''`. The OTP `otp-request` handler must validate `email !== ''` before proceeding and return 422 if missing — a passkey-only user with no email cannot use the OTP fallback.

**4. Playwright WebAuthn in CI.**  
Real passkey registration in headless Chrome requires CDP `WebAuthn.enable`. For the auth fixture, consider provisioning a dedicated test user in KC with a password credential (bypassing the passkey flow) — simpler, no CDP setup required, and sufficient for storageState generation. Reserve CDP WebAuthn simulation for tests that specifically exercise the passkey UX.
