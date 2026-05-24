# Phase 8: OTP + Passkey Campaign — Research

**Researched:** 2026-05-24
**Domain:** Cloudflare Workers (Hono), keycloak-js AIA, Web Crypto, Resend SDK, frontend cookie/modal patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Both OTP endpoints are Bearer-protected; use existing `authMiddleware` + `ensureUserProvisioned` chain; `c.var.user` and `c.var.dbUserId` are available in handlers.
- **D-02:** Email derived from `c.var.user.email` (JWT payload), not request body.
- **D-03:** If `c.var.user.email` is undefined/empty, return HTTP 422 `{ success: false, error: 'no_email' }`.
- **D-04:** If valid unexpired OTP already exists when `/otp-request` is called, return HTTP 429 `{ success: false, error: 'otp_pending', retryAfter: <seconds> }`.
- **D-05:** New route file `backend/src/routes/auth.ts` mounted at `/auth` in `routes/index.ts` → final paths `/api/auth/otp-request` and `/api/auth/otp-verify`.
- **D-06:** OTP lookup/write use `c.var.dbUserId` to query `email_otp_codes`.
- **D-07:** OTP generation: 6-digit numeric string. Hash stored as HMAC-SHA256 using `OTP_SECRET` env binding. Comparison uses HMAC-SHA256 + XOR accumulator.
- **D-08:** Resend SDK sends email in prod; Mailpit HTTP API in local dev. Resend must be added as npm dependency.
- **D-09:** After max 5 failed attempts on `/otp-verify`, mark code exhausted (`used_at = now()`) and return HTTP 429 `{ success: false, error: 'max_attempts' }`.
- **D-10:** Campaign logic in `frontend/src/modules/passkeyCampaign.ts`, exported as `checkPasskeyCampaign(userId: string): void`.
- **D-11:** Only `frontend/src/pages/dashboard.ts` calls `checkPasskeyCampaign()` — after `initKeycloak()` resolves with `true` and `getUserInfo()` provides userId.
- **D-12:** WebAuthn capability check: `typeof PublicKeyCredential !== 'undefined'`.
- **D-13:** Cookie name: `pnk_${userId}`. Written with `document.cookie = 'pnk_${userId}=1; max-age=2592000; SameSite=Strict'`.
- **D-14:** Cookie written BEFORE redirect.
- **D-15:** Redirect: `keycloak.login({ action: 'webauthn-register-passwordless', redirectUri: window.location.href })`.
- **D-16:** `credentialCount` tracked as module-level variable updated inside `loadPasskeys()`.
- **D-17:** When delete clicked and `credentialCount === 1`, modal opens but Delete button replaced with "Register another passkey first" button.
- **D-18:** Modal body text: "You must register another passkey on another device before deleting this one." Delete hidden; register button shown.
- **D-19:** "Register another passkey first" calls `keycloak.login({ action: 'webauthn-register-passwordless', redirectUri: window.location.href })`.
- **D-20:** Worker does NOT call KC Admin API post-verify. After `/otp-verify` 200, Worker returns `{ success: true }`.
- **D-21:** Dashboard holds `let webauthnCapable: boolean`; after successful `/otp-verify`, if `!webauthnCapable` call `keycloak.login({ action: 'UPDATE_PASSWORD', redirectUri: window.location.href })`.
- **D-22:** Dashboard detects `!webauthnCapable` on load and shows persistent banner with "Send code" button.
- **D-23:** "Send code" calls `POST /api/auth/otp-request`; on 201 opens modal with 6-digit input, "Verify" button, "Resend" button.
- **D-24:** On `/otp-verify` 200: dismiss modal, then if `!webauthnCapable` redirect via UPDATE_PASSWORD. On 400/401/429: show inline error.

### Claude's Discretion
- Exact OTP email template (subject, body, plain-text vs HTML)
- OTP modal and banner CSS/styling
- How the 429 `retryAfter` countdown is displayed
- `OTP_SECRET` value for local dev
- Whether to add Zod schema for `/otp-verify` body `{ code: string }`

