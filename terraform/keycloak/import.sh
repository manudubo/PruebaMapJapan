#!/usr/bin/env bash
# Import an existing Keycloak realm into Terraform state (run from terraform/keycloak/).
#
# Usage:
#   KC_URL=https://kc.example.com KC_ADMIN_PASSWORD=... bash import.sh [options]
#
# Options:
#   --url URL               Keycloak base URL (overrides $KC_URL). Required, no default.
#   --remove-stale-flows    Actually DELETE the stale pre-KC-01 'password-forms' subflow.
#                           Without it the script only reports what it would delete (dry run).
#   -h, --help              Show this help.
#
# Environment:
#   KC_URL              Keycloak base URL, e.g. https://japan-keycloak.up.railway.app
#   KC_ADMIN_USER       admin user in the master realm (default: admin)
#   KC_ADMIN_PASSWORD   admin password. If unset and stdin is a terminal, you are
#                       prompted (input hidden). Never passed on the command line.
#   KC_REALM            realm to import (default: japan-trip)
#
# The admin password and the access token never appear in any process's argv:
# curl reads the password from stdin and the Authorization header from a
# mode-600 temp file.
set -euo pipefail

usage() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "ERROR: $*" >&2; exit 1; }

KC_URL="${KC_URL:-}"
KC_REALM="${KC_REALM:-japan-trip}"
ADMIN_USER="${KC_ADMIN_USER:-admin}"
REMOVE_STALE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) [ $# -ge 2 ] || die "--url needs a value"; KC_URL="$2"; shift 2 ;;
    --url=*) KC_URL="${1#--url=}"; shift ;;
    --remove-stale-flows) REMOVE_STALE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument '$1'. The admin password is no longer accepted as an argument (it would be visible in 'ps'); set KC_ADMIN_PASSWORD instead. See --help." ;;
  esac
done

[ -n "$KC_URL" ] || die "Keycloak URL not set. Pass --url https://... or set KC_URL."
case "$KC_URL" in
  http://*|https://*) ;;
  *) die "KC_URL must start with http:// or https:// (got '$KC_URL')." ;;
esac
KC_URL="${KC_URL%/}"

ADMIN_PASS="${KC_ADMIN_PASSWORD:-}"
if [ -z "$ADMIN_PASS" ] && [ -t 0 ]; then
  read -r -s -p "Keycloak admin password for '${ADMIN_USER}' at ${KC_URL}: " ADMIN_PASS
  echo >&2
fi
[ -n "$ADMIN_PASS" ] || die "admin password not set. Export KC_ADMIN_PASSWORD (or run interactively to be prompted)."

command -v jq >/dev/null || die "jq is required."
command -v curl >/dev/null || die "curl is required."
TF="${TERRAFORM:-terraform}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
chmod 700 "$WORKDIR"
AUTH_HEADER="$WORKDIR/auth-header"

# --- Admin token --------------------------------------------------------------
TOKEN_JSON=$(printf '%s' "$ADMIN_PASS" | curl -sS --fail \
  --data-urlencode "client_id=admin-cli" \
  --data-urlencode "username=${ADMIN_USER}" \
  --data-urlencode "password@-" \
  --data-urlencode "grant_type=password" \
  "${KC_URL}/realms/master/protocol/openid-connect/token") \
  || die "token request to ${KC_URL} failed. Is Keycloak reachable? Is the password correct?"
unset ADMIN_PASS
TOKEN=$(printf '%s' "$TOKEN_JSON" | jq -r '.access_token // empty' 2>/dev/null) || TOKEN=""
[ -n "$TOKEN" ] || die "no access_token in the token response (wrong password, or not a Keycloak token endpoint)."
( umask 077; printf 'Authorization: Bearer %s\n' "$TOKEN" > "$AUTH_HEADER" )
unset TOKEN TOKEN_JSON

# GET an admin API path; fails the script on HTTP errors or non-JSON bodies.
api_get() {
  local out
  out=$(curl -sS --fail -H @"$AUTH_HEADER" "${KC_URL}/admin/realms/${KC_REALM}$1") \
    || die "GET $1 failed."
  printf '%s' "$out" | jq -e 'type == "array" or type == "object"' >/dev/null 2>&1 \
    || die "GET $1 did not return JSON."
  printf '%s' "$out"
}

