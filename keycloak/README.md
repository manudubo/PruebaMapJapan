# Keycloak Setup for Japan Trip

This directory contains everything needed to run Keycloak as the identity provider for the Japan Trip app, supporting passkey (WebAuthn) authentication.

---

## 1. Local Development

**Prerequisites:** Docker and Docker Compose installed.

```bash
# From the keycloak/ directory
docker compose up -d
```

Keycloak will start on http://localhost:8080 with an empty `japan-trip` realm slot. The realm
itself is created and configured by Terraform — see [Configuration source of truth](#3-configuration-source-of-truth).

- **Admin console:** http://localhost:8080/admin
- **Admin credentials:** `admin` / `admin`
- **Realm:** `japan-trip`
- **OIDC discovery:** http://localhost:8080/realms/japan-trip/.well-known/openid-configuration

Backend `.dev.vars` (Cloudflare Workers local dev):
```
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=japan-trip
```

Frontend `.env.local`:
```
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=japan-trip
VITE_KEYCLOAK_CLIENT_ID=japan-trip-frontend
```

---

## 2. Railway Deployment

Railway is the cheapest managed option at ~$5/month on the Hobby plan.

### Steps

1. Create a new Railway project at https://railway.app
2. Add a **PostgreSQL** service (Railway Postgres plugin)
3. Add a new **service** from this repo's `keycloak/` directory (or a linked repo pointing to it)
4. Set the following environment variables on the Keycloak service:

| Variable | Description | Example |
|---|---|---|
| `KC_DB` | Database type | `postgres` |
| `KC_DB_URL` | JDBC connection string (from Railway Postgres) | `jdbc:postgresql://host:5432/railway` |
| `KC_DB_USERNAME` | Database username | `postgres` |
| `KC_DB_PASSWORD` | Database password | (from Railway Postgres credentials) |
| `KC_HOSTNAME` | Public URL (Railway provides the domain) | `https://keycloak.up.railway.app` |
| `KC_HTTP_ENABLED` | Railway terminates TLS and forwards plain HTTP to the container | `true` |
| `KC_PROXY_HEADERS` | Trust Railway's `X-Forwarded-*` headers (scheme, host, client IP) | `xforwarded` |
| `KC_BOOTSTRAP_ADMIN_USERNAME` | Initial admin username | `admin` |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | Initial admin password (use a strong password) | (generate a secret) |

> `KC_PROXY=edge` (listed here previously) no longer exists in Keycloak 26 — `kc.sh start --help`
> has no `--proxy` option — so it was silently ignored. `KC_PROXY_HEADERS` + `KC_HTTP_ENABLED`
> replace it. `KEYCLOAK_ADMIN*` are the pre-26 names of the bootstrap admin variables.

5. Railway will use the `Dockerfile` in this directory to build and the `railway.toml` for deployment config.
6. Once Keycloak is up, apply `terraform/keycloak` against the public URL to create/configure the realm
   (nothing is imported at startup — neither `railway.toml` nor `docker-compose.yml` passes `--import-realm`).

### TLS behind the Railway proxy (SEC-17)

The realm's `sslRequired` comes from the Terraform variable `ssl_required`:

- `external` (default, used locally): plain HTTP is accepted from loopback/private addresses.
  Behind Railway every request arrives from the proxy's private address, so **if Keycloak does
  not trust `X-Forwarded-Proto`, it treats all traffic as internal HTTP**: TLS is not enforced by
  Keycloak and its cookies are not marked `Secure` (the "Non-secure context detected" warning).
- `all`: HTTPS is required for every request. Correct for production, but it only works when
  Keycloak sees the original scheme via the proxy headers — otherwise every login fails with
  "HTTPS required".

Before setting `ssl_required = "all"` in the production var-file, verify on the deployed
instance (with `KC_PROXY_HEADERS=xforwarded` and `KC_HOSTNAME=https://…` set):

```bash
KC=https://keycloak.up.railway.app
# 1. Issuer must be https:// (hostname/scheme resolved correctly)
curl -s "$KC/realms/japan-trip/.well-known/openid-configuration" | jq -r .issuer
# 2. Login-page cookies must carry the Secure flag
curl -s -o /dev/null -D - "$KC/realms/japan-trip/protocol/openid-connect/auth?client_id=japan-trip-frontend&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fmanudubo.github.io%2FPruebaMapJapan%2Fdashboard.html" \
  | grep -i '^set-cookie' | grep -ci secure   # expect > 0
```

Then apply with `ssl_required = "all"` and repeat step 2 plus a real browser login. If step 1
prints `http://` or step 2 prints `0`, fix the proxy configuration first and keep `external`.

### Connecting backend/frontend to production Keycloak

Update your Cloudflare Workers secrets:
```bash
wrangler secret put KEYCLOAK_URL
# enter: https://keycloak.up.railway.app

wrangler secret put KEYCLOAK_REALM
# enter: japan-trip
```

Update frontend environment for production build:
```
VITE_KEYCLOAK_URL=https://keycloak.up.railway.app
VITE_KEYCLOAK_REALM=japan-trip
VITE_KEYCLOAK_CLIENT_ID=japan-trip-frontend
```

---

## 3. Configuration source of truth

**Terraform (`terraform/keycloak/`) is the only source of truth for the `japan-trip` realm**
(SEC-13 / ARCH-08): realm settings, clients, protocol mappers, required actions, test users,
the `browser-passkey` authentication flow, and which flow the realm uses
(`keycloak_authentication_bindings.browser_flow` in `flows.tf`, which also binds the
`registration-passkey` registration flow).

- Do not change realm settings in the admin console or with ad-hoc Admin REST calls — the next
  `terraform apply` reverts them, and until then the live realm silently diverges from the repo.
  Change the `.tf` files and apply instead.
- There is no realm export in this directory. The former `realm-export.json` was never imported
  (no `--import-realm` anywhere) and had drifted from the live config; it was removed in Phase 26.
- The former `apply-local-settings.sh` was removed in Phase 26. It reset `browserFlow` to the
  stock `browser` flow after every `docker compose up`, which contradicted Terraform and hid the
  `browser-passkey` flow locally. Everything else it set is already in `main.tf`.
- On an **empty** Keycloak, the first `terraform apply` creates the realm, but the four built-in
  client-scope mappers managed in `mappers.tf` (`username`, `full name`, `email`,
  `email verified`) already exist and must be imported first — see `terraform/keycloak/import.sh`.
- `import.sh` takes the URL and admin password from the environment, never from argv:
  ```bash
  cd terraform/keycloak
  KC_URL=https://<keycloak-host> bash import.sh            # prompts for the admin password
  KC_URL=... KC_ADMIN_PASSWORD=... bash import.sh --remove-stale-flows
  ```
  A realm configured before KC-01 still has a top-level `password-forms` subflow that Terraform
  no longer manages. Without `--remove-stale-flows` the script only reports it (dry run); with the
  flag it deletes it and verifies it is gone. Run `terraform plan` afterwards. Tests:
  `bash terraform/keycloak/tests/import.test.sh` (stub curl/terraform, no Keycloak needed).

To inspect the live realm without changing it:

```bash
docker compose exec keycloak /opt/keycloak/bin/kc.sh export --file /tmp/realm.json --realm japan-trip
```

---

## Browser flow (`browser-passkey`)

Defined in `terraform/keycloak/flows.tf` (KC-01 / SEC-12):

```
browser-passkey
├── Cookie                                       ALTERNATIVE
└── passkey-forms                                ALTERNATIVE
    ├── Username Form                            REQUIRED
    └── passkey-or-password                      REQUIRED
        ├── passkey                              ALTERNATIVE
        │   └── passkey-if-configured            CONDITIONAL
        │       ├── WebAuthn Passwordless        REQUIRED
        │       └── Condition - user configured  REQUIRED
        └── password                             ALTERNATIVE
            └── password-if-configured           CONDITIONAL
                ├── Password Form                REQUIRED
                └── Condition - user configured  REQUIRED
```

Each credential branch only exists for a user who HAS that credential (REG-03):

| User has | Sign-in |
|---|---|
| passkey only | WebAuthn step, never a password form. On a device without WebAuthn the page promotes "Can't use a passkey on this device? Get a code by email" (link to the app's `recover.html`, see below) |
| password only | password form, nothing else |
| passkey and password | the **preferred** credential first (Keycloak's credential priority = the one enrolled first: the passkey for accounts made by sign-up, the password for invited users who add a passkey later), the other under **Try another way**. A browser without WebAuthn uses Try another way → password |
| neither | rejected after the username ("Invalid username or password.") |

Anyone submitting only a username is rejected, whatever the user has. Two layout details matter
and are checked by `tests/e2e/idp-config.spec.ts`: every credential authenticator is REQUIRED only
inside a `conditional-user-configured` subflow (an unconfigured REQUIRED authenticator counts as
passed and queues an enrolment — the KC-A takeover), and it comes **before** its condition:
Keycloak's `AuthenticationSelectionResolver` only offers the sibling branch ("Try another way")
when the current execution is the first of its subflow (verified on 26.6.1; with the condition
first, passkey users had no fallback at all).

`tests/e2e/idp-flow.spec.ts` covers every row above against a running Keycloak, with the Chromium
virtual authenticator and with `window.PublicKeyCredential` removed (no-WebAuthn browser), plus
the tampering paths (forced executions, forged assertions, passwords posted to the WebAuthn step).

### E-mail recovery link on passkey steps (theme)

`themes/japan-trip/login/footer.ftl` adds, on the WebAuthn sign-in, enrolment and error pages,
a link to `<client base URL>recover.html?email=<typed address>` — the client base URL is the
Pages origin + path from `config/deploy-defaults.json`, so production never links to localhost.
It is a small secondary link normally and becomes the main action when the browser has no
WebAuthn. `recover.html` (frontend) calls the backend's `POST /api/auth/recovery/request` and
`/confirm`: a 6-digit code to the account's address, then a new password set through the
`travelmap-recovery` client (below). Only the address is passed in the URL, never a code or token.

## Registration flow (`registration-passkey`)

Bound as the realm's registration flow next to the browser flow (`flows.tf`):

```
registration-passkey
└── registration-passkey-form (form, registration-page-form)  REQUIRED
    ├── Registration User Profile Creation     REQUIRED   (e-mail = username; names optional)
    └── reCAPTCHA                              REQUIRED   only with recaptcha_site_key + secret
```

- **No password at sign-up**: there is no `registration-password-action`; a password smuggled
  into the POST is ignored (tested).
- `webauthn-register-passwordless` is a **default required action**: right after the form the
  new user enrols a passkey, before any authorization code is issued. The resulting account has
  exactly one credential, the passkey.
- No WebAuthn on the device: enrolment cannot finish, no code is issued, and the page offers the
  e-mail recovery link. The account exists without a credential until then: it cannot sign in
  (the credential step is empty for it) and, never verified, it is deleted by
  `deploy/selfhost/scripts/purge-unverified.sh` after the purge window.
- **E-mail ownership is proven by the backend**, not by Keycloak's link: `verify_email = false`
  and `VERIFY_EMAIL` is not a default action. New tokens carry `email_verified=false` and the API
  answers `403 email_not_verified` until the user enters the 6-digit code from
  `POST /api/auth/email-verify/request` (backend; `users.email_verified_at`).
- Duplicate address: Keycloak's standard "Email already exists." (an enumeration oracle while
  sign-up is open, the same information the username step already gives).
- `registration_allowed` defaults to true locally and **false in production**; see section 4.

`tests/e2e/idp-registration.spec.ts` runs these against Keycloak + Mailpit (and the backend part
when `E2E_API_URL` is set).

## Recovery client (`travelmap-recovery`)

A confidential, service-account-only client (no browser flows, `full_scope_allowed = false`) with
exactly one role, `realm-management/manage-users` — Keycloak has no narrower built-in role that can
set a password. The backend uses it (internal URL, `KEYCLOAK_ADMIN_URL=http://keycloak:8080/auth`)
to look a user up by e-mail and set a password after a valid e-mail code. Its secret is the
sensitive Terraform output `recovery_client_secret`; `deploy/selfhost/scripts/keycloak-apply.sh`
writes it to the server's `.env` (`KEYCLOAK_RECOVERY_CLIENT_SECRET`) without printing it. It is
the only admin-API client a production plan accepts (`japan-trip-worker` fails the plan).
**Residual risk:** whoever controls the backend process can reset any password in the realm.
Rotate: admin console → Clients → travelmap-recovery → Credentials → Regenerate, then re-run
`keycloak-apply.sh` (it refreshes `.env`) and restart the backend.

The passwordless policy uses `authenticatorAttachment = platform` to prefer built-in
authenticators (Touch ID, Windows Hello, Face ID). Both WebAuthn policies take their rpId from
the Terraform variable `webauthn_rp_id` (`localhost` locally); see section 4 before changing it.

---

## 4. Internet-facing production (self-hosted, single host or split hosts)

Everything that must differ from a laptop hangs off `profile = "production"` in
`terraform/keycloak`. Start from `terraform/keycloak/production.tfvars.example`. A production
plan **fails** (Terraform preconditions) unless:

| Setting | Required value | Why |
|---|---|---|
| `ssl_required` | `all` | SEC-17. Needs `KC_PROXY_HEADERS=xforwarded` (or TLS on Keycloak itself), otherwise every login says "HTTPS required" |
| test users | not created (`create_test_users` false, the default) | the six Playwright users and their passwords never exist in production |
| `webauthn_rp_id` | the Keycloak host name, not `localhost` | see "Passkeys" below |
| `kc_url` | `https://…`, `kc_tls_insecure_skip_verify = false` | the admin password crosses this connection |
| realm SMTP | a real server over TLS (`smtp_starttls` or `smtp_ssl`) | verification and reset-password mail |
| password policy | contains `length(12)` or more | applies whenever a password is set (invite, recovery, reset) |
| `japan-trip-worker` | not created (`create_worker_client = false`) | a second `manage-users` client; only `travelmap-recovery` is allowed |
| with `registration_allowed = true` | brute force at ≤ 10 failures, `travelmap-recovery` created | open sign-up needs lockouts and the no-WebAuthn way in |
| `require_recaptcha = true` | both reCAPTCHA keys set | optional extra gate on the sign-up form |

Production also defaults to: self-registration **off** (`registration_allowed`), Terraform
deletion protection on the realm, and the stronger password policy below. All of these refusals
are tested offline: `terraform -chdir=terraform/keycloak test` (`tests/guards.tftest.hcl`, mocked
provider, 23 runs).

### Single-host mode (no domain: Tailscale Funnel)

One public host name serves both, with path routing:

| Piece | Value |
|---|---|
| Keycloak server env | `KC_HTTP_RELATIVE_PATH=/auth`, `KC_HOSTNAME=https://<machine>.<tailnet>.ts.net/auth`, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true` (TLS ends at the proxy) |
| Terraform | `kc_url = "https://<machine>.<tailnet>.ts.net/auth"`, `webauthn_rp_id = "<machine>.<tailnet>.ts.net"` |
| Issuer (what tokens carry) | `https://<machine>.<tailnet>.ts.net/auth/realms/japan-trip` |
| Backend | `KEYCLOAK_URL=https://<machine>.<tailnet>.ts.net/auth`, optionally `KEYCLOAK_JWKS_URL=http://keycloak:8080/auth/realms/japan-trip/protocol/openid-connect/certs` (internal network; `iss` must still be the public issuer) |
| Frontend build | `VITE_KEYCLOAK_URL=https://<machine>.<tailnet>.ts.net/auth`, `VITE_API_URL=https://<machine>.<tailnet>.ts.net/api` |

Split hosts work the same way without the path (`https://auth.<domain>`, rpId `auth.<domain>`
or the registrable parent `<domain>` if you want passkeys to also work on sibling hosts).

Validated on Keycloak 26.6.1 with `KC_HTTP_RELATIVE_PATH=/auth` behind TLS: discovery issuer and
JWKS under `/auth`, a real access token accepted by the backend verifier, the real ID token from
the same login rejected (`.planning/qa/PROD-HARDENING.md`).

### Passkeys: set `webauthn_rp_id` once, before anyone registers

A passkey is cryptographically bound to the rpId it was created for. Changing `webauthn_rp_id`
later (for example when moving from a ts.net name to your own domain) makes **every registered
passkey unusable**; users fall back to their password (or "Forgot password") and must register a
new passkey. Choose the long-term host name first. The rpId must be the host that serves the
Keycloak login pages (or a registrable parent of it); the `/auth` path plays no role.

### Brute-force protection

Temporary lockouts only. `permanent_lockout = false` on purpose: anyone on the internet who knows
a username could otherwise lock its owner out for good.

| Parameter | Production | Local |
|---|---|---|
| Failures before lockout (`brute_force_max_login_failures`) | 10 | 30 (Keycloak's default; the negative E2E tests fail logins on purpose and Keycloak keeps counts between runs) |
| Wait increment / max wait | 60 s / 15 min | same |
| Quick-login check | two failures < 1 s apart lock for 60 s | same |
| Failure counter reset | 12 h | same |

A locked account shows the same "Invalid username or password." as a wrong password (theme
messages in `themes/japan-trip/login/messages`). To unlock someone early: admin console →
Users → the user → "Brute force: unlock", or `DELETE /admin/realms/japan-trip/attack-detection/brute-force/users/{id}`.

### Password policy

Production: `length(12) and maxLength(128) and notUsername and notEmail and passwordHistory(3)`
(NIST SP 800-63B style: long, no composition rules). Local keeps the historical
`length(8) and upperCase(1) and digits(1) and specialChars(1)` that the seeded test passwords
satisfy. Existing passwords are not re-checked; the policy applies on the next change.

### Email (verification, reset password) with Gmail — no domain needed

1. On the Google account: enable 2-Step Verification (Google Account → Security).
2. Create an app password: <https://myaccount.google.com/apppasswords> (on a phone: Google app →
   Manage your Google Account → Security → 2-Step Verification → App passwords). Name it
   "TravelMap"; copy the 16 characters (spaces are ignored).
3. Terraform: `smtp_host = "smtp.gmail.com"`, `smtp_port = 587`, `smtp_starttls = true`
   (or 465 with `smtp_ssl = true`), `smtp_user` = `smtp_from` = the Gmail address, and
   `export TF_VAR_smtp_password='<app password>'` — never in a committed file.
4. The backend uses the same account for OTP mail: `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`,
   `SMTP_PORT=587`, `SMTP_SECURE=starttls`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM="TravelMap <you@gmail.com>"`.

Limits: Gmail allows roughly 500 recipients per day for a personal account and rewrites the
From address to the account address. Revoke the app password if the server is compromised.
With a domain you can switch the backend to Resend (`RESEND_API_KEY`) and Keycloak to any SMTP relay.

### Required actions and email verification

`verify_email = false` and `VERIFY_EMAIL` is **not** a default required action (REG-02): the
backend proves the address with a 6-digit code (`/api/auth/email-verify/*`) and refuses every
other API call with `403 email_not_verified` until then. A user counts as verified when the
token says `email_verified: true` (invited accounts are created verified by `add-user.sh`) or the
backend recorded the code (`users.email_verified_at`). The `email verified` mapper puts the claim
in the access token (`mappers.tf`, statically tested). `webauthn-register-passwordless` is a
default action (new accounts enrol a passkey); invited accounts have their required actions
cleared because the invite link sets a password instead.

### Username enumeration (documented residual risk)

The browser flow is username-first (KC-01). Keycloak answers an unknown username on the username
step ("Invalid username or email.") and a known one with the next step (password form, or the
WebAuthn prompt when the user has a passkey). Anyone can therefore test whether an account exists,
and whether it has a passkey. There is no Keycloak setting that hides this in a username-first
flow; the alternatives are a combined username+password form (loses passkey-first sign-in) or a
custom authenticator. What bounds it here: self-registration is off in production by default
(when it is on, the sign-up form's "Email already exists." is a second oracle with the same
information), lockouts are temporary, the credential-failure messages are
identical, and the reverse proxy should rate-limit `POST …/login-actions/authenticate` per client
IP. `tests/e2e/idp-hardening.spec.ts` pins the current behaviour so a Keycloak change that removes
the difference is noticed.

### Verification

```bash
cd tests
KEYCLOAK_URL=https://<host>/auth E2E_KC_PROFILE=production \
KC_ADMIN_CLIENT_ID=<throwaway service account with manage-users> KC_ADMIN_CLIENT_SECRET=... \
SKIP_REAL_AUTH=1 npx playwright test e2e/idp-hardening.spec.ts --project=chromium
```

Delete the throwaway service-account client afterwards.
