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
#   mail       (opt-in, needs TEST_MAILPIT_PORT: tests/compose.test.yml's SMTP
#              sink) OTP request -> mail delivered over STARTTLS + AUTH, the
#              code never appears in the backend log
#   invite     (opt-in, needs TEST_MAILPIT_PORT) scripts/add-user.sh -> Keycloak
#              mails the invite over STARTTLS + AUTH -> password set from the
#              link -> that person logs in and calls the API
#   register   realm side of self-registration through the proxy at /auth:
#              the registration endpoint is open (REGISTRATION_ENABLED=true) or
#              refused (false), the form asks for no password, and the
#              travelmap-recovery secret is in the .env
#   verify     (opt-in, needs TEST_MAILPIT_PORT) e-mail verification gate through
#              /auth + /api: unverified user -> 403 email_not_verified on data
#              routes, /users/me still works, code mailed, wrong code refused,
#              right code unlocks the API (REQUIRE_VERIFIED_EMAIL default = on)
#   recover    (opt-in, needs TEST_MAILPIT_PORT) e-mail recovery through the proxy:
#              anonymous request -> same 202 for unknown addresses, mailed code,
#              weak password / wrong code refused, new password set through the
#              backend -> Keycloak Admin API (travelmap-recovery) -> the person
#              logs in with it and the old password is dead
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

