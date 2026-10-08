#!/usr/bin/env bash
# Backend + Postgres + built frontend for the registration e2e specs
# (tests/e2e/idp-registration.spec.ts "with the backend", tests/e2e/registration-integration.spec.ts).
# Runs on top of scripts/ci/keycloak-flow.sh (Keycloak, Mailpit, realm, travelmap-recovery secret).
#
# Usage: scripts/ci/registration-stack.sh start|stop     (run keycloak-flow.sh start + apply first)
#
#   start  Postgres 16 in a container, migrations (drizzle, 0000..latest), the backend dev server
#          (REQUIRE_VERIFIED_EMAIL=true, SMTP sink = the Mailpit of keycloak-flow.sh,
#          KEYCLOAK_RECOVERY_* from the Terraform output), a frontend build with the local API and
#          Keycloak URLs, and `vite preview` on :5173 (the redirect URI registered in the realm).
#          Appends E2E_API_URL to $KC_WORK/e2e.env.
#   stop   Kill the backend and the preview server, remove the Postgres container.
#
# Environment (all optional; the ones of keycloak-flow.sh apply too):
#   KC_WORK, KC_PORT, KC_CONTAINER, MAILPIT_SMTP_PORT   same meaning as in keycloak-flow.sh
#   API_PORT              backend port (default 8787)
#   PG_PORT               Postgres port on 127.0.0.1 (default 55432)
#   REG_DATABASE_URL      use this (already running, empty) database instead of starting a container
#
# Generated secrets (database password, OTP secret) live in mode-600 files under $KC_WORK and are
# never printed or passed on a command line; on GitHub Actions they are also masked.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KC_PORT="${KC_PORT:-8080}"
KC_CONTAINER="${KC_CONTAINER:-kc-flow}"
MAILPIT_SMTP_PORT="${MAILPIT_SMTP_PORT:-1025}"
API_PORT="${API_PORT:-8787}"
PG_PORT="${PG_PORT:-55432}"
PG_CONTAINER="${KC_CONTAINER}-pg"
PG_IMAGE="public.ecr.aws/docker/library/postgres:16-alpine"
if [ -z "${KC_WORK:-}" ]; then
  [ -n "${RUNNER_TEMP:-}" ] || die "set KC_WORK (or RUNNER_TEMP) to the directory keycloak-flow.sh uses"
  KC_WORK="$RUNNER_TEMP/keycloak-flow"
fi

mask() { if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$1"; fi; }

wait_http_200() {
  local url="$1" tries="$2"
  for _ in $(seq 1 "$tries"); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)" = "200" ]; then return 0; fi
    sleep 1
  done
  return 1
}

