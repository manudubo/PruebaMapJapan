# Self-registration and passkey fallback — IdP half

**Date:** 2026-10-08
**Base:** `origin/main` @ `d2dd404`. Worktree branch, not pushed.
**Scope (after the owner's revision):** Keycloak/Terraform, login theme, CI job, purge script,
self-host wiring and docs. The backend half (e-mail code verification, `users.email_verified_at`,
403 gating, recovery endpoints) belongs to the parallel backend work stream; the frontend
(Create-account buttons, verification screen, `recover.html`, onboarding passkey offer) to the
frontend stream.

## Contract with the other streams

| Piece | Agreed shape |
|---|---|
| Sign-up entry | frontend `keycloak.register({ redirectUri })` with one of the exact redirect pages (`dashboard.html`, `profile.html`, `index.html`); Keycloak's registration endpoint, flow `registration-passkey` |
| New-user signal | access token `email_verified=false`; backend `GET /api/users/me` exposes `email_verified`; until verified every other route answers `403 email_not_verified` |
| E-mail proof | backend `POST /api/auth/email-verify/request` / `confirm {code}` (Keycloak sends no link) |
| No-WebAuthn way in | theme link on passkey steps → `<Pages origin>/PruebaMapJapan/recover.html?email=<typed address>` → backend `POST /api/auth/recovery/request {email}` (always the same 202) / `confirm {email, code, new_password}` |
| Admin client | `travelmap-recovery`, confidential, service account only, exactly `realm-management/manage-users`; secret = sensitive output `recovery_client_secret`, written to the server `.env` as `KEYCLOAK_RECOVERY_CLIENT_SECRET` by `keycloak-apply.sh`; backend env `KEYCLOAK_ADMIN_URL=http://keycloak:8080/auth`, `KEYCLOAK_RECOVERY_CLIENT_ID=travelmap-recovery` |
| Backend asks (sent to the coordinator) | add those three variables to `SERVER_ENV_CONTRACT` **and** compose together (the bootstrap test requires equality, so compose was not changed here); after a recovery password, remove the user's pending `webauthn-register-passwordless` action (else a no-WebAuthn user loops on enrolment); for a never-verified (squatted) account also delete other credentials and sessions |
| Purge | `deploy/selfhost/scripts/purge-unverified.sh` reads `SELECT keycloak_id FROM users WHERE email_verified_at IS NOT NULL` and deletes `users` rows `WHERE keycloak_id = :kid AND email_verified_at IS NULL` |

## Design decisions

1. **Passwordless registration form + mandatory passkey enrolment.** Keycloak 26.6.1 form actions
   only accept REQUIRED/DISABLED (checked on the live realm), so a password cannot be "optional"
   in the form. The `registration-passkey` flow has no `registration-password-action`;
   `webauthn-register-passwordless` is a default required action, so the account gets its passkey
   before any code is issued. The enrolment required action cannot be skipped (its Cancel only
   exists for application-initiated actions — read from `WebAuthnRegister` / `webauthn-register.ftl`
   in the 26.6.1 jars), which is why the password fallback goes through the backend e-mail recovery
   rather than a Keycloak "skip".
2. **Never a usable credential-less account.** The account is created when the form is posted;
   if enrolment never completes it has no credential. Proven live: no code is issued, a later
   username-only sign-in is rejected ("Invalid username or password.", no password form, no
   enrolment prompt), and it stays unverified so the purge deletes it. A strict "created only with
   a credential" is impossible with built-ins without forcing a password at sign-up.
3. **E-mail verification moved to the backend code** (owner's revision): `verify_email = false`,
   `VERIFY_EMAIL` stays enabled but is no longer a default action; the `email verified` mapper
   keeps `email_verified` in the access token (statically tested; live: `false` for a new sign-up).
4. **Browser flow fallback (REG-03).** Both credential branches are now conditional
   (`conditional-user-configured`) and each authenticator precedes its condition. Root cause found
   in Keycloak's `AuthenticationSelectionResolver` (26.6.1 source): it only lists sibling branches
   ("Try another way") when the current execution is the first of its subflow — with the condition
   first, passkey users never had a fallback. A flat ALTERNATIVE layout was also tried live: it
   offers Try another way but drops passkey-first for everyone whose password is older.
   **Trade-off kept:** with both credentials Keycloak shows the *preferred* one first (credential
   priority = enrolment order): passkey for sign-ups, password for invited users who add a passkey
   later (the passkey is then one click away). A backend `moveToFirst` after onboarding enrolment
   would make passkeys preferred (suggested, not required).
5. **Production guards.** New preconditions: password policy `length(>=12)` in production; no
   `japan-trip-worker` in production (only `travelmap-recovery` may hold `manage-users`); with
   `registration_allowed`: brute force ≤ 10 failures and the recovery client present;
   `require_recaptcha` needs both keys; captcha keys both-or-neither; site-key format validated.
   SMTP-over-TLS was already enforced for every production plan.
6. **reCAPTCHA** (`registration-recaptcha-action`, config keys `site.key`/`secret.key` read from
   the 26.6.1 class) is created only when both keys are set; the secret is a sensitive variable
   with no default, passed by `keycloak-apply.sh` through `TF_VAR_recaptcha_secret_key` only.
7. **E-mail as username** (`registration_email_as_username = true`): Keycloak then stores the
   address as username for every user; the three seeded users with plain usernames now use their
   address (`tests/.env.test.example` updated). Existing local states replace those three users once.
8. **Seeded users vs the new default action:** on an empty Keycloak they received
   `webauthn-register-passwordless` at creation despite `required_actions = []`; the action now
   depends on the users, and a fresh bootstrap converges (plan: no changes).
9. **Theme link** in `footer.ftl` (all passkey pages via `pageId`), base URL = client base URL
   (Pages origin + path from `config/deploy-defaults.json`), promoted when
   `window.PublicKeyCredential` is undefined. No template copies.
10. **Sign-up throttle not implemented.** The stock Caddy 2.10 image has no rate-limit module
    (`caddy list-modules`), Keycloak has none for registration, and the Node backend that could
    serve a Caddy `forward_auth` check belongs to the other stream. Documented as an open risk.
11. **Account enumeration:** sign-up answers Keycloak's standard "Email already exists." (tested,
    also case-insensitive); it is the same information the username-first sign-in step already
    gives (README §4). Not hidden.

## Validation performed (this sandbox)

| Check | Result |
|---|---|
| Keycloak 26.6.1 `start-dev` + Mailpit v1.29 via `scripts/ci/keycloak-flow.sh` (unique names/ports), **fresh** bootstrap with the final Terraform | 35 resources, next plan **no changes** |
| `idp-flow` + `idp-config` + `idp-hardening` + `idp-registration` + `idp-theme`, Chromium + Firefox | **71 passed**, 14 skipped by design (Firefox has no CDP authenticator; backend-dependent tests; production-only lockout) |
| `idp-registration` + `idp-flow`, Chromium, `--repeat-each=3` | 72 passed, 0 flaky |
| New live cases | passkey sign-up (no password field, one credential, no Keycloak mail, `email_verified=false`); sign-up without WebAuthn (no code, link promoted, credential-less account rejected by username); smuggled password ignored; duplicate e-mail; registration closed (pending form + endpoint + no link); both credentials: Try another way with authenticator ON and with `PublicKeyCredential` removed; password-first user reaches the passkey; passkey-only user without WebAuthn: no password form, no Try another way, link href, forced password post yields no code; password-only user sees neither |
| All previous KC-01 negative tests on the new flow | pass (username alone, tampered executions, forged/cancelled WebAuthn, no-credential user, disabled user) |
| `terraform test` (mocked provider, offline): `tests/guards.tftest.hcl` | **23/23**: 3 valid profiles plan, 20 misconfigurations fail (9 new + the 11 previously manual ones) |
| `terraform fmt -check -recursive`, `validate`; `import.test.sh` | clean; 48/48 |
| `purge-unverified.test.sh` (stub curl + stub DB commands) | **34/34**; default psql commands checked against a real Postgres 16 (id bound as `:'kid'`, verified row kept) |
| `scripts.test.sh` (incl. new keycloak-apply input checks, compose config per mode) | 57/57 |
| shellcheck (CI file sets) | clean |
| Frontend vitest (incl. `workflows.test.ts` +2 cases, `e2e-hygiene.test.ts`) / `tsc` | 1150/1150; clean |
| Specs typecheck (`tsc --strict` on the three idp specs) | clean |

## Not validated here

- The backend half end to end: the two backend-dependent Playwright tests (sign-up → 403 → code →
  API unlocked; passkey-only user → recovery code → password → sign-in) are written against the
  contract and are `fixme` until `E2E_API_URL` points at that backend (`CI_BACKEND=1` makes them
  required). Backend tests, `wrangler deploy --dry-run` and the frontend build were not re-run:
  no backend or frontend source changed in this branch.
- The backend reaching the admin API on `http://keycloak:8080/auth` while `KC_HOSTNAME` is the
  public URL (issuer of the service-account token vs the admin endpoint) — to check in the
  self-host stack once the backend uses it.
- Real reCAPTCHA (needs Google keys) — only the plan/executions were checked.
- A sign-up throttle (see decision 10); real Gmail; WebKit; Firefox passkey paths.
- GitHub Actions run of the extended `keycloak-flow.yml` (same commands run locally).

## Files

`terraform/keycloak/{flows,main,variables}.tf`, `production.tfvars.example`,
`tests/guards.tftest.hcl`; `keycloak/themes/japan-trip/login/{footer.ftl,messages/*,resources/css/login.css}`;
`tests/e2e/{idp-flow,idp-config,idp-registration}.spec.ts`, `tests/e2e/fixtures/kc-admin.ts`,
`tests/.env.test.example`; `scripts/ci/keycloak-flow.sh`, `.github/workflows/{keycloak-flow,ci}.yml`,
`frontend/tests/workflows.test.ts`; `deploy/selfhost/{.env.example,scripts/keycloak-apply.sh,
scripts/purge-unverified.sh,scripts/purge-timer.sh,systemd/travelmap-purge-unverified.*,
tests/purge-unverified.test.sh,tests/scripts.test.sh}`; `docs/SELF-HOSTING.md` ("Open sign-up"),
`keycloak/README.md`.
