#!/usr/bin/env bash
# Daily automatic backups with a systemd timer (03:30 + up to 20 min).
#
#   ./scripts/backup-timer.sh install   # needs sudo; runs as the current user
#   ./scripts/backup-timer.sh status    # next run, last result
#   ./scripts/backup-timer.sh remove
#   add --dry-run to print the unit files instead of installing them
#
# Logs: journalctl -u travelmap-backup.service
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

ACTION="${1:-status}"; shift || true
[ "${1:-}" = --dry-run ] && DRY_RUN=1
UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SUDO=(); [ "$(id -u)" = 0 ] || SUDO=(sudo)
user="$(id -un)"

render() {
  sed -e "s#@SELFHOST_DIR@#$SELFHOST_DIR#g" -e "s#@USER@#$user#g" "$SELFHOST_DIR/systemd/$1"
}

case "$ACTION" in
  install)
    id -nG "$user" | grep -qw docker || [ "$user" = root ] \
      || warn "User $user is not in the docker group; the backup would fail. Fix: sudo usermod -aG docker $user (then log out and in)."
    for unit in travelmap-backup.service travelmap-backup.timer; do
      if [ "$DRY_RUN" = 1 ]; then say "--- $UNIT_DIR/$unit"; render "$unit"; continue; fi
      render "$unit" | "${SUDO[@]}" tee "$UNIT_DIR/$unit" >/dev/null
    done
    run "${SUDO[@]}" systemctl daemon-reload
    run "${SUDO[@]}" systemctl enable --now travelmap-backup.timer
    ok "Daily backup timer installed. Test it now: sudo systemctl start travelmap-backup.service && ./scripts/backup.sh --list" ;;
  status)
    systemctl list-timers travelmap-backup.timer --all --no-pager || true
    systemctl status travelmap-backup.service --no-pager -n 5 || true ;;
  remove)
    run "${SUDO[@]}" systemctl disable --now travelmap-backup.timer || true
    run "${SUDO[@]}" rm -f "$UNIT_DIR/travelmap-backup.service" "$UNIT_DIR/travelmap-backup.timer"
    run "${SUDO[@]}" systemctl daemon-reload
    ok "Backup timer removed (existing backups kept)." ;;
  -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "usage: backup-timer.sh install|status|remove [--dry-run]" ;;
esac
