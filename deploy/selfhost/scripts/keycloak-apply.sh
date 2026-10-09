#!/usr/bin/env bash
# Create or update the japan-trip realm on the self-hosted Keycloak with
# Terraform: terraform/keycloak with profile = "production" (its
# preconditions refuse any local-only setting). Safe to re-run: no
# changes = nothing applied.
#
#   ./scripts/keycloak-apply.sh            # plan, ask, apply
#   ./scripts/keycloak-apply.sh --yes      # apply without asking
#   ./scripts/keycloak-apply.sh --dry-run  # plan only, change nothing
#
# Values passed from .env (everything else is the production profile:
# brute-force lockouts, password policy, no test users):
#   - app_origins [FRONTEND_ORIGIN], app_base_path FRONTEND_BASE_PATH/ (exact
#     redirect pages, no wildcards)
#   - ssl_required = all, webauthn_rp_id = the Keycloak host name
#   - Keycloak emails through SMTP_* / EMAIL_FROM from .env
#   - registration_allowed = REGISTRATION_ENABLED (default false), optional
#     reCAPTCHA (RECAPTCHA_SITE_KEY, secret via TF_VAR_recaptcha_secret_key)
#   - opt-in "Remember me" and session lengths: REMEMBER_ME, SSO_SESSION_IDLE_TIMEOUT,
#     SSO_SESSION_MAX_LIFESPAN, SSO_SESSION_IDLE_REMEMBER_ME, SSO_SESSION_MAX_REMEMBER_ME
#     (empty = unchanged defaults; see .env.example)
#   - writes the travelmap-recovery client secret to .env
#     (KEYCLOAK_RECOVERY_CLIENT_SECRET, never printed) for the backend
#
# Talks to Keycloak on http://127.0.0.1:KC_ADMIN_PORT/auth (never through the
# public URL, where the admin API is blocked). Uses `terraform` if installed,
# otherwise the official Terraform image. State lives in
# deploy/selfhost/state/terraform/keycloak (back it up; backup.sh does).
#
# Fails closed: if the plan destroys or replaces anything (e.g. protocol mappers or a
# role), nothing is applied. Read the plan (state/terraform/keycloak/plan.txt); only if the destroys
# are intended, re-run with ALLOW_DESTROY=1.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done

load_config
require_secrets

TF_SRC="$REPO_DIR/terraform/keycloak"
STATE_DIR="${SELFHOST_STATE_DIR:-$SELFHOST_DIR/state}"
# Same layout as the repo (terraform/keycloak reads ../../config/deploy-defaults.json).
WORK="$STATE_DIR/terraform/keycloak"
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
  *) die "SMTP_SECURE must be starttls or tls for Keycloak in production (got '$smtp_secure')." ;;
esac
[[ "$smtp_port" =~ ^[0-9]{1,5}$ ]] || die "SMTP_PORT must be a number (got '$smtp_port')."

# --- Open sign-up (docs/SELF-HOSTING.md "Open sign-up") ------------------------
registration="${REGISTRATION_ENABLED:-false}"
case "$registration" in
  true|false) ;;
  *) die "REGISTRATION_ENABLED must be true or false (got '$registration')." ;;
esac
recaptcha_site_key="${RECAPTCHA_SITE_KEY:-}"
if { [ -n "$recaptcha_site_key" ] && [ -z "${RECAPTCHA_SECRET_KEY:-}" ]; } \
   || { [ -z "$recaptcha_site_key" ] && [ -n "${RECAPTCHA_SECRET_KEY:-}" ]; }; then
  die "Set both RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY in .env, or neither."
fi

# --- Sessions / "Remember me" (opt-in; docs/SELF-HOSTING.md "Keeping people signed in") ----
remember_me="${REMEMBER_ME:-false}"
case "$remember_me" in
  true|false) ;;
  *) die "REMEMBER_ME must be true or false (got '$remember_me')." ;;
esac
for v in SSO_SESSION_IDLE_TIMEOUT SSO_SESSION_MAX_LIFESPAN SSO_SESSION_IDLE_REMEMBER_ME SSO_SESSION_MAX_REMEMBER_ME; do
  [[ -z "${!v:-}" || "${!v}" =~ ^[1-9][0-9]{0,5}[smh]$ ]] \
    || die "$v must look like 30m, 10h or 720h (seconds, minutes or hours; no days: 30 days is 720h). Got '${!v}'."
done
if [ "$remember_me" = true ] && { [ -z "${SSO_SESSION_IDLE_REMEMBER_ME:-}" ] || [ -z "${SSO_SESSION_MAX_REMEMBER_ME:-}" ]; }; then
  die "REMEMBER_ME=true needs SSO_SESSION_IDLE_REMEMBER_ME and SSO_SESSION_MAX_REMEMBER_ME in .env (recommended: 720h and 2160h)."
fi

