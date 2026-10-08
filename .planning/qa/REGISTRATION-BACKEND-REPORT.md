# Self-registration, backend half - report

Branch: worktree-agent-a0a5dd1253decb0df (no push, no PR). Scope: `backend/`, deploy env forwarding, docs/SELF-HOSTING.md.

## What changed

| Area | Files |
|---|---|
| Migration 0011 | `backend/src/db/migrations/0011_email_verification.sql`, `schema.ts`, `schema-guard.ts` |
| Shared OTP core | `backend/src/auth/otp-core.ts` (hash, compare, `checkOtp`, `issueAndSendOtp`), `queries/otp.ts` (purpose, `releaseOtp`) |
| Verified-email gate | `config/verified-email.ts`, `middleware/verified-email.ts` |
| E-mail verification | `routes/auth.ts` (`/email-verify/request|confirm`), `routes/users.ts` (`email_verified`) |
| Recovery | `routes/recovery.ts`, `auth/keycloak-admin.ts`, `auth/password-policy.ts` |
| Env forwarding | `node/config.ts` SERVER_ENV_CONTRACT, `deploy/selfhost/docker-compose.prod.yml`, `.env.example` |
| `onboarding.is_new` | cherry-picked from the frontend branch (commit f017a77), kept next to `email_verified` |

## Migration 0011

- `users.email_verified_at timestamptz` (nullable). **Backfill: every user existing at migration time is stamped `now()`** (grandfathered; otherwise REQUIRE_VERIFIED_EMAIL would lock all current users out on first deploy). Only stamped when the column is created by this migration (a push-built DB that already has the column keeps NULLs).
- `email_otp_codes.purpose text NOT NULL DEFAULT 'login'` + CHECK in (`login`,`email_verify`,`recovery`). Existing rows become `login`.
- `otp_issue(..., p_purpose)` 6-arg: pending check and hourly cap are per (user, purpose). The 5-arg form remains as a wrapper for `login` (rolling deploys with the old Worker keep working).
- Schema guard requires: `column users.email_verified_at`, `column email_otp_codes.purpose`, `function otp_issue(purpose)` (503 `schema_not_migrated` until migrated). Column names `keycloak_id`, `email_verified_at` are as the IdP purge script expects.

## Contract for frontend and Keycloak agents

All JSON. Errors use `{success:false,error,...}`.

### Verified definition
`users.email_verified_at IS NOT NULL` OR token claim `email_verified === true` (boolean; `"true"`, `1`, `null`, missing = not verified).

### Gate (REQUIRE_VERIFIED_EMAIL)
Unset: true when ENVIRONMENT != development; `true`/`false` explicit; any other value = true. When on, every authenticated route except `GET|PATCH /api/users/me`, `POST /api/auth/email-verify/request|confirm` and health answers

`403 {"success":false,"error":"email_not_verified","code":"email_not_verified"}`

(trips, destinations, days, activities, hotels, `/api/geocode`, `/api/users/me/trips`, `/api/auth/otp-request|otp-verify`). A test enumerates `app.routes`, so a new route cannot ship ungated.

### GET /api/users/me
`200|201 {success:true,data:{...user row, email_verified:boolean, email_verified_at, onboarding:{is_new:boolean}}}`. PATCH returns `email_verified` too.

### POST /api/auth/email-verify/request (Bearer, no body)
- `201 {success:true}` code mailed to the TOKEN e-mail (works while unverified; the only such flow).
- `200 {success:true,data:{email_verified:true}}` already verified, nothing sent.
- `422 {error:'no_email'}`; `429 {error:'otp_pending'|'otp_rate_limited',retryAfter}` (pending code / 5 per hour per purpose); `429 {error:'rate_limited',retryAfter}` + `Retry-After` (limits: 20/h per IP, 6/15min per account, 5/h per address).
### POST /api/auth/email-verify/confirm (Bearer) `{code:"123456"}`
- `200 {success:true,data:{email_verified:true}}`.
- `400 {error:'invalid_code'|'otp_not_found'}`, `429 {error:'max_attempts'}` (5 guesses, then the code is dead), `422 validation_error` for a malformed code, `429 rate_limited` (60/15min per IP, 15/15min per account).
After success the same token passes the gate (DB flag), no re-login needed.

