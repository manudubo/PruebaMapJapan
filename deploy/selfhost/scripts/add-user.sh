#!/usr/bin/env bash
# Invite someone to sign in: create the Keycloak account and email them a link
# to choose a password. Self-registration is off on the production realm, so
# this is how accounts are made, yours included. The address counts as
# verified: only its owner receives the link that sets the password.
#
#   ./scripts/add-user.sh you@gmail.com "First Last"
#   ./scripts/add-user.sh --resend you@gmail.com     # send the link again
#
# The link is valid for 12 hours and ends on the app's dashboard. Uses the
# admin API on http://127.0.0.1:KC_ADMIN_PORT/auth (never the public URL).
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

RESEND=0
case "${1:-}" in
  -h|--help|'') sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --resend) RESEND=1; shift ;;
esac
EMAIL="${1:-}"
NAME="${2:-}"
[[ "$EMAIL" =~ ^[^[:space:]@\"\<\>]+@[^[:space:]@\"\<\>]+\.[A-Za-z]{2,}$ ]] || die "First argument must be an email address (got '$EMAIL')."

load_config
require_secrets
KC_LOCAL_URL="http://127.0.0.1:${KC_ADMIN_PORT}/auth"
REALM="$KEYCLOAK_REALM"
LIFESPAN_S=43200

token="$(printf '%s' "$KC_ADMIN_PASSWORD" | curl -fsS --noproxy '*' --max-time 15 \
  --data-urlencode client_id=admin-cli --data-urlencode username=admin \
  --data-urlencode password@- --data-urlencode grant_type=password \
  "$KC_LOCAL_URL/realms/master/protocol/openid-connect/token" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')" \
  || die "Could not get an admin token from $KC_LOCAL_URL (is the stack running? see ./scripts/status.sh)."
api() { curl -fsS --noproxy '*' --max-time 30 -H "Authorization: Bearer $token" -H 'Content-Type: application/json' "$@"; }
base="$KC_LOCAL_URL/admin/realms/$REALM"
find_id() {
  api "$base/users?email=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$EMAIL")&exact=true" \
    | python3 -c 'import json,sys; u=json.load(sys.stdin); print(u[0]["id"] if u else "")'
}

id="$(find_id)"
if [ -z "$id" ]; then
  [ "$RESEND" = 0 ] || die "No account for $EMAIL. Run without --resend to create it."
  first="${NAME%% *}"; last="${NAME#* }"
  [ -n "$NAME" ] || { first="${EMAIL%%@*}"; last="-"; }
  [ "$last" != "$NAME" ] || last="-"
  body="$(python3 -c 'import json,sys; print(json.dumps({"username": sys.argv[1], "email": sys.argv[1], "firstName": sys.argv[2], "lastName": sys.argv[3], "enabled": True, "emailVerified": True}))' "$EMAIL" "$first" "$last")"
  api -X POST "$base/users" -d "$body" >/dev/null || die "Keycloak refused to create $EMAIL."
  id="$(find_id)"
  # VERIFY_EMAIL is a default action for new accounts (terraform/keycloak); the
  # invite link already proves the address, so drop it (one email, not two).
  api -X PUT "$base/users/$id" -d '{"requiredActions":[]}' >/dev/null
  ok "Account created: $EMAIL"
else
  [ "$RESEND" = 1 ] || die "$EMAIL already has an account. Use --resend to email the link again."
fi

redirect="$FRONTEND_ORIGIN${FRONTEND_BASE_PATH%/}/dashboard.html"
q="client_id=japan-trip-frontend&lifespan=$LIFESPAN_S&redirect_uri=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$redirect")"
api -X PUT "$base/users/$id/execute-actions-email?$q" -d '["UPDATE_PASSWORD"]' >/dev/null \
  || die "Keycloak could not send the email. Check SMTP_* in .env, then ./scripts/keycloak-apply.sh, and: ./scripts/compose.sh logs keycloak | grep -i mail"
ok "Email sent to $EMAIL from ${EMAIL_FROM:-the configured sender}: open it within 12 hours, choose a password, and you land on $redirect signed in."
