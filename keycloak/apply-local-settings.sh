#!/usr/bin/env bash
# apply-local-settings.sh
# Applies runtime settings to the local Keycloak instance via Admin REST API.
# Run this once after "docker compose up -d" whenever settings need resetting.
#
# Usage:
#   cd keycloak
#   bash apply-local-settings.sh

set -e

KC_URL="${KC_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-japan-trip}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"

echo "==> Waiting for Keycloak to be ready at $KC_URL ..."
until curl -sf "$KC_URL/health/ready" > /dev/null 2>&1; do
  sleep 2
done
echo "    Keycloak is up."

echo "==> Obtaining admin access token ..."
TOKEN=$(curl -sf \
  -d "client_id=admin-cli" \
  -d "username=$ADMIN_USER" \
  -d "password=$ADMIN_PASS" \
  -d "grant_type=password" \
  "$KC_URL/realms/master/protocol/openid-connect/token" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token))")

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: Could not obtain admin token. Is Keycloak running?" >&2
  exit 1
fi
echo "    Token obtained."

echo "==> Applying realm settings to '$KC_REALM' ..."
curl -sf -X PUT "$KC_URL/admin/realms/$KC_REALM" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "browserFlow": "browser",
    "registrationAllowed": true,
    "resetPasswordAllowed": true,
    "loginWithEmailAllowed": true,
    "passwordPolicy": "length(8) and upperCase(1) and digits(1) and specialChars(1)"
  }'
echo "    Realm settings applied."

echo ""
echo "Done. Keycloak is configured:"
echo "  - Browser flow: browser (standard, no passkey required)"
echo "  - Registration: enabled"
echo "  - Password policy: min 8 chars, 1 uppercase, 1 digit, 1 special char"