### Deferred Ideas (OUT OF SCOPE)
- KC Admin API call to force UPDATE_PASSWORD server-side
- Separate `otp.html` page
- OTP fallback on pages other than dashboard
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PASS-04 | Post-login passkey campaign with per-device cookie and WebAuthn capability check | `checkPasskeyCampaign.ts` module pattern, keycloak-js `login({ action })` confirmed, cookie SameSite behavior verified |
| PASS-05 | Email OTP fallback endpoints; HMAC-SHA256 hash; 10-min TTL; single-use; max 5 attempts; timing-safe comparison; Resend/Mailpit delivery | `email_otp_codes` migration confirmed, crypto.subtle HMAC pattern, Resend install path, Mailpit HTTP send API documented |
| PASS-06 | Guard against deleting last credential — profile delete flow checks count before allowing | `loadPasskeys()` + `openDeleteConfirm()` extension points confirmed in codebase |
| PASS-07 | UPDATE_PASSWORD Required Action forced post-OTP only when device does NOT support WebAuthn | keycloak-js `action: 'UPDATE_PASSWORD'` confirmed in types; frontend flag pattern identified |
</phase_requirements>

---

## Summary

Phase 8 adds four interlocking features on top of the already-complete Phase 7 backend infrastructure. The `email_otp_codes` table is already migrated (migration `0003_add_email_otp_codes.sql` confirmed in DB). The `Env` interface needs one addition (`OTP_SECRET`); the `routes/index.ts` needs one new route mount; and the `resend` npm package must be added to `backend/package.json`.

The codebase is in a clean state. Every function referenced in CONTEXT.md (`loadPasskeys`, `openDeleteConfirm`, `buildDeleteModal`, `registerPasskey`, `checkPasskeyCampaign`) is either already present (profile.ts) or correctly absent (passkeyCampaign.ts — to be created). The keycloak-js `login({ action: '...' })` API is typed as `action?: string`, confirming all three action strings (`webauthn-register-passwordless`, `UPDATE_PASSWORD`, `delete_credential:{id}`) work.

One important discrepancy: D-07 and REQUIREMENTS state "Workers lacks `crypto.timingSafeEqual`" as rationale for the HMAC+XOR approach. **This is factually inaccurate** — Cloudflare Workers exposes `crypto.subtle.timingSafeEqual` as a non-standard extension. D-07 is locked, so the plan uses HMAC+XOR; the approach is correct and safe, just more code than necessary. Noted in Open Questions.

**Primary recommendation:** Implement in four parallel task groups — (1) backend `auth.ts` route with OTP logic, (2) frontend `passkeyCampaign.ts` module, (3) profile.ts last-credential guard, (4) dashboard.ts OTP banner/modal wiring.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OTP generation + storage | API / Backend (Worker) | Database | Secrets (OTP_SECRET) live server-side; HMAC in Workers runtime |
| OTP email delivery | API / Backend (Worker) | External (Resend/Mailpit) | Worker calls Resend REST API; no SMTP from browser |
| OTP verification | API / Backend (Worker) | — | Timing-safe comparison must happen server-side |
| Passkey campaign check | Browser / Client | — | Cookie read/write + WebAuthn capability check are browser-only |
| KC AIA redirect | Browser / Client | KC Server | keycloak-js `login({ action })` initiates redirect from browser |
| Last-credential guard | Browser / Client | Browser / Client | Count tracked in-memory from KC Account API response; no backend call needed |
| UPDATE_PASSWORD gate | Browser / Client | KC Server | Frontend reads `webauthnCapable` flag, redirects to KC AIA |

---

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.6.17 | Route handler framework | Project standard [VERIFIED: backend/package.json] |
| drizzle-orm | ^0.38.3 | DB queries for `email_otp_codes` | Project standard [VERIFIED: backend/package.json] |
| @hono/zod-validator | ^0.4.1 | Request body validation | Project standard [VERIFIED: backend/package.json] |
| zod | ^3.23.8 | Schema definition for `{ code: string }` | Project standard [VERIFIED: backend/package.json] |
| keycloak-js | ^26.0.0 | `keycloak.login({ action })`, cookie-after-init pattern | Project standard [VERIFIED: frontend/package.json] |
| Web Crypto API | built-in | `crypto.subtle.importKey`, `sign`, `verify` for HMAC | Workers built-in [VERIFIED: Cloudflare docs] |

