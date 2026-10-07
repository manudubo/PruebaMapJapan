#!/usr/bin/env bash
# Build and (re)start the TravelMap stack. Safe to run any number of times:
# a second run with nothing changed rebuilds from cache, applies no
# migration and restarts nothing.
#
#   ./scripts/deploy.sh             # build, migrate, start, wait until ready
#   ./scripts/deploy.sh --dry-run   # only print what would run
#   ./scripts/deploy.sh --no-build  # reuse the images already built
#
# Steps: config + port checks -> build -> postgres -> db:preflight ->
#        db:migrate -> start everything -> wait for /api/health/ready
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
# shellcheck source=lib/checks.sh
. "$(dirname "$0")/lib/checks.sh"

BUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --no-build) BUILD=0; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done

step "Checking configuration"
load_config
require_secrets
missing=()
for name in EMAIL_FROM NOMINATIM_CONTACT; do
  [ -n "${!name:-}" ] || missing+=("$name")
done
case "${EMAIL_PROVIDER:-}" in
  resend) [ -n "${RESEND_API_KEY:-}" ] || missing+=(RESEND_API_KEY) ;;
  smtp|'') [ -n "${SMTP_HOST:-}" ] && [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ] || missing+=("SMTP_HOST/SMTP_USER/SMTP_PASS") ;;
esac
[ "${#missing[@]}" -eq 0 ] || die "Fill these in .env first: ${missing[*]}"
command -v docker >/dev/null || die "Docker is not installed (see docs/SELF-HOSTING.md step 1)."
docker compose version >/dev/null 2>&1 || die "The docker compose plugin is missing."
ok "HOST_MODE=$HOST_MODE INGRESS=$INGRESS"
ok "API:      $API_PUBLIC_URL"
ok "Keycloak: $KC_PUBLIC_URL"

conflicts="$(foreign_name_conflicts)"
[ -z "$conflicts" ] || die "Containers with our names belong to another project: $conflicts. Set COMPOSE_PROJECT_NAME in .env to something else."
check_port_conflicts || die "Port conflict (see above)."
ok "Ports free: $(planned_host_ports | tr '\n' ' ')(all on 127.0.0.1 unless INGRESS=caddy)"

if [ "$BUILD" = 1 ]; then
  step "Building images (first time: several minutes)"
  run compose build backend keycloak migrate
fi

step "Starting Postgres"
run compose up -d postgres
[ "$DRY_RUN" = 1 ] || wait_healthy "$COMPOSE_PROJECT_NAME-postgres" 120
ok "Postgres healthy"

step "Database pre-flight checks"
run compose run --rm --no-deps migrate npm run db:preflight
before="$(applied_migrations)"

step "Applying database migrations"
run compose run --rm --no-deps migrate npm run db:migrate
after="$(applied_migrations)"
if [ "$before" != "$after" ]; then
  ok "Applied $((after - before)) new migration(s) ($after total)"
else
  ok "Database already up to date ($after migrations)"
fi

step "Starting all services"
# Only containers whose image or settings changed are recreated.
run compose up -d --remove-orphans
if [ "$before" != "$after" ] && [ "$DRY_RUN" != 1 ]; then
  # The schema check is cached for 30 s; restart so the new schema is used now.
  run compose restart backend
fi

if [ "$DRY_RUN" = 1 ]; then
  ok "Dry run finished; nothing was changed."
  exit 0
fi

step "Waiting for services"
wait_healthy "$COMPOSE_PROJECT_NAME-keycloak" 300
ok "Keycloak healthy"
wait_backend_ready 120
ok "Backend ready (/api/health/ready = 200)"
case "$COMPOSE_PROFILES" in
  *local-proxy*)
    if wait_for_ready "$API_HOST" /api/health/ready 60; then
      ok "Reverse proxy OK: $(local_proxy_url)/api/health/ready -> 200"
    else
      die "Backend is ready but the proxy on $(local_proxy_url) does not answer. Logs: ./scripts/compose.sh logs --tail=50 proxy"
    fi ;;
esac

step "Done"
say "Next steps (first deployment only):"
say "  1. ./scripts/keycloak-apply.sh      # create/update the japan-trip realm"
if [ "$INGRESS" = funnel ]; then
  say "  2. ./scripts/funnel.sh enable        # publish https://$PUBLIC_HOST on the internet"
fi
say "  Then check everything with: ./scripts/status.sh"
