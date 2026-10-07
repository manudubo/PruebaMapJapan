#!/usr/bin/env bash
# First-time preparation of an Ubuntu server. SAFE ON A SHARED SERVER:
# by default it only CHECKS and prints what it would do.
#
#   ./scripts/bootstrap.sh            # read-only check (same as --check)
#   ./scripts/bootstrap.sh --setup    # create .env (mode 600) + secrets + state dirs
#
# Optional system changes, each only when you pass its flag:
#   --install-docker        install Docker from Ubuntu's own packages (skipped if present)
#   --install-tailscale     install Tailscale with its official script (skipped if present)
#   --unattended-upgrades   enable automatic security updates (apt)
#   --fail2ban              install fail2ban with the default sshd jail (apt)
#   --apply-firewall        enable ufw: allow SSH (+80/443 for INGRESS=caddy), deny other
#                           incoming. NOT needed for Funnel or Cloudflare Tunnel, and on a
#                           server with other services it can cut them off. Read the warning.
#
# Never touches: existing Docker or Tailscale installs, other containers,
# Tailscale serve/funnel config, sshd config, sysctl.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"
# shellcheck source=SCRIPTDIR/lib/checks.sh
. "$(dirname "$0")/lib/checks.sh"

SETUP=0; DOCKER=0; TAILSCALE=0; UNATTENDED=0; FAIL2BAN=0; FIREWALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) shift ;;
    --setup) SETUP=1; shift ;;
    --install-docker) DOCKER=1; shift ;;
    --install-tailscale) TAILSCALE=1; shift ;;
    --unattended-upgrades) UNATTENDED=1; shift ;;
    --fail2ban) FAIL2BAN=1; shift ;;
    --apply-firewall) FIREWALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done
SUDO=(); [ "$(id -u)" = 0 ] || SUDO=(sudo)
have() { command -v "$1" >/dev/null 2>&1; }
if [ -f "$ENV_FILE" ]; then load_env_file "$ENV_FILE"; fi

step "System"
# shellcheck disable=SC1091
. /etc/os-release 2>/dev/null && say "  OS: ${PRETTY_NAME:-unknown} ($(uname -m))"
say "  CPU cores: $(nproc)   memory: $(free -h | awk '/^Mem:/ {print $2 " total, " $7 " available"}')"
say "  disk /: $(df -h / | awk 'NR==2 {print $4 " free of " $2}')"
mem_avail_mb="$(free -m | awk '/^Mem:/ {print $7}')"
[ "${mem_avail_mb:-0}" -ge 2500 ] && ok "≥2.5 GB RAM available (stack needs ~1.9 GB at most)" \
  || warn "Only ${mem_avail_mb} MB RAM available; the stack can use up to ~1.9 GB."
for tool in curl git python3 openssl; do
  have "$tool" && ok "$tool present" || warn "$tool missing: sudo apt install $tool"
done

step "Docker"
if have docker && docker compose version >/dev/null 2>&1; then
  ok "$(docker --version | cut -d, -f1), compose $(docker compose version --short) - left as is"
  if ! docker info >/dev/null 2>&1; then
    warn "Your user cannot talk to Docker. Fix: sudo usermod -aG docker $(id -un), then log out and back in."
  fi
elif [ "$DOCKER" = 1 ]; then
  run "${SUDO[@]}" apt-get update
  run "${SUDO[@]}" apt-get install -y docker.io docker-compose-v2
  run "${SUDO[@]}" systemctl enable --now docker
  run "${SUDO[@]}" usermod -aG docker "$(id -un)"
  ok "Docker installed from Ubuntu packages. Log out and back in once."
else
  warn "Docker or its compose plugin is missing. Install: ./scripts/bootstrap.sh --install-docker"
fi

step "Tailscale (needed for HOST_MODE=single-host)"
if have tailscale; then
  ok "$(tailscale version 2>/dev/null | head -1) - left as is"
  name="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
  if [ -n "$name" ]; then ok "logged in as $name  (use this as PUBLIC_HOST)"; else warn "not logged in: sudo tailscale up"; fi
  say "  Current serve/funnel config (never modified by bootstrap):"
  tailscale funnel status 2>/dev/null | sed 's/^/    /' || say "    (run 'sudo tailscale funnel status' to see it)"