# Print the single id selected by a jq filter, or die naming what is missing.
# Usage: require_id "<description>" "<json>" '<jq filter yielding ids>'
require_id() {
  local what="$1" json="$2" filter="$3" ids count
  ids=$(printf '%s' "$json" | jq -r "[$filter | select(. != null and . != \"\")] | .[]") \
    || die "could not parse the response while looking for ${what}."
  count=$(printf '%s' "$ids" | grep -c . || true)
  [ "$count" -ge 1 ] || die "${what} not found in realm '${KC_REALM}'."
  [ "$count" -eq 1 ] || die "${what} is ambiguous (${count} matches) in realm '${KC_REALM}'."
  printf '%s' "$ids"
}

# Like require_id, but an absent object is fine (prints nothing).
optional_id() {
  local what="$1" json="$2" filter="$3" ids count
  ids=$(printf '%s' "$json" | jq -r "[$filter | select(. != null and . != \"\")] | .[]") \
    || die "could not parse the response while looking for ${what}."
  count=$(printf '%s' "$ids" | grep -c . || true)
  [ "$count" -le 1 ] || die "${what} is ambiguous (${count} matches) in realm '${KC_REALM}'."
  printf '%s' "$ids"
}

tf_import() {
  echo "+ terraform import $1 $2"
  "$TF" import "$1" "$2"
}

# --- Realm and clients ---------------------------------------------------------
echo "=== Importing realm ==="
api_get "" >/dev/null
tf_import keycloak_realm.japan_trip "$KC_REALM"

echo "=== Fetching client IDs ==="
CLIENTS=$(api_get "/clients")
FRONTEND_ID=$(require_id "client japan-trip-frontend" "$CLIENTS" '.[] | select(.clientId=="japan-trip-frontend") | .id')
API_ID=$(require_id "client japan-trip-api" "$CLIENTS" '.[] | select(.clientId=="japan-trip-api") | .id')

echo "=== Importing clients ==="
tf_import keycloak_openid_client.japan_trip_frontend "${KC_REALM}/${FRONTEND_ID}"
tf_import keycloak_openid_client.japan_trip_api "${KC_REALM}/${API_ID}"

echo "=== Importing audience mapper ==="
FRONTEND_MAPPERS=$(api_get "/clients/${FRONTEND_ID}/protocol-mappers/models")
AUDIENCE_ID=$(require_id "audience-mapper on japan-trip-frontend" "$FRONTEND_MAPPERS" '.[] | select(.name=="audience-mapper") | .id')
tf_import keycloak_openid_audience_protocol_mapper.audience "${KC_REALM}/client/${FRONTEND_ID}/${AUDIENCE_ID}"

# --- Authentication flows -------------------------------------------------------
echo "=== Importing authentication flows ==="
tf_import keycloak_authentication_flow.browser_passkey "${KC_REALM}/browser-passkey"
tf_import keycloak_authentication_subflow.passkey_forms "${KC_REALM}/browser-passkey/passkey-forms"

echo "=== Fetching execution IDs ==="
EXECUTIONS=$(api_get "/authentication/flows/browser-passkey/executions")
COOKIE_ID=$(require_id "auth-cookie execution in browser-passkey" "$EXECUTIONS" '.[] | select(.providerId=="auth-cookie") | .id')
SUBFLOW_EXECUTIONS=$(api_get "/authentication/flows/passkey-forms/executions")
USERNAME_ID=$(require_id "auth-username-form execution in passkey-forms" "$SUBFLOW_EXECUTIONS" '.[] | select(.providerId=="auth-username-form") | .id')
WEBAUTHN_ID=$(optional_id "webauthn-authenticator-passwordless directly under passkey-forms" "$SUBFLOW_EXECUTIONS" '.[] | select(.providerId=="webauthn-authenticator-passwordless") | .id')

echo "=== Importing executions ==="
tf_import keycloak_authentication_execution.cookie "${KC_REALM}/browser-passkey/${COOKIE_ID}"
tf_import keycloak_authentication_execution.username_form "${KC_REALM}/passkey-forms/${USERNAME_ID}"
# Pre-KC-01 realms have webauthn directly under passkey-forms. Importing it lets the next
# apply replace it (parent_flow_alias changed) instead of leaving a stray ALTERNATIVE
# next to the REQUIRED username form; that stray is what made username-only login work.
if [ -n "$WEBAUTHN_ID" ]; then
  tf_import keycloak_authentication_execution.webauthn_passwordless "${KC_REALM}/passkey-forms/${WEBAUTHN_ID}"
fi

