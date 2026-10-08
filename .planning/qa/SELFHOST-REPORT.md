# QA: self-hosting kit (deploy/selfhost, docs/SELF-HOSTING.md)

**Date:** 2026-10-07
**Branch:** `worktree-agent-a971f81a0b901a920` (not pushed). Based on `claude/focused-lovelace-cryssy`, merged up to its head on 2026-10-07.
**Target:** legion-server (Ubuntu 26.04, Docker 29 / Compose v5, Tailscale 1.102, shared with other services). Default mode is single-host behind Tailscale Funnel at `legion-server.tailad4a36.ts.net`.

## What was built

| Piece | Where |
|---|---|
| Production Node entry: env validation (all problems at once, exit 1), node `incoming` merged into bindings, JSON logs, graceful drain, pg pool limits | `backend/src/server.ts`, `backend/src/node/{config,runtime}.ts`, `configurePgPool` in `backend/src/db/index.ts`; bundle via `npm run build:node` |
| Images | `deploy/selfhost/backend/Dockerfile` (runtime = node + one file, user `node`, healthcheck; `tools` target for preflight/migrate); `deploy/selfhost/keycloak/Dockerfile` (`start --optimized`, `/auth`, ships `keycloak/themes`) |
| Stack | `deploy/selfhost/docker-compose.prod.yml`: Postgres 16 on an internal network, two least-privilege DB owners; Keycloak in production mode (KC_HOSTNAME with path, xforwarded, admin console only via 127.0.0.1:28081); Caddy proxy on 127.0.0.1:28080 (single-host path routing or subdomains host routing, admin and master realm blocked); cloudflared / public Caddy profiles; memory/CPU limits, log rotation, no-new-privileges, read-only where possible |
| Scripts | `bootstrap.sh` (check-only by default), `gen-secrets.sh`, `deploy.sh`, `keycloak-apply.sh` (Terraform plus a production override file), `funnel.sh`, `status.sh`, `backup.sh`, `restore.sh` (with `--drill`), `backup-timer.sh` (systemd), `update.sh`, `compose.sh` |
| Docs | `docs/SELF-HOSTING.md` |
| Tests | `backend/src/node/*.test.ts` (48 tests), `deploy/selfhost/tests/scripts.test.sh` (45 checks, in CI), `deploy/selfhost/tests/stack-e2e.sh` (32 checks against a running stack) |

## Validated in the sandbox

The full prod compose ran with a test override (`tests/compose.test.yml`). A Caddy "TLS front" with a private CA stood in for Funnel: it listened on :443 for `travelmap.localtest.me` and appended X-Forwarded-For the way `tailscale serve` does. Mailpit stood in for SMTP. The backend image was built from this branch with the security agent's in-progress `backend/src` overlaid (ALLOWED_ORIGINS, KEYCLOAK_JWKS_URL, client IP, logging), to test the env contract end to end.

`stack-e2e.sh`, all phases: **32 passed, 0 failed**.