elif [ "$TAILSCALE" = 1 ]; then
  run sh -c 'curl -fsSL https://tailscale.com/install.sh | sh'
  ok "Tailscale installed. Next: sudo tailscale up  (open the link it prints on your phone)"
else
  warn "Tailscale missing. Install: ./scripts/bootstrap.sh --install-tailscale"
fi

step "Ports"
say "  listening now: $(listening_ports | cut -f1 | tr '\n' ' ')"
if [ -f "$ENV_FILE" ]; then
  ( load_config >/dev/null && check_port_conflicts && ok "planned ports free: $(planned_host_ports | tr '\n' ' ')" ) || true
else
  for p in 28080 28081; do port_in_use "$p" && warn "default port $p is taken: change it in .env" || ok "default port $p free"; done
fi

step "Firewall (read-only check)"
if have ufw; then
  "${SUDO[@]}" -n ufw status verbose 2>/dev/null | sed 's/^/  /' || say "  (sudo ufw status to see the rules)"
fi
say "  With Funnel or Cloudflare Tunnel nothing is published on the network:"
say "  the proxy listens on 127.0.0.1 only, so no firewall change is needed."
say "  Note: ports Docker publishes on 0.0.0.0 bypass ufw; this stack only does that for INGRESS=caddy (80/443)."

if [ "$UNATTENDED" = 1 ]; then
  step "Automatic security updates"
  run "${SUDO[@]}" apt-get install -y unattended-upgrades
  run "${SUDO[@]}" dpkg-reconfigure -f noninteractive unattended-upgrades
fi
if [ "$FAIL2BAN" = 1 ]; then
  step "fail2ban (sshd jail)"
  if have fail2ban-client; then ok "fail2ban already installed - left as is"; else
    run "${SUDO[@]}" apt-get install -y fail2ban
    run "${SUDO[@]}" systemctl enable --now fail2ban
  fi
fi
if [ "$FIREWALL" = 1 ]; then
  step "Firewall (ufw) - CHANGES NETWORK ACCESS"
  warn "These ports are listening on this server right now: $(listening_ports | cut -f1 | tr '\n' ' ')"
  warn "After 'ufw enable' only SSH$( [ "${INGRESS:-}" = caddy ] && echo ', 80, 443') will be reachable from other machines."
  warn "Home Assistant, game servers, dashboards etc. on other ports become unreachable from your LAN."
  if [ "$DRY_RUN" != 1 ]; then
    [ -t 0 ] || die "Refusing to change the firewall without a terminal."
    read -r -p "Type FIREWALL to continue: " answer
    [ "$answer" = FIREWALL ] || die "Cancelled; firewall unchanged."
  fi
  run "${SUDO[@]}" ufw allow OpenSSH
  if [ "${INGRESS:-}" = caddy ]; then run "${SUDO[@]}" ufw allow 80/tcp; run "${SUDO[@]}" ufw allow 443; fi
  run "${SUDO[@]}" ufw default deny incoming
  run "${SUDO[@]}" ufw enable
fi

if [ "$SETUP" = 1 ]; then
  step "Settings file"
  if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE exists - kept"
  else
    run cp "$SELFHOST_DIR/.env.example" "$ENV_FILE"
    run chmod 600 "$ENV_FILE"
    ok "created $ENV_FILE (mode 600)"
  fi
  if [ "$DRY_RUN" = 1 ]; then "$SELFHOST_DIR/scripts/gen-secrets.sh" --dry-run; else "$SELFHOST_DIR/scripts/gen-secrets.sh"; fi
  run mkdir -p "$SELFHOST_DIR/state" "$SELFHOST_DIR/backups"
  run chmod 700 "$SELFHOST_DIR/state" "$SELFHOST_DIR/backups"
  say ""
  say "Now edit $ENV_FILE (nano $ENV_FILE): PUBLIC_HOST, EMAIL_FROM, SMTP_USER, SMTP_PASS, NOMINATIM_CONTACT."
  say "Then: ./scripts/deploy.sh"
else
  say ""
  say "Nothing was changed. Next: ./scripts/bootstrap.sh --setup"
fi