# The pre-KC-01 top-level "password-forms" subflow is no longer in flows.tf (password is
# now an ALTERNATIVE inside passkey-or-password). Terraform does not track it, so it would
# stay in the realm forever. Deleting its execution also deletes the subflow.
STALE_ID=$(optional_id "stale password-forms subflow" "$EXECUTIONS" '.[] | select(.displayName=="password-forms" and .authenticationFlow==true) | .id')
if [ -n "$STALE_ID" ]; then
  if [ "$REMOVE_STALE" -eq 1 ]; then
    echo "=== Removing stale 'password-forms' subflow (execution ${STALE_ID}) ==="
    curl -sS --fail -X DELETE -H @"$AUTH_HEADER" \
      "${KC_URL}/admin/realms/${KC_REALM}/authentication/executions/${STALE_ID}" \
      || die "could not delete the stale password-forms subflow (execution ${STALE_ID})."
    REMAINING=$(api_get "/authentication/flows/browser-passkey/executions")
    STILL_THERE=$(optional_id "stale password-forms subflow" "$REMAINING" '.[] | select(.displayName=="password-forms" and .authenticationFlow==true) | .id')
    [ -z "$STILL_THERE" ] || die "the stale password-forms subflow is still present after DELETE."
    echo "Removed."
  else
    echo "DRY RUN: stale 'password-forms' subflow found in browser-passkey (execution ${STALE_ID})."
    echo "         It is not managed by Terraform. Re-run with --remove-stale-flows to delete it."
  fi
else
  echo "No stale 'password-forms' subflow."
fi

echo "=== Importing required action ==="
tf_import keycloak_required_action.webauthn_register_passwordless "${KC_REALM}/webauthn-register-passwordless"

# --- Client-scope mappers -------------------------------------------------------
echo "=== Fetching scope IDs for mappers ==="
SCOPES=$(api_get "/client-scopes")
PROFILE_SCOPE_ID=$(require_id "client scope 'profile'" "$SCOPES" '.[] | select(.name=="profile") | .id')
EMAIL_SCOPE_ID=$(require_id "client scope 'email'" "$SCOPES" '.[] | select(.name=="email") | .id')

PROFILE_MAPPERS=$(api_get "/client-scopes/${PROFILE_SCOPE_ID}/protocol-mappers/models")
USERNAME_MAPPER_ID=$(require_id "profile mapper 'username'" "$PROFILE_MAPPERS" '.[] | select(.name=="username") | .id')
FULLNAME_MAPPER_ID=$(require_id "profile mapper 'full name'" "$PROFILE_MAPPERS" '.[] | select(.name=="full name") | .id')
AVATAR_MAPPER_ID=$(require_id "profile mapper 'avatar_url'" "$PROFILE_MAPPERS" '.[] | select(.name=="avatar_url") | .id')
PREFS_MAPPER_ID=$(require_id "profile mapper 'preferences'" "$PROFILE_MAPPERS" '.[] | select(.name=="preferences") | .id')

EMAIL_MAPPERS=$(api_get "/client-scopes/${EMAIL_SCOPE_ID}/protocol-mappers/models")
EMAIL_CLAIM_ID=$(require_id "email mapper 'email'" "$EMAIL_MAPPERS" '.[] | select(.name=="email") | .id')
EMAIL_VERIFIED_ID=$(require_id "email mapper 'email verified'" "$EMAIL_MAPPERS" '.[] | select(.name=="email verified") | .id')

echo "=== Importing scope mappers ==="
tf_import keycloak_openid_user_property_protocol_mapper.profile_username "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${USERNAME_MAPPER_ID}"
tf_import keycloak_openid_full_name_protocol_mapper.profile_full_name "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${FULLNAME_MAPPER_ID}"
tf_import keycloak_openid_user_attribute_protocol_mapper.avatar_url "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${AVATAR_MAPPER_ID}"
tf_import keycloak_openid_user_attribute_protocol_mapper.preferences "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${PREFS_MAPPER_ID}"
tf_import keycloak_openid_user_property_protocol_mapper.email_claim "${KC_REALM}/client-scope/${EMAIL_SCOPE_ID}/${EMAIL_CLAIM_ID}"
tf_import keycloak_openid_user_property_protocol_mapper.email_verified "${KC_REALM}/client-scope/${EMAIL_SCOPE_ID}/${EMAIL_VERIFIED_ID}"

echo "=== All imports complete. Run: terraform plan -var-file=local.tfvars ==="
