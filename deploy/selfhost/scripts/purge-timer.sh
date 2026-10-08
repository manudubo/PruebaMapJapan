#!/usr/bin/env bash
# Hourly purge of never-verified self-registered accounts (purge-unverified.sh
# --apply) with a systemd timer. Only useful with open sign-up (REGISTRATION_ENABLED).
#
#   ./scripts/purge-timer.sh install   # needs sudo; runs as the current user
#   ./scripts/purge-timer.sh status    # next run, last result
#   ./scripts/purge-timer.sh remove
#   add --dry-run to print the unit files instead of installing them
#
# Logs: journalctl -u travelmap-purge-unverified.service
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

ACTION="${1:-status}"; shift || true
[ "${1:-}" = --dry-run ] && DRY_RUN=1
UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SUDO=(); [ "$(id -u)" = 0 ] || SUDO=(sudo)
user="$(id -un)"
UNITS=(travelmap-purge-unverified.service travelmap-purge-unverified.timer)

render() {
  sed -e "s#@SELFHOST_DIR@#$SELFHOST_DIR#g" -e "s#@USER@#$user#g" "$SELFHOST_DIR/systemd/$1"
}

case "$ACTION" in
  install)
    id -nG "$user" | grep -qw docker || [ "$user" = root ] \
      || warn "User $user is not in the docker group; the purge would fail. Fix: sudo usermod -aG docker $user (then log out and in)."
    for unit in "${UNITS[@]}"; do
      if [ "$DRY_RUN" = 1 ]; then say "--- $UNIT_DIR/$unit"; render "$unit"; continue; fi
      render "$unit" | "${SUDO[@]}" tee "$UNIT_DIR/$unit" >/dev/null
    done
    run "${SUDO[@]}" systemctl daemon-reload
    run "${SUDO[@]}" systemctl enable --now travelmap-purge-unverified.timer
    ok "Hourly purge installed. Preview what it deletes: ./scripts/purge-unverified.sh" ;;
  status)
    systemctl list-timers travelmap-purge-unverified.timer --all --no-pager || true
    systemctl status travelmap-purge-unverified.service --no-pager -n 5 || true ;;
  remove)
    run "${SUDO[@]}" systemctl disable --now travelmap-purge-unverified.timer || true
    run "${SUDO[@]}" rm -f "$UNIT_DIR/travelmap-purge-unverified.service" "$UNIT_DIR/travelmap-purge-unverified.timer"
    run "${SUDO[@]}" systemctl daemon-reload
    ok "Purge timer removed." ;;
  -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "usage: purge-timer.sh install|status|remove [--dry-run]" ;;
esac
