#!/usr/bin/env bash
# Publish the stack on the internet with Tailscale Funnel (HOST_MODE=single-host).
#
#   ./scripts/funnel.sh status    # what Tailscale serves/funnels now (read-only)
#   ./scripts/funnel.sh enable    # https://PUBLIC_HOST (port 443) -> 127.0.0.1:PROXY_PORT
#   ./scripts/funnel.sh disable   # stop serving port 443 (other ports untouched)
#   add --dry-run to print the tailscale command instead of running it
#
# Only port 443 is ever touched. Anything you already serve on other ports
# (e.g. Home Assistant on 8443) is left alone, and if 443 is already used for
# something else the script stops instead of overwriting it. It never runs
# `tailscale serve reset` / `tailscale funnel reset`.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

ACTION="${1:-status}"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown argument '$1'" ;;
  esac
done
case "$ACTION" in status|enable|disable) ;; -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; *) die "usage: funnel.sh status|enable|disable [--dry-run]" ;; esac

load_config
[ "$INGRESS" = funnel ] || die "INGRESS is '$INGRESS', not funnel; nothing to do here."
command -v tailscale >/dev/null || die "Tailscale is not installed. See docs/SELF-HOSTING.md 'Tailscale'."
command -v python3 >/dev/null || die "python3 is required."

TS=(tailscale)
if [ "$(id -u)" != 0 ] && ! tailscale serve status --json >/dev/null 2>&1; then
  TS=(sudo tailscale)
fi
TARGET="http://127.0.0.1:$PROXY_PORT"

self_name="$("${TS[@]}" status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')" \
  || die "tailscale is not logged in. Run: sudo tailscale up"
[ "$self_name" = "$PUBLIC_HOST" ] \
  || die "This machine's Tailscale name is '$self_name' but PUBLIC_HOST in .env is '$PUBLIC_HOST'. Fix .env (passkeys are tied to this name)."

# What is configured on <host>:443 right now: "none", "ours" or "other:<details>".
port443_state() {
  "${TS[@]}" serve status --json 2>/dev/null | python3 -c '
import json, sys
host, target = sys.argv[1], sys.argv[2]
raw = sys.stdin.read().strip()
cfg = json.loads(raw) if raw else {}
tcp = (cfg.get("TCP") or {}).get("443")
web = (cfg.get("Web") or {}).get(host + ":443")
if not tcp and not web:
    print("none"); sys.exit()
handlers = (web or {}).get("Handlers") or {}
if list(handlers) == ["/"] and (handlers["/"].get("Proxy") or "").rstrip("/") == target:
    print("ours"); sys.exit()
print("other:" + json.dumps({"TCP": tcp, "Web": web}))
' "$PUBLIC_HOST" "$TARGET"
}

show_status() {
  say "--- tailscale funnel status ---"
  "${TS[@]}" funnel status 2>&1 || true
  say "-------------------------------"
}

case "$ACTION" in
  status)
    show_status
    state="$(port443_state)"
    case "$state" in
      ours) ok "Port 443 -> $TARGET (this stack)" ;;
      none) warn "Port 443 is not served. Run: ./scripts/funnel.sh enable" ;;
      *) warn "Port 443 serves something else: ${state#other:}" ;;
    esac ;;
  enable)
    step "Current Tailscale serve/funnel configuration (before)"
    show_status
    state="$(port443_state)"
    case "$state" in
      ours) ok "Already enabled: https://$PUBLIC_HOST -> $TARGET" ;;
      none)
        run "${TS[@]}" funnel --bg --https=443 "$TARGET"
        [ "$DRY_RUN" = 1 ] || ok "Enabled: https://$PUBLIC_HOST -> $TARGET" ;;
      *)
        die "Port 443 on $PUBLIC_HOST is already configured for something else: ${state#other:}
       Not overwriting it. Free port 443 yourself, or use another Funnel port (8443/10000) by hand." ;;
    esac
    step "After"
    show_status
    if [ "$DRY_RUN" != 1 ]; then
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$PUBLIC_HOST/api/health/ready" || true)"
      if [ "$code" = 200 ]; then ok "https://$PUBLIC_HOST/api/health/ready -> 200"; else
        warn "https://$PUBLIC_HOST/api/health/ready -> $code. Funnel can take a minute to appear in public DNS; retry ./scripts/status.sh shortly."
      fi
    fi ;;
  disable)
    state="$(port443_state)"
    case "$state" in
      ours) run "${TS[@]}" funnel --https=443 off; ok "Funnel on 443 disabled (other ports untouched)." ;;
      none) ok "Port 443 is not served; nothing to disable." ;;
      *) die "Port 443 serves something that is not this stack; leaving it alone." ;;
    esac
    show_status ;;
esac
