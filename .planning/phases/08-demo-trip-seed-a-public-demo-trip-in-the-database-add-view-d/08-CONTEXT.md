# Phase 8: OTP + Passkey Campaign — Context

**Gathered:** 2026-05-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Two new Hono route handlers for email OTP (request + verify); a new frontend module for the post-login passkey campaign; a last-credential guard added to the profile delete flow; and frontend-driven UPDATE_PASSWORD redirect after OTP verify on non-WebAuthn devices.

No new HTML pages. No KC Java SPIs. No production Terraform changes. No changes to the existing KC auth flow.

</domain>

<decisions>
## Implementation Decisions

### OTP endpoints (PASS-05)

- **D-01:** Both `POST /api/auth/otp-request` and `POST /api/auth/otp-verify` are Bearer-protected. Use existing `authMiddleware` from `backend/src/middleware/auth.ts` and `ensureUserProvisioned` from `backend/src/middleware/user.ts` — same two-phase pattern as trips/users routes. `c.var.user` and `c.var.dbUserId` are available in handlers.
- **D-02:** Email is derived from `c.var.user.email` (JWT payload) — NOT taken from the request body. Users cannot supply someone else's email.
- **D-03:** If `c.var.user.email` is undefined or empty, return HTTP 422 `{ success: false, error: 'no_email' }`. Do not attempt OTP generation.
- **D-04:** If a valid (unexpired, unused) OTP already exists for this user when `/otp-request` is called, return HTTP 429 `{ success: false, error: 'otp_pending', retryAfter: <seconds until expiry> }`. Do not generate a new code.
- **D-05:** New route file `backend/src/routes/auth.ts` mounted at `/auth` in `routes/index.ts` → final paths `/api/auth/otp-request` and `/api/auth/otp-verify`.
- **D-06:** OTP lookup and write use `c.var.dbUserId` to query/insert into `email_otp_codes`. Do not use `keycloak_id` directly — the DB foreign key is on `users.id`.
- **D-07:** OTP code generation: 6-digit numeric string (leading zeros allowed). Hash stored as HMAC-SHA256 using a `OTP_SECRET` env binding (add to `Env` interface). Comparison uses HMAC-SHA256 + XOR accumulator (timing-safe; Workers lacks `crypto.timingSafeEqual`).
- **D-08:** Resend SDK sends email in prod; Mailpit SMTP in local dev. Resend is already a Worker dependency — check if installed, else add `resend` npm package.
- **D-09:** After max 5 failed attempts on `/otp-verify`, mark the code as exhausted (`used_at = now()`) and return HTTP 429 `{ success: false, error: 'max_attempts' }`.

### Passkey campaign (PASS-04)

- **D-10:** Campaign logic lives in a new module `frontend/src/modules/passkeyCampaign.ts`, exported as `checkPasskeyCampaign(userId: string): void`.
- **D-11:** Only `frontend/src/pages/dashboard.ts` calls `checkPasskeyCampaign()` — called after `initKeycloak()` resolves with `true` and `getUserInfo()` provides the userId.
- **D-12:** WebAuthn capability check: `typeof PublicKeyCredential !== 'undefined'`.
- **D-13:** Cookie name: `pnk_${userId}`. Written with `document.cookie = 'pnk_${userId}=1; max-age=2592000; SameSite=Strict'`.
- **D-14:** Cookie is written BEFORE the redirect (prevents redirect loop if KC registration fails silently or user presses back).
- **D-15:** Redirect trigger: `keycloak.login({ action: 'webauthn-register-passwordless', redirectUri: window.location.href })`. Uses the `keycloak` singleton already exported from `frontend/src/auth/keycloak.ts`.

### Last-credential delete guard (PASS-06)

- **D-16:** Credential count is tracked in a module-level variable (`let credentialCount = 0`) updated inside `loadPasskeys()`. No extra API call on delete click.
- **D-17:** When the Delete button is clicked and `credentialCount === 1`, the confirm modal OPENS but the "Delete" button is replaced with a "Register another passkey first" button that calls `registerPasskey()`.
- **D-18:** Modal title stays "Delete passkey?" but the body text changes to: "You must register another passkey on another device before deleting this one." The "Delete" button is hidden; the "Register another passkey first" button is shown.
- **D-19:** "Register another passkey first" calls `keycloak.login({ action: 'webauthn-register-passwordless', redirectUri: window.location.href })` — same as `registerPasskey()`.

### UPDATE_PASSWORD flow coordination (PASS-07)

- **D-20:** Frontend-driven. The Worker does NOT call KC Admin API in the verify flow. After `/otp-verify` returns 200, the Worker returns `{ success: true }` and is done.
- **D-21:** Dashboard holds a `let webauthnCapable: boolean` flag (set during campaign check using `typeof PublicKeyCredential !== 'undefined'`). After a successful `/otp-verify` response, dashboard checks this flag: if `!webauthnCapable`, call `keycloak.login({ action: 'UPDATE_PASSWORD', redirectUri: window.location.href })`. If WebAuthn-capable, just dismiss the OTP modal.

### OTP UI on dashboard (PASS-05, PASS-07)

- **D-22:** Dashboard detects `!webauthnCapable` on load (after `initKeycloak()`) and shows a persistent banner: "Your device doesn't support passkeys. Verify your email to set a password." with a "Send code" button.
- **D-23:** "Send code" calls `POST /api/auth/otp-request`. On success (201), opens a modal overlay on dashboard with: a description ("Check your email for a 6-digit code"), a 6-digit input field, a "Verify" submit button, and a "Resend" button (disabled; enabled with a countdown when 429 is returned with `retryAfter`).
- **D-24:** On `/otp-verify` 200: dismiss modal, then (if `!webauthnCapable`) redirect via `keycloak.login({ action: 'UPDATE_PASSWORD' })`. On 400/401/429: show inline error in modal (wrong code, expired, too many attempts).

