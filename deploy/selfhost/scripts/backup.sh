#!/usr/bin/env bash
# Back up everything needed to rebuild the server:
#   travelmap.dump   app database      (pg_dump custom format)
#   keycloak.dump    Keycloak database (users, passkeys, sessions config)
#   terraform.tar.gz Keycloak Terraform state (deploy/selfhost/state)
#   env              a copy of .env (SECRETS - keep backups private)
#   SHA256SUMS       checksums, verified by restore.sh
# into BACKUP_DIR/<date-time>/, keeps the newest BACKUP_KEEP backups, and
# optionally copies the new backup off-site with rclone (BACKUP_RCLONE_REMOTE).
#
#   ./scripts/backup.sh             # make a backup now
#   ./scripts/backup.sh --dry-run   # show what would happen
#   ./scripts/backup.sh --list      # list existing backups
# Daily automatic backups: ./scripts/backup-timer.sh install
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --list) LIST=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done

load_config
PG="$COMPOSE_PROJECT_NAME-postgres"
STATE_DIR="${SELFHOST_STATE_DIR:-$SELFHOST_DIR/state}"

if [ "$LIST" = 1 ]; then
  [ -d "$BACKUP_DIR" ] || { say "No backups yet ($BACKUP_DIR does not exist)."; exit 0; }
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' | sort | while read -r b; do
    printf '%s  %s\n' "$b" "$(du -sh "$BACKUP_DIR/$b" | cut -f1)"
  done
  exit 0
fi

[ "$(docker inspect -f '{{.State.Running}}' "$PG" 2>/dev/null)" = true ] \
  || die "Postgres container $PG is not running. Start the stack: ./scripts/deploy.sh --no-build"

stamp="$(date -u +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/$stamp"
step "Backing up to $dest"
if [ "$DRY_RUN" = 1 ]; then
  say "[dry-run] pg_dump travelmap, keycloak; tar $STATE_DIR; copy .env; keep newest $BACKUP_KEEP"
  [ -z "${BACKUP_RCLONE_REMOTE:-}" ] || say "[dry-run] rclone copy -> $BACKUP_RCLONE_REMOTE/$stamp"
  exit 0
fi

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
tmp="$BACKUP_DIR/.incomplete-$stamp"
rm -rf "$tmp"
mkdir "$tmp"
trap 'rm -rf "$tmp"' EXIT

for db in travelmap keycloak; do
  docker exec "$PG" pg_dump -U postgres -d "$db" -Fc --no-owner > "$tmp/$db.dump" \
    || die "pg_dump of $db failed."
  # A dump that pg_restore cannot list is useless; check now, not on restore day.
  docker exec -i "$PG" pg_restore -l < "$tmp/$db.dump" > /dev/null \
    || die "$db.dump is not readable by pg_restore."
  ok "$db.dump ($(du -h "$tmp/$db.dump" | cut -f1))"
done

if [ -d "$STATE_DIR" ]; then
  tar -C "$STATE_DIR" --exclude='.terraform' --exclude='*.tfplan' -czf "$tmp/terraform.tar.gz" .
  ok "terraform.tar.gz"
fi
cp "$ENV_FILE" "$tmp/env"
ok "env (contains secrets)"
(cd "$tmp" && sha256sum -- * > SHA256SUMS)
mv "$tmp" "$dest"
trap - EXIT
ok "Backup complete: $dest"

# Rotation: keep the newest BACKUP_KEEP backups.
mapfile -t all < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' | sort)
excess=$(( ${#all[@]} - BACKUP_KEEP ))
if [ "$excess" -gt 0 ]; then
  for old in "${all[@]:0:$excess}"; do
    rm -rf "${BACKUP_DIR:?}/$old"
    say "  removed old backup $old"
  done
fi

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copy "$dest" "$BACKUP_RCLONE_REMOTE/$stamp" && ok "Copied off-site to $BACKUP_RCLONE_REMOTE/$stamp" \
      || die "rclone copy failed; the local backup is fine: $dest"
  else
    warn "BACKUP_RCLONE_REMOTE is set but rclone is not installed; no off-site copy made."
  fi
fi
