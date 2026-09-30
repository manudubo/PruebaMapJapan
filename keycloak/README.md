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
curl -s -o /dev/null -D - "$KC/realms/japan-trip/protocol/openid-connect/auth?client_id=japan-trip-frontend&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fmanud.github.io%2FPruebaMapJapan%2Fdashboard.html" \
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
(`keycloak_authentication_bindings.browser_flow` in `flows.tf`).

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
        │       ├── Condition - user configured  REQUIRED
        │       └── WebAuthn Passwordless        REQUIRED
        └── Password Form                        ALTERNATIVE
```

- Users with a registered passkey get the WebAuthn prompt after entering their username.
- Users without a passkey get the password form.
- A user with neither credential, or anyone submitting only a username, is rejected.
- Passkey users do not get a "Try another way → password" option in this flow; a user who lost
  their passkey recovers through "Forgot password" (Keycloak's email reset-credentials flow, which
  signs the user in on completion — not covered by E2E yet) or an admin removing the credential.

`tests/e2e/idp-flow.spec.ts` covers these cases against a running Keycloak, and
`tests/e2e/idp-config.spec.ts` statically checks the flow layout (no REQUIRED+ALTERNATIVE mix,
credential subflow after the username, WebAuthn guarded by the condition) without needing Keycloak.

The passwordless policy uses `authenticatorAttachment = platform` to prefer built-in
authenticators (Touch ID, Windows Hello, Face ID) and `rpId = localhost` (changing it requires
every user to re-register their passkey).
