#!/usr/bin/env bash
# Throwaway Keycloak + Terraform realm for the KC-01 regression E2E tests
# (tests/e2e/idp-flow.spec.ts). Used by .github/workflows/keycloak-flow.yml and
# runnable locally with the same commands (see .planning/qa/E2E-DEBT-KC-CI.md).
#
# Usage: scripts/ci/keycloak-flow.sh start|apply|stop
#
#   start  Generate random secrets, start quay.io/keycloak/keycloak:26.6.1 (start-dev)
#          plus Mailpit (the realm's SMTP sink, for registration/recovery mail)
#          and wait until both answer.
#   apply  terraform init (lock file read-only) + apply terraform/keycloak against it,
#          then write the Playwright env file ($KC_WORK/e2e.env).
#   stop   Remove the containers and the work directory.
#
# Environment (all optional):
#   KC_WORK        directory for generated secrets, tfvars and state
#                  (default: $RUNNER_TEMP/keycloak-flow; must be set locally)
#   KC_PORT        HTTP port (default 8080)
#   KC_MGMT_PORT   management port (default 9000)
#   KC_CONTAINER   container name (default kc-flow); Mailpit is "$KC_CONTAINER-mailpit"
#   MAILPIT_SMTP_PORT / MAILPIT_HTTP_PORT  Mailpit ports on 127.0.0.1 (default 1025 / 8025)
#   TERRAFORM      terraform binary (default: terraform)
#
# Secrets (admin password, test-user passwords, worker client secret) are generated
# here, written only to mode-600 files under $KC_WORK and never printed or passed on
# a command line. On GitHub Actions they are also registered with ::add-mask:: so a
# tool that echoes them by accident is redacted.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KC_IMAGE="quay.io/keycloak/keycloak:26.6.1"
KC_PORT="${KC_PORT:-8080}"
KC_MGMT_PORT="${KC_MGMT_PORT:-9000}"
KC_CONTAINER="${KC_CONTAINER:-kc-flow}"
MAILPIT_CONTAINER="${KC_CONTAINER}-mailpit"
MAILPIT_IMAGE="ghcr.io/axllent/mailpit:v1.29"
MAILPIT_SMTP_PORT="${MAILPIT_SMTP_PORT:-1025}"
MAILPIT_HTTP_PORT="${MAILPIT_HTTP_PORT:-8025}"
TF="${TERRAFORM:-terraform}"
if [ -z "${KC_WORK:-}" ]; then
  [ -n "${RUNNER_TEMP:-}" ] || die "set KC_WORK (or RUNNER_TEMP) to a private directory"
  KC_WORK="$RUNNER_TEMP/keycloak-flow"
fi
KC_URL="http://localhost:${KC_PORT}"

# 24 random bytes, base64url, plus a fixed suffix that satisfies the realm password
# policy (upper case, digit, special character) whatever the random part contains.
gen_password() { printf '%s' "$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=\n')Aa1!"; }

mask() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$1"; fi
}

wait_http_200() {
  local url="$1" tries="$2"
  for _ in $(seq 1 "$tries"); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)" = "200" ]; then return 0; fi
    sleep 2
  done
  return 1
}

