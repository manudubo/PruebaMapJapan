#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2001  # the bash -c snippets expand their own $0/$1 on purpose
# Shell-level tests for terraform/keycloak/import.sh (review S5).
# Runs import.sh against stub `curl` and `terraform` executables placed first on
# PATH, so no Keycloak or Terraform is needed. Usage: bash tests/import.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../import.sh"
PASS=0
FAIL=0
STUB_ROOT="$(mktemp -d)"
trap 'rm -rf "$STUB_ROOT"' EXIT

SECRET_PASSWORD='s3cr3t pa$$ word'
TOKEN='tok-abc123'

# --- stubs ---------------------------------------------------------------------
mkdir -p "$STUB_ROOT/bin"
cat > "$STUB_ROOT/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Stub curl: serves fixtures from $STUB_DIR/fx, logs argv and stdin.
printf '%s\n' "$*" >> "$STUB_DIR/argv.log"
method=GET url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -H) [ "${2:0:1}" = "@" ] && cat "${2:1}" >> "$STUB_DIR/headers.log"; shift 2 ;;
    --data-urlencode)
      case "$2" in *@-) cat >> "$STUB_DIR/stdin.log" ;; esac
      shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "$method $url" >> "$STUB_DIR/requests.log"
case "$url" in
  */protocol/openid-connect/token)
    case "${STUB_TOKEN_MODE:-ok}" in
      fail) exit 22 ;;
      null) echo '{"access_token":null,"error":"invalid_grant"}' ;;
      html) echo '<html>login</html>' ;;
      *) printf '{"access_token":"%s"}' "$STUB_TOKEN" ;;
    esac
    exit 0 ;;
esac
path="${url#*/admin/realms/japan-trip}"
key=$(printf '%s' "${path:-/}" | tr '/' '_')
if [ "$method" = "DELETE" ]; then
  [ "${STUB_DELETE_FAILS:-0}" = 1 ] && exit 22
  touch "$STUB_DIR/deleted"
  exit 0
fi
if [ -f "$STUB_DIR/deleted" ] && [ -f "$STUB_DIR/fx/$key.after" ]; then cat "$STUB_DIR/fx/$key.after"; exit 0; fi
[ -f "$STUB_DIR/fx/$key" ] || exit 22
cat "$STUB_DIR/fx/$key"
STUB
cat > "$STUB_ROOT/bin/terraform" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/tf.log"
STUB
chmod +x "$STUB_ROOT/bin/curl" "$STUB_ROOT/bin/terraform"

# --- fixtures -------------------------------------------------------------------
new_case() {
  STUB_DIR="$STUB_ROOT/case-$((PASS + FAIL))-$RANDOM"
  mkdir -p "$STUB_DIR/fx"
  : > "$STUB_DIR/argv.log"; : > "$STUB_DIR/tf.log"; : > "$STUB_DIR/requests.log"
  local fx="$STUB_DIR/fx"
  echo '{"realm":"japan-trip"}' > "$fx/_"
  echo '[{"clientId":"japan-trip-frontend","id":"cid-front"},{"clientId":"japan-trip-api","id":"cid-api"},{"clientId":"account","id":"cid-acc"}]' > "$fx/_clients"
  echo '[{"name":"audience-mapper","id":"map-aud"}]' > "$fx/_clients_cid-front_protocol-mappers_models"
  echo '[{"providerId":"auth-cookie","id":"ex-cookie","level":0},{"displayName":"passkey-forms","authenticationFlow":true,"id":"ex-pf","level":0}]' > "$fx/_authentication_flows_browser-passkey_executions"
  echo '[{"providerId":"auth-username-form","id":"ex-user","level":0}]' > "$fx/_authentication_flows_passkey-forms_executions"
  echo '[{"name":"profile","id":"sc-prof"},{"name":"email","id":"sc-email"}]' > "$fx/_client-scopes"
  echo '[{"name":"username","id":"m-u"},{"name":"full name","id":"m-fn"},{"name":"avatar_url","id":"m-av"},{"name":"preferences","id":"m-pr"}]' > "$fx/_client-scopes_sc-prof_protocol-mappers_models"
  echo '[{"name":"email","id":"m-e"},{"name":"email verified","id":"m-ev"}]' > "$fx/_client-scopes_sc-email_protocol-mappers_models"
  export STUB_DIR STUB_TOKEN="$TOKEN"
  unset STUB_TOKEN_MODE STUB_DELETE_FAILS
}