### Claude's Discretion

- Exact OTP email template (subject, body, plain-text vs HTML)
- OTP modal and banner CSS/styling
- How the 429 `retryAfter` countdown is displayed in the UI (timer or static text)
- `OTP_SECRET` value for local dev — generate a random hex string, document in `wrangler.dev.toml.example`
- Whether to add Zod schemas for the two OTP request bodies (both are effectively empty — no body needed for `/otp-request`; `/otp-verify` takes `{ code: string }`)
- Migration file name for any schema changes (none expected — `email_otp_codes` table is already migrated from Phase 7)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and goals
- `.planning/REQUIREMENTS.md` §PASS-04, PASS-05, PASS-06, PASS-07 — full requirement definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 8 — 5 success criteria that define done

### Backend source files
- `backend/src/middleware/auth.ts` — `authMiddleware` pattern to apply to new `/auth` routes
- `backend/src/middleware/user.ts` — `ensureUserProvisioned` pattern; sets `c.var.dbUserId`
- `backend/src/db/schema.ts` — `emailOtpCodes` table definition (already migrated from Phase 7)
- `backend/src/routes/index.ts` — route mounting; add `routes.route('/auth', authRoute)` here
- `backend/src/types/index.ts` — `Env` interface (add `OTP_SECRET: string`), `KeycloakJwtPayload.email?: string`
- `backend/src/auth/keycloak.ts` — `extractUserInfo()`, base64url helpers available for reuse

### Frontend source files
- `frontend/src/auth/keycloak.ts` — `initKeycloak()`, `keycloak` singleton, `login()` with `action` param
- `frontend/src/pages/profile.ts` — `loadPasskeys()`, `openDeleteConfirm()`, `registerPasskey()`, `buildDeleteModal()` — all need modification for D-16 to D-19
- `frontend/src/pages/dashboard.ts` — integration point for campaign check (D-11) and OTP flow (D-22 to D-24)

### Prior phase context
- `.planning/phases/07-passkey-login-wire-browser-passkey-keycloak-flow-as-default-/07-CONTEXT.md` — D-01 (japan-trip-worker KC client), D-03 (KC Admin API env vars already in Env), D-08 (emailOtpCodes schema)
- `.planning/STATE.md` — key decisions: HMAC-SHA256+XOR for timing-safe OTP comparison; Resend (prod) / Mailpit (local) for email delivery

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- `authMiddleware` + `ensureUserProvisioned`: copy the same `tripsRoute.use('*', ...)` middleware chain for the new `authRoute`
- `profile.ts:showStatus()`: reusable error display helper — already used for passkey status messages
- `profile.ts:registerPasskey()`: already calls `keycloak.login({ action: 'webauthn-register-passwordless' })` — reuse from the "Register another passkey first" guard button
- `profile.ts:buildDeleteModal()`: existing modal builder — extend its state to handle the last-credential guard path
- `base64urlDecode()` in `backend/src/auth/keycloak.ts` — available for reuse in OTP hash helpers if needed

### Established patterns
- Route mounting: `routes.route('/auth', authRoute)` follows existing pattern in `routes/index.ts`
- Two-phase auth middleware: all protected routes do `route.use('*', authMiddleware, ensureUserProvisioned)` — apply to authRoute
- Hono response envelope: all routes return `ApiResponse<T>` with `{ success: boolean, data?, error? }` — use the same shape for OTP responses
- Modal builder pattern (profile.ts:151–170): creates overlay div, appends modal div, uses `hidden` attribute — follow same pattern for OTP modal on dashboard
- Module-level variables: `profile.ts` already uses module-level variables for DOM state — `credentialCount` follows the same pattern

### Integration points
- `routes/index.ts` line 22: add `import authRoute from './auth'` and `routes.route('/auth', authRoute)` after the public route mount
- `backend/src/types/index.ts` `Env` interface: add `OTP_SECRET: string` (used in OTP HMAC)
- `frontend/src/pages/dashboard.ts`: after the `authenticated = await initKeycloak()` check, call `checkPasskeyCampaign(info.id)` and (if `!webauthnCapable`) build the OTP banner + wire the "Send code" flow
- `frontend/src/pages/profile.ts:56`: `loadPasskeys()` — update to track `credentialCount` and pass it to `openDeleteConfirm()`
- `frontend/src/pages/profile.ts:173`: `openDeleteConfirm(credentialId)` — add guard path when `credentialCount === 1`

</code_context>

<specifics>
## Specific Ideas

- `retryAfter` in the 429 response: include seconds as a number so the frontend can render a countdown (`retryAfter: 347` = "try again in 5:47")
- OTP modal on dashboard should be built similarly to the delete modal in profile.ts — overlay div + modal div, `hidden` attribute toggled
- Cookie check in `passkeyCampaign.ts`: `document.cookie.includes('pnk_${userId}=')` — simple string check is sufficient

</specifics>

<deferred>
## Deferred Ideas

- KC Admin API call to force UPDATE_PASSWORD server-side — decided against (frontend-driven is sufficient and simpler); could be revisited if frontend loses state between verify and redirect
- Separate `otp.html` page — decided against; modal overlay on dashboard is sufficient
- OTP fallback on pages other than dashboard — campaign and OTP UI scoped to dashboard only; profile and trip-detail are not affected

</deferred>

---

*Phase: 08-otp-passkey-campaign*
*Context gathered: 2026-05-24*
