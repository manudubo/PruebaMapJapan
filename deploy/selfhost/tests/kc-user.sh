#!/usr/bin/env bash
# TEST helper: create (or reset) a verified user with a password in the realm
# through the local admin port. Usage:
#   KC_LOCAL_URL=http://127.0.0.1:28081/auth KC_ADMIN_PASSWORD=... \
#     kc-user.sh <username> <password>
# Prints the user id.
set -euo pipefail
user="$1"; pass="$2"
realm="${KEYCLOAK_REALM:-japan-trip}"
: "${KC_LOCAL_URL:?}" "${KC_ADMIN_PASSWORD:?}"
token="$(printf '%s' "$KC_ADMIN_PASSWORD" | curl -fsS --noproxy '*' \
  --data-urlencode client_id=admin-cli --data-urlencode username=admin \
  --data-urlencode password@- --data-urlencode grant_type=password \
  "$KC_LOCAL_URL/realms/master/protocol/openid-connect/token" | jq -r .access_token)"
api() { curl -fsS --noproxy '*' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' "$@"; }
base="$KC_LOCAL_URL/admin/realms/$realm"
id="$(api "$base/users?username=$(jq -rn --arg u "$user" '$u|@uri')&exact=true" | jq -r '.[0].id // empty')"
if [ -z "$id" ]; then
  api -X POST "$base/users" -d "$(jq -n --arg u "$user" '{username:$u,email:$u,emailVerified:true,enabled:true,firstName:"Self",lastName:"Host",requiredActions:[]}')"
  id="$(api "$base/users?username=$(jq -rn --arg u "$user" '$u|@uri')&exact=true" | jq -r '.[0].id')"
fi
# VERIFY_EMAIL is a default action for new users; this test user is verified.
api -X PUT "$base/users/$id" -d '{"requiredActions":[],"emailVerified":true}'
api -X PUT "$base/users/$id/reset-password" -d "$(jq -n --arg p "$pass" '{type:"password",value:$p,temporary:false}')"
printf '%s\n' "$id"