with_stale_flow() {
  local f="$STUB_DIR/fx/_authentication_flows_browser-passkey_executions"
  cp "$f" "$f.after"
  echo '[{"providerId":"auth-cookie","id":"ex-cookie","level":0},{"displayName":"passkey-forms","authenticationFlow":true,"id":"ex-pf","level":0},{"displayName":"password-forms","authenticationFlow":true,"id":"ex-stale","level":0}]' > "$f"
}

# run_script [args...] — env KC_URL/KC_ADMIN_PASSWORD from caller; stdin is /dev/null (not a tty)
run_script() {
  OUT=$(cd "$HERE/.." && PATH="$STUB_ROOT/bin:$PATH" bash "$SCRIPT" "$@" < /dev/null 2>&1)
  CODE=$?
}

ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
not_ok() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; echo "$OUT" | sed 's/^/       | /'; }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else not_ok "$name"; fi; }
contains() { grep -qF -- "$2" <<< "$1"; }
no_terraform() { [ ! -s "$STUB_DIR/tf.log" ]; }
no_curl() { [ ! -s "$STUB_DIR/argv.log" ]; }

export KC_ADMIN_PASSWORD="$SECRET_PASSWORD"

# --- configuration failures -------------------------------------------------------
new_case; unset KC_URL; run_script
check "no URL: fails, says how to set it, no network" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "no URL: message names KC_URL" contains "$OUT" "KC_URL"
check "no URL: curl never called" no_curl

new_case; KC_URL="localhost:8080" run_script
check "non-http URL: rejected" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "non-http URL: message" contains "$OUT" "must start with http"

new_case; KC_URL="https://kc.example.com" run_script "hunter2"
check "password as argument: rejected" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "password as argument: explains KC_ADMIN_PASSWORD" contains "$OUT" "KC_ADMIN_PASSWORD"
check "password as argument: curl never called" no_curl

new_case; OUT=$(cd "$HERE/.." && KC_URL="https://kc.example.com" KC_ADMIN_PASSWORD="" PATH="$STUB_ROOT/bin:$PATH" bash "$SCRIPT" < /dev/null 2>&1); CODE=$?
check "no password and no tty: fails (no 'admin' default)" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "no password: message" contains "$OUT" "admin password not set"
check "no password: curl never called" no_curl

new_case; KC_URL="https://kc.example.com" run_script --url
check "--url without a value: fails" bash -c '[ "$0" -ne 0 ]' "$CODE"

# --- token failures -------------------------------------------------------------
new_case; export STUB_TOKEN_MODE=fail; KC_URL="https://kc.example.com" run_script
check "token endpoint error: fails" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "token endpoint error: message" contains "$OUT" "token request"
check "token endpoint error: nothing imported" no_terraform

new_case; export STUB_TOKEN_MODE=null; KC_URL="https://kc.example.com" run_script
check "access_token null: fails (not the string 'null')" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "access_token null: message" contains "$OUT" "no access_token"
check "access_token null: nothing imported" no_terraform

new_case; export STUB_TOKEN_MODE=html; KC_URL="https://kc.example.com" run_script
check "non-JSON token response: fails" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "non-JSON token response: nothing imported" no_terraform

# --- lookup failures --------------------------------------------------------------
new_case; echo '[{"clientId":"japan-trip-frontend","id":"cid-front"}]' > "$STUB_DIR/fx/_clients"
KC_URL="https://kc.example.com" run_script
check "missing client: fails" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "missing client: names it" contains "$OUT" "client japan-trip-api not found"
check "missing client: no import with an empty id" bash -c '! grep -q "japan-trip/$" "$0"' "$STUB_DIR/tf.log"

new_case; echo '[{"clientId":"japan-trip-frontend","id":null},{"clientId":"japan-trip-api","id":"cid-api"}]' > "$STUB_DIR/fx/_clients"
KC_URL="https://kc.example.com" run_script
check "null id: treated as missing" contains "$OUT" "client japan-trip-frontend not found"

