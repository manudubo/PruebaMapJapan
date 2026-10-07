#!/usr/bin/env bash
# Create or update the japan-trip realm on the self-hosted Keycloak with
# Terraform (terraform/keycloak + the production overrides in
# deploy/selfhost/terraform). Safe to re-run: no changes = nothing applied.
#
#   ./scripts/keycloak-apply.sh            # plan, ask, apply
#   ./scripts/keycloak-apply.sh --yes      # apply without asking
#   ./scripts/keycloak-apply.sh --dry-run  # plan only, change nothing
#
# Production settings applied on top of terraform/keycloak:
#   - redirect URIs  FRONTEND_ORIGIN/FRONTEND_BASE_PATH/*, web origin FRONTEND_ORIGIN
#   - ssl_required = all, passkey rpId = the Keycloak host name
#   - Keycloak emails through SMTP_* from .env
#   - NO test users
#
# Talks to Keycloak on http://127.0.0.1:KC_ADMIN_PORT/auth (never through the
# public URL, where the admin API is blocked). Uses `terraform` if installed,
# otherwise the official Terraform image. State lives in
# deploy/selfhost/state/terraform (back it up; backup.sh does).
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done

load_config
require_secrets

TF_SRC="$REPO_DIR/terraform/keycloak"
TF_OVERRIDES="$SELFHOST_DIR/terraform"
WORK="${SELFHOST_STATE_DIR:-$SELFHOST_DIR/state}/terraform"
KC_LOCAL_URL="http://127.0.0.1:${KC_ADMIN_PORT}/auth"
TERRAFORM_IMAGE="${TERRAFORM_IMAGE:-public.ecr.aws/hashicorp/terraform:1.9.8}"
REALM="$KEYCLOAK_REALM"

# --- Email settings for Keycloak ------------------------------------------------
smtp_host="${SMTP_HOST:-}"; smtp_port="${SMTP_PORT:-587}"; smtp_secure="${SMTP_SECURE:-starttls}"
smtp_user="${SMTP_USER:-}"; smtp_pass="${SMTP_PASS:-}"
if [ "${EMAIL_PROVIDER:-}" = resend ] && [ -z "$smtp_user" ] && [ -n "${RESEND_API_KEY:-}" ]; then
  # Resend's SMTP relay uses the same API key.
  smtp_host=smtp.resend.com; smtp_port=465; smtp_secure=tls; smtp_user=resend; smtp_pass="$RESEND_API_KEY"
fi
[ -n "$smtp_host" ] && [ -n "$smtp_user" ] && [ -n "$smtp_pass" ] \
  || die "Keycloak needs SMTP to send verification emails: set SMTP_HOST, SMTP_USER, SMTP_PASS in .env (or EMAIL_PROVIDER=resend + RESEND_API_KEY)."
[ -n "${EMAIL_FROM:-}" ] || die "Set EMAIL_FROM in .env."
# "Name <addr@x>" -> from=addr@x, display=Name ; "addr@x" -> from=addr@x
if [[ "$EMAIL_FROM" =~ ^(.*)\<([^>]+)\>[[:space:]]*$ ]]; then
  smtp_from="${BASH_REMATCH[2]}"
  smtp_from_name="$(printf '%s' "${BASH_REMATCH[1]}" | sed 's/^[[:space:]"]*//; s/[[:space:]"]*$//')"
else
  smtp_from="$EMAIL_FROM"; smtp_from_name=""
fi
smtp_from_name="${smtp_from_name:-TravelMap}"
case "$smtp_secure" in
  tls) smtp_ssl=true; smtp_starttls=false ;;
  starttls) smtp_ssl=false; smtp_starttls=true ;;
  none) smtp_ssl=false; smtp_starttls=false ;;
  *) die "SMTP_SECURE must be starttls, tls or none (got '$smtp_secure')." ;;
esac

