#!/usr/bin/env bash
# Restore a backup made by backup.sh.
#
#   ./scripts/restore.sh --drill [latest|<backup>]
#       SAFE practice run: restores the app database into a temporary
#       database, compares row counts with the live one, then deletes it.
#       Changes nothing. Do this once a month.
#   ./scripts/restore.sh latest            # REPLACE live data with the newest backup
#   ./scripts/restore.sh 20261007-030000   # ... or a named one (see backup.sh --list)
#   ./scripts/restore.sh latest --only app        # only the app database
#   ./scripts/restore.sh latest --only keycloak   # only Keycloak (users, passkeys)
#   --yes      do not ask for confirmation     --dry-run  only print the plan
#
# A real restore takes a safety backup first, stops backend and Keycloak,
# recreates the databases from the dumps, restores Keycloak's Terraform
# state, and starts everything again. .env is NOT overwritten: if you are
# rebuilding a dead server, copy <backup>/env to .env yourself first.
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
# shellcheck source=lib/checks.sh
. "$(dirname "$0")/lib/checks.sh"

DRILL=0; ONLY=all; ASSUME_YES=0; WHICH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --drill) DRILL=1; shift ;;
    --only) [ $# -ge 2 ] || die "--only needs app or keycloak"; ONLY="$2"; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option '$1' (see --help)" ;;
    *) WHICH="$1"; shift ;;
  esac
done
case "$ONLY" in all|app|keycloak) ;; *) die "--only must be app or keycloak" ;; esac

load_config
PG="$COMPOSE_PROJECT_NAME-postgres"
STATE_DIR="${SELFHOST_STATE_DIR:-$SELFHOST_DIR/state}"

[ -n "$WHICH" ] || { [ "$DRILL" = 1 ] && WHICH=latest; } || die "Which backup? Use 'latest' or a name from ./scripts/backup.sh --list"
if [ "$WHICH" = latest ]; then
  WHICH="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' 2>/dev/null | sort | tail -n 1)"
  [ -n "$WHICH" ] || die "No backups found in $BACKUP_DIR."
fi
SRC="$BACKUP_DIR/$WHICH"
[ -d "$SRC" ] || die "Backup $SRC not found (see ./scripts/backup.sh --list)."

step "Checking backup $WHICH"
(cd "$SRC" && sha256sum --quiet -c SHA256SUMS) || die "Checksums do not match: the backup is damaged."
ok "checksums OK"
[ "$(docker inspect -f '{{.State.Running}}' "$PG" 2>/dev/null)" = true ] \
  || die "Postgres container $PG is not running. Start it: ./scripts/compose.sh up -d postgres"

psql_pg() { docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

# Row counts of the app tables (one "table count" line each).
table_counts() {
  docker exec "$PG" psql -U postgres -d "$1" -tA -F' ' -c \
    "SELECT 'users', count(*) FROM users UNION ALL SELECT 'trips', count(*) FROM trips
     UNION ALL SELECT 'destinations', count(*) FROM destinations UNION ALL SELECT 'activities', count(*) FROM activities
     ORDER BY 1"
}

restore_db() { # <db> <owner> <dump>
  local db="$1" owner="$2" dump="$3"
  psql_pg -d postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)"
  psql_pg -d postgres -c "CREATE DATABASE \"$db\" OWNER \"$owner\" ENCODING 'UTF8' TEMPLATE template0"
  psql_pg -d "$db" -c "ALTER SCHEMA public OWNER TO \"$owner\""
  docker exec -i "$PG" pg_restore -U postgres -d "$db" --no-owner --role="$owner" --exit-on-error < "$dump"
}

if [ "$DRILL" = 1 ]; then
  step "Restore drill: $WHICH -> temporary database travelmap_drill"
  if [ "$DRY_RUN" = 1 ]; then say "[dry-run] would restore into travelmap_drill and compare counts"; exit 0; fi
  trap 'psql_pg -d postgres -c "DROP DATABASE IF EXISTS travelmap_drill WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
  restore_db travelmap_drill travelmap "$SRC/travelmap.dump"
  docker exec -i "$PG" pg_restore -l < "$SRC/keycloak.dump" >/dev/null || die "keycloak.dump unreadable"
  say "  table          backup  live-now"
  join <(table_counts travelmap_drill) <(table_counts travelmap) | while read -r t a b; do
    printf '  %-14s %6s  %6s\n' "$t" "$a" "$b"
  done
  ok "Drill passed: the backup restores cleanly (live data untouched). Differences above are changes since $WHICH."
  exit 0
fi

say ""
warn "This REPLACES the live $( [ "$ONLY" = all ] && echo "app AND Keycloak databases" || echo "$ONLY database") with backup $WHICH."
say "Anything created after that backup is lost (a safety backup is taken first)."
if [ "$DRY_RUN" = 1 ]; then
  say "[dry-run] backup.sh; stop backend keycloak; restore $ONLY; restore terraform state; start; wait ready"
  exit 0
fi
if [ "$ASSUME_YES" != 1 ]; then
  [ -t 0 ] || die "Not a terminal: re-run with --yes."
  read -r -p "Type RESTORE to continue: " answer
  [ "$answer" = RESTORE ] || { say "Cancelled."; exit 1; }
fi

step "Safety backup of the current data"
"$SELFHOST_DIR/scripts/backup.sh"

step "Stopping backend and Keycloak"
compose stop backend keycloak

if [ "$ONLY" = all ] || [ "$ONLY" = app ]; then
  step "Restoring app database"
  restore_db travelmap travelmap "$SRC/travelmap.dump"
  ok "travelmap restored"
fi
if [ "$ONLY" = all ] || [ "$ONLY" = keycloak ]; then
  step "Restoring Keycloak database"
  restore_db keycloak keycloak "$SRC/keycloak.dump"
  ok "keycloak restored"
  if [ -f "$SRC/terraform.tar.gz" ]; then
    mkdir -p "$STATE_DIR"
    chmod 700 "$STATE_DIR"
    tar -C "$STATE_DIR" -xzf "$SRC/terraform.tar.gz"
    ok "Terraform state restored"
  fi
fi

step "Starting services"
compose up -d backend keycloak
wait_healthy "$COMPOSE_PROJECT_NAME-keycloak" 300
wait_backend_ready 120
ok "Restore complete. Check: ./scripts/status.sh"