| Check | Result |
|---|---|
| `deploy.sh` from empty volumes: build, preflight, 11 migrations, all healthy | ✅ |
| `/api/health/ready` = 200 through TLS front → proxy → backend | ✅ |
| `keycloak-apply.sh` on an empty Keycloak: realm created, 4 built-in mappers imported, 20 resources added; issuer = `https://<host>/auth/realms/japan-trip`; second run prints `No changes` | ✅ |
| Production realm: login page under `/auth` with the japan-trip theme; cookies `Secure`; foreign redirect_uri rejected; no test users | ✅ |
| OIDC code + PKCE login through the public URL (headless script) → token → `GET /api/users/me` with `Origin: https://manudubo.github.io` → 201/200 with ACAO; tampered token → 401 | ✅ |
| CORS preflight: Pages origin allowed; `https://evil.example` and `http://localhost:5173` get no ACAO | ✅ (needs the security agent's ALLOWED_ORIGINS change, which this branch does not contain) |
| Public `/auth/admin/*`, `/auth/realms/master*`, `/` → 404; admin console works at `http://localhost:28081/auth/admin/` (SSH tunnel) | ✅ |
| X-Forwarded-For seen by the backend: `6.6.6.6, 127.0.0.1, 172.19.0.1`, so with TRUSTED_PROXY_HOPS=2 the client is the real peer, not the spoof; X-Forwarded-Proto=https | ✅ |
| Backup → delete all trips → `restore.sh latest --yes` → trips back; `restore.sh --drill` | ✅ |
| Second `deploy.sh`: no container recreated, no migration; second `keycloak-apply.sh`: no changes | ✅ after fix S2 |
| `docker kill` Postgres → ready 503, liveness 200; Postgres back → ready 200; next Keycloak admin call and login OK | ✅ after fixes S1, S3 |
| `compose restart` of everything → login works, data kept. An unplanned dockerd restart also brought the `unless-stopped` services back by themselves | ✅ |
| `bootstrap.sh` (check mode) on the sandbox: reports only, changes nothing | ✅ |
| `scripts.test.sh`: .env parsing, all 3 mode derivations, gen-secrets, funnel.sh against a stub tailscale (443 only, never overwrites or resets, PUBLIC_HOST must match), compose services and 127.0.0.1-only ports per mode, all 3 Caddyfiles valid | ✅ 45/45 |
| shellcheck (0.11) on all kit scripts | ✅ clean |
| Backend `tsc` (main, tests/system, tests/adversarial); vitest **50 files / 1668 tests** (PG 16.13 via setpriv, own port) | ✅ |
| Frontend typecheck + vitest **49 files / 1082 tests** | ✅ |
| `wrangler deploy --dry-run` (Worker build unchanged) | ✅ |

## Findings fixed (one commit each)

| # | Finding | Fix |
|---|---|---|
| S1 | `/api/health/ready` kept answering **200 with Postgres killed**. The schema verdict is cached forever once ready, and ad852aa's `db_unreachable` only covers the case where the check actually runs. Uptime monitors and deploy waits would miss an outage. | One `SELECT 1` per probe (`routes/health.ts`) + regression test in `schema-guard.test.ts` (fails before the fix). The security agent also edits `health.ts` (rate limit), so expect a small merge there. |
| S2 | Every `deploy.sh` recreated backend and Keycloak: BuildKit's default provenance attestation embeds a timestamp, so each build had a new image ID | Scripts build with `BUILDX_NO_DEFAULT_ATTESTATIONS=1` |
| S3 | Keycloak answered 500 to the first admin request after a Postgres restart (dead pooled connection) | `QUARKUS_DATASOURCE_JDBC_VALIDATE_ON_BORROW=true` (3 kill/recover cycles clean afterwards) |
| S4 | The Terraform Keycloak provider reads `KEYCLOAK_REALM` from the environment and then logged in to `japan-trip` instead of `master` | `keycloak-apply.sh` unsets `KEYCLOAK_*` for terraform |
| S5 | The old `keycloak/Dockerfile` never shipped the themes | The new image copies `keycloak/themes`. Verified: the login page loads `login/japan-trip/css/login.css` |

## Not validated (needs the real server or accounts)

- **Tailscale Funnel itself**: `funnel.sh` was only tested against a stub. Unverified: the exact CLI shape on 1.102 (`tailscale funnel --bg --https=443 <target>`, `--https=443 off`), the `serve status --json` layout, and whether serve adds X-Forwarded-For with the real client IP, which TRUSTED_PROXY_HOPS=2 assumes. Check on the server: after `funnel.sh enable`, look at the backend's client-IP logging, or run `stack-e2e.sh xff` in a staging copy. Also unverified: Funnel bandwidth limits and public DNS propagation time.
- **Cloudflare Tunnel and Caddy + Let's Encrypt modes**: tested at config level only (compose services, ports, Caddyfile validation, derived URLs, hop counts).
- **Real email**: Gmail/Resend SMTP from Keycloak and the backend's SMTP/Resend OTP transport (the backend transport belongs to the security agent). Keycloak SMTP was only wired to Mailpit.
- **Passkeys** on the real `.ts.net` rpId, in a real browser. The UI flow on GitHub Pages was not run (no Playwright browsers in the sandbox). Login was proven with a headless HTTP client.
- **Ubuntu 26.04 specifics**: `bootstrap.sh --install-*`, `--unattended-upgrades`, `--fail2ban` and `--apply-firewall` were not executed (the sandbox is 24.04, and these are opt-in flags). `backup-timer.sh install` (systemd) was only rendered, not installed. rclone off-site copy not exercised.
- `update.sh` (git pull path) not run end to end; its parts (backup, deploy, keycloak plan) were.

## Dependencies on other work

- CORS for `https://manudubo.github.io`, `KEYCLOAK_JWKS_URL`, the `incoming` peer address, EMAIL_*/SMTP_*, NOMINATIM_* and TRUSTED_PROXY_HOPS are implemented by the security agent's branch. This branch only forwards and validates them. Without that branch, CORS still allows only `https://manud.github.io` (the typo) and JWKS is fetched from the public URL.
- That branch imports repo-root `config/deploy-defaults.json`. The backend Dockerfile copies `config/*.json` when present, so the merged tree builds without a change.
- Its `terraform/keycloak` changes merge under `deploy/selfhost/terraform/selfhost_override.tf`. The override replaces only `ssl_required`, the two WebAuthn policy blocks, `smtp_server`, the frontend client's redirect URIs and web origins, and removes test users with `count = 0`. If main.tf changes one of those blocks, the override must mirror the change.