cmd_start() {
  umask 077
  [ -f "$KC_WORK/e2e.env" ] || die "run keycloak-flow.sh start and apply first (no $KC_WORK/e2e.env)"
  local db_url="${REG_DATABASE_URL:-}" otp_secret
  if [ -z "$db_url" ]; then
    local pg_pass
    pg_pass="$(openssl rand -hex 24)"
    mask "$pg_pass"
    printf 'POSTGRES_PASSWORD=%s\n' "$pg_pass" > "$KC_WORK/pg.env"
    docker run -d --name "$PG_CONTAINER" --network host --env-file "$KC_WORK/pg.env" \
      "$PG_IMAGE" -c "port=${PG_PORT}" -c listen_addresses=127.0.0.1 -c max_connections=100 >/dev/null
    for _ in $(seq 1 40); do
      docker exec "$PG_CONTAINER" pg_isready -h 127.0.0.1 -p "$PG_PORT" -U postgres >/dev/null 2>&1 && break
      sleep 1
    done
    docker exec "$PG_CONTAINER" pg_isready -h 127.0.0.1 -p "$PG_PORT" -U postgres >/dev/null || die "Postgres did not start"
    db_url="postgresql://postgres:${pg_pass}@127.0.0.1:${PG_PORT}/postgres"
  fi
  otp_secret="$(openssl rand -hex 32)"
  mask "$otp_secret"

  # One env file for migrations, backend and (read-only) nothing else; mode 600.
  {
    printf 'DATABASE_URL=%s\n' "$db_url"
    printf 'DB_DRIVER=pg\nPORT=%s\n' "$API_PORT"
    printf 'KEYCLOAK_URL=http://localhost:%s\nKEYCLOAK_REALM=japan-trip\nVALID_AUDIENCES=japan-trip-frontend\n' "$KC_PORT"
    printf 'OTP_SECRET=%s\n' "$otp_secret"
    # development: plain-http CORS for the local preview and an SMTP sink without TLS. The gate is
    # explicit, so it is on exactly as in production.
    printf 'ENVIRONMENT=development\nREQUIRE_VERIFIED_EMAIL=true\nALLOWED_ORIGINS=http://localhost:5173\n'
    printf 'EMAIL_PROVIDER=smtp\nSMTP_HOST=127.0.0.1\nSMTP_PORT=%s\nSMTP_SECURE=none\nEMAIL_FROM=noreply@example.test\n' "$MAILPIT_SMTP_PORT"
    printf 'KEYCLOAK_ADMIN_URL=http://localhost:%s\nKEYCLOAK_RECOVERY_CLIENT_ID=travelmap-recovery\n' "$KC_PORT"
    grep -E '^KC_RECOVERY_CLIENT_SECRET=' "$KC_WORK/e2e.env" | sed 's/^KC_RECOVERY_CLIENT_SECRET=/KEYCLOAK_RECOVERY_CLIENT_SECRET=/'
  } > "$KC_WORK/backend.env"

  # shellcheck source=/dev/null
  ( cd "$REPO/backend" && set -a && . "$KC_WORK/backend.env" && set +a && npx drizzle-kit migrate >"$KC_WORK/migrate.log" 2>&1 ) \
    || { tail -n 30 "$KC_WORK/migrate.log" >&2; die "migrations failed"; }

  # shellcheck source=/dev/null
  ( cd "$REPO/backend" && set -a && . "$KC_WORK/backend.env" && set +a \
    && exec setsid npx tsx src/dev.ts >"$KC_WORK/backend.log" 2>&1 & echo $! > "$KC_WORK/backend.pid" )
  wait_http_200 "http://127.0.0.1:${API_PORT}/api/health" 60 || { tail -n 30 "$KC_WORK/backend.log" >&2; die "backend did not start"; }

  ( cd "$REPO/frontend" \
    && VITE_API_URL="http://localhost:${API_PORT}/api" VITE_KEYCLOAK_URL="http://localhost:${KC_PORT}" \
       VITE_KEYCLOAK_REALM=japan-trip VITE_KEYCLOAK_CLIENT_ID=japan-trip-frontend npm run build >"$KC_WORK/frontend-build.log" 2>&1 ) \
    || { tail -n 30 "$KC_WORK/frontend-build.log" >&2; die "frontend build failed"; }
  ( cd "$REPO/frontend" && exec setsid npx vite preview --port 5173 --strictPort >"$KC_WORK/preview.log" 2>&1 & echo $! > "$KC_WORK/preview.pid" )
  wait_http_200 "http://localhost:5173/PruebaMapJapan/dashboard.html" 30 || { tail -n 20 "$KC_WORK/preview.log" >&2; die "frontend preview did not start"; }

  printf 'E2E_API_URL=http://localhost:%s\n' "$API_PORT" >> "$KC_WORK/e2e.env"
  echo "Backend on :${API_PORT} (REQUIRE_VERIFIED_EMAIL=true), frontend preview on :5173"
}

kill_tree() {
  local pidfile="$1" pid
  [ -f "$pidfile" ] || return 0
  pid="$(cat "$pidfile")"
  # setsid made it a session/group leader: kill the whole group (npx -> node).
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  rm -f "$pidfile"
}

cmd_stop() {
  kill_tree "$KC_WORK/backend.pid"
  kill_tree "$KC_WORK/preview.pid"
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  *) die "usage: $0 start|stop" ;;
esac