# --- Client URLs: the production realm must never point at localhost -----------------
# The client's base URL feeds Keycloak's "Back to application" link (e.g. on the
# "Registration not allowed" page) and the login footer.
case "$FRONTEND_ORIGIN" in
  https://localhost*|https://127.*|https://\[::1\]*|http://*)
    die "FRONTEND_ORIGIN must be the public https origin of the app (got '$FRONTEND_ORIGIN'), never localhost or plain http: Keycloak's \"Back to application\" link is built from it." ;;
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
      -v "$STATE_DIR:/state" -w /state/terraform/keycloak -e HOME=/state/terraform/keycloak \
      -e TF_IN_AUTOMATION=1 \
      -e TF_VAR_kc_url -e TF_VAR_kc_admin_user -e TF_VAR_kc_admin_pass \
      -e TF_VAR_smtp_password -e TF_VAR_recaptcha_secret_key \
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
mkdir -p "$WORK" "$STATE_DIR/config"
chmod 700 "$STATE_DIR" "$STATE_DIR/terraform" "$WORK"
# Older versions kept the state one level up (state/terraform): move it once.
legacy="$STATE_DIR/terraform"
if [ -f "$legacy/terraform.tfstate" ] && [ ! -f "$WORK/terraform.tfstate" ]; then
  say "  moving Terraform state from $legacy to $WORK"
  for f in terraform.tfstate terraform.tfstate.backup .terraform .terraform.lock.hcl; do
    [ -e "$legacy/$f" ] && mv "$legacy/$f" "$WORK/"
  done
  rm -f "$legacy"/*.tf "$legacy"/*.tfvars.json "$legacy"/plan.txt "$legacy"/*.tfplan
fi
# Refresh the .tf files (repo may have changed); keep state and provider cache.
# (This also removes the selfhost_*.tf override files older versions copied here.)
find "$WORK" -maxdepth 1 -name '*.tf' -delete
rm -f "$WORK/selfhost.auto.tfvars.json"
cp "$TF_SRC"/*.tf "$WORK"/
[ -f "$TF_SRC/.terraform.lock.hcl" ] && cp "$TF_SRC/.terraform.lock.hcl" "$WORK"/
cp "$REPO_DIR/config/deploy-defaults.json" "$STATE_DIR/config/"

# Non-secret values in a file; secrets only in the environment.
umask 077
base_path="${FRONTEND_BASE_PATH%/}/"
{
  printf '{\n'
  printf '  "profile": "production",\n'
  printf '  "kc_url": %s,\n' "$(json_str "$KC_LOCAL_URL")"
  printf '  "kc_admin_user": "admin",\n'
  printf '  "ssl_required": "all",\n'
  printf '  "app_origins": [%s],\n' "$(json_str "$FRONTEND_ORIGIN")"
  printf '  "app_base_path": %s,\n' "$(json_str "$base_path")"
  printf '  "webauthn_rp_id": %s,\n' "$(json_str "$PASSKEY_RP_ID")"
  printf '  "smtp_host": %s,\n' "$(json_str "$smtp_host")"
  printf '  "smtp_port": %s,\n' "$smtp_port"
  printf '  "smtp_from": %s,\n' "$(json_str "$smtp_from")"
  printf '  "smtp_from_display_name": %s,\n' "$(json_str "$smtp_from_name")"
  printf '  "smtp_user": %s,\n' "$(json_str "$smtp_user")"
  printf '  "smtp_ssl": %s,\n' "$smtp_ssl"
  printf '  "smtp_starttls": %s,\n' "$smtp_starttls"
  printf '  "registration_allowed": %s,\n' "$registration"
  printf '  "remember_me": %s,\n' "$remember_me"
  # Only what .env sets: empty keeps the Terraform default (current behaviour).
  [ -z "${SSO_SESSION_IDLE_TIMEOUT:-}" ] || printf '  "sso_session_idle_timeout": %s,\n' "$(json_str "$SSO_SESSION_IDLE_TIMEOUT")"
  [ -z "${SSO_SESSION_MAX_LIFESPAN:-}" ] || printf '  "sso_session_max_lifespan": %s,\n' "$(json_str "$SSO_SESSION_MAX_LIFESPAN")"
  [ -z "${SSO_SESSION_IDLE_REMEMBER_ME:-}" ] || printf '  "sso_session_idle_timeout_remember_me": %s,\n' "$(json_str "$SSO_SESSION_IDLE_REMEMBER_ME")"
  [ -z "${SSO_SESSION_MAX_REMEMBER_ME:-}" ] || printf '  "sso_session_max_lifespan_remember_me": %s,\n' "$(json_str "$SSO_SESSION_MAX_REMEMBER_ME")"
  printf '  "recaptcha_site_key": %s\n' "$(json_str "$recaptcha_site_key")"
  printf '}\n'
} > "$WORK/production.auto.tfvars.json"

export TF_VAR_kc_url="$KC_LOCAL_URL" TF_VAR_kc_admin_user=admin TF_VAR_kc_admin_pass="$KC_ADMIN_PASSWORD"
export TF_VAR_smtp_password="$smtp_pass"
# Terraform's null (no captcha) when unset; the secret never goes into a file.
if [ -n "${RECAPTCHA_SECRET_KEY:-}" ]; then export TF_VAR_recaptcha_secret_key="$RECAPTCHA_SECRET_KEY"; fi

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

# The backend's travelmap-recovery secret goes from Terraform state straight into
# .env (mode 600), never to the terminal. The backend reads it at start: if it
# changed, ./scripts/deploy.sh (or compose up -d backend) restarts it.
store_recovery_secret() {
  local secret current tmp
  secret="$(tf output -raw recovery_client_secret 2>/dev/null)" || secret=""
  if [ -z "$secret" ]; then
    warn "No travelmap-recovery secret in the Terraform outputs; e-mail recovery stays off."
    return 0
  fi
  [[ "$secret" =~ ^[A-Za-z0-9_-]+$ ]] || die "Unexpected travelmap-recovery secret format; not written to .env."
  current="$(sed -n 's/^KEYCLOAK_RECOVERY_CLIENT_SECRET=//p' "$ENV_FILE" | tail -n 1)"
  if [ "$current" = "$secret" ]; then
    ok "travelmap-recovery secret already in $ENV_FILE"
    return 0
  fi
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  chmod 600 "$tmp"
  grep -v '^KEYCLOAK_RECOVERY_CLIENT_SECRET=' "$ENV_FILE" > "$tmp" || true
  printf 'KEYCLOAK_RECOVERY_CLIENT_SECRET=%s\n' "$secret" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  ok "travelmap-recovery secret written to $ENV_FILE (not shown). Restart the backend: ./scripts/deploy.sh"
}

# --- Plan / apply ---------------------------------------------------------------------
step "terraform plan"
set +e
tf plan -input=false -no-color -detailed-exitcode -out=selfhost.tfplan > "$WORK/plan.txt" 2>&1
plan_rc=$?
set -e
case "$plan_rc" in
  0) ok "No changes: Keycloak already matches the configuration."; rm -f "$WORK/selfhost.tfplan"
     [ "$DRY_RUN" = 1 ] || store_recovery_secret
     exit 0 ;;
  2) grep -E '^\s*(#|Plan:)' "$WORK/plan.txt" || true ;;
  *) cat "$WORK/plan.txt" >&2; die "terraform plan failed (full output above)." ;;
esac

# Fail closed on destroys. Normal updates only ever create or change things; a destroy
# or replacement (protocol mappers, roles, flows, clients...) is what a wrong plan looks
# like, and it is applied to the live login realm. Stop unless the operator, having read
# the plan, passes ALLOW_DESTROY=1.
guard_destroys() {
  local doomed
  doomed="$(tf show -json -no-color selfhost.tfplan 2>/dev/null | python3 -c '
import json, sys
try:
    plan = json.load(sys.stdin)
except ValueError:
    print("UNREADABLE"); sys.exit(0)
for rc in plan.get("resource_changes", []):
    actions = rc.get("change", {}).get("actions", [])
    if "delete" in actions:
        print(("replace  " if "create" in actions else "destroy  ") + rc["address"])
')" || doomed=UNREADABLE
  [ -n "$doomed" ] || return 0
  if [ "$doomed" = UNREADABLE ]; then
    doomed="(could not read the plan with 'terraform show -json'; assuming it destroys something)"
  fi
  warn "The plan DESTROYS or REPLACES live Keycloak objects:"
  printf '  %s\n' "$doomed" >&2
  if [ "${ALLOW_DESTROY:-0}" = 1 ]; then
    warn "ALLOW_DESTROY=1: continuing."
    return 0
  fi
  rm -f "$WORK/selfhost.tfplan"
  say "Full plan: $WORK/plan.txt"
  die "Refusing to continue: an update of this realm should not destroy anything (check docs/SELF-HOSTING.md, 'Keycloak plan shows destroys'). Send the plan, or re-run with ALLOW_DESTROY=1 if you read it and the destroys are intended."
}
guard_destroys

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
store_recovery_secret

# Verify: issuer and a production redirect.
issuer="$(curl -fsS --max-time 10 "$KC_LOCAL_URL/realms/$REALM/.well-known/openid-configuration" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])')"
[ "$issuer" = "$KC_PUBLIC_URL/realms/$REALM" ] || die "Issuer is '$issuer', expected '$KC_PUBLIC_URL/realms/$REALM'. Check KC_HOSTNAME (PUBLIC_HOST/DOMAIN in .env) and re-run deploy.sh."
ok "Realm '$REALM' applied. Issuer: $issuer"