### Must Be Added
| Library | Version | Purpose | Install |
|---------|---------|---------|---------|
| resend | 6.12.3 | Send OTP email in production | `npm install resend` in `backend/` |

**Version verification:** `npm view resend version` → `6.12.3` [VERIFIED: npm registry 2026-05-24]

**Installation:**
```bash
cd backend && npm install resend
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HMAC+XOR accumulator (D-07) | `crypto.subtle.timingSafeEqual` | Both correct; timingSafeEqual is actually available in Workers (see Open Questions); HMAC+XOR locked per D-07 |
| `document.cookie` (D-13) | js-cookie library | Simpler API for plain cookie; no library needed |

---

## Architecture Patterns

### System Architecture Diagram

```
POST /api/auth/otp-request
  → authMiddleware (verifies Bearer JWT)
  → ensureUserProvisioned (sets c.var.dbUserId)
  → Check email_otp_codes: unexpired+unused? → 429 otp_pending
  → Check c.var.user.email: empty? → 422 no_email
  → Generate 6-digit code → HMAC-SHA256(code, OTP_SECRET)
  → INSERT email_otp_codes (user_id, code_hash, expires_at = now+10min)
  → Send email: RESEND_API_KEY? → Resend.emails.send() : Mailpit HTTP POST
  → 201 { success: true }

POST /api/auth/otp-verify
  → authMiddleware → ensureUserProvisioned
  → SELECT latest unexpired+unused OTP for dbUserId
  → Not found/expired → 400 { error: 'otp_not_found' }
  → attempts >= 5? → mark used_at → 429 max_attempts
  → HMAC-SHA256(submitted_code, OTP_SECRET) XOR-compare with code_hash
  → No match → INCREMENT attempts → 400/429
  → Match → UPDATE used_at = now() → 200 { success: true }

Browser: dashboard.ts init()
  → initKeycloak() → authenticated=true
  → getUserInfo() → info.id
  → webauthnCapable = typeof PublicKeyCredential !== 'undefined'
  → if webauthnCapable: checkPasskeyCampaign(info.id)
      → cookie pnk_{userId} present? → done
      → write cookie → keycloak.login({ action: 'webauthn-register-passwordless' })
  → if !webauthnCapable: show OTP banner

Browser: profile.ts loadPasskeys()
  → KC Account API → credentials[]
  → credentialCount = credentials.length
  → render list with delete buttons

Browser: profile.ts openDeleteConfirm(credentialId)
  → credentialCount === 1?
      → show guard modal (hide Delete, show "Register another passkey first")
  → else: show normal delete modal → delete_credential AIA
```

### Recommended Project Structure
```
backend/src/
├── routes/auth.ts       # NEW — OTP endpoints
├── routes/index.ts      # MODIFY — add authRoute mount
├── db/queries/otp.ts    # NEW — email_otp_codes queries
├── types/index.ts       # MODIFY — add OTP_SECRET to Env
└── validation/schemas.ts # MODIFY — add OtpVerifySchema

frontend/src/
├── modules/passkeyCampaign.ts  # NEW — checkPasskeyCampaign()
├── pages/dashboard.ts          # MODIFY — banner + OTP modal + campaign call
└── pages/profile.ts            # MODIFY — credentialCount + last-credential guard
```

### Pattern 1: OTP Route — Two-Phase Auth Middleware Chain

The exact pattern used by `tripsRoute` and replicated for `authRoute`:

```typescript
// Source: backend/src/routes/trips.ts line 47 [VERIFIED: codebase]
const authRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();
authRoute.use('*', authMiddleware, ensureUserProvisioned);
```

### Pattern 2: HMAC-SHA256 OTP Hash (Web Crypto API)

```typescript
// Source: Cloudflare Workers Web Crypto docs [VERIFIED: developers.cloudflare.com]
async function hashOtp(code: string, secret: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const codeBytes = new TextEncoder().encode(code);
  const sig = await crypto.subtle.sign('HMAC', key, codeBytes);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
```

### Pattern 3: XOR Accumulator Timing-Safe Comparison (locked per D-07)

```typescript
// XOR accumulator — constant time regardless of mismatch position [ASSUMED pattern]
async function timingSafeCompareHmac(
  submitted: string,
  stored: string,
  secret: string,
): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    hashOtp(submitted, secret),
    hashOtp(stored, secret),   // stored is already the hash — re-hash for comparison
  ]);
  const a = new TextEncoder().encode(hashA);
  const b = new TextEncoder().encode(hashB);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
