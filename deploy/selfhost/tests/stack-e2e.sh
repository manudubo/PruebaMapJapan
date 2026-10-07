#!/usr/bin/env bash
# End-to-end checks against a RUNNING self-hosted stack (sandbox/staging only:
# it creates a test user and test data). Reads the same .env as the scripts.
#
#   SELFHOST_ENV_FILE=... [TEST_CA_FILE=root.crt] tests/stack-e2e.sh [phase...]
# Phases (default: all, in this order):
#   public     health, issuer, blocked admin paths, Secure cookies
#   login      OIDC code+PKCE login, token accepted by the API, forged token refused
#   cors       preflight from FRONTEND_ORIGIN allowed, unknown origin refused
#   xff        X-Forwarded-For seen by the backend (temporarily swaps in an echo
#              container; the real backend is restarted afterwards)
#   backup     backup -> delete data -> restore -> data back; restore drill
#   idempotent second deploy.sh changes nothing
#   postgres   kill Postgres: ready=503; start it: ready=200 again
#   restart    restart every container: data and login still work
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=SCRIPTDIR/../scripts/lib/common.sh
. "$HERE/../scripts/lib/common.sh"
# shellcheck source=SCRIPTDIR/../scripts/lib/checks.sh
. "$HERE/../scripts/lib/checks.sh"
load_config

PHASES=("$@")
[ "${#PHASES[@]}" -gt 0 ] || PHASES=(public login cors xff backup idempotent postgres restart)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
USER_NAME="${TEST_USER:-selfhost-e2e@travelmap.test}"
USER_PASS="${TEST_PASS:-Selfhost-E2e-Pw-1!}"
API="$API_PUBLIC_URL"
KC_LOCAL_URL="http://127.0.0.1:$KC_ADMIN_PORT/auth"
passed=0; failed=0
pass() { ok "$*"; passed=$((passed + 1)); }
flunk() { fail "$*"; failed=$((failed + 1)); }
check() { # <description> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1 ($3)"; else flunk "$1: expected '$2', got '$3'"; fi
}

CURL=(curl -s --noproxy '*' --max-time 20)
[ -n "${TEST_CA_FILE:-}" ] && CURL+=(--cacert "$TEST_CA_FILE")
code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" || true; }

login() { # writes $TMP/token, prints the summary JSON
  KC_LOCAL_URL="$KC_LOCAL_URL" KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" KEYCLOAK_REALM="$KEYCLOAK_REALM" \
    "$HERE/kc-user.sh" "$USER_NAME" "$USER_PASS" >/dev/null
  NODE_EXTRA_CA_CERTS="${TEST_CA_FILE:-}" PUBLIC_URL="https://$AUTH_HOST" API_URL="$API" \
    REALM="$KEYCLOAK_REALM" USERNAME="$USER_NAME" PASSWORD="$USER_PASS" ORIGIN="$FRONTEND_ORIGIN" \
    REDIRECT_URI="$FRONTEND_ORIGIN$FRONTEND_BASE_PATH/dashboard.html" TOKEN_FILE="$TMP/token" \
    node "$HERE/oidc-login.mjs"
}
api() { "${CURL[@]}" -H "Authorization: Bearer $(cat "$TMP/token")" -H 'Content-Type: application/json' "$@"; }
trip_count() {
  api "$API/trips" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(len(d["data"]) if isinstance(d, dict) and d.get("success") else "error:" + json.dumps(d)[:120])' 2>/dev/null || echo "?"
}