# --- Terraform runner -------------------------------------------------------------
tf() {
  if command -v terraform >/dev/null 2>&1 && [ "${USE_TERRAFORM_IMAGE:-0}" != 1 ]; then
    # The Keycloak provider also reads KEYCLOAK_* from the environment (e.g.
    # KEYCLOAK_REALM would make it log in to japan-trip instead of master).
    (cd "$WORK" && env -u KEYCLOAK_REALM -u KEYCLOAK_URL -u KEYCLOAK_CLIENT_ID \
      -u KEYCLOAK_CLIENT_SECRET -u KEYCLOAK_USER -u KEYCLOAK_PASSWORD terraform "$@")
  else
    docker run --rm -i --network host --user "$(id -u):$(id -g)" \
      -v "$WORK:/work" -w /work -e HOME=/work \
      -e TF_IN_AUTOMATION=1 \
      -e TF_VAR_kc_url -e TF_VAR_kc_admin_user -e TF_VAR_kc_admin_pass \
      -e TF_VAR_e2e_test_password -e TF_VAR_e2e_otp_password -e TF_VAR_testuser_password \
      -e TF_VAR_new_user_test_password -e TF_VAR_trip_edit_test_user_password -e TF_VAR_e2e_session_password \
      -e TF_VAR_selfhost_smtp_password \
      "$TERRAFORM_IMAGE" "$@"
  fi
}

json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

# --- Keycloak reachable? -------------------------------------------------------
step "Checking Keycloak at $KC_LOCAL_URL"
if ! curl -fsS --max-time 10 -o /dev/null "$KC_LOCAL_URL/realms/master"; then
  die "Keycloak does not answer on $KC_LOCAL_URL. Run ./scripts/deploy.sh first (and check ./scripts/status.sh)."
fi
ok "Keycloak answers"