```

**Note:** The simpler alternative is `crypto.subtle.timingSafeEqual(bufA, bufB)` which IS available in Workers. D-07 locks the XOR approach — proceed with it.

### Pattern 4: Resend Email (Production)

```typescript
// Source: Resend docs [VERIFIED: resend.com/docs/send-with-cloudflare-workers]
// Package: resend@6.12.3 [VERIFIED: npm registry]
import { Resend } from 'resend';

const resend = new Resend(env.RESEND_API_KEY);
await resend.emails.send({
  from: 'TravelMap <noreply@yourdomain.com>',
  to: [userEmail],
  subject: 'Your verification code',
  text: `Your code is: ${code}. It expires in 10 minutes.`,
});
```

**Workers compatibility:** Use `text` or `html` content, NOT the `react` parameter (Worker is `.ts`, not `.tsx`; React JSX is not available).

### Pattern 5: Mailpit HTTP Send API (Local Dev)

```typescript
// Source: github.com/axllent/mailpit send.go [VERIFIED: github.com/axllent/mailpit]
// Endpoint: POST http://localhost:8025/api/v1/send
await fetch('http://localhost:8025/api/v1/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    From: { Name: 'TravelMap', Email: 'noreply@localhost' },
    To: [{ Name: '', Email: userEmail }],
    Subject: 'Your verification code',
    Text: `Your code is: ${code}. It expires in 10 minutes.`,
  }),
});
```

**Key difference from Resend:** `From` is an object `{ Name, Email }`, not a string. `To` is an array of objects, not strings. Fields are PascalCase.

**Switching logic:** Check for `RESEND_API_KEY` in `env`. If present → Resend. If absent → Mailpit HTTP API at `http://localhost:8025`. (Do not embed the URL — read from env or use a conditional based on presence of RESEND_API_KEY.)

### Pattern 6: keycloak-js AIA Redirect

```typescript
// Source: keycloak-js type definition [VERIFIED: node_modules/keycloak-js/lib/keycloak.d.ts]
// action?: string  — accepts any string; all three values confirmed in profile.ts
await keycloak.login({
  action: 'webauthn-register-passwordless',  // or 'UPDATE_PASSWORD', 'delete_credential:{id}'
  redirectUri: window.location.href,
});
```

### Pattern 7: Per-Device Cookie

```typescript
// Source: CONTEXT.md D-13 [locked]
// SameSite=Strict is safe for localhost (same-site relative to port) and prod.
// Secure attribute intentionally omitted — would break localhost (HTTP).
document.cookie = `pnk_${userId}=1; max-age=2592000; SameSite=Strict`;
const hasCookie = document.cookie.includes(`pnk_${userId}=`);
```

**SameSite=Strict on localhost:** Works correctly. The `Secure` flag is NOT required by D-13 and would block the cookie on `http://localhost` — correct to omit.

### Pattern 8: Profile Modal Extension (last-credential guard)

The `buildDeleteModal()` function in `profile.ts` lines 151–170 creates the overlay/modal once at startup. The `openDeleteConfirm()` at line 173 re-wires button event listeners each time. The guard path (D-17 to D-19) is added inside `openDeleteConfirm`:

```typescript
// Inside openDeleteConfirm(credentialId):
if (credentialCount === 1) {
  // Hide freshConfirm, show guard button
  freshConfirm.setAttribute('hidden', '');
  const guardBtn = document.createElement('button');
  guardBtn.className = 'btn btn-primary';
  guardBtn.textContent = 'Register another passkey first';
  freshConfirm.parentNode?.insertBefore(guardBtn, freshConfirm);
  guardBtn.addEventListener('click', () => {
    keycloak.login({ action: 'webauthn-register-passwordless', redirectUri: window.location.href });
  }, { once: true });
}
```

**Modal text update:** `modal.querySelector('p')!.textContent = ...` or better: give the `<p>` an id during `buildDeleteModal()` so `openDeleteConfirm` can target it without a querySelector.

### Anti-Patterns to Avoid