for phase in "${PHASES[@]}"; do
  step "phase: $phase"
  case "$phase" in
    public)
      check "public /api/health/ready" 200 "$(code "$API/health/ready")"
      issuer="$("${CURL[@]}" "$KC_PUBLIC_URL/realms/$KEYCLOAK_REALM/.well-known/openid-configuration" | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])' 2>/dev/null)"
      check "issuer is the public URL" "$KC_PUBLIC_URL/realms/$KEYCLOAK_REALM" "$issuer"
      for p in /auth/admin/ /auth/admin/master/console/ /auth/admin/realms/master/users /auth/realms/master /auth/realms/master/protocol/openid-connect/token /; do
        check "public $p blocked" 404 "$(code "https://$AUTH_HOST$p")"
      done
      check "unknown path" 404 "$(code "https://$API_HOST/api/nope")" ;;
    login)
      out="$(login)"; rc=$?
      say "  $out"
      check "OIDC login + API call with the token (exit code)" 0 "$rc"
      check "login cookies are Secure" true "$(printf '%s' "$out" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["secureCookies"]).lower())' 2>/dev/null)" ;;
    cors)
      pre() { "${CURL[@]}" -o /dev/null -D - -X OPTIONS "$API/trips" -H "Origin: $1" \
        -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' \
        | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin" {print $2}'; }
      check "preflight from $FRONTEND_ORIGIN" "$FRONTEND_ORIGIN" "$(pre "$FRONTEND_ORIGIN")"
      check "preflight from https://evil.example" "" "$(pre https://evil.example)"
      check "preflight from http://localhost:5173 (dev origin, prod)" "" "$(pre http://localhost:5173)" ;;
    xff)
      # Replace the backend with an echo server under the same network alias.
      net="${COMPOSE_PROJECT_NAME}_edge"
      docker stop "$COMPOSE_PROJECT_NAME-backend" >/dev/null
      docker run -d --rm --name "$COMPOSE_PROJECT_NAME-xff-echo" --network "$net" --network-alias backend \
        "${CADDY_IMAGE:-public.ecr.aws/docker/library/caddy:2.10-alpine}" \
        caddy respond --listen :8787 'xff={http.request.header.X-Forwarded-For} proto={http.request.header.X-Forwarded-Proto}' >/dev/null
      sleep 2
      seen="$("${CURL[@]}" -H 'X-Forwarded-For: 6.6.6.6' "$API/health")"
      say "  backend received: $seen"
      docker rm -f "$COMPOSE_PROJECT_NAME-xff-echo" >/dev/null
      docker start "$COMPOSE_PROJECT_NAME-backend" >/dev/null
      # Expect: spoofed, real client (added by the TLS front / Funnel), proxy peer.
      n="$(printf '%s' "$seen" | sed 's/^xff=//; s/ proto=.*//' | tr ',' '\n' | grep -c .)"
      check "X-Forwarded-For has 3 entries (spoof, client, proxy peer) - TRUSTED_PROXY_HOPS=2 picks the client" 3 "$n"
      check "first entry is the client's (untrusted) value" 6.6.6.6 "$(printf '%s' "$seen" | sed 's/^xff=//; s/,.*//')"
      check "X-Forwarded-Proto" https "${seen##*proto=}"
      wait_backend_ready 60 && pass "backend back after xff test" || flunk "backend did not come back" ;;
    backup)
      [ -s "$TMP/token" ] || login >/dev/null
      api -X POST "$API/trips" -d '{"name":"Backup canary"}' -o /dev/null
      before="$(trip_count)"
      "$SELFHOST_DIR/scripts/backup.sh" >/dev/null && pass "backup.sh" || flunk "backup.sh failed"
      latest="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' | sort | tail -1)"
      docker exec "$COMPOSE_PROJECT_NAME-postgres" psql -U postgres -d travelmap -qc 'DELETE FROM trips' >/dev/null
      check "trips deleted" 0 "$(trip_count)"
      "$SELFHOST_DIR/scripts/restore.sh" "$latest" --yes >/dev/null && pass "restore.sh $latest" || flunk "restore.sh failed"
      login >/dev/null
      check "trips back after restore" "$before" "$(trip_count)"
      "$SELFHOST_DIR/scripts/restore.sh" --drill >/dev/null && pass "restore drill" || flunk "restore drill failed" ;;
    idempotent)
      out="$("$SELFHOST_DIR/scripts/deploy.sh" 2>&1)"; rc=$?
      check "deploy.sh exit code" 0 "$rc"
      check "no container recreated" 0 "$(printf '%s\n' "$out" | grep -cE 'Recreat|Restarting')"
      check "no migration applied" 1 "$(printf '%s\n' "$out" | grep -c 'Database already up to date')"
      out="$("$SELFHOST_DIR/scripts/keycloak-apply.sh" --yes 2>&1)"
      check "keycloak-apply.sh second run" 1 "$(printf '%s\n' "$out" | grep -c 'No changes')" ;;
    postgres)
      docker kill "$COMPOSE_PROJECT_NAME-postgres" >/dev/null
      sleep 3
      check "ready while Postgres is down" 503 "$(code "$API/health/ready")"
      check "liveness while Postgres is down" 200 "$(code "$API/health")"
      compose up -d postgres >/dev/null 2>&1
      wait_healthy "$COMPOSE_PROJECT_NAME-postgres" 120 >/dev/null
      n=0; until [ "$(code "$API/health/ready")" = 200 ] || [ $n -ge 30 ]; do sleep 2; n=$((n + 1)); done
      check "ready after Postgres is back" 200 "$(code "$API/health/ready")" ;;
    restart)
      [ -s "$TMP/token" ] || login >/dev/null
      before="$(trip_count)"
      compose restart >/dev/null 2>&1
      wait_healthy "$COMPOSE_PROJECT_NAME-keycloak" 300 >/dev/null
      wait_backend_ready 120 >/dev/null
      n=0; until [ "$(code "$API/health/ready")" = 200 ] || [ $n -ge 30 ]; do sleep 2; n=$((n + 1)); done
      out="$(login)"; rc=$?
      check "login after restarting everything" 0 "$rc"
      check "trips kept across restart" "$before" "$(trip_count)" ;;
    *) flunk "unknown phase $phase" ;;
  esac
done

say ""
say "passed: $passed  failed: $failed"
[ "$failed" -eq 0 ]
