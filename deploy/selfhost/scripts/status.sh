#!/usr/bin/env bash
# One-screen health report. Read-only: changes nothing.
#
#   ./scripts/status.sh
#
# Containers, readiness through the local proxy AND through the public URL,
# Keycloak issuer, ingress (Funnel / tunnel / certificate), disk, last backup,
# and conflicts with other programs or containers on this server.
# Exit code 0 = everything OK, 1 = at least one FAIL.
set -uo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"
# shellcheck source=SCRIPTDIR/lib/checks.sh
. "$(dirname "$0")/lib/checks.sh"
case "${1:-}" in -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac

load_config
problems=0
bad() { fail "$*"; problems=$((problems + 1)); }

step "Containers ($COMPOSE_PROJECT_NAME)"
for svc in postgres backend keycloak; do
  state="$(container_health "$COMPOSE_PROJECT_NAME-$svc")"
  if [ "$state" = healthy ] || { [ "$svc" = backend ] && [ "$state" = running ]; }; then ok "$svc: $state"; else bad "$svc: $state"; fi
done
case "$COMPOSE_PROFILES" in
  *public-proxy*) proxy_name=proxy-public ;;
  *) proxy_name=proxy ;;
esac
state="$(container_health "$COMPOSE_PROJECT_NAME-$proxy_name")"
[ "$state" = healthy ] && ok "$proxy_name: $state" || bad "$proxy_name: $state"
if [ "$INGRESS" = cloudflared ]; then
  state="$(container_health "$COMPOSE_PROJECT_NAME-cloudflared")"
  [ "$state" = running ] && ok "cloudflared: running" || bad "cloudflared: $state"
fi

step "Readiness"
code="$(backend_get_status /api/health/ready)"
[ "$code" = 200 ] && ok "backend /api/health/ready: 200" || bad "backend /api/health/ready: $code (503 = database down or not migrated)"
if [ "$INGRESS" != caddy ]; then
  code="$(proxy_status "$API_HOST" /api/health/ready)"
  [ "$code" = 200 ] && ok "proxy $(local_proxy_url) -> backend: 200" || bad "proxy $(local_proxy_url): $code"
  code="$(proxy_status "$AUTH_HOST" "/auth/realms/$KEYCLOAK_REALM")"
  [ "$code" = 200 ] && ok "proxy -> Keycloak realm $KEYCLOAK_REALM: 200" || bad "proxy -> Keycloak realm: $code (run ./scripts/keycloak-apply.sh?)"
  code="$(proxy_status "$AUTH_HOST" /auth/admin/)"
  [ "$code" = 404 ] && ok "admin console blocked on the public side (404)" || bad "admin console answers $code on the public side (expected 404)"
fi

step "Public URLs (from this server)"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$API_PUBLIC_URL/health/ready" || true)"
[ "$code" = 200 ] && ok "$API_PUBLIC_URL/health/ready: 200" || bad "$API_PUBLIC_URL/health/ready: ${code:-000}"
issuer="$(curl -s --max-time 15 "$KC_PUBLIC_URL/realms/$KEYCLOAK_REALM/.well-known/openid-configuration" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])' 2>/dev/null || true)"
[ "$issuer" = "$KC_PUBLIC_URL/realms/$KEYCLOAK_REALM" ] && ok "issuer: $issuer" || bad "issuer: '${issuer:-unreachable}' (expected $KC_PUBLIC_URL/realms/$KEYCLOAK_REALM)"
say "  (from outside, check with your phone on mobile data, or an uptime monitor on $API_PUBLIC_URL/health/ready)"

step "Ingress: $INGRESS"
case "$INGRESS" in
  funnel)
    if command -v tailscale >/dev/null; then
      tailscale funnel status 2>/dev/null | sed 's/^/  /' || warn "could not read 'tailscale funnel status' (try with sudo)"
    else
      bad "tailscale is not installed"
    fi ;;
  cloudflared)
    n="$(docker logs --since 24h "$COMPOSE_PROJECT_NAME-cloudflared" 2>&1 | grep -c 'Registered tunnel connection' || true)"
    [ "${n:-0}" -gt 0 ] && ok "tunnel connections registered in the last 24h: $n" || bad "no tunnel connection in the last 24h (check CLOUDFLARE_TUNNEL_TOKEN)" ;;
  caddy)
    for h in "$API_HOST" "$AUTH_HOST"; do
      end="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$h" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
      [ -n "$end" ] && ok "certificate $h valid until $end" || bad "no certificate served for $h"
    done ;;
esac

step "Disk and backups"
df -h / "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)" 2>/dev/null | awk 'NR==1 || !seen[$0]++' | sed 's/^/  /'
use="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
[ "${use:-0}" -lt 90 ] || bad "root disk is ${use}% full"
latest="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' 2>/dev/null | sort | tail -n 1)"
if [ -z "$latest" ]; then
  warn "no backups yet: ./scripts/backup.sh and ./scripts/backup-timer.sh install"
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$BACKUP_DIR/$latest") ) / 3600 ))
  if [ "$age_h" -le 26 ]; then ok "last backup $latest (${age_h}h ago)"; else warn "last backup $latest is ${age_h}h old"; fi
fi
mapfile -t ids < <(docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")
[ "${#ids[@]}" -eq 0 ] || docker stats --no-stream --format '  {{.Name}}: mem {{.MemUsage}} cpu {{.CPUPerc}}' "${ids[@]}" 2>/dev/null

step "Conflicts with other things on this server"
ours="$(our_published_ports)"
for port in $(planned_host_ports); do
  if printf '%s\n' "$ours" | grep -qx "$port"; then ok "port $port: ours"
  elif port_in_use "$port"; then bad "port $port: used by another program (change it in .env)"
  else warn "port $port: free (stack not running?)"; fi
done
foreign="$(foreign_name_conflicts)"
[ -z "$foreign" ] && ok "no foreign containers with our names" || bad "containers from another project use our names: $foreign"
others="$(docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}}' \
  | awk -v p="$COMPOSE_PROJECT_NAME" '$2 != p {printf "%s ", $1}')"
say "  other containers (left alone): ${others:-none}"

say ""
if [ "$problems" -eq 0 ]; then ok "All checks passed."; exit 0; fi
fail "$problems check(s) failed - see docs/SELF-HOSTING.md 'Troubleshooting'."
exit 1