- **Using `innerHTML` for OTP code display:** Use `textContent` or `setText()` (dom.ts helper). Raw 6-digit codes are safe but the pattern matters for consistency.
- **Putting `RESEND_API_KEY` in `wrangler.toml`:** Use `wrangler secret put RESEND_API_KEY` or `.dev.vars` for local.
- **Calling KC Account API for credential count on every delete click:** D-16 locks module-level variable from `loadPasskeys()` — do not make an extra API call.
- **Applying `SameSite=Secure` to the per-device cookie:** Breaks localhost. Omit `Secure` per D-13.
- **Using `react` parameter in Resend:** The Worker is `.ts`, not `.tsx`. Use `text` or `html`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery | Custom SMTP client | Resend SDK (prod) / Mailpit HTTP API (local) | Workers can't do raw TCP/SMTP; Resend SDK handles auth, retries, headers |
| JWT verification | Custom JWT parser | Existing `verifyJwt()` + `authMiddleware` | Already handles JWKS cache, RS256, aud, exp, iss |
| HMAC computation | Custom hash function | `crypto.subtle.importKey` + `crypto.subtle.sign` | Web Crypto is Workers-native; no dependencies |
| DB client | Raw SQL strings | Drizzle ORM (project standard) | Already configured for both local pg and Neon |
| Route auth | Custom Bearer header parse | `authMiddleware` + `ensureUserProvisioned` | Sets `c.var.user` and `c.var.dbUserId` — exact pattern required by D-01 |

---

## Common Pitfalls

### Pitfall 1: Mailpit HTTP API vs SMTP
**What goes wrong:** Worker calls `nodemailer` or tries raw SMTP to `localhost:1025` — fails at Workers runtime because TCP sockets require the `connect()` API which is not available by default.
**Why it happens:** D-08 says "Mailpit SMTP in local dev" which implies SMTP. Workers cannot do SMTP natively.
**How to avoid:** Use Mailpit's HTTP send API at `POST http://localhost:8025/api/v1/send` — confirmed available.
**Warning signs:** Import errors for `nodemailer` at Wrangler startup.

### Pitfall 2: Resend `react` parameter in `.ts` files
**What goes wrong:** Copying the Resend docs example verbatim — docs show `react: <EmailTemplate />` which requires JSX.
**Why it happens:** Resend docs target React/Next.js. Workers use `.ts`.
**How to avoid:** Use `text` or `html` parameter only. No JSX imports needed.
**Warning signs:** TypeScript error `JSX expressions must have one parent element` or `Cannot use JSX without --jsx flag`.

### Pitfall 3: OTP request body confusion
**What goes wrong:** `/otp-request` handler tries to read `{ email }` from request body.
**Why it happens:** Natural assumption — user provides email. D-02 locks it to `c.var.user.email`.
**How to avoid:** No request body on `/otp-request`. Email always from JWT via `c.var.user.email`.
**Warning signs:** Unnecessary `zValidator` on the request body; 422 errors when body is empty.

### Pitfall 4: Cookie check false positives
**What goes wrong:** `document.cookie.includes('pnk_')` fires for a different user's cookie left in the browser.
**Why it happens:** Cookie string check is too broad if `userId` is not included.
**How to avoid:** Always check `document.cookie.includes(`pnk_${userId}=`)` — exact match with equals sign and userId per CONTEXT.md specifics section.

### Pitfall 5: Campaign redirect before userId is available
**What goes wrong:** `checkPasskeyCampaign` is called before `getUserInfo()` returns a userId, so the cookie name is `pnk_undefined`.
**Why it happens:** `initKeycloak()` resolving does not guarantee token is parsed.
**How to avoid:** Per D-11 — call `checkPasskeyCampaign` after BOTH `initKeycloak()` resolves `true` AND `getUserInfo()` returns a non-null object with a valid `id`.

### Pitfall 6: `buildDeleteModal` creates multiple overlays
**What goes wrong:** `buildDeleteModal()` called twice creates two `#passkey-delete-overlay` elements; `openDeleteConfirm` targets the first (hidden) one.
**Why it happens:** Defensive re-call or hot-reload.
**How to avoid:** Guard with `if (document.getElementById('passkey-delete-overlay')) return;` at the start of `buildDeleteModal`.