### POST /api/auth/recovery/request (no auth) `{email}`
- `202 {success:true,message:"If an account exists for that address, a recovery code has been sent."}` identical for known/unknown (body, headers, ~latency). Mail is sent in the background only for an existing account.
- `422 validation_error` (not an address), `429 rate_limited` (10/h per IP, 3/h per address, 300/h global), `503 {error:'try_again_later',code:'service_unavailable'}` when recovery is not configured (no `KEYCLOAK_RECOVERY_CLIENT_SECRET`).
### POST /api/auth/recovery/confirm (no auth) `{email,code,new_password}`
- `200 {success:true}`; also sets `email_verified_at`.
- `400 {success:false,error:'invalid_code'}` for unknown account, no pending code, wrong code, expired or burned code (indistinguishable).
- `422 {error:'weak_password',code:'weak_password',reason}` with reason `too_short|too_long|contains_nul|blank|matches_email|rejected` (`rejected` = Keycloak realm policy). Checked before any state change; the code stays valid.
- `422 {error:'recovery_unavailable'}` account missing/disabled/ambiguous in Keycloak (code spent).
- `503 {error:'try_again_later',code:'service_unavailable'}` Keycloak down/401/5xx/timeout; the code is given back, retry with the same code.
- `429 rate_limited` (20/15min per IP, 10/15min per address, 300/h global).
- Keycloak calls (needed IdP config): token `POST {base}/realms/{realm}/protocol/openid-connect/token` (client_credentials, `travelmap-recovery`), `GET /admin/realms/{realm}/users?email=..&exact=true`, `PUT /admin/realms/{realm}/users/{id}/reset-password {type:'password',value,temporary:false}`; then `PUT users/{id}` dropping required action `webauthn-register-passwordless`; for an account whose `email_verified_at` is NULL and Keycloak `emailVerified != true` also `GET users/{id}/credentials`, `DELETE` each non-password credential, `POST users/{id}/logout`. Needs `manage-users` (the lookup also works with `view-users`). Cleanup failures are logged and do not fail the recovery.
- Not done (optional item 4 of the IdP relay): moving the passkey credential first.

### Env
`REQUIRE_VERIFIED_EMAIL`, `KEYCLOAK_ADMIN_URL` (default KEYCLOAK_URL; compose passes `http://keycloak:8080/auth`; `/auth` prefix and trailing slashes handled), `KEYCLOAK_RECOVERY_CLIENT_ID` (default `travelmap-recovery`), `KEYCLOAK_RECOVERY_CLIENT_SECRET`. All in SERVER_ENV_CONTRACT + compose + `.env.example`; boot validation rejects a bad REQUIRE_VERIFIED_EMAIL or non-URL admin URL.

## Tests (real Postgres 16)

- `src/db/migrations.test.ts` (0011 on populated DB: backfill, legacy OTP rows, 5-arg wrapper, per-purpose pending/cap, CHECK, push-built DB), `tests/system/upgrade-path.test.ts` (legacy DB gets grandfathered users; journal-length expectations are dynamic, no count edits needed), `src/db/schema-guard.test.ts` (ready / not ready for each new object).
- `src/routes/email-verify.test.ts` (27), `src/config/verified-email.test.ts`, `src/auth/password-policy.test.ts`.
- `tests/adversarial/email-verification.test.ts` (81): table-driven 403 over every route in `app.routes` (+401 without token), claim variants (false, "true", 1, null, object, array, missing), DB flag, parallel confirms (single success), 50 parallel guesses (<=5 evaluated), replay, expiry, wrong user, cross-purpose, rate-limit exhaustion, spoofed XFF with hops=0 and trusted-proxy hops=1.
- `tests/adversarial/recovery.test.ts` (77): enumeration (identical status/body/headers; latency medians within 20 ms), brute force, replay, expiry, parallel confirms, wrong e-mail/user, password policy table (unicode, emoji, NUL, 1 MB, equal/contained e-mail, full-width), Keycloak stubs (401/403/500/503/garbage/down/hang-timeout at each stage, not found, two users, disabled, malicious id, 400 policy), code given back on retryable failures, log hygiene (no code/password/e-mail/secret/token in any log line), per-IP/per-address/global limits, spoofed headers, route table.

Results: typecheck both workspaces clean; backend suite run three times (see final message for counts); `wrangler deploy --dry-run` and `CSP_ALLOW_MISSING_ORIGINS=true npm run build` green.

## Risks and notes

1. Recovery only works for accounts that already have a row in `users` (first authenticated request creates it). A Keycloak user who registered but never reached `/api/users/me` cannot recover until they have; the frontend calls `/users/me` right after sign-up, so this is the unusual case.
2. Parallel requests each spend an attempt (SEC-07 design, unchanged): 50 parallel confirms with the right code may all fail; never more than one succeeds.
3. Background mail in `recovery/request`: on Node a crash/shutdown right after the 202 can drop the mail (user retries). Failures are logged scrubbed, never surfaced.
4. The global recovery buckets (300/h) bound mail-bombing at scale but also let an attacker exhaust recovery for everyone for an hour; the per-IP limit is the first line. On Workers the in-memory limiter is per isolate (existing caveat).
5. The e-mail verification code is sent to the TOKEN address. If Keycloak allowed changing the e-mail between request and confirm, a code for address A could verify an account now showing B; keep realm "edit email" off or re-verified.
6. Unverified-account detection for the credential purge uses the DB flag plus Keycloak `emailVerified`; a legitimate new user who never verified and recovers loses passkeys they had enrolled (intended, matches the squatting defence).
7. Rate-limited login `otp-request` for an unverified-token user whose DB flag is set is now allowed (address proven); previously token-only.
8. `docs/SELF-HOSTING.md` has the new section; the realm/Terraform side is the IdP agent's.