cmd_start() {
  umask 077
  mkdir -p "$KC_WORK"
  local admin_pass
  admin_pass="$(gen_password)"
  mask "$admin_pass"
  # --env-file keeps the password out of docker's argv (visible in `ps`).
  printf 'KC_BOOTSTRAP_ADMIN_USERNAME=admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$admin_pass" > "$KC_WORK/kc.env"
  printf '%s' "$admin_pass" > "$KC_WORK/admin-pass"

  # Host networking: same command works on the Actions runner and in a sandbox whose
  # dockerd runs with --iptables=false (no published ports).
  docker run -d --name "$KC_CONTAINER" --network host \
    --env-file "$KC_WORK/kc.env" \
    -e KC_HTTP_PORT="$KC_PORT" \
    -e KC_HTTP_MANAGEMENT_PORT="$KC_MGMT_PORT" \
    -v "$REPO/keycloak/themes:/opt/keycloak/themes:ro" \
    --health-cmd "bash -c 'exec 3<>/dev/tcp/127.0.0.1/${KC_PORT} && printf \"GET /realms/master HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n\" >&3 && head -1 <&3 | grep -q 200'" \
    --health-interval 5s --health-timeout 5s --health-retries 30 \
    "$KC_IMAGE" start-dev >/dev/null

  # SMTP sink for the realm (registration, recovery and reset mail); loopback only.
  docker run -d --name "$MAILPIT_CONTAINER" --network host \
    -e MP_SMTP_BIND_ADDR="127.0.0.1:${MAILPIT_SMTP_PORT}" \
    -e MP_UI_BIND_ADDR="127.0.0.1:${MAILPIT_HTTP_PORT}" \
    "$MAILPIT_IMAGE" >/dev/null
  wait_http_200 "http://127.0.0.1:${MAILPIT_HTTP_PORT}/api/v1/messages" 30 || die "Mailpit did not start"

  for _ in $(seq 1 60); do
    case "$(docker inspect --format '{{.State.Health.Status}}' "$KC_CONTAINER")" in
      healthy) echo "Keycloak is healthy at $KC_URL"; return 0 ;;
      unhealthy) break ;;
    esac
    sleep 3
  done
  docker logs --tail 80 "$KC_CONTAINER" >&2 || true
  die "Keycloak did not become healthy"
}

# terraform apply in $mod with $tfvars. Terraform never prints sensitive values, but the
# log stays quiet unless the apply fails.
tf_apply() {
  if ! "$TF" -chdir="$mod" apply -input=false -auto-approve -no-color -var-file="$tfvars" "$@" \
    > "$KC_WORK/apply.log" 2>&1; then
    tail -n 60 "$KC_WORK/apply.log" >&2
    die "terraform apply $* failed"
  fi
}

import_builtin_scope_mappers() {
  local auth="$KC_WORK/auth-header" token scopes scope_id mappers id
  # Password via stdin and token via a mode-600 header file: neither appears in argv.
  token="$(curl -sS --fail --data-urlencode client_id=admin-cli --data-urlencode username=admin \
      --data-urlencode grant_type=password --data-urlencode "password@$KC_WORK/admin-pass" \
      "$KC_URL/realms/master/protocol/openid-connect/token" | jq -r '.access_token // empty')"
  [ -n "$token" ] || die "could not get an admin token"
  printf 'Authorization: Bearer %s\n' "$token" > "$auth"
  scopes="$(curl -sS --fail -H @"$auth" "$KC_URL/admin/realms/japan-trip/client-scopes")"

  local spec scope name resource
  for spec in "profile|username|keycloak_openid_user_property_protocol_mapper.profile_username" \
              "profile|full name|keycloak_openid_full_name_protocol_mapper.profile_full_name" \
              "email|email|keycloak_openid_user_property_protocol_mapper.email_claim" \
              "email|email verified|keycloak_openid_user_property_protocol_mapper.email_verified"; do
    IFS='|' read -r scope name resource <<< "$spec"
    scope_id="$(jq -r --arg s "$scope" '.[] | select(.name == $s) | .id' <<< "$scopes")"
    [ -n "$scope_id" ] || die "client scope '$scope' not found"
    mappers="$(curl -sS --fail -H @"$auth" "$KC_URL/admin/realms/japan-trip/client-scopes/$scope_id/protocol-mappers/models")"
    id="$(jq -r --arg n "$name" '.[] | select(.name == $n) | .id' <<< "$mappers")"
    [ -n "$id" ] || die "built-in mapper '$name' not found in scope '$scope'"
    "$TF" -chdir="$mod" import -input=false -no-color -var-file="$tfvars" "$resource" \
      "japan-trip/client-scope/$scope_id/$id" > "$KC_WORK/import.log" 2>&1 \
      || { tail -n 30 "$KC_WORK/import.log" >&2; die "terraform import $resource failed"; }
  done
  rm -f "$auth"
}

