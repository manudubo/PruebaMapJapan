# Self-hosting TravelMap on a home server

This guide runs the backend, Keycloak (login) and Postgres on your own Ubuntu
machine with Docker, reachable from the internet over HTTPS. The website itself
stays on GitHub Pages (`https://manudubo.github.io/PruebaMapJapan/`) and calls
your server.

Everything is copy-paste. Each step ends with **Verify**: do not go on until
it passes. All commands run on the server over SSH, which works from a phone
(Termius, Blink, JuiceSSH).

The kit lives in `deploy/selfhost/`:

| Path | What it is |
|---|---|
| `docker-compose.prod.yml` | The stack: postgres, backend, keycloak, proxy (+ cloudflared) |
| `.env.example` | Every setting, explained. Your copy is `.env` (secret, never committed) |
| `scripts/bootstrap.sh` | Checks the server; prepares `.env`. Changes nothing unless you pass a flag |
| `scripts/deploy.sh` | Build, migrate the database, start, wait until ready. Safe to re-run |
| `scripts/keycloak-apply.sh` | Create/update the login realm with Terraform (production profile) |
| `scripts/add-user.sh` | Create an account and email the person a link to choose a password |
| `scripts/purge-unverified.sh`, `purge-timer.sh` | Open sign-up only: delete never-verified accounts (dry run by default), hourly timer |
| `scripts/funnel.sh` | Publish the server with Tailscale Funnel (port 443 only) |
| `scripts/status.sh` | One-screen health report |
| `scripts/backup.sh`, `restore.sh`, `backup-timer.sh` | Backups, restore, restore drill, daily timer |
| `scripts/update.sh` | Backup, pull new code, redeploy |
| `scripts/gen-secrets.sh` | Fill/rotate random secrets in `.env` |
| `scripts/compose.sh` | `docker compose` with your settings (`./scripts/compose.sh logs -f backend`) |

---

## How it fits together

Default mode, **single-host** with Tailscale Funnel (no domain, no router ports):

```
 Phone / laptop browser
   │  https://manudubo.github.io/PruebaMapJapan/   (GitHub Pages: HTML/JS only)
   │
   │  https://legion-server.tailad4a36.ts.net/api/...   and   .../auth/...
   ▼
 Tailscale Funnel (Tailscale's servers, valid HTTPS certificate)
   │  encrypted tunnel, no open port on your router (works behind CGNAT)
   ▼
 legion-server ── tailscaled ──► 127.0.0.1:28080
                                    │
                         ┌──────────┴───────────┐  Docker network "edge"
                         │  proxy (Caddy, HTTP) │  /api/*  → backend:8787
                         │                      │  /auth/* → keycloak:8080
                         └──────────────────────┘  /auth/admin, master realm → 404
                              │            │
                        backend (Node)   Keycloak ◄── 127.0.0.1:28081 (admin console,
                              │            │            SSH tunnel only)
                         ─────┴────────────┴─────  Docker network "db" (no internet)
                                 Postgres 16
                          databases: travelmap, keycloak
```

