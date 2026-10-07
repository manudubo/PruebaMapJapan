#!/usr/bin/env bash
# Shared helpers for deploy/selfhost/scripts/*.sh. Source it; do not run it.
#
# Every script works from any current directory: SELFHOST_DIR is the
# deploy/selfhost folder, REPO_DIR the repository root.
# shellcheck disable=SC2034  # variables here are used by the sourcing scripts

SELFHOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_DIR="$(cd "$SELFHOST_DIR/../.." && pwd)"
ENV_FILE="${SELFHOST_ENV_FILE:-$SELFHOST_DIR/.env}"
COMPOSE_FILE_PATH="$SELFHOST_DIR/docker-compose.prod.yml"
DRY_RUN="${DRY_RUN:-0}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_DIM=$'\e[2m'; C_OFF=$'\e[0m'
else
  C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$C_OK" "$*" "$C_OFF"; }
ok()   { printf '%s[ OK ]%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
fail() { printf '%s[FAIL]%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; }
die()  { fail "$*"; exit 1; }

# Run a command, or only print it with --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s[dry-run]%s %s\n' "$C_DIM" "$C_OFF" "$*"
    return 0
  fi
  "$@"
}

# Parse a KEY=value file without executing it (values may contain spaces,
# '<', '>' or '$', e.g. EMAIL_FROM=TravelMap <login@example.com>).
# Variables already set in the environment win, like docker compose does.
load_env_file() {
  local file="$1" line key value
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*|[[:space:]]*'#'*) continue ;; esac
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}

# Load .env and compute the derived settings both modes need. Exports them so
# docker compose interpolates them (shell env beats .env in compose).
load_config() {
  if [ ! -f "$ENV_FILE" ]; then
    die "$ENV_FILE not found. Run: cp $SELFHOST_DIR/.env.example $ENV_FILE && chmod 600 $ENV_FILE && $SELFHOST_DIR/scripts/gen-secrets.sh"
  fi
  check_env_permissions
  load_env_file "$ENV_FILE"
  derive_config
}

check_env_permissions() {
  local mode
  mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo "")
  case "$mode" in
    600|400|'') ;;
    *) warn "$ENV_FILE is readable by other users (mode $mode). Fix: chmod 600 $ENV_FILE" ;;
  esac
}