# Newest 6-digit code mailed to $1 whose subject matches $2 (extended regex), via the test SMTP sink.
mail_code() { # <to> <subject regex>
  local sink="http://127.0.0.1:$TEST_MAILPIT_PORT/api/v1" n=0 got=""
  until [ -n "$got" ] || [ $n -ge 20 ]; do
    got="$("${CURL[@]}" "$sink/search?query=to:$1" | SUBJ="$2" python3 -c '
import json, os, re, sys
for m in json.load(sys.stdin).get("messages") or []:
    if re.search(os.environ["SUBJ"], m.get("Subject", ""), re.I):
        print(m["ID"]); break' 2>/dev/null)"
    [ -n "$got" ] || { sleep 1; n=$((n + 1)); }
  done
  [ -n "$got" ] || return 1
  "${CURL[@]}" "$sink/message/$got" | python3 -c 'import json,re,sys; print((re.findall(r"code is: (\d{6})", json.load(sys.stdin)["Text"]) or [""])[0])'
}
# Log in as $1 / $2 (token to $TMP/<name>); exit code of oidc-login.mjs.
login_as() { # <user> <pass> <token file>
  NODE_EXTRA_CA_CERTS="${TEST_CA_FILE:-}" PUBLIC_URL="https://$AUTH_HOST" API_URL="$API" \
    REALM="$KEYCLOAK_REALM" USERNAME="$1" PASSWORD="$2" ORIGIN="$FRONTEND_ORIGIN" \
    REDIRECT_URI="$FRONTEND_ORIGIN$FRONTEND_BASE_PATH/dashboard.html" TOKEN_FILE="$3" \
    node "$HERE/oidc-login.mjs" >/dev/null 2>&1
}
apit() { # <token file> curl args...  (Bearer from a given token file)
  local tf="$1"; shift
  "${CURL[@]}" -H "Authorization: Bearer $(cat "$tf")" -H 'Content-Type: application/json' "$@"
}
json_field() { # <python expr over d> from stdin JSON
  python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null
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
    mail)
      [ -n "${TEST_MAILPIT_PORT:-}" ] || { flunk "mail phase needs TEST_MAILPIT_PORT (the test SMTP sink)"; continue; }
      [ -s "$TMP/token" ] || login >/dev/null
      sink="http://127.0.0.1:$TEST_MAILPIT_PORT/api/v1"
      "${CURL[@]}" -X DELETE "$sink/messages" -o /dev/null
      check "OTP request (code issued)" 201 "$(api -o /dev/null -w '%{http_code}' -X POST "$API/auth/otp-request" -d '{}')"
      n=0; got=""
      until [ -n "$got" ] || [ $n -ge 15 ]; do
        sleep 1; n=$((n + 1))
        got="$("${CURL[@]}" "$sink/search?query=to:$USER_NAME" | python3 -c 'import json,sys; m=json.load(sys.stdin)["messages"]; print(m[0]["ID"] if m else "")' 2>/dev/null)"
      done
      check "OTP mail delivered to the user" true "$([ -n "$got" ] && echo true || echo false)"
      code6="$("${CURL[@]}" "$sink/message/$got" | python3 -c 'import json,re,sys; print((re.findall(r"\b\d{6}\b", json.load(sys.stdin)["Text"]) or [""])[0])' 2>/dev/null)"
      check "mail carries a 6-digit code" 6 "${#code6}"
      check "code not in the backend log" 0 "$(docker logs "$COMPOSE_PROJECT_NAME-backend" 2>&1 | grep -c "${code6:-nocode}")"
      check "OTP verify with the mailed code" 200 "$(api -o /dev/null -w '%{http_code}' -X POST "$API/auth/otp-verify" -d "{\"code\":\"$code6\"}")" ;;
    invite)
      [ -n "${TEST_MAILPIT_PORT:-}" ] || { flunk "invite phase needs TEST_MAILPIT_PORT (the test SMTP sink)"; continue; }
      invitee="invite-$(date +%s)@travelmap.test"; invitee_pass="Invited-$(date +%s)-Pw!"
      "$SELFHOST_DIR/scripts/add-user.sh" "$invitee" "Invited Person" >/dev/null && pass "add-user.sh $invitee" || flunk "add-user.sh failed"
      sleep 2
      python3 -I "$HERE/invite-flow.py" "http://127.0.0.1:$TEST_MAILPIT_PORT/api/v1" "$invitee" "https://$AUTH_HOST" "$invitee_pass" \
        && pass "invite email -> password chosen from the link" || flunk "invite link flow"
      out="$(NODE_EXTRA_CA_CERTS="${TEST_CA_FILE:-}" PUBLIC_URL="https://$AUTH_HOST" API_URL="$API" \
        REALM="$KEYCLOAK_REALM" USERNAME="$invitee" PASSWORD="$invitee_pass" ORIGIN="$FRONTEND_ORIGIN" \
        REDIRECT_URI="$FRONTEND_ORIGIN$FRONTEND_BASE_PATH/dashboard.html" TOKEN_FILE="$TMP/invitee-token" \
        node "$HERE/oidc-login.mjs")"; rc=$?
      check "invited person logs in and calls the API (exit code)" 0 "$rc" ;;
    register)
      reg_url="$KC_PUBLIC_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/registrations?client_id=japan-trip-frontend&response_type=code&scope=openid&redirect_uri=$FRONTEND_ORIGIN$FRONTEND_BASE_PATH/dashboard.html&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
      # The endpoint redirects to the registration form (login-actions/registration), with cookies.
      "${CURL[@]}" -L -c "$TMP/reg.jar" -b "$TMP/reg.jar" -o "$TMP/register.html" -w '%{http_code}' "$reg_url" > "$TMP/register.code" || true
      if [ "${REGISTRATION_ENABLED:-false}" = true ]; then
        check "registration endpoint is open (REGISTRATION_ENABLED=true)" 200 "$(cat "$TMP/register.code")"
        check "form asks for the e-mail" 1 "$(grep -c 'name="email"' "$TMP/register.html")"
        check "form asks for no password (passkey is enrolled right after)" 0 "$(grep -c 'type="password"' "$TMP/register.html")"
        check "KEYCLOAK_RECOVERY_CLIENT_SECRET was written by keycloak-apply.sh" true \
          "$([ -n "${KEYCLOAK_RECOVERY_CLIENT_SECRET:-}" ] && [ "${KEYCLOAK_RECOVERY_CLIENT_SECRET:-}" != CHANGE_ME_SECRET ] && echo true || echo false)"
      else
        check "registration endpoint is refused (REGISTRATION_ENABLED=false)" true \
          "$([ "$(cat "$TMP/register.code")" != 200 ] && echo true || echo false)"
      fi ;;
    verify)
      [ -n "${TEST_MAILPIT_PORT:-}" ] || { flunk "verify phase needs TEST_MAILPIT_PORT (the test SMTP sink)"; continue; }
      vuser="verify-$(date +%s)@travelmap.test"; vpass="Verify-$(date +%s)-Pw!x"
      KC_LOCAL_URL="$KC_LOCAL_URL" KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" KEYCLOAK_REALM="$KEYCLOAK_REALM" KC_USER_VERIFIED=false \
        "$HERE/kc-user.sh" "$vuser" "$vpass" >/dev/null && pass "unverified user created" || flunk "kc-user.sh failed"
      login_as "$vuser" "$vpass" "$TMP/vtoken"; check "unverified user signs in (exit code)" 0 "$?"
      me="$(apit "$TMP/vtoken" "$API/users/me")"
      check "GET /users/me still works and says email_verified=false" False "$(printf '%s' "$me" | json_field 'd["data"]["email_verified"]')"
      gate="$(apit "$TMP/vtoken" -w '\n%{http_code}' "$API/trips")"
      check "GET /trips is refused with 403" 403 "$(printf '%s' "$gate" | tail -1)"
      check "  body carries email_not_verified" email_not_verified "$(printf '%s' "$gate" | head -1 | json_field 'd["code"]')"
      check "POST /auth/email-verify/request" 201 "$(apit "$TMP/vtoken" -o /dev/null -w '%{http_code}' -X POST "$API/auth/email-verify/request")"
      vcode="$(mail_code "$vuser" 'confirm')" || vcode=""
      check "verification mail carries a 6-digit code" 6 "${#vcode}"
      check "the code is not in the backend log" 0 "$(docker logs "$COMPOSE_PROJECT_NAME-backend" 2>&1 | grep -c "${vcode:-nocode}")"
      wrong="000000"; [ "$vcode" = 000000 ] && wrong=111111
      check "wrong code refused" 400 "$(apit "$TMP/vtoken" -o /dev/null -w '%{http_code}' -X POST "$API/auth/email-verify/confirm" -d "{\"code\":\"$wrong\"}")"
      check "right code accepted" 200 "$(apit "$TMP/vtoken" -o /dev/null -w '%{http_code}' -X POST "$API/auth/email-verify/confirm" -d "{\"code\":\"$vcode\"}")"
      check "same token now passes the gate" 200 "$(apit "$TMP/vtoken" -o /dev/null -w '%{http_code}' "$API/trips")" ;;
    recover)
      [ -n "${TEST_MAILPIT_PORT:-}" ] || { flunk "recover phase needs TEST_MAILPIT_PORT (the test SMTP sink)"; continue; }
      ruser="recover-$(date +%s)@travelmap.test"; rpass="Recover-$(date +%s)-Old1!"; rnew="Recovered-$(date +%s)-New1!"
      KC_LOCAL_URL="$KC_LOCAL_URL" KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" KEYCLOAK_REALM="$KEYCLOAK_REALM" \
        "$HERE/kc-user.sh" "$ruser" "$rpass" >/dev/null && pass "recovery test user created" || flunk "kc-user.sh failed"
      login_as "$ruser" "$rpass" "$TMP/rtoken"; check "first sign-in provisions the account (exit code)" 0 "$?"
      post() { "${CURL[@]}" -w '\n%{http_code}' -H 'Content-Type: application/json' -X POST "$API/auth/recovery/$1" -d "$2"; }
      known="$(post request "{\"email\":\"$ruser\"}")"
      unknown="$(post request "{\"email\":\"nobody-$ruser\"}")"
      check "recovery request answers 202 through the proxy" 202 "$(printf '%s' "$known" | tail -1)"
      check "  unknown address gets the identical answer (anti-enumeration)" "$known" "$unknown"
      rcode="$(mail_code "$ruser" 'recovery')" || rcode=""
      check "recovery mail carries a 6-digit code" 6 "${#rcode}"
      check "no mail for the unknown address" 0 "$("${CURL[@]}" "http://127.0.0.1:$TEST_MAILPIT_PORT/api/v1/search?query=to:nobody-$ruser" | json_field 'd["messages_count"]')"
      check "weak password refused before any state change" 422 "$(post confirm "{\"email\":\"$ruser\",\"code\":\"$rcode\",\"new_password\":\"short\"}" | tail -1)"
      wrong="000000"; [ "$rcode" = 000000 ] && wrong=111111
      check "wrong code refused" 400 "$(post confirm "{\"email\":\"$ruser\",\"code\":\"$wrong\",\"new_password\":\"$rnew\"}" | tail -1)"
      check "right code sets the password (backend -> Keycloak Admin API)" 200 "$(post confirm "{\"email\":\"$ruser\",\"code\":\"$rcode\",\"new_password\":\"$rnew\"}" | tail -1)"
      check "the code is single use" 400 "$(post confirm "{\"email\":\"$ruser\",\"code\":\"$rcode\",\"new_password\":\"$rnew\"}" | tail -1)"
      login_as "$ruser" "$rnew" "$TMP/rtoken2"; check "signs in with the new password (exit code)" 0 "$?"
      if login_as "$ruser" "$rpass" "$TMP/rtoken3"; then old_works=true; else old_works=false; fi
      check "the old password no longer works" false "$old_works" ;;
    *) flunk "unknown phase $phase" ;;
  esac
done

say ""
say "passed: $passed  failed: $failed"
[ "$failed" -eq 0 ]