### Pitfall 7: Drizzle schema import for `emailOtpCodes`
**What goes wrong:** Query file for OTP tries to import `emailOtpCodes` but the export name does not match.
**Why it happens:** Schema uses camelCase `emailOtpCodes`; developer searches for `email_otp_codes`.
**How to avoid:** Import as `import { emailOtpCodes } from '../schema'` — confirmed export name is `emailOtpCodes` (camelCase).

---

## Codebase Verification Summary

| Claim in CONTEXT.md | Verified? | Finding |
|---------------------|-----------|---------|
| `email_otp_codes` table migrated from Phase 7 | YES | `migrations/0003_add_email_otp_codes.sql` exists; schema matches BACK-03 exactly [VERIFIED: codebase] |
| `emailOtpCodes` in schema.ts | YES | Lines 179–189; columns: id, user_id, code_hash, expires_at, used_at, attempts, created_at [VERIFIED: codebase] |
| `authMiddleware` pattern | YES | `backend/src/middleware/auth.ts` — Bearer JWT → `verifyJwt()` → `c.set('user', payload)` [VERIFIED: codebase] |
| `ensureUserProvisioned` sets `c.var.dbUserId` | YES | `backend/src/middleware/user.ts` line 32: `c.set('dbUserId', dbUser.id)` [VERIFIED: codebase] |
| `routes/index.ts` mounting pattern | YES | Three existing mounts: `/health`, `/users`, `/trips`, `/public` — add `/auth` follows same pattern [VERIFIED: codebase] |
| `Env` interface does NOT yet have `OTP_SECRET` | YES | `backend/src/types/index.ts` has 5 fields; `OTP_SECRET` absent [VERIFIED: codebase] |
| `resend` NOT in `backend/package.json` | YES | Dependencies section confirmed — must install [VERIFIED: codebase] |
| `keycloak.login({ action: '...' })` typed as `action?: string` | YES | `node_modules/keycloak-js/lib/keycloak.d.ts` line: `action?: string` [VERIFIED: codebase] |
| `profile.ts:loadPasskeys()` | YES | Lines 56–115; fetches `/account/credentials?type=webauthn-passwordless` [VERIFIED: codebase] |
| `profile.ts:openDeleteConfirm()` | YES | Lines 173–210; clones buttons to strip prior listeners [VERIFIED: codebase] |
| `profile.ts:buildDeleteModal()` | YES | Lines 151–171; overlay+modal pattern, `hidden` attribute [VERIFIED: codebase] |
| `profile.ts:registerPasskey()` | YES | Lines 117–130; calls `keycloak.login({ action: 'webauthn-register-passwordless' })` [VERIFIED: codebase] |
| `dashboard.ts` calls `initKeycloak()` + `getUserInfo()` | YES | Lines 198–237; `getUserInfo()` at line 13 import, used at line 122 [VERIFIED: codebase] |
| `passkeyCampaign.ts` does NOT exist | YES | `ls frontend/src/modules/` — absent; file to be created [VERIFIED: codebase] |
| Mailpit on port 8025 in docker-compose | YES | `keycloak/docker-compose.yml` lines 46–51: `image: axllent/mailpit:v1.29`, ports 1025/8025 [VERIFIED: codebase] |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| KC `action` typed as enum | `action?: string` in keycloak-js | KC 26+ | Any AIA action string works; no type narrowing needed |
| `crypto.timingSafeEqual` assumed missing | `crypto.subtle.timingSafeEqual` IS available | Workers runtime (non-standard) | D-07 uses XOR accumulator; simpler alternative exists but locked |
| Mailpit SMTP only | Mailpit HTTP send API at `/api/v1/send` | Mailpit v1.21+ | Workers can call HTTP; avoids TCP socket requirement |
| Resend `react` parameter | `text` / `html` for non-React contexts | Resend SDK v6 | Required when Worker is `.ts` not `.tsx` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | HMAC+XOR stores the HASH in `code_hash` and re-hashes the submitted code to compare — NOT the raw code | Architecture Patterns / Pattern 3 | Wrong comparison direction would never match; low risk since both sides hash |
| A2 | Mailpit `/api/v1/send` is accessible via fetch in local Workers dev without CORS issues | Architecture Patterns / Pattern 5 | If CORS blocks: add `MP_SEND_AUTH` or use Mailpit's `--cors` flag |
| A3 | `RESEND_API_KEY` env var name matches what already exists in prod Worker secrets | Standard Stack | Name mismatch means prod emails fail silently |

