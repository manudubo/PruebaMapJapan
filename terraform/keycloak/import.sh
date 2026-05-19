#!/usr/bin/env bash
# Run from terraform/keycloak/ directory
# Usage: bash import.sh <kc_admin_pass>
set -e

KC_URL="http://localhost:8080"
KC_REALM="japan-trip"
ADMIN_USER="admin"
ADMIN_PASS="${1:-admin}"

# Acquire admin token
TOKEN=$(curl -sf \
  -d "client_id=admin-cli" \
  -d "username=${ADMIN_USER}" \
  -d "password=${ADMIN_PASS}" \
  -d "grant_type=password" \
  "${KC_URL}/realms/master/protocol/openid-connect/token" | jq -r '.access_token')

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to acquire admin token. Is KC running? Is password correct?"
  exit 1
fi

echo "=== Importing realm ==="
terraform import keycloak_realm.japan_trip japan-trip

echo "=== Fetching client IDs ==="
FRONTEND_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/clients" | \
  jq -r '.[] | select(.clientId=="japan-trip-frontend") | .id')
API_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/clients" | \
  jq -r '.[] | select(.clientId=="japan-trip-api") | .id')

echo "=== Importing clients ==="
terraform import keycloak_openid_client.japan_trip_frontend "${KC_REALM}/${FRONTEND_ID}"
terraform import keycloak_openid_client.japan_trip_api "${KC_REALM}/${API_ID}"

echo "=== Fetching audience mapper ID ==="
AUDIENCE_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/clients/${FRONTEND_ID}/protocol-mappers/models" | \
  jq -r '.[] | select(.name=="audience-mapper") | .id')
echo "=== Importing audience mapper ==="
terraform import keycloak_openid_audience_protocol_mapper.audience \
  "${KC_REALM}/client/${FRONTEND_ID}/${AUDIENCE_ID}"

echo "=== Importing authentication flows ==="
terraform import keycloak_authentication_flow.browser_passkey "${KC_REALM}/browser-passkey"
terraform import keycloak_authentication_subflow.passkey_forms "${KC_REALM}/browser-passkey/passkey-forms"

echo "=== Fetching execution IDs ==="
EXECUTIONS=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/authentication/flows/browser-passkey/executions")
COOKIE_ID=$(echo "$EXECUTIONS" | jq -r '.[] | select(.providerId=="auth-cookie") | .id')

SUBFLOW_EXECUTIONS=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/authentication/flows/passkey-forms/executions")
USERNAME_ID=$(echo "$SUBFLOW_EXECUTIONS" | jq -r '.[] | select(.providerId=="auth-username-form") | .id')
WEBAUTHN_ID=$(echo "$SUBFLOW_EXECUTIONS" | jq -r '.[] | select(.providerId=="webauthn-authenticator-passwordless") | .id')

echo "=== Importing executions ==="
terraform import keycloak_authentication_execution.cookie "${KC_REALM}/browser-passkey/${COOKIE_ID}"
terraform import keycloak_authentication_execution.username_form "${KC_REALM}/passkey-forms/${USERNAME_ID}"
terraform import keycloak_authentication_execution.webauthn_passwordless "${KC_REALM}/passkey-forms/${WEBAUTHN_ID}"

echo "=== Importing required action ==="
terraform import keycloak_required_action.webauthn_register_passwordless \
  "${KC_REALM}/webauthn-register-passwordless"

echo "=== Fetching scope IDs for mappers ==="
PROFILE_SCOPE_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/client-scopes" | \
  jq -r '.[] | select(.name=="profile") | .id')
EMAIL_SCOPE_ID=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/client-scopes" | \
  jq -r '.[] | select(.name=="email") | .id')

echo "=== Fetching profile scope mapper IDs ==="
PROFILE_MAPPERS=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/client-scopes/${PROFILE_SCOPE_ID}/protocol-mappers/models")
USERNAME_MAPPER_ID=$(echo "$PROFILE_MAPPERS" | jq -r '.[] | select(.name=="username") | .id')
FULLNAME_MAPPER_ID=$(echo "$PROFILE_MAPPERS" | jq -r '.[] | select(.name=="full name") | .id')
AVATAR_MAPPER_ID=$(echo "$PROFILE_MAPPERS" | jq -r '.[] | select(.name=="avatar_url") | .id')
PREFS_MAPPER_ID=$(echo "$PROFILE_MAPPERS" | jq -r '.[] | select(.name=="preferences") | .id')

echo "=== Fetching email scope mapper IDs ==="
EMAIL_MAPPERS=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "${KC_URL}/admin/realms/${KC_REALM}/client-scopes/${EMAIL_SCOPE_ID}/protocol-mappers/models")
EMAIL_CLAIM_ID=$(echo "$EMAIL_MAPPERS" | jq -r '.[] | select(.name=="email") | .id')
EMAIL_VERIFIED_ID=$(echo "$EMAIL_MAPPERS" | jq -r '.[] | select(.name=="email verified") | .id')

echo "=== Importing scope mappers ==="
terraform import keycloak_openid_user_property_protocol_mapper.profile_username \
  "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${USERNAME_MAPPER_ID}"
terraform import keycloak_openid_full_name_protocol_mapper.profile_full_name \
  "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${FULLNAME_MAPPER_ID}"
terraform import keycloak_openid_user_attribute_protocol_mapper.avatar_url \
  "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${AVATAR_MAPPER_ID}"
terraform import keycloak_openid_user_attribute_protocol_mapper.preferences \
  "${KC_REALM}/client-scope/${PROFILE_SCOPE_ID}/${PREFS_MAPPER_ID}"
terraform import keycloak_openid_user_property_protocol_mapper.email_claim \
  "${KC_REALM}/client-scope/${EMAIL_SCOPE_ID}/${EMAIL_CLAIM_ID}"
terraform import keycloak_openid_user_property_protocol_mapper.email_verified \
  "${KC_REALM}/client-scope/${EMAIL_SCOPE_ID}/${EMAIL_VERIFIED_ID}"

echo "=== All imports complete. Run: terraform plan -var-file=local.tfvars ==="