is_fqdn() {
  [[ "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]]
}

# Validate HOST_MODE/INGRESS and export the derived URLs, proxy binding and
# compose profiles. Pure: reads and exports variables only (unit tested).
derive_config() {
  HOST_MODE="${HOST_MODE:-single-host}"
  export KC_RELATIVE_PATH=/auth
  export KEYCLOAK_REALM="${KEYCLOAK_REALM:-japan-trip}"
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-travelmap}"
  export PROXY_PORT="${PROXY_PORT:-28080}"
  export KC_ADMIN_PORT="${KC_ADMIN_PORT:-28081}"
  export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-https://manudubo.github.io}"
  export FRONTEND_BASE_PATH="${FRONTEND_BASE_PATH:-/PruebaMapJapan}"
  export BACKUP_DIR="${BACKUP_DIR:-$SELFHOST_DIR/backups}"
  export BACKUP_KEEP="${BACKUP_KEEP:-14}"
  local default_hops
  case "$HOST_MODE" in
    single-host)
      PUBLIC_HOST="${PUBLIC_HOST%.}"
      [ -n "$PUBLIC_HOST" ] || die "HOST_MODE=single-host needs PUBLIC_HOST in .env (e.g. legion.tail1234.ts.net)."
      is_fqdn "$PUBLIC_HOST" || die "PUBLIC_HOST '$PUBLIC_HOST' is not a host name (no https://, no path, no port)."
      INGRESS="${INGRESS:-funnel}"
      [ "$INGRESS" = funnel ] || die "HOST_MODE=single-host supports INGRESS=funnel only (got '$INGRESS')."
      export API_HOST="$PUBLIC_HOST" AUTH_HOST="$PUBLIC_HOST"
      export CADDY_CONFIG=single-host COMPOSE_PROFILES=local-proxy
      default_hops=2 ;;
    subdomains)
      [ -n "${DOMAIN:-}" ] || die "HOST_MODE=subdomains needs DOMAIN in .env (e.g. example.com)."
      is_fqdn "$DOMAIN" || die "DOMAIN '$DOMAIN' is not a domain name (no https://, no path)."
      INGRESS="${INGRESS:-cloudflared}"
      export API_HOST="api.$DOMAIN" AUTH_HOST="auth.$DOMAIN"
      case "$INGRESS" in
        cloudflared)
          [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ] || die "INGRESS=cloudflared needs CLOUDFLARE_TUNNEL_TOKEN in .env."
          export CADDY_CONFIG=subdomains-tunnel COMPOSE_PROFILES=local-proxy,cloudflared
          default_hops=2 ;;
        caddy)
          [ -n "${ACME_EMAIL:-}" ] || die "INGRESS=caddy needs ACME_EMAIL in .env (Let's Encrypt contact)."
          export CADDY_CONFIG=subdomains-https COMPOSE_PROFILES=public-proxy
          default_hops=1 ;;
        *) die "INGRESS must be cloudflared or caddy with HOST_MODE=subdomains (got '$INGRESS')." ;;
      esac ;;
    *) die "HOST_MODE must be single-host or subdomains (got '$HOST_MODE')." ;;
  esac
  export HOST_MODE INGRESS PUBLIC_HOST="${PUBLIC_HOST:-}" DOMAIN="${DOMAIN:-}"
  export TRUSTED_PROXY_HOPS="${TRUSTED_PROXY_HOPS:-$default_hops}"
  export KC_PUBLIC_URL="https://${AUTH_HOST}${KC_RELATIVE_PATH}"
  export API_PUBLIC_URL="https://${API_HOST}/api"
  # Passkeys (WebAuthn) are bound to the host the Keycloak login page runs on.
  export PASSKEY_RP_ID="${PASSKEY_RP_ID:-$AUTH_HOST}"
  export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$FRONTEND_ORIGIN}"
}

# Fail when required secrets are missing or still placeholders.
require_secrets() {
  local name missing=()
  for name in POSTGRES_SUPERUSER_PASSWORD APP_DB_PASSWORD KC_DB_PASSWORD KC_ADMIN_PASSWORD OTP_SECRET; do
    case "${!name:-}" in ''|CHANGE_ME*) missing+=("$name") ;; esac
  done
  [ "${#missing[@]}" -eq 0 ] || die "Secrets not set in .env: ${missing[*]}. Run ./scripts/gen-secrets.sh"
}

# docker compose with the right file, project and profiles.
compose() {
  local files=(-f "$COMPOSE_FILE_PATH")
  # Test harnesses add files here (deploy/selfhost/tests); not for production.
  if [ -n "${SELFHOST_COMPOSE_OVERRIDE:-}" ]; then
    files+=(-f "$SELFHOST_COMPOSE_OVERRIDE")
  fi
  docker compose --project-directory "$SELFHOST_DIR" --env-file "$ENV_FILE" "${files[@]}" "$@"
}

# Base URL of the local reverse proxy (what Funnel/cloudflared point at).
local_proxy_url() {
  if [ "${INGRESS:-}" = caddy ]; then
    printf 'http://127.0.0.1:80'
  else
    printf 'http://127.0.0.1:%s' "$PROXY_PORT"
  fi
}

# GET a path through the local proxy, pretending to be the public host, and
# print the HTTP status (000 when nothing answers).
proxy_status() {
  local host="$1" path="$2"
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Host: $host" -H 'X-Forwarded-Proto: https' "$(local_proxy_url)$path" 2>/dev/null || true
}

# Wait until GET <path> through the proxy answers 200, up to <seconds>.
wait_for_ready() {
  local host="$1" path="$2" seconds="${3:-120}" waited=0 code
  while [ "$waited" -lt "$seconds" ]; do
    code=$(proxy_status "$host" "$path")
    [ "$code" = 200 ] && return 0
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}