---

## Open Questions

1. **`crypto.subtle.timingSafeEqual` vs HMAC+XOR (D-07)**
   - What we know: Cloudflare Workers exposes `crypto.subtle.timingSafeEqual` as a non-standard extension [VERIFIED: developers.cloudflare.com/workers/examples/protect-against-timing-attacks/]
   - What D-07 says: "Workers lacks `crypto.timingSafeEqual`" — this premise is factually incorrect
   - Decision impact: ZERO — HMAC+XOR (D-07) is a valid timing-safe approach regardless
   - Recommendation: Proceed with HMAC+XOR per D-07; note for tech debt cleanup that `crypto.subtle.timingSafeEqual` is available if ever simplified

2. **`skip-if-exists` AIA parameter for campaign (D-15)**
   - What we know: KC 26.3+ supports `kc_action=webauthn-register-passwordless:skip-if-exists` [VERIFIED: keycloak.org 26.3.0 release notes]
   - What D-15 says: Use bare `webauthn-register-passwordless`
   - Impact: Without `skip-if-exists`, users who already have a passkey on ANOTHER device and visit on the SAME device will be redirected to register again (per-device cookie stops this only for the current device)
   - Recommendation: D-15 is locked; proceed with bare action string; document this as a known UX limitation

3. **Mailpit CORS on localhost**
   - What we know: Mailpit HTTP API documented; no CORS headers confirmed
   - What's unclear: Whether the Workers `fetch()` to `localhost:8025` hits CORS — this is server-to-server (Worker dev server to Mailpit), not browser-to-Mailpit, so CORS does NOT apply
   - Recommendation: No issue — Worker `fetch()` is not a browser CORS-restricted call

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Mailpit container | Local OTP email | Confirmed in docker-compose | v1.29 | — |
| Mailpit port 8025 | HTTP send API | Configured (runtime probe needed) | — | Start with `docker compose up mailpit` |
| resend npm package | Prod email delivery | Not installed | 6.12.3 (latest) | — (must install) |
| `RESEND_API_KEY` secret | Prod Resend calls | Not in `.dev.vars` (local not needed) | — | Local uses Mailpit |
| `OTP_SECRET` binding | HMAC key | Not yet in `.dev.vars` or `Env` | — | Add to both before local test |

**Missing dependencies with no fallback:**
- `resend` package: `cd backend && npm install resend` — planner must include this as Wave 0 task
- `OTP_SECRET` env binding: must be added to `backend/src/types/index.ts` (`Env` interface), `.dev.vars`, and `.dev.vars.example`

