---
gsd_state_version: 1.0
milestone: v3.3
milestone_name: UX & Product Polish
status: v3.3_shipped_pending_owner_validation_on_real_devices
stopped_at: v3.3 shipped (PR #27 `c7d54dc`, PR #28 `460a449`, PR #29 `38b9108`, PR #30 `432aba5`); login theme cache-busting fix in PR #31; nothing deployed, nothing validated on real devices
last_updated: "2026-10-09T12:00:00.000Z"
last_activity: 2026-10-09 -- Phase 33 recorded (UX-NAV-02, TEST-PARITY-01 in PR #30; UX-KC-04 in PR #31, pending); QA report qa/UX-REPORT.md
progress:
  total_phases: 8
  completed_phases: 8
  total_plans: 6
  completed_plans: 6
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-09 — v3.3 shipped; registration batch and v3.2 merged)

**Core value:** A user can build a complete trip itinerary end-to-end from the UI — destinations, hotels, days, activities — and see it visualized on a map.
**Current focus (2026-10-09): v3.3 is shipped; next is owner validation on real devices plus the residual items.** v3.3 UX & Product Polish (phases 27-32) is in `main`: PR #27 (`c7d54dc`, UX-KC-01..03, UX-NAV-01, UX-SEARCH-01, UX-TRIP-01, UX-TRIP-02) and PR #28 (`460a449`, UX-MOB-01). Passkey-first login (PKF-01..04) is merged as PR #29 (`38b9108`). PR #30 (`432aba5`) added the demo-parity acceptance test (TEST-PARITY-01) and the iOS `redirect_uri` fix (UX-NAV-02, `silentCheckSsoFallback: false`). PR #31 fixes the stale Keycloak login CSS on phones (UX-KC-04): production Keycloak serves theme resources with a 30-day `Cache-Control` under its own version hash, so the owner's iPhone showed the OLD `login.css` on the NEW templates; `template.ftl` now links assets as `?v=${properties.jpAssetVersion}` (refresh with `node tests/e2e/fixtures/idp-theme/asset-version.mjs --write`), plus friendly error pages. For it to reach a phone the Keycloak image must be rebuilt and redeployed (`deploy.sh`); browsers pick it up on their next page load. All of it is sandbox-validated only (Chromium, Keycloak 26.6.1 with a virtual authenticator); nothing is deployed. Owner steps: pull `main`, redeploy the Keycloak image (new theme), re-run `keycloak-apply` on the Lenovo (for passkey-first the plan adds 5 resources, updates the realm passkey setting, profile mappers no change; `docs/SELF-HOSTING.md`), set `REGISTRATION_ENABLED` + SMTP for Sign up (the Pages build now includes sign-up when `VITE_KEYCLOAK_URL` is set), then try on a real iPhone and Android: Face ID / Touch ID / biometrics, the iOS Safari user-gesture rule for the passkey prompt, installed PWA, keyboard overlap, OTP autofill, a real swipe over the map. Residual items: "remember me" is off (`remember_me=false`, SSO idle 30 min / max 10 h; owner may want longer sessions, proposal only); search deep link to a day/activity ignored by `tripDetail.ts`; external cover images blocked by the CSP `img-src`; editor cramped in landscape; profile heading flush; drop-a-pin hint says "Click ... Esc"; navbar `role=tab` on links; weather/news widgets not on the trip city view; no per-IP sign-up throttle (REG-06); `deploy/selfhost/scripts/lib/common.sh` hard-codes `FRONTEND_ORIGIN` defaults instead of reading `config/deploy-defaults.json`. Earlier focus, still valid for ops: PR #24 (`d2dd404`), PR #25 (`41f43d4`) and PR #26 (`6d4c4f1`) are merged; validate on the owner's server `legion-server.tailad4a36.ts.net` (Funnel, Gmail, passkeys) and read the `Keycloak flow` workflow on Actions (QA-01, REG-07).

## Current Position

Phase: 26 of 26 (all v3.2 phases executed and merged); post-v3.2 production-readiness batch (PR #24) not phased
Plan: n/a — Phases 22-26 ran from summaries, not PLAN.md files; the batch ran as five parallel tracks plus one integration pass
Status: v3.3 shipped to `main` (PR #27, PR #28, PR #29, PR #30); PR #31 (login theme cache-busting) pending. v3.2 shipped to `main` (CI green). PR #24 (`d2dd404`), PR #25 self-registration (`41f43d4`) and PR #26 docs (`6d4c4f1`) are merged; validated in the sandbox only. see the v3.3 notes in the current focus above
Last activity: 2026-10-09

Progress: v3.2 100%, v3.3 100%. Requirements: 103 Complete, 4 Partial (DEP-02, SEC-17, PROD-01, REG-06), 3 Unverified (QA-01, REG-01, REG-07), 0 Deferred, 0 In progress (110 rows: 82 audit-derived, DATA-04, PROD-01..04, QA-01, REG-01..07, UX-KC-01..04, UX-NAV-01..02, UX-SEARCH-01, UX-TRIP-01..02, UX-MOB-01, PKF-01..04, TEST-PARITY-01). PR #24 is in `main` as `d2dd404` (its "open / running checks" wording below is from before the merge); the registration batch is merged as PR #25 (`41f43d4`), its docs as PR #26 (`6d4c4f1`). v3.3 added 15 rows, all Complete (PKF-01..04 in PR #29; UX-NAV-02 and TEST-PARITY-01 in PR #30; UX-KC-04 in PR #31, pending).

GitHub Actions evidence (checked 2026-10-08 through the API): PR #23 head `2200c6e` had all 10 checks green (`e2e`, `accessibility`, `gitleaks`, `test-backend`, `test-frontend`, `test-scripts`, `typecheck-*`, `build-backend`, Vercel preview comments). The push to `main` at `ed49639` ran green (12 check runs including `e2e`, `accessibility`, `gitleaks`, `test-backend`, `build-and-deploy` and `deploy`; the `Security & Accessibility Scans`, `Deploy Frontend to GitHub Pages` and `Deploy Backend to Cloudflare Workers` runs succeeded; the backend deploy almost certainly skipped without Cloudflare secrets, cause not inspected). For PR #24 head `2d7a734`, `Keycloak flow`, `CI` and the security workflow had started; `e2e`, `idp-flow`, `accessibility` and `test-backend` were still in progress, the rest green. Re-read before merging.

Verification as last run (2026-10-04, this worktree, real Postgres 16, UTF8; superseded by the integration run below for the batch):

| Check | Result |
|-------|--------|
| `npm run typecheck` backend and frontend | clean |
| `npm test --workspace=backend` | 43 files, 1524 tests passed |
| `npm run test:run --workspace=frontend` (default TZ and `America/Argentina/Buenos_Aires`) | 47 files, 1042 tests passed |
| `vite build` with API and Keycloak origins | OK; CSP meta in 13 of 14 pages (all except `silent-check-sso.html`) |
| Playwright e2e, Terraform, live Keycloak | not re-run in this consolidation (see `.planning/qa/QA-INDEX.md`) |

Git range `3c147f6..HEAD` at the v3.2 consolidation: 151 non-merge commits plus 18 merges, 303 files changed (+30,798 / -4,212).

Verification as reported by the PR #24 batch (`qa/INTEGRATION-REPORT.md`, 2026-10-08, not re-run for these docs): typecheck clean on frontend, backend, `tests/adversarial` and `tests/system`; backend 64 files / 1928 tests green three times on PG 16.13; frontend 53 files / 1148 tests green, also under `America/Argentina/Buenos_Aires`; `vite build`, `build:node` and `wrangler deploy --dry-run` OK; `scripts.test.sh` 52/52; `stack-e2e.sh` 40/40 on a fresh sandbox stack; mocked Playwright 286 passed, 2 flaky under load (`qa-sw`, `trips`) that pass alone. Real-auth e2e: 66/66 plus `uat-passkeys` 2/2 (`qa/QA-FULLSTACK-REPORT.md`).

## Performance Metrics

**Velocity:**

- Total plans completed: 93 (v2.0: 62, v3.0: 19, v3.1: 4 recorded earlier, v3.2: 6 with PLAN.md; Phases 22-26 have summaries only)
- Average duration: ~15 min/plan (v2.0 baseline)

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. v3.2 decisions that affect how the code must be operated:

- **Production topology (PR #24):** frontend on GitHub Pages; backend, Keycloak and Postgres on the owner's server behind one Tailscale Funnel host (`legion-server.tailad4a36.ts.net`, port 443 only) with path routing `/api` and `/auth` (`KC_HTTP_RELATIVE_PATH=/auth`), Funnel to Caddy to app. Split hosts, Cloudflare Tunnel and Caddy with Let's Encrypt are supported at config level only. Choose the Keycloak host name before anyone registers a passkey (it is the WebAuthn rpId).
- **Node server from the same Hono app:** `backend/src/server.ts` runs the app unchanged under `@hono/node-server` with the pg driver; `node/bootstrap.ts` validates env, applies the log level and pool, and builds the fetch handler; the Worker build is untouched. Boot-time config calls the app's own validators (no copies, which had drifted).
- **Production Keycloak profile guards:** `profile = local|production` in Terraform. Production refuses at plan time: `ssl_required != all`, test users, rpId `localhost`, non-TLS or unverified admin URL (loopback http allowed for the kit), Mailpit or non-TLS SMTP. It also sets temporary brute-force lockouts (10 failures), a 12-character password policy, exact redirect URIs, registration off, verify email on, and no worker client. The kit applies it through `production.auto.tfvars.json`; the earlier override file that undid it was removed.
- **Rate limiter is in-memory with a pluggable store:** sliding window, exact for one Node process, bounded to 50k keys, `setRateLimitStore()` for a shared store, fails open if the store fails. Per-IP limits run before JWT verification, per-user limits after. Client IP comes from `TRUSTED_PROXY_HOPS` (default 0 ignores forwarding headers; Funnel to Caddy to app is 2). A wrong hop count either merges all users into one bucket or trusts a spoofable entry.
- **SMTP is a dependency-free client, TLS only:** STARTTLS required when configured (a stripped capability is an error), or implicit TLS; AUTH only after TLS; verified certificates; `SMTP_SECURE=none` only in development. Gmail app password. Workers cannot use it (`node:net`); use Resend there. OTP mail needs `email_verified` in the token.
- **API accepts access tokens only:** `typ=Bearer`, `azp` in `ALLOWED_AZP`, `sub` string; a real Keycloak ID token was accepted by the earlier verifier. Tokens stay valid until `exp` (5 min) after logout; no introspection.
- **Geocoding through the backend (SEC-18):** `GET /api/geocode` with an identifying User-Agent (`NOMINATIM_CONTACT` or `NOMINATIM_USER_AGENT`), 1 req/s gate and 24 h cache per process. Demo-only builds keep the direct call.
- **Landing LCP and marker target size (A11Y-04/05):** pages render immediately (no opacity gate), hero served as AVIF/WebP/JPEG with preloads, Leaflet is a lazy chunk, overlapping markers are spread in screen space instead of clustered. `.day-group-badge` colour darkened for contrast.
- **Login return-to:** Keycloak is always sent a registered `redirect_uri`; the real target is kept in sessionStorage (15 min) and restored after the callback. `logout()` defaults to the registered `index.html`.
- **Migration 0010 and preflight:** push-built or journal-less 0003 databases upgrade with the plain migrator; `db:preflight` blocks only a journal-less database that already has 0004+ objects. Never roll the schema back (no down-migrations); prefer roll-forward.
- **OSM tiles (QA-DEMO-FIXES):** CartoDB `basemaps.cartocdn.com` now answers every tile with a 200 "API KEY REQUIRED" placeholder. Maps use keyless `tile.openstreetmap.org`, dark mode is a CSS filter on the tile pane, attribution is visible, the service worker never caches tiles (OSM policy). `src/data/tiles.ts` is the single place to change provider; a large traffic increase needs a self-hosted or commercial source.
- **BIZ-07 as DB triggers (migration 0008), not route checks:** production uses the Neon HTTP driver, which has no interactive transactions, so a route cannot hold a lock between check and write. Triggers raise `DC001`, mapped to 422 `date_conflict`. Advisory-lock namespaces: 7001 (OTP, per user), 7002 (BIZ-07, per trip). Shrinking a parent that would orphan children is rejected, never cascaded.
- **OTP issuance in one SQL function (migration 0009, `otp_issue()`):** same reason (single statement works on Neon HTTP). Clock comes from the DB.
- **404, not 403 (SEC-22):** foreign and missing resources answer the same 404 body on all nested routes; there is no existence oracle.
- **Direct `MIGRATION_DATABASE_URL` secret:** migrations run in the deploy workflow with a direct (non-pooled) Neon URL, in the order config gate, `db:preflight`, `db:migrate`, `wrangler deploy`. No `CLOUDFLARE_API_TOKEN` means the job is green and skipped (demo-only today).
- **CSP strict origins:** the CSP meta is built from the resolved Vite env. A production build fails if exactly one of `VITE_API_URL` / `VITE_KEYCLOAK_URL` is missing, or if both are missing without `CSP_ALLOW_MISSING_ORIGINS=true` (the Pages workflow sets that only when both secrets are empty). IPv6 hosts, wildcards, credentials and non-loopback `http` are rejected.
- **Keycloak login flow:** passkey users always get WebAuthn; users without a passkey get the password form; no credential means no session. Users with both get "Try another way" (REG-05, `17a2493`); a passkey-only user has no password form and recovers by e-mail code (REG-03). Terraform is the only source of realm config.
- **Schema validation answers 422** (path-id, JSON syntax and reorder-permutation errors stay 400). Public trip responses omit `user_id`; numeric ids stay because the adapter needs them.
- **Keycloak is the source of truth for user name/email** (BUG-08); `PATCH /api/users/me` name is overwritten on the next request.
- **Test DB:** backend tests run on a real ephemeral Postgres 16 (`TEST_DATABASE_URL`), never skipped. `db:migrate` is the supported way to build the schema (`drizzle-kit push` produces a different schema; preflight stops a push-created DB).


Third batch (self-registration, REG-01..07):

- **Backend-owned e-mail OTP verification:** Keycloak core has no e-mail OTP and Java SPIs are out of scope, so `verify_email = false` in the realm and the backend sends and checks the 6-digit code (`email-verify/request|confirm`), reusing the login OTP core with a `purpose` column (migration 0011).
- **Passkey-first sign-up:** Keycloak 26.6.1 form actions accept only REQUIRED/DISABLED, so the registration password cannot be optional. The form has no password and `webauthn-register-passwordless` is a default required action that cannot be skipped; users on devices without passkey support recover by e-mail code and set a password. E-mail is the username.
- **Recovery client risk:** `travelmap-recovery` is a confidential service-account client holding realm-management `manage-users` (scope-mapped, `b6463b8`; without the mapping its token had no roles). Its secret lives in the server `.env` and the backend; whoever gets it can reset any password. It is the only admin client allowed in production.
- **Verified semantic (DB flag):** verified = `users.email_verified_at` is set OR the token claim `email_verified === true` (boolean; `"true"`, `1`, null do not count). Migration 0011 stamps every existing user so the gate does not lock them out. `REQUIRE_VERIFIED_EMAIL` defaults to on outside development.
- **Squatting defence:** recovering an account whose e-mail was never verified also deletes its other credentials and sessions; a legitimate unverified user loses passkeys they enrolled.

- **Passkey-first (PKF):** realm passkeys (provider >= 5.8, lock 5.10.0) let the username page accept a passkey answer; a CONDITIONAL credential subflow fails open on Keycloak 26.6.1 (a bare username got a code), so the credential step gets an extra fail-closed ALTERNATIVE branch `passkey-done` (condition first, `allow-access` second). The device marker `jp.passkey.<realm>` holds no identifying data and lives 180 days. SEC-25 mappers pin `add_to_token_introspection=false` across the provider bump.
- **Mobile is a tested target (UX-MOB-01):** Chromium-only emulation (iPhone 13, Pixel 7) with an `e2e-mobile` CI job; real-device and WebKit gaps are listed in `docs/design/MOBILE-COVERAGE.md`.
- **Guided editor (UX-TRIP-01):** one autosave queue with undo and a live preview built from the demo's own classes; the saved view uses the same adapters (`docs/design/TRIP-CREATION-UX.md`).

### Pending Todos

- v3.3: merge PR #31 (replace the "PR #31" placeholders in `REQUIREMENTS.md`, `phases/TRACEABILITY.md`, `MILESTONES.md`, `ROADMAP.md`, `PROJECT.md`, `qa/UX-REPORT.md`, `qa/QA-INDEX.md` with the real number and merge hash), rebuild and redeploy the Keycloak image, then validate on real devices (see current focus) and update the Unverified lines of `qa/UX-REPORT.md`. Optional: lower Keycloak's theme static max-age at deploy time; version the module imports in `passkey-first.js`.
- Terraform (not implemented): make the data sources in `terraform/keycloak/mappers.tf` (`data "keycloak_openid_client_scope"` profile/email) and `terraform/keycloak/main.tf` (`data "keycloak_role"`, `data "keycloak_openid_client"` realm_management) use the realm NAME (a variable/local that does not depend on `keycloak_realm.japan_trip.id`), so a single apply works. See the operator finding under Blockers.
- Registration batch is merged (PR #25 `41f43d4`, docs PR #26 `6d4c4f1`); the Actions run of the extended `keycloak-flow.yml` is still to be read (REG-07).
- Read the PR #24 checks (`e2e`, `idp-flow`, `accessibility`, `test-backend` were in progress), merge, and record the `Keycloak flow` result against QA-01.
- Validate on the owner's server (see Manual actions for the owner). Then update PROD-01 and SEC-17.
- ARCH-06, ARCH-09 and DEP-03 were decided by the PR #23 run (all green); that is recorded in REQUIREMENTS.md.
- Owner actions for v3.2 are in `.planning/PR-DESCRIPTION.md`; the ones for the batch are below.

### Manual actions for the owner (from `qa/PROD-HARDENING.md` and `qa/SELFHOST-REPORT.md`)

1. Choose the long-term Keycloak host name before anyone registers a passkey; set `webauthn_rp_id` to it.
2. Create the Gmail app password; set `TF_VAR_smtp_password` (Terraform) and `SMTP_PASS` (backend). Never commit either.
3. Run `deploy.sh`, then `keycloak-apply.sh` with the production profile (`production.tfvars` from the example); on an existing realm expect the built-in mapper and worker-role re-creation. Then `import.sh --remove-stale-flows` if the old flow ever ran in production.
4. Set `TRUSTED_PROXY_HOPS=2`, `ALLOWED_ORIGINS=https://manudubo.github.io` and `NOMINATIM_CONTACT` (or `NOMINATIM_USER_AGENT`) on the backend; run `funnel.sh enable` and then `stack-e2e.sh xff` to confirm the client IP seen behind the real Funnel.
5. Build the Pages frontend with `VITE_API_URL=https://<host>/api` and `VITE_KEYCLOAK_URL=https://<host>/auth`.
6. Create the first account with `deploy/selfhost/scripts/add-user.sh` (registration is off in production).
7. Consider a Caddy rate limit on `POST /auth/realms/japan-trip/login-actions/authenticate` (username enumeration).
8. Run the Neon smoke checklist if the Worker/Neon path will be used; rotate the leaked local `japan-trip-worker` secret (DEP-02).
9. Registration (third batch): set `REGISTRATION_ENABLED=true` only when ready; run `keycloak-apply.sh` (writes `KEYCLOAK_RECOVERY_CLIENT_SECRET` to `.env`), redeploy the backend, run `stack-e2e.sh register verify recover` against the real host; enable `purge-timer.sh` (daily); decide on reCAPTCHA (`TF_VAR_recaptcha_site_key` / `recaptcha_secret_key`, `require_recaptcha`); consider a Caddy or WAF limit on `/auth/realms/japan-trip/protocol/openid-connect/registrations`; check that `users.email_verified_at` is filled for existing users before turning the gate on.
10. v3.3 / passkey-first: pull `main`, redeploy the Keycloak image (new theme), re-run `keycloak-apply` on the Lenovo (plan: +5 resources, realm passkey setting updated, profile mappers no change); set `REGISTRATION_ENABLED` + SMTP to enable Sign up; rebuild Pages with `VITE_KEYCLOAK_URL` set to include sign-up; decide whether to lengthen sessions (`remember_me`).

### Blockers/Concerns

- **Production Keycloak may be exposed (KC-01).** The pre-Phase-26 `browser-passkey` flow let a username alone produce a token (and passkey registration for that account). Locally this was masked by `apply-local-settings.sh`, which is now deleted. Treat any production Keycloak that ran this Terraform as exposed: apply the new Terraform, run `terraform/keycloak/import.sh` with `--remove-stale-flows`, review login events for credential-less LOGINs, list WebAuthn credentials for ones the owner did not register, and sign out all sessions.
- **Production Keycloak realm needs `import.sh --remove-stale-flows`.** Terraform does not notice stray executions or the old `password-forms` subflow. Run `KC_URL=https://<kc> bash terraform/keycloak/import.sh` (dry run), then again with `--remove-stale-flows`, then `terraform plan`.
- **Operator finding (unexpected Terraform plan after the provider bump; cause not verified; fix not implemented).** `keycloak-apply.sh` on the owner's server planned to destroy and recreate 6 protocol mappers (`profile_username`, `profile_full_name`, `email_claim`, `email_verified`, `avatar_url`, `preferences`) and the recovery service-account role plus scope mapping. Suspected cause: data sources (`terraform/keycloak/mappers.tf` `data "keycloak_openid_client_scope"` profile/email; `terraform/keycloak/main.tf` `data "keycloak_role"` and `data "keycloak_openid_client"` realm_management) reference `keycloak_realm.japan_trip.id` while the realm has a pending change, so Terraform defers them ("known after apply"). Mitigation used on the server: two-step apply (`-target=keycloak_realm.japan_trip`, then re-plan expecting 0 destroys and only the 5 `passkey_done*` creates plus the in-place client update, then the full apply). Proposed repo fix (todo): use the realm name instead of the resource id in those data sources.
- **Prod Keycloak image has no theme** (`keycloak/Dockerfile` never copies `themes/`), so the SEC-11 `error.ftl` fix only applies where the theme is mounted.
- **S3 built, not yet seen green on Actions.** `.github/workflows/keycloak-flow.yml` (via `scripts/ci/keycloak-flow.sh`) runs `idp-flow`, `idp-config` and `idp-hardening` on Chromium and Firefox. It passes locally (51 passed / 5 fixme) but had not concluded on Actions when checked (PR #24 run in progress). It is informational, not a deploy gate; make it a required check after about 10 green runs.
- **Real validation on the owner's server is pending.** Funnel, Gmail delivery and passkeys on the `.ts.net` rpId were never exercised: the sandbox used a TLS front for Funnel and Mailpit for Gmail. Whether `tailscale serve` forwards the true client IP in `X-Forwarded-For` (the `TRUSTED_PROXY_HOPS=2` assumption) is unverified. `funnel.sh` ran only against a stub tailscale.
- **Neon is only an emulator.** The Neon HTTP driver path ran against a fake that models the `/sql` contract (`backend/tests/system/`), not real Neon; the smoke checklist (S4) is still unrun.
- **Username enumeration is residual.** The username-first login flow answers differently for an unknown user and a known one (and shows the WebAuthn prompt only for users with a passkey). Not fixable by configuration; bounded by registration off, temporary lockouts, identical failure messages. Pinned by `idp-hardening.spec.ts`; see `keycloak/README.md` section 4.
- **No per-IP sign-up throttle (REG-06).** The stock Caddy 2.10 image has no rate-limit module, Keycloak has none for registration, and no backend `forward_auth` check exists. A bot with a WebAuthn emulator can create accounts at Keycloak's speed. Mitigations: purge of never-verified accounts, optional reCAPTCHA (unvalidated), closing sign-up. Watch `purge-unverified.sh` output.
- **Recovery only works for accounts with a `users` row.** The row is created by the first authenticated API call (the app makes it on the redirect landing); a user who aborted sign-up before that cannot recover.
- **`users.email_verified_at` backfill:** migration 0011 grandfathers every existing user as verified (stamped `now()` when the column is created). A push-built database that already had the column keeps NULLs. Check the count before enabling the gate.
- **Keep registration closed until ready.** Production default is `registration_allowed = false`; open it only after the owner actions below (host name, Gmail, recovery secret) and the Actions run of the extended `keycloak-flow.yml` is seen. That run, real passkeys on the `.ts.net` rpId, real Gmail and reCAPTCHA are all unvalidated.
- **Gmail limit (~500 mails/day)** is shared by login OTP, verification and recovery codes; every sign-up costs one mail. Per-address and per-user code limits exist, a global ceiling does not.
- **Minor:** the backend never sends `attemptsLeft`, so the wrong-code message is generic; recovery's `weak_password.reason` is not shown by the UI; the e-mail code goes to the token address (keep realm "edit email" off).
- **Informational, not ours: the owner's existing Tailscale Funnel on port 8443 (Home Assistant) is public** (the owner's statement). The kit leaves it, and the existing `:8081` entry, untouched and uses 443 only. Worth the owner reviewing what is reachable from the internet on that machine.
- **Rate limits are per process.** On Workers each isolate counts separately until a shared store or WAF rules exist; the geocode gate and cache are also per process. A typo in `ALLOWED_ORIGINS` silently locks the SPA out (logged as `cors.invalid_allowed_origins`).
- **Old Worker on a migrated schema degrades to 500s** for date-rule and email-conflict writes; roll forward, never roll the schema back.
- **S4 not run: Neon HTTP smoke test.** Tests use node-postgres (the system suite uses an emulator). The Neon paths (`db.execute().rows` for `otp_issue()`, the `code`/`message`/`column` fields behind 422 `date_conflict` and 409, the schema-guard query) have never run on the Neon driver. Checklist: `qa/NEON-SMOKE-CHECKLIST.md`.
- **Migration 0005 aborts on duplicate emails** (case-insensitive, non-empty). The migrator rolls the whole run back. `db:preflight` lists the offenders and runs before `db:migrate` in the deploy workflow; merge accounts by hand. Migration 0006 sets both coordinates to NULL on out-of-range rows and cannot detect swapped lat/lng (query in `backend/src/db/README.md`).
- **Deploy order matters.** Migrations 0004-0009 must be applied before the new Worker (the new `otp-request` calls `otp_issue()`, absent until 0009). The workflow enforces it; manual deploys must too. `GET /api/health/ready` returns 503 `schema_not_migrated` otherwise.
- **The e2e job gates deploys.** `continue-on-error` was removed from the `e2e` job (2fa0560), so a red e2e run on `main` blocks both the Pages and Worker deploys. It was green on PR #23 head 2200c6e and on the push to `main` (ARCH-09 Complete).
- **Backend has never been deployed.** The Worker deploy run on `main` (ed49639) is green, which is consistent with the workflow skipping without Cloudflare secrets (cause not inspected); no backend is running. The Pages deploy for ed49639 succeeded. The self-hosted backend of PR #24 is not deployed either.
- **Leaked local Keycloak client secret** (`japan-trip-worker`, found by gitleaks in two planning docs) was redacted at HEAD but remains in git history; rotation not verified (DEP-02).
- **CSP is a second line of defence only:** `script-src` keeps `'unsafe-inline'`; `frame-ancestors` cannot be set by a meta tag.
- Residual test debt (after QA-01): the `waitForTimeout` and `test.skip(` residue, `api.spec.ts` `[404, 500]` and the `trip-edit.spec.ts` zoom_level expectation are fixed; `qa-sw` on Firefox fails 3 tests (CI is Chromium only); `qa-sw` "offline city never opened" and `trips` "API failure on create" flake under load; the backend suite needs a UTF8 Postgres cluster. Dead sessionStorage replay in several specs is cosmetic.
- Local dev stack (Docker Keycloak/Postgres, backend, frontend) goes down between sessions. A git worktree's `backend/.dev.vars` is gitignored and not copied on worktree creation; missing it makes DB-backed tests fail silently.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| SEC | SEC-17 proxy-header behaviour behind the real Funnel to Caddy chain | Partial: production profile enforces `ssl_required = all`; Railway no longer applies; real chain unverified | v3.2 Phase 26 |
| DEP | Rotate the `japan-trip-worker` Keycloak secret | Owner action, unverified | v3.2 Phase 23 |
| CI | S3: CI job running Keycloak + `idp-flow.spec.ts` | Built (`keycloak-flow.yml`), not yet green on Actions (QA-01) | v3.2 review |
| QA | S4: Neon HTTP smoke test | Not run (checklist ready) | v3.2 review |
| BIZ | Day in an undated destination vs trip range; hotel dates vs destination dates; option groups "1/2/3" need an `option_label` column | Not enforced / not built | v3.2 Phase 25 |
| TECH | `AuthGuard.ts` unused; `drizzle-kit push` vs migrations drift in `schema.ts` | Cleanup candidates | v3.2 |
| DEPLOY | Production deployment | Self-hosted kit built (PROD-01) and sandbox-proven; real-server validation pending. Cloudflare + Neon + Railway still unscoped | v1.0 planning |
| DEMO | Landing demo experience | Shipped in practice (landing, overview map, countdown); formal closure pending | v1.0 planning |
| PASS | Rename passkey (PUT credentials/{id}/label) | Deferred, unscoped | v1.0 planning |
| PROD | prod rpId for passkeys | `webauthn_rp_id` is a required production variable now (host name to be chosen by the owner before any registration) | Phase 09 |
| PROD | Real-auth E2E in CI (requires KC in CI environment) | Partly done: IdP specs in the Keycloak job; the rest stays `SKIP_REAL_AUTH` | Phase 09 |
| E2E | OTP brute-force lockout: add `attackDetection.del` to `beforeEach` | Deferred to future | v3.1 planning |
| E2E | Per-recipient Mailpit isolation (`search?query=to:...`) | Deferred to future | v3.1 planning |

## Session Continuity

Last session: 2026-10-08
Stopped at: Planning docs updated for Phase 33 (UX-KC-04, UX-NAV-02, TEST-PARITY-01) and the PR #29 references; before that for shipped v3.3 (UX-*, UX-MOB-01, PKF-01..04 Complete, phases 27-32, `qa/UX-REPORT.md`); before that for the v3.3 requirements (UX-*, phases 27-31, QA placeholder); before that for the registration batch (REQUIREMENTS REG-01..07, ROADMAP, STATE, PROJECT, MILESTONES, phases/TRACEABILITY, qa/QA-INDEX, PR-DESCRIPTION).
Resume: merge PR #31; then re-run `keycloak-apply` and validate v3.3 on real devices and on the owner's server, then update PROD-01, SEC-17 and QA-01. Run `/gsd-complete-milestone` only after owner actions are done or consciously deferred.
