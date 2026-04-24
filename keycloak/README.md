# Keycloak Setup for Japan Trip

This directory contains everything needed to run Keycloak as the identity provider for the Japan Trip app, supporting passkey (WebAuthn) authentication.

---

## 1. Local Development

**Prerequisites:** Docker and Docker Compose installed.

```bash
# From the keycloak/ directory
docker compose up -d
```

Keycloak will start on http://localhost:8080 and automatically import the `realm-export.json` realm configuration.

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
| `KC_HOSTNAME` | Public hostname (Railway provides this) | `keycloak.up.railway.app` |
| `KC_HOSTNAME_STRICT` | Enforce hostname | `true` |
| `KC_PROXY` | Proxy mode (Railway uses edge proxy) | `edge` |
| `KEYCLOAK_ADMIN` | Admin username | `admin` |
| `KEYCLOAK_ADMIN_PASSWORD` | Admin password (use a strong password) | (generate a secret) |

5. Railway will use the `Dockerfile` in this directory to build and the `railway.toml` for deployment config.
6. The first startup imports `realm-export.json` automatically via the `--import-realm` flag baked into the image.

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

## 3. Exporting Realm Config After Changes

After making changes in the Keycloak admin console, export the updated realm config so it can be committed to the repo.

### From local Docker

```bash
# Replace <container_id> with the actual container ID from `docker ps`
docker exec <container_id> /opt/keycloak/bin/kc.sh export \
  --file /tmp/realm-export.json \
  --realm japan-trip

docker cp <container_id>:/tmp/realm-export.json ./realm-export.json
```

Or using docker compose:
```bash
docker compose exec keycloak /opt/keycloak/bin/kc.sh export \
  --file /tmp/realm-export.json \
  --realm japan-trip

docker compose cp keycloak:/tmp/realm-export.json ./realm-export.json
```

### From Railway

Use the Railway CLI or shell-in to the container:
```bash
railway run --service keycloak -- /opt/keycloak/bin/kc.sh export \
  --file /tmp/realm-export.json \
  --realm japan-trip
```

Then copy the file out via the Railway console file browser or `railway shell`.

> **Note:** Always restart Keycloak after making changes locally and re-importing, or use the admin REST API for live changes without restart.

---

## Passkey (WebAuthn) Notes

The realm is configured with a custom browser flow (`browser-passkey`) that uses WebAuthn Passwordless as the primary authenticator. Users register their passkey on first login. The `webAuthnPolicyPasswordlessAuthenticatorAttachment` is set to `platform` to prefer built-in biometric authenticators (Touch ID, Windows Hello, Face ID).

To enable passkeys for a user in the admin console: Users > (select user) > Credentials > Set up WebAuthn Passwordless.