**Missing dependencies with fallback:**
- Mailpit port: start with `docker compose up` from `keycloak/`

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 |
| Config file | `backend/vitest.config.ts` (inferred from package.json `test: vitest run`) |
| Quick run command | `cd backend && npm test` |
| Full suite command | `cd backend && npm test && cd ../frontend && npm run test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PASS-05 | `POST /api/auth/otp-request` returns 201 with valid email | unit | `cd backend && npm test -- --reporter=verbose src/routes/auth.test.ts` | ❌ Wave 0 |
| PASS-05 | `POST /api/auth/otp-request` returns 429 when OTP already pending | unit | same | ❌ Wave 0 |
| PASS-05 | `POST /api/auth/otp-request` returns 422 when email absent | unit | same | ❌ Wave 0 |
| PASS-05 | `POST /api/auth/otp-verify` returns 200 on correct code | unit | same | ❌ Wave 0 |
| PASS-05 | `POST /api/auth/otp-verify` returns 429 after 5 attempts | unit | same | ❌ Wave 0 |
| PASS-04 | `checkPasskeyCampaign` sets cookie and calls `keycloak.login` when capable + no cookie | unit | `cd frontend && npm run test:run -- src/modules/passkeyCampaign.test.ts` | ❌ Wave 0 |
| PASS-04 | `checkPasskeyCampaign` is no-op when cookie present | unit | same | ❌ Wave 0 |
| PASS-06 | Delete modal shows guard state when credentialCount === 1 | unit/manual | manual inspection | manual-only |
| PASS-07 | UPDATE_PASSWORD redirect fires only when `!webauthnCapable` after OTP verify | unit | frontend dashboard.test.ts | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd backend && npm test`
- **Per wave merge:** `cd backend && npm test && cd ../frontend && npm run test:run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `backend/src/routes/auth.test.ts` — covers PASS-05 (request + verify, 429, 422, 401 unauthed)
- [ ] `backend/src/db/queries/otp.test.ts` — optional: unit test OTP query helpers with mock DB
- [ ] `frontend/src/modules/passkeyCampaign.test.ts` — covers PASS-04 (cookie logic, redirect trigger)
- [ ] `frontend/src/pages/dashboard.test.ts` — covers PASS-07 (UPDATE_PASSWORD gate, webauthnCapable flag)
- [ ] Mock env in `backend/src/routes/auth.test.ts` must include `OTP_SECRET` (new field)

**Existing test infrastructure:** `backend/src/index.test.ts` provides the mock env pattern and `app.request()` Hono test pattern — new `auth.test.ts` follows the same structure.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OTP: 6-digit, 10-min TTL, single-use, max 5 attempts per window |
| V3 Session Management | no | KC handles sessions; no custom session |
| V4 Access Control | yes | Both OTP endpoints behind `authMiddleware` — unauthenticated callers get 401 |
| V5 Input Validation | yes | Zod schema on `/otp-verify` body `{ code: string }`; email from JWT not user input |
| V6 Cryptography | yes | HMAC-SHA256 for OTP hash; `OTP_SECRET` from env binding — never in source |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| OTP brute force | Tampering | Max 5 attempts → exhausted (D-09); TTL 10 min |
| OTP replay | Repudiation | `used_at` set on first successful verify; single-use enforced |
| Email takeover via request body | Spoofing | Email from JWT only (D-02); users cannot supply arbitrary email |
| Timing oracle on OTP compare | Information Disclosure | HMAC+XOR accumulator (D-07); constant time |
| Cookie session fixation for campaign | Spoofing | Per-device cookie uses `userId` from KC JWT; cannot be set by another user |

---

## Sources

### Primary (HIGH confidence)
- Codebase — `backend/src/middleware/auth.ts`, `user.ts`, `db/schema.ts`, `routes/index.ts`, `types/index.ts`, `auth/keycloak.ts`, `frontend/src/auth/keycloak.ts`, `frontend/src/pages/profile.ts`, `frontend/src/pages/dashboard.ts` — direct file reads
- `node_modules/keycloak-js/lib/keycloak.d.ts` — `KeycloakLoginOptions.action?: string` type definition
- `backend/migrations/0003_add_email_otp_codes.sql` — migration confirmed
- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) — HMAC support and `timingSafeEqual` availability
- [Cloudflare Workers timingSafeEqual example](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/) — confirmed available as non-standard extension
- [Cloudflare Workers signing requests](https://developers.cloudflare.com/workers/examples/signing-requests/) — HMAC pattern
- [Resend Cloudflare Workers docs](https://resend.com/docs/send-with-cloudflare-workers) — send API confirmed
- npm registry — `resend@6.12.3` is current version
- [Mailpit send.go source](https://github.com/axllent/mailpit/blob/develop/server/apiv1/send.go) — HTTP send API payload schema (PascalCase fields)

### Secondary (MEDIUM confidence)
- [Keycloak 26.3.0 release notes](https://www.keycloak.org/2025/07/keycloak-2630-released) — `skip-if-exists` AIA parameter added
- [Keycloak JS adapter docs](https://www.keycloak.org/securing-apps/javascript-adapter) — `action` parameter described

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in codebase or npm registry
- Architecture: HIGH — all referenced functions exist and match CONTEXT.md descriptions
- Pitfalls: HIGH — derived from actual code inspection plus verified Cloudflare/Resend docs
- Mailpit HTTP API payload: MEDIUM — field names verified from source code, not official prose docs

**Research date:** 2026-05-24
**Valid until:** 2026-06-24 (Resend and keycloak-js APIs are stable; KC 26.x series unlikely to break AIA within 30 days)