cmd_apply() {
  umask 077
  [ -f "$KC_WORK/admin-pass" ] || die "run '$0 start' first"
  local e2e_pw session_pw v
  tfvars="$KC_WORK/ci.tfvars"
  e2e_pw="$(gen_password)"
  session_pw="$(gen_password)"
  {
    printf 'kc_url = "%s"\nkc_admin_user = "admin"\n' "$KC_URL"
    printf 'kc_admin_pass = "%s"\n' "$(cat "$KC_WORK/admin-pass")"
    printf 'ssl_required = "external"\n'
    printf 'smtp_host = "127.0.0.1"\nsmtp_port = %s\n' "$MAILPIT_SMTP_PORT"
    printf 'e2e_test_password = "%s"\n' "$e2e_pw"
    printf 'e2e_session_password = "%s"\n' "$session_pw"
    for v in e2e_otp_password testuser_password new_user_test_password trip_edit_test_user_password; do
      printf '%s = "%s"\n' "$v" "$(gen_password)"
    done
  } > "$tfvars"
  mask "$e2e_pw"
  mask "$session_pw"

  # Work on a copy so state, .terraform/ and the plugin cache never land in the checkout.
  # Same layout as the repo: main.tf reads ../../config/deploy-defaults.json.
  rm -rf "$KC_WORK/tf"
  mod="$KC_WORK/tf/terraform/keycloak"
  mkdir -p "$mod" "$KC_WORK/tf/config"
  cp "$REPO"/terraform/keycloak/*.tf "$REPO"/terraform/keycloak/.terraform.lock.hcl "$mod/"
  cp "$REPO"/config/deploy-defaults.json "$KC_WORK/tf/config/"
  "$TF" -chdir="$mod" init -input=false -lockfile=readonly -no-color >/dev/null

  # Fresh bootstrap: Keycloak creates the built-in profile/email scope mappers together
  # with the realm, and mappers.tf manages four of them, so a plain apply fails with
  # "a protocol mapper with name ... already exists". Create the realm first, import
  # those four, then apply everything (import.sh is for adopting a whole existing realm).
  tf_apply -target=keycloak_realm.japan_trip
  import_builtin_scope_mappers
  tf_apply
  grep -E '^Apply complete' "$KC_WORK/apply.log"

  local worker_secret recovery_secret
  worker_secret="$("$TF" -chdir="$mod" output -raw worker_client_secret)"
  mask "$worker_secret"
  recovery_secret="$("$TF" -chdir="$mod" output -raw recovery_client_secret)"
  mask "$recovery_secret"
  {
    printf 'KEYCLOAK_URL=%s\n' "$KC_URL"
    printf 'KEYCLOAK_REALM=japan-trip\n'
    printf 'E2E_TEST_USERNAME=e2e-test@local\n'
    printf 'E2E_TEST_PASSWORD=%s\n' "$e2e_pw"
    # The worker client has realm-management/manage-users: enough for the kcAdmin fixture
    # (create/delete throwaway users, credentials). Its secret is generated per run.
    printf 'KC_ADMIN_CLIENT_ID=japan-trip-worker\n'
    printf 'KC_ADMIN_CLIENT_SECRET=%s\n' "$worker_secret"
    # travelmap-recovery (manage-users only): the backend's e-mail recovery client,
    # used by tests/e2e/idp-registration.spec.ts when it runs the backend.
    printf 'KC_RECOVERY_CLIENT_ID=travelmap-recovery\n'
    printf 'KC_RECOVERY_CLIENT_SECRET=%s\n' "$recovery_secret"
    printf 'MAILPIT_URL=http://127.0.0.1:%s\n' "$MAILPIT_HTTP_PORT"
  } > "$KC_WORK/e2e.env"
  wait_http_200 "$KC_URL/realms/japan-trip" 15 || die "realm japan-trip not served after apply"
  echo "Realm japan-trip applied; Playwright env written to $KC_WORK/e2e.env"
}

cmd_stop() {
  docker rm -f "$KC_CONTAINER" "$MAILPIT_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$KC_WORK"
}

case "${1:-}" in
  start) cmd_start ;;
  apply) cmd_apply ;;
  stop) cmd_stop ;;
  *) die "usage: $0 start|apply|stop" ;;
esac