new_case; echo '[{"clientId":"japan-trip-frontend","id":"a"},{"clientId":"japan-trip-frontend","id":"b"},{"clientId":"japan-trip-api","id":"c"}]' > "$STUB_DIR/fx/_clients"
KC_URL="https://kc.example.com" run_script
check "duplicate client: fails as ambiguous" contains "$OUT" "ambiguous"

new_case; echo 'not json' > "$STUB_DIR/fx/_client-scopes"
KC_URL="https://kc.example.com" run_script
check "non-JSON admin response: fails" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "non-JSON admin response: message" contains "$OUT" "did not return JSON"

new_case; rm "$STUB_DIR/fx/_authentication_flows_passkey-forms_executions"
KC_URL="https://kc.example.com" run_script
check "admin API 404: fails" bash -c '[ "$0" -ne 0 ]' "$CODE"

new_case; echo '[{"name":"username","id":"m-u"},{"name":"full name","id":"m-fn"},{"name":"avatar_url","id":"m-av"}]' > "$STUB_DIR/fx/_client-scopes_sc-prof_protocol-mappers_models"
KC_URL="https://kc.example.com" run_script
check "missing mapper: fails naming it" contains "$OUT" "profile mapper 'preferences' not found"

# --- happy paths ----------------------------------------------------------------
new_case; KC_URL="https://kc.example.com/" run_script
check "happy path: exit 0" bash -c '[ "$0" -eq 0 ]' "$CODE"
check "happy path: 15 imports" bash -c '[ "$(wc -l < "$0")" -eq 15 ]' "$STUB_DIR/tf.log"
check "happy path: client import uses the id" grep -qx "import keycloak_openid_client.japan_trip_api japan-trip/cid-api" "$STUB_DIR/tf.log"
check "happy path: no stale flow reported" contains "$OUT" "No stale 'password-forms' subflow."
check "trailing slash normalised" bash -c '! grep -q "example.com//" "$0"' "$STUB_DIR/requests.log"
check "password sent on stdin" bash -c '[ "$(cat "$0")" = "$1" ]' "$STUB_DIR/stdin.log" "$SECRET_PASSWORD"
check "password never in curl argv" bash -c '! grep -qF "s3cr3t" "$0"' "$STUB_DIR/argv.log"
check "token never in curl argv" bash -c '! grep -qF "$1" "$0"' "$STUB_DIR/argv.log" "$TOKEN"
check "token sent as header from file" grep -qF "Authorization: Bearer $TOKEN" "$STUB_DIR/headers.log"

new_case; KC_URL="https://ignored.example.com" run_script --url https://kc.override.example.com
check "--url overrides KC_URL" grep -q "https://kc.override.example.com/realms/master" "$STUB_DIR/requests.log"

new_case; with_stale_flow; KC_URL="https://kc.example.com" run_script
check "stale flow, default: exit 0" bash -c '[ "$0" -eq 0 ]' "$CODE"
check "stale flow, default: dry run message" contains "$OUT" "DRY RUN"
check "stale flow, default: no DELETE" bash -c '! grep -q "^DELETE" "$0"' "$STUB_DIR/requests.log"

new_case; with_stale_flow; KC_URL="https://kc.example.com" run_script --remove-stale-flows
check "stale flow, --remove-stale-flows: exit 0" bash -c '[ "$0" -eq 0 ]' "$CODE"
check "stale flow, --remove-stale-flows: DELETEs that execution" grep -qx "DELETE https://kc.example.com/admin/realms/japan-trip/authentication/executions/ex-stale" "$STUB_DIR/requests.log"
check "stale flow, --remove-stale-flows: confirms removal" contains "$OUT" "Removed."

new_case; with_stale_flow; export STUB_DELETE_FAILS=1; KC_URL="https://kc.example.com" run_script --remove-stale-flows
check "DELETE fails: script fails" bash -c '[ "$0" -ne 0 ]' "$CODE"
check "DELETE fails: message" contains "$OUT" "could not delete"

new_case; with_stale_flow; rm "$STUB_DIR/fx/_authentication_flows_browser-passkey_executions.after"
KC_URL="https://kc.example.com" run_script --remove-stale-flows
check "DELETE 'succeeds' but flow remains: script fails" contains "$OUT" "still present after DELETE"

echo
echo "import.sh tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