# --- Work directory ----------------------------------------------------------------
step "Preparing Terraform work directory $WORK"
mkdir -p "$WORK"
chmod 700 "$WORK"
# Refresh the .tf files (repo may have changed); keep state and provider cache.
find "$WORK" -maxdepth 1 -name '*.tf' -delete
cp "$TF_SRC"/*.tf "$WORK"/
[ -f "$TF_SRC/.terraform.lock.hcl" ] && cp "$TF_SRC/.terraform.lock.hcl" "$WORK"/
cp "$TF_OVERRIDES/selfhost_variables.tf" "$TF_OVERRIDES/selfhost_override.tf" "$WORK"/

# Non-secret values in a file; secrets only in the environment.
umask 077
{
  printf '{\n'
  printf '  "kc_url": %s,\n' "$(json_str "$KC_LOCAL_URL")"
  printf '  "kc_admin_user": "admin",\n'
  printf '  "selfhost_frontend_origin": %s,\n' "$(json_str "$FRONTEND_ORIGIN")"
  printf '  "selfhost_frontend_base_path": %s,\n' "$(json_str "$FRONTEND_BASE_PATH")"
  printf '  "selfhost_passkey_rp_id": %s,\n' "$(json_str "$PASSKEY_RP_ID")"
  printf '  "selfhost_smtp_host": %s,\n' "$(json_str "$smtp_host")"
  printf '  "selfhost_smtp_port": %s,\n' "$(json_str "$smtp_port")"
  printf '  "selfhost_smtp_from": %s,\n' "$(json_str "$smtp_from")"
  printf '  "selfhost_smtp_from_display_name": %s,\n' "$(json_str "$smtp_from_name")"
  printf '  "selfhost_smtp_user": %s,\n' "$(json_str "$smtp_user")"
  printf '  "selfhost_smtp_ssl": %s,\n' "$smtp_ssl"
  printf '  "selfhost_smtp_starttls": %s\n' "$smtp_starttls"
  printf '}\n'
} > "$WORK/selfhost.auto.tfvars.json"

export TF_VAR_kc_url="$KC_LOCAL_URL" TF_VAR_kc_admin_user=admin TF_VAR_kc_admin_pass="$KC_ADMIN_PASSWORD"
export TF_VAR_selfhost_smtp_password="$smtp_pass"
# terraform/keycloak declares test-user passwords without defaults; the
# override removes those users (count = 0), so these values are never used.
unused="Unused-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')-1!"
export TF_VAR_e2e_test_password="$unused" TF_VAR_e2e_otp_password="$unused" TF_VAR_testuser_password="$unused"
export TF_VAR_new_user_test_password="$unused" TF_VAR_trip_edit_test_user_password="$unused" TF_VAR_e2e_session_password="$unused"

step "terraform init"
tf init -input=false -no-color >/dev/null
ok "initialised"

in_state() { tf state list 2>/dev/null | grep -qx "$1"; }

# --- First run on an empty Keycloak ------------------------------------------------
# Creating the realm also creates Keycloak's built-in client-scope mappers,
# which mappers.tf manages; they must be imported, not created (409 otherwise).
if ! in_state keycloak_realm.japan_trip; then
  realm_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$KC_LOCAL_URL/realms/$REALM")"
  if [ "$realm_code" = 200 ]; then
    die "Realm '$REALM' exists in Keycloak but not in Terraform state ($WORK). Restore state/terraform from a backup, or import it: see docs/SELF-HOSTING.md 'Keycloak state lost'."
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say "[dry-run] would create realm '$REALM', import its built-in mappers, then apply everything."
    exit 0
  fi
  step "Creating realm '$REALM' (first run)"
  tf apply -input=false -no-color -auto-approve -target=keycloak_realm.japan_trip >/dev/null
  ok "realm created"
fi

import_builtin_mappers() {
  local token scopes
  token="$(printf '%s' "$KC_ADMIN_PASSWORD" | curl -fsS --max-time 15 \
    --data-urlencode client_id=admin-cli --data-urlencode username=admin \
    --data-urlencode password@- --data-urlencode grant_type=password \
    "$KC_LOCAL_URL/realms/master/protocol/openid-connect/token" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')" \
    || die "Could not get an admin token from Keycloak (wrong KC_ADMIN_PASSWORD?)."
  api() { curl -fsS --max-time 15 -H "Authorization: Bearer $token" "$KC_LOCAL_URL/admin/realms/$REALM$1"; }
  scopes="$(api /client-scopes)"
  local resource scope mapper scope_id mapper_id
  while read -r resource scope mapper; do
    mapper="${mapper//_/ }"
    in_state "$resource" && continue
    scope_id="$(printf '%s' "$scopes" | python3 -c 'import json,sys; n=sys.argv[1]; print(next(s["id"] for s in json.load(sys.stdin) if s["name"]==n))' "$scope")"
    mapper_id="$(api "/client-scopes/$scope_id/protocol-mappers/models" \
      | python3 -c 'import json,sys; n=sys.argv[1]; print(next((m["id"] for m in json.load(sys.stdin) if m["name"]==n), ""))' "$mapper")"
    if [ -n "$mapper_id" ]; then
      say "  import $resource"
      tf import -input=false -no-color "$resource" "$REALM/client-scope/$scope_id/$mapper_id" >/dev/null
    fi
  done <<'EOF'
keycloak_openid_user_property_protocol_mapper.profile_username profile username
keycloak_openid_full_name_protocol_mapper.profile_full_name profile full_name
keycloak_openid_user_property_protocol_mapper.email_claim email email
keycloak_openid_user_property_protocol_mapper.email_verified email email_verified
EOF
}

if [ "$DRY_RUN" != 1 ]; then
  step "Importing Keycloak's built-in mappers (only those not yet in state)"
  import_builtin_mappers
  ok "mappers in state"
fi

# --- Plan / apply ---------------------------------------------------------------------
step "terraform plan"
set +e
tf plan -input=false -no-color -detailed-exitcode -out=selfhost.tfplan > "$WORK/plan.txt" 2>&1
plan_rc=$?
set -e
case "$plan_rc" in
  0) ok "No changes: Keycloak already matches the configuration."; rm -f "$WORK/selfhost.tfplan"; exit 0 ;;
  2) grep -E '^\s*(#|Plan:)' "$WORK/plan.txt" || true ;;
  *) cat "$WORK/plan.txt" >&2; die "terraform plan failed (full output above)." ;;
esac

if [ "$DRY_RUN" = 1 ]; then
  ok "Dry run: the changes above were NOT applied. Full plan: $WORK/plan.txt"
  exit 0
fi
if [ "$ASSUME_YES" != 1 ]; then
  if [ -t 0 ]; then
    read -r -p "Apply these changes? [y/N] " answer
    case "$answer" in y|Y|yes|YES) ;; *) say "Not applied."; exit 1 ;; esac
  else
    die "Not a terminal: re-run with --yes to apply."
  fi
fi

step "terraform apply"
tf apply -input=false -no-color selfhost.tfplan | grep -E '^(Apply complete|Error)' || true
rm -f "$WORK/selfhost.tfplan"

# Verify: issuer and a production redirect.
issuer="$(curl -fsS --max-time 10 "$KC_LOCAL_URL/realms/$REALM/.well-known/openid-configuration" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])')"
[ "$issuer" = "$KC_PUBLIC_URL/realms/$REALM" ] || die "Issuer is '$issuer', expected '$KC_PUBLIC_URL/realms/$REALM'. Check KC_HOSTNAME (PUBLIC_HOST/DOMAIN in .env) and re-run deploy.sh."
ok "Realm '$REALM' applied. Issuer: $issuer"