Optional **subdomains** mode (your own domain on Cloudflare):
`https://api.<DOMAIN>/api/...` and `https://auth.<DOMAIN>/auth/...`, through a
Cloudflare Tunnel (no open ports) or Caddy with Let's Encrypt (ports 80/443
forwarded). See [Subdomains mode](#subdomains-mode-your-own-domain).

### Single-host vs subdomains

| | single-host + Funnel (default) | subdomains + Cloudflare Tunnel | subdomains + Caddy |
|---|---|---|---|
| Needs a domain | no | yes (on Cloudflare DNS) | yes |
| Router port forwarding | no | no | 80 + 443 |
| Works behind CGNAT | yes | yes | no |
| HTTPS certificate | Tailscale | Cloudflare | Let's Encrypt |
| Public URL | `https://<machine>.<tailnet>.ts.net` | `https://api.<domain>`, `https://auth.<domain>` | same |
| Bandwidth | Funnel is rate-limited (fine for a few users; not for big uploads) | generous | your uplink |
| Passkeys bound to | the `.ts.net` name | `auth.<domain>` | `auth.<domain>` |

Funnel caveats: Tailscale does not publish a fixed bandwidth limit for Funnel and
it may change; it is meant for light use (this app sends small JSON). If you
rename the machine or the tailnet, the public URL changes **and every passkey
stops working** (see [Passkeys](#passkeys-and-the-host-name)).

---

## Before you start on a shared server

> **legion-server already runs other services** (Home Assistant, AdGuard, game
> servers...). The kit is built not to disturb them:
>
> - One compose project (`travelmap`), containers named `travelmap-*`, its own
>   Docker networks and volumes. It never stops, removes or edits other containers.
> - It publishes only two ports, both on **127.0.0.1** (not reachable from your
>   LAN): `28080` (proxy, for Funnel) and `28081` (Keycloak admin, for SSH
>   tunnels). `deploy.sh` stops with a clear message if either is already in
>   use; change `PROXY_PORT` / `KC_ADMIN_PORT` in `.env` if so.
> - Tailscale: it only ever touches Funnel **port 443**. Your existing
>   `:8443` (Home Assistant, Funnel) and `:8081` (tailnet only) entries are left
>   alone; if 443 is already used for something else, `funnel.sh` stops instead
>   of overwriting. It never runs `tailscale serve reset`.
> - Firewall: **no change needed**. ufw already allows your LAN and
>   `tailscale0`; Funnel reaches the proxy through 127.0.0.1. `bootstrap.sh`
>   never touches ufw, sshd or sysctl unless you pass a flag.
> - Memory: limits are postgres 512 MB, backend 256 MB, Keycloak 1 GB (Java heap
>   256–768 MB), proxy 128 MB: about **1.9 GB worst case**, ~0.6 GB typical.
> - All state lives in the checkout: `deploy/selfhost/.env`, `state/`
>   (Terraform: `state/terraform/keycloak`; an older `state/terraform` layout is
>   moved there automatically), `backups/`, plus the Docker volumes `travelmap_pgdata`,
>   `travelmap_caddy_data`, `travelmap_caddy_config`.

---

## Prerequisites

- Ubuntu server with Docker + the compose plugin (legion-server has Docker 29
  and Compose v5) and `git`, `curl`, `python3`, `openssl` (standard on Ubuntu).
- **Tailscale** installed and logged in (legion-server: done, name
  `legion-server.tailad4a36.ts.net`).
- **An email account to send sign-in emails** (verification codes, password
  resets). Pick one:
  - **Gmail (no domain needed)**: turn on 2-step verification, then create an
    *App password* (Google Account → Security → App passwords; Google shows 16
    letters, paste them as shown, spaces or not). Limit ~500 emails/day; Gmail
    sends as your address whatever `EMAIL_FROM` says. Settings:
    `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=starttls`,
    `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`,
    `EMAIL_FROM=TravelMap <you@gmail.com>`, `EMAIL_PROVIDER=smtp`. The same
    account sends both the app's sign-in codes and Keycloak's emails (invites,
    password resets). Plain SMTP (`SMTP_SECURE=none`) is refused: both the
    backend and the production realm require TLS.
  - **Resend** (needs your own domain verified in Resend; without one it only
    delivers to your own address): `EMAIL_PROVIDER=resend`,
    `RESEND_API_KEY=re_...`, `EMAIL_FROM=TravelMap <login@yourdomain>`; Keycloak
    then uses Resend's SMTP relay automatically.
- Access to the GitHub repository settings (to set 4 secrets).
- Subdomains mode only: a domain on Cloudflare DNS and a free Cloudflare account.

---

## Step by step (single-host, Tailscale Funnel)

### 1. Get the code

```bash
cd ~
git clone https://github.com/manudubo/PruebaMapJapan.git travelmap
cd ~/travelmap/deploy/selfhost
```

**Verify:** `ls scripts` lists `deploy.sh`, `status.sh`, ...

### 2. Check the server (changes nothing)

```bash
./scripts/bootstrap.sh
```

**Verify:** Docker shows `[ OK ] ... left as is`, Tailscale shows
`logged in as legion-server.tailad4a36.ts.net`, the ports line says free.
If it says your user cannot talk to Docker:
`sudo usermod -aG docker $USER`, log out, log in, re-run.

### 3. Create your settings file

```bash
./scripts/bootstrap.sh --setup     # creates .env (mode 600) and random secrets
nano .env
```

Fill in (everything else has working defaults):

| Setting | Value |
|---|---|
| `PUBLIC_HOST` | `legion-server.tailad4a36.ts.net` (already the default) |
| `EMAIL_FROM`, `EMAIL_PROVIDER`, `SMTP_*` / `RESEND_API_KEY` | from [Prerequisites](#prerequisites) |
| `NOMINATIM_CONTACT` | your email (OpenStreetMap asks apps to give a contact) |

Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

**Verify:** `ls -l .env` shows `-rw-------`, and `grep -c CHANGE_ME .env` prints `0`.

### 4. Allow Funnel in your tailnet (from the phone, once)

1. Open <https://login.tailscale.com/admin/dns> → **HTTPS Certificates** → *Enable*
   (MagicDNS must be on too).
2. Open <https://login.tailscale.com/admin/acls/file> and make sure the policy has a
   `funnel` node attribute. Your Home Assistant Funnel already needs it, so it is
   probably there:
   ```json
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```

**Verify:** on the server, `tailscale funnel status` lists your existing
`:8443` Funnel entry (proof Funnel is allowed for this machine).

### 5. Start the stack

```bash
./scripts/deploy.sh
```

The first run builds two images (5–10 minutes), creates the databases, runs
the database checks and migrations, starts everything and waits until ready.

**Verify:** it ends with
`[ OK ] Backend ready (/api/health/ready = 200)` and
`[ OK ] Reverse proxy OK`. Running it again changes nothing and says
`Database already up to date`.

### 6. Create the login realm

```bash
./scripts/keycloak-apply.sh
```

It shows what it will create (about 25 items) and asks; type `y`.

It applies `terraform/keycloak` with `profile = "production"`: exact redirect
pages for `FRONTEND_ORIGIN` (no wildcards), the app's root/base URL
(`FRONTEND_ORIGIN` + `FRONTEND_BASE_PATH`, defaults in `config/deploy-defaults.json`;
it is the "Back to application" link of Keycloak's error pages and never
localhost: the script and the plan refuse it), HTTPS required, the passkey rpId
`PUBLIC_HOST`, temporary lockouts after 10 wrong passwords, a 12-character
password minimum, email through your `SMTP_*`, **no test users and no
self-registration** unless you opt in (you invite people in step 9; see
[Open sign-up](#open-sign-up)), and the `travelmap-recovery` client whose
secret it writes to `.env` for the backend. Terraform itself refuses to
apply if one of these production rules is not met (for example SMTP without
TLS). It talks to Keycloak on `http://127.0.0.1:28081/auth`, which never
leaves the machine.

**Verify:** the last line is
`[ OK ] Realm 'japan-trip' applied. Issuer: https://legion-server.tailad4a36.ts.net/auth/realms/japan-trip`.
Running it again prints `No changes`.

### 7. Publish it with Funnel

```bash
./scripts/funnel.sh enable
```

It prints the Tailscale configuration before and after. Your existing `:8443`
and `:8081` entries must still be there; a new `https://...ts.net (Funnel on)`
entry points `/` to `http://127.0.0.1:28080`.

**Verify (from the phone on mobile data, Wi-Fi off):** open
`https://legion-server.tailad4a36.ts.net/api/health/ready` → `{"status":"ready"}`.
DNS for a new Funnel can take a few minutes.

### 8. Point the website at your server

GitHub → repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `VITE_API_URL` | `https://legion-server.tailad4a36.ts.net/api` |
| `VITE_KEYCLOAK_URL` | `https://legion-server.tailad4a36.ts.net/auth` |
| `VITE_KEYCLOAK_REALM` | `japan-trip` |
| `VITE_KEYCLOAK_CLIENT_ID` | `japan-trip-frontend` |

Then rebuild the site: **Actions → "Deploy Frontend to GitHub Pages" → latest run
→ Re-run all jobs** (or push any commit to `main`; the deploy runs after CI
passes).

Notes:
- Set **both** `VITE_API_URL` and `VITE_KEYCLOAK_URL`. With both empty the site
  builds as a demo without login; with only one set the build **fails** on purpose.
- Do **not** set `CLOUDFLARE_API_TOKEN`: that would also deploy the backend to
  Cloudflare Workers (`deploy-backend.yml`). Without it that workflow skips itself.

**Verify:** after the deploy finishes, open
`https://manudubo.github.io/PruebaMapJapan/dashboard.html`, press *Sign in*; the
login page is served from `legion-server.tailad4a36.ts.net/auth/...`.

### 9. First account

There are two ways to get your first account. Pick one.

**A. Sign up on the website** (needs `REGISTRATION_ENABLED=true` in `.env`, see
[Open sign-up](#open-sign-up); with the default `false` the button is not shown
and the realm refuses registration). Open
`https://manudubo.github.io/PruebaMapJapan/`, press **Sign up**, type your email
(it becomes your username) and let the browser create a **passkey** (Face ID,
Touch ID, Windows Hello, Android). You land on the dashboard, which asks for a
**6-digit code** emailed to that address; type it and the app opens. No password
is created. If the device cannot do passkeys, use the *"Can't use a passkey?
Get a code by email"* link on that page to set a password instead.

**B. Invite yourself from the server** (works with sign-up closed, and is the
way to add other people while it stays closed):

```bash
./scripts/add-user.sh you@gmail.com "Your Name"
```

It prints `[ OK ] Email sent to you@gmail.com`. Open that email (subject
*Update Your Account*, from your Gmail address) within 12 hours, click the
link, choose a password (at least 12 characters, not your email), and you see
*Your account has been updated*. Click **Back to application**, press
**Sign in** and use your email and that password. Register a passkey from the
profile page if you want. Link expired or lost: `./scripts/add-user.sh --resend you@gmail.com`.
Invited accounts are already verified, so there is no code step.

**Verify:** the dashboard shows your name; `./scripts/status.sh` ends with
`All checks passed.`

### 10. Backups

```bash
./scripts/backup.sh              # first backup now
./scripts/backup-timer.sh install   # daily at ~03:30 (asks for sudo)
./scripts/restore.sh --drill     # practice restore, changes nothing
```

**Verify:** `./scripts/backup.sh --list` shows a backup; the drill ends with
`Drill passed`. See [Backups](#backups-and-restore) for off-site copies.

### 11. Uptime monitoring

Add a free HTTP monitor (UptimeRobot, Better Stack, healthchecks.io...) on
`https://legion-server.tailad4a36.ts.net/api/health/ready`, every 5 minutes,
alert on anything but 200. It answers 503 when the database is down or not
migrated. (`/api/health` only proves the backend process answers.)

---

## Daily operations

| Task | Command |
|---|---|
| Health report | `./scripts/status.sh` |
| Logs (one JSON object per line) | `./scripts/compose.sh logs -f --tail=100 backend` (or `keycloak`, `proxy`, `postgres`) |
| Restart one service | `./scripts/compose.sh restart backend` |
| Stop everything (data kept) | `./scripts/compose.sh down` (start again: `./scripts/deploy.sh --no-build`) |
| Update to the latest code | `./scripts/update.sh` |
| Take Funnel offline | `./scripts/funnel.sh disable` |

**Updating** (`update.sh`): backup → `git pull --ff-only` → `deploy.sh` (build,
pre-flight, migrate, restart only what changed) → shows pending Keycloak
changes; apply them with `./scripts/keycloak-apply.sh`. To roll back the code:
`git checkout <previous-commit> && ./scripts/deploy.sh`. Database migrations
only go forward; if an update damaged data, restore the backup it took.

**Keycloak admin console** (never public): from your laptop or phone SSH app,
forward a port, then open it locally.

```bash
ssh -L 28081:127.0.0.1:28081 you@legion-server
# browser: http://localhost:28081/auth/admin/   user: admin  password: KC_ADMIN_PASSWORD from .env
```

(Termius: *Port Forwarding → Local*, local 28081 → 127.0.0.1:28081.) Change
realm settings in `terraform/keycloak` + `keycloak-apply.sh`, not in the
console: the next apply reverts console changes. Managing *users* (disable,
reset a passkey) in the console is fine.

---

## Passkeys and the host name

Passkeys are tied to the host name of the login page (WebAuthn `rpId`). The kit
sets it to `PUBLIC_HOST` (single-host) or `auth.<DOMAIN>`. If that name ever
changes (renamed machine, new tailnet, switching to a domain), every
registered passkey stops working: users sign in with password or email code and
register a new passkey. Pick the final name before inviting people.

### Passkey-first sign-in (operator notes)

A browser that has used a passkey on the login page asks for it on load, with
no username typed; other browsers get the usual form with passkeys in the
e-mail field's autofill list. Design and per-browser behaviour:
`docs/design/PASSKEY-FIRST-LOGIN.md`.

To roll it out on an existing server, in this order:

1. Redeploy Keycloak so the new login theme is served (rebuild/restart the
   Keycloak image; the theme is copied in by `keycloak/Dockerfile`). No new
   Keycloak feature flag is needed.
2. Run `keycloak-apply` (Terraform) with provider 5.8 or newer (the lock file
   pins it; `terraform init` fetches it). It turns on realm passkeys and adds
   the `passkey-done` branch to the credential step. Both changes are
   additive and fail closed at every step of the apply. Check the plan: it
   should add 5 resources and update the realm's passkey setting; the two
   profile mappers must show no change (`add_to_token_introspection` is pinned
   false).
3. Nothing to do on the devices: the first passkey sign-in or registration on
   a browser stores the marker. Safari deletes script-written storage after
   about 7 days without a visit; that browser then simply shows the normal
   page until the next passkey sign-in.

Rollback: set `passwordless_passkeys_enabled = false` and re-apply; the theme
falls back to the plain form by itself.

---

## Open sign-up

By default only people you invite (`add-user.sh`) have accounts. Setting
`REGISTRATION_ENABLED=true` lets **anyone on the internet** create one from the
app's **Sign up** button. Read this section before turning it on.

**How a sign-up works**

1. The Keycloak form asks only for an e-mail address (it becomes the username)
   and, optionally, a name. No password.
2. Right after, the browser registers a **passkey** (Face ID, Touch ID, Windows
   Hello, Android). The account is usable only once that succeeds.
3. On the first visit the app asks for a **6-digit code** sent to that address.
   Until it is entered, the API answers `403 email_not_verified` to everything
   except the verification itself (backend; `users.email_verified_at`).
4. **No passkey possible** (old browser, shared PC) — at sign-up or later: the
   passkey page shows *"Can't use a passkey on this device? Get a code by email"*.
   It opens the app's `recover.html`; a code to the address sets a **password**
   (12+ characters, not the address) through the `travelmap-recovery` client.
   Users with both a passkey and a password get the other one under
   *Try another way* when one does not work.

**Risks and what limits them**

| Risk | Limit |
|---|---|
| Strangers use your server and your Gmail quota (~500 mails/day) | every sign-up costs a passkey or a mailed code; the backend's per-user/per-IP/per-address limits on code requests; optional reCAPTCHA (below). **There is no per-IP sign-up throttle**: Keycloak has none and the stock Caddy image has no rate-limit module, so a bot with a WebAuthn emulator can create accounts at Keycloak's speed. Watch `./scripts/purge-unverified.sh` output and close sign-up if numbers jump |
| Someone registers **your** address first ("squatting") | they cannot use the API (no code), and `purge-unverified.sh` deletes never-verified accounts after `PURGE_UNVERIFIED_AFTER_HOURS` (24); the owner can also take the address back through e-mail recovery |
| Checking whether an address has an account | the sign-up form says "Email already exists." — the same information the sign-in page already gives (keycloak/README.md, "Username enumeration"). Recovery always answers the same |
| Password guessing | lockouts after 10 failures (Terraform refuses open sign-up with a laxer setting), 12-character minimum |
| The backend can set passwords | `travelmap-recovery` holds `manage-users`: whoever controls the backend can reset any password. Its secret lives only in `.env` (mode 600) and the backend reaches Keycloak on the internal network; the public URL blocks `/auth/admin` |

**Turning it on**

```bash
nano .env                      # REGISTRATION_ENABLED=true
                               # optional: RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET_KEY
                               #   (Google reCAPTCHA admin console, domain = PUBLIC_HOST)
./scripts/keycloak-apply.sh    # plan shows registration_allowed = true
./scripts/deploy.sh            # restarts the backend with the recovery secret
./scripts/purge-timer.sh install
./scripts/purge-unverified.sh  # dry run: lists what the hourly timer would delete
```

Terraform refuses the change if brute-force lockouts are above 10 failures or
the recovery client is disabled. `RECAPTCHA_SECRET_KEY` only reaches Terraform
through the environment, never a file in the repository.

**Purging never-verified accounts.** `purge-unverified.sh` lists Keycloak
accounts older than 24 h that are neither verified in Keycloak (invited
accounts are) nor in the app database, and with `--apply` deletes them and
their empty app row. It never deletes when it cannot ask the database, and
stops above 50 candidates (`--max`). The timer runs it hourly; logs:
`journalctl -u travelmap-purge-unverified.service`.

**Closing it again.** Set `REGISTRATION_ENABLED=false` and re-run
`./scripts/keycloak-apply.sh`: the **Sign up** buttons and the Keycloak "Register" link disappear and the
registration endpoint answers "Registration not allowed". Existing accounts keep
working. Leave the purge timer installed until the last unverified sign-ups are
gone, then `./scripts/purge-timer.sh remove`. To remove a specific account:
admin console (SSH tunnel) → Users.

**Rotating the recovery secret.** Admin console → Clients →
`travelmap-recovery` → Credentials → Regenerate, then `./scripts/keycloak-apply.sh`
(it copies the new secret into `.env`) and `./scripts/deploy.sh`.

---

## Rotating secrets

All secrets live only in `.env`. After any change run `./scripts/deploy.sh --no-build`.

| Secret | How |
|---|---|
| `OTP_SECRET` | `./scripts/gen-secrets.sh --rotate OTP_SECRET`, deploy. Pending email codes stop working (users request a new one). |
| `KC_ADMIN_PASSWORD` | Change it in the admin console (*master* realm → Users → admin → Credentials), then put the same value in `.env` (`keycloak-apply.sh` logs in with it). |
| `APP_DB_PASSWORD` | `./scripts/gen-secrets.sh --rotate APP_DB_PASSWORD`, then `docker exec -it travelmap-postgres psql -U postgres -c "ALTER ROLE travelmap PASSWORD '<new value from .env>'"`, then deploy. |
| `KC_DB_PASSWORD` | Same with `--rotate KC_DB_PASSWORD` and `ALTER ROLE keycloak`. |
| `POSTGRES_SUPERUSER_PASSWORD` | `--rotate`, then `ALTER ROLE postgres PASSWORD '...'` (only used for admin tasks). |
| `SMTP_PASS` / `RESEND_API_KEY` | Create the new one at the provider, edit `.env`, deploy, `./scripts/keycloak-apply.sh` (Keycloak keeps its own copy), revoke the old one. |
| `KEYCLOAK_RECOVERY_CLIENT_SECRET` | Regenerate it in the admin console (*japan-trip* realm -> Clients -> `travelmap-recovery` -> Credentials), put the new value in `.env`, deploy. Recovery answers "try again later" until both sides match. |
| Cloudflare tunnel token | Dashboard → tunnel → refresh token, edit `.env`, deploy. |

Docker only reads the Postgres passwords on the very first start; that is why
the database passwords also need `ALTER ROLE`.

---

## Account recovery secrets and sign-up verification

Self-registration adds two backend settings (the Keycloak side - the
`travelmap-recovery` client, its service-account role and the sign-up theme -
is created by the realm setup, not here):

| Variable | Meaning |
|---|---|
| `REQUIRE_VERIFIED_EMAIL` | Empty = `true` in production. Accounts must confirm their e-mail with a 6-digit code before using the API (everything except `GET/PATCH /api/users/me`, `POST /api/auth/email-verify/*` and health answers `403 email_not_verified`). Existing users are marked verified by migration 0011. `false` only for a closed, invite-only deployment. Any other value is read as `true`. |
| `KEYCLOAK_RECOVERY_CLIENT_ID` | Confidential service-account client used to reset a password (default `travelmap-recovery`). It holds exactly one role, realm-management `manage-users`, scope-mapped onto the client (without that mapping its token carries no roles and every call is a 403). |
| `KEYCLOAK_RECOVERY_CLIENT_SECRET` | That client's secret. **Treat it like a database password**: whoever holds it can set any user's password. Keep it only in `.env` (mode 600), never in the frontend or the repo. Empty = account recovery is switched off (the endpoints answer 503). |
| `KEYCLOAK_ADMIN_URL` | Where the backend reaches Keycloak for that call. Default in the compose file `http://keycloak:8080/auth` (inside the compose network, not through the tunnel). On the Worker/standalone it defaults to `KEYCLOAK_URL`. Keep the `/auth` prefix if Keycloak runs with `KC_HTTP_RELATIVE_PATH=/auth`. |

Recovery sends a code to the account's e-mail (same SMTP/Resend settings as the
login code) and, with the code, sets a new password in Keycloak. It does not
log or store passwords; codes are single-use, expire after 10 minutes and allow
5 guesses.

---

## Backups and restore

`backup.sh` writes `backups/<date-time>/` with `travelmap.dump`,
`keycloak.dump` (users and passkeys), `terraform.tar.gz` (Keycloak state),
`env` (**your secrets**) and `SHA256SUMS`, and keeps the newest `BACKUP_KEEP`
(14). Each dump is checked with `pg_restore -l` when it is written.

**Off-site copy** (recommended: a disk failure or theft takes local backups
too): `sudo apt install rclone`, `rclone config` (e.g. Google Drive, then
add a *crypt* remote on top so the copy is encrypted, because it contains
`.env`), then set `BACKUP_RCLONE_REMOTE=gdrive-crypt:travelmap` in `.env`.

**Restore drill (monthly, safe):** `./scripts/restore.sh --drill` restores the
latest app dump into a temporary database, prints row counts next to the live
ones, and deletes it.

**Real restore** (replaces live data; a safety backup is taken first):

```bash
./scripts/backup.sh --list
./scripts/restore.sh 20261007-033012        # or: latest
./scripts/restore.sh latest --only app      # app data only
./scripts/restore.sh latest --only keycloak # users/passkeys only
```

**New server from scratch:** clone the repo (step 1), copy a backup folder to
`deploy/selfhost/backups/`, `cp backups/<name>/env .env && chmod 600 .env`,
`./scripts/deploy.sh`, `./scripts/restore.sh <name> --yes`,
`./scripts/keycloak-apply.sh` (expects `No changes`), `./scripts/funnel.sh enable`.

---

## Subdomains mode (your own domain)

In `.env`: `HOST_MODE=subdomains`, `DOMAIN=example.com`, then either:

**Cloudflare Tunnel** (`INGRESS=cloudflared`, no open ports):
1. Cloudflare dashboard → *Zero Trust → Networks → Tunnels → Create a tunnel*
   (Cloudflared), name it `travelmap`, copy the token from the Docker command
   into `CLOUDFLARE_TUNNEL_TOKEN`.
2. In the tunnel, add two *Public hostnames*: `api.example.com` → `HTTP` →
   `proxy:80`, and `auth.example.com` → `HTTP` → `proxy:80`.
3. `./scripts/deploy.sh && ./scripts/keycloak-apply.sh`.

**Caddy with Let's Encrypt** (`INGRESS=caddy`, `ACME_EMAIL=you@example.com`):
create DNS A records `api` and `auth` pointing to your public IP (Cloudflare:
DNS only / grey cloud), forward TCP 80 and 443 on the router to the server,
allow them in ufw (`sudo ufw allow 80/tcp && sudo ufw allow 443`), deploy.
Caddy is then the only thing published on `0.0.0.0` (Docker-published ports
bypass ufw rules, which is why everything else stays on 127.0.0.1).

GitHub secrets for this mode: `VITE_API_URL=https://api.example.com/api`,
`VITE_KEYCLOAK_URL=https://auth.example.com/auth`. Keycloak keeps the `/auth`
path in both modes.

Client IPs (rate limiting): the scripts set `TRUSTED_PROXY_HOPS` per mode —
Funnel → proxy → backend = 2, Cloudflare edge → cloudflared → proxy → backend = 2
(the edge writes the client into X-Forwarded-For, the proxy appends cloudflared),
Caddy → backend = 1.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `deploy.sh`: *Port 28080 is already used* | Another program has it. Pick a free port in `.env` (`PROXY_PORT`), deploy, `./scripts/funnel.sh disable && ./scripts/funnel.sh enable`. |
| Backend restarts, log says `invalid configuration, refusing to start` | The log line lists every missing/invalid setting. Fix `.env`, `./scripts/deploy.sh --no-build`. |
| `/api/health/ready` = 503 `schema_not_migrated` | Migrations not applied: `./scripts/deploy.sh`. |
| `/api/health/ready` = 503 `db_unreachable` | Postgres down: `./scripts/compose.sh ps`, `./scripts/compose.sh logs --tail=50 postgres`. |
| Browser console: *blocked by CORS policy* | `FRONTEND_ORIGIN` must be exactly `https://manudubo.github.io` (no path, no trailing slash). Check: `curl -si -X OPTIONS https://<host>/api/trips -H 'Origin: https://manudubo.github.io' -H 'Access-Control-Request-Method: GET' \| grep -i access-control-allow-origin`. |
| Browser console: *Refused to connect ... Content Security Policy* | The Pages build has old URLs baked in. Fix the `VITE_*` secrets and re-run the Pages deploy (step 8). |
| Login page: *Invalid parameter: redirect_uri* | Realm not applied, or `FRONTEND_ORIGIN`/`FRONTEND_BASE_PATH` wrong: fix `.env`, `./scripts/keycloak-apply.sh`. |
| Keycloak error page (e.g. *Registration not allowed*): *Back to application* goes to `http://localhost:5173/...` | The realm was applied before the client root/base URL came from `FRONTEND_ORIGIN`. Re-run `./scripts/keycloak-apply.sh`: the plan shows the `japan-trip-frontend` client changing `root_url`/`base_url` to `https://manudubo.github.io/PruebaMapJapan/`. |
| Login page: *HTTPS required* | Keycloak reached without `X-Forwarded-Proto: https`. Only use the public URL; the proxy adds the header. |
| API answers 401 right after a good login | Issuer mismatch: `KEYCLOAK_URL` must equal the public `.../auth` URL (the scripts derive it from `PUBLIC_HOST`). Also check the server clock: `timedatectl` must say *System clock synchronized: yes* (tokens live 5 minutes). |
| Passkey: *operation not allowed* / not offered | The page host differs from the passkey rpId (`PUBLIC_HOST`). Renamed machine? See [Passkeys](#passkeys-and-the-host-name). |
| Signed out on every page load / cookies dropped | Use the HTTPS URL (Keycloak cookies are `Secure`). Safari with *Prevent cross-site tracking* blocks Keycloak's third-party check; login still works with redirects. |
| No verification email | `./scripts/compose.sh logs keycloak \| grep -i mail`. Gmail needs an *App password*, not your normal one. Resend without a verified domain only sends to your own address. |
| `funnel.sh`: *Port 443 ... already configured* | Something else uses Funnel 443. Check `tailscale funnel status`; free it yourself or ask for help. |
| `https://...ts.net` does not open from outside | `tailscale funnel status` must show *Funnel on* for 443; HTTPS certificates and the `funnel` attribute must be enabled (step 4). New names can take minutes to resolve. |
| `keycloak-apply.sh`: *exists in Keycloak but not in Terraform state* | `state/` was lost. Restore it from a backup (`terraform.tar.gz`), or ask for help importing (`terraform/keycloak/import.sh`). |

---

## Security checklist (internet-facing home server)

- [ ] `.env` is mode 600, not in git, and backups (which contain it) are private / encrypted off-site.
- [ ] Only 127.0.0.1 ports are published (`./scripts/status.sh` "Conflicts" section; `docker ps` shows `127.0.0.1:` for travelmap containers).
- [ ] `https://<host>/auth/admin/` and `https://<host>/auth/realms/master` answer 404 from outside.
- [ ] Keycloak admin password is the generated one (64 hex chars) and only used through the SSH tunnel.
- [ ] No test users in the realm (production profile; Terraform refuses otherwise). Registration off, or on deliberately with the purge timer installed ([Open sign-up](#open-sign-up)).
- [ ] `KEYCLOAK_RECOVERY_CLIENT_SECRET` only in `.env`; no `japan-trip-worker` client in the realm.
- [ ] SSH: key login only (`PasswordAuthentication no`), consider `./scripts/bootstrap.sh --fail2ban`.
- [ ] Automatic security updates: `./scripts/bootstrap.sh --unattended-upgrades` (if not already handled).
- [ ] Daily backups + monthly `restore.sh --drill` + an off-site copy.
- [ ] Uptime monitor on `/api/health/ready`.
- [ ] `./scripts/update.sh` at least monthly (also updates base images on rebuild).

## Go-live checklist

- [ ] `./scripts/status.sh` → `All checks passed.`
- [ ] From mobile data: `https://<host>/api/health/ready` → `{"status":"ready"}`.
- [ ] GitHub secrets set (4), Pages redeployed, sign-in redirects to `<host>/auth`.
- [ ] First account works: **Sign up** (passkey, then the emailed 6-digit code) or the `add-user.sh` invite email (the link sets your password; you sign in).
- [ ] With sign-up open: `tests/stack-e2e.sh register verify recover` on a staging copy passes (needs the test SMTP sink, see `tests/compose.test.yml`).
- [ ] Create a trip, reload, it is still there; sign out and in again.
- [ ] Optional: register a passkey and sign in with it.
- [ ] Backup timer installed (`./scripts/backup-timer.sh status`), drill passed.
- [ ] Uptime monitor alerting to your phone.
- [ ] Your existing services (Home Assistant on `:8443`, etc.) still work.

---

## Reference

**Settings derived by the scripts** (not in `.env`): `KC_PUBLIC_URL`
(`https://<host>/auth`), `API_PUBLIC_URL`, `ALLOWED_ORIGINS` (=`FRONTEND_ORIGIN`),
`PASSKEY_RP_ID`, `TRUSTED_PROXY_HOPS`, compose profiles. That is why the
scripts (or `./scripts/compose.sh`) must be used instead of plain
`docker compose`.

**Backend environment** (validated at start-up by `backend/src/node/bootstrap.ts`,
with the same rules the app uses at run time; the process exits listing every
problem; the list is `SERVER_ENV_CONTRACT` in `backend/src/node/config.ts`, and
a test checks that compose forwards it): `ENVIRONMENT`, `DATABASE_URL`,
`DB_DRIVER=pg`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `VALID_AUDIENCES`,
`KEYCLOAK_JWKS_URL` (internal, set by compose), optional `KEYCLOAK_ISSUER` and
`ALLOWED_AZP`, `OTP_SECRET` (≥32 chars), `EMAIL_PROVIDER`, `EMAIL_FROM` (alias
`SMTP_FROM`) + `RESEND_API_KEY` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`
(`starttls`/`tls`)/`SMTP_USER`/`SMTP_PASS`, `ALLOWED_ORIGINS` (exact https
origins), `NOMINATIM_CONTACT`, optional `NOMINATIM_USER_AGENT` and
`NOMINATIM_URL`, `TRUSTED_PROXY_HOPS`, `CLIENT_IP_HEADER`, `LOG_LEVEL`
(`info`; `warn` hides the per-request lines), optional `PG_POOL_MAX` (10),
`PG_IDLE_TIMEOUT_MS`, `PG_CONNECT_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`,
`LOG_REQUESTS`. Every other variable is passed to the app unchanged.

**What could not be tested before go-live** (see
`.planning/qa/SELFHOST-REPORT.md`): real Tailscale Funnel, Cloudflare Tunnel,
Let's Encrypt and real email delivery were simulated locally (TLS front with a
private CA, Mailpit). Steps 7–9 above are the real-world check.
