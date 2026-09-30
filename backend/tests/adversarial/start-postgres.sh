#!/usr/bin/env bash
# Start a throwaway Postgres for the adversarial suite and print the
# ADV_DATABASE_URL to export. Tries installed binaries first, then Docker.
#
#   eval "$(backend/tests/adversarial/start-postgres.sh)"
#   npm test --workspace=backend
#
# Stop it again with:  backend/tests/adversarial/start-postgres.sh stop
set -euo pipefail

PORT="${ADV_PG_PORT:-57691}"
DATA="${ADV_PG_DATA:-${TMPDIR:-/tmp}/travelmap-adv-pg}"
CONTAINER=travelmap-adv-pg

run_as_pg() {
  if [ "$(id -u)" = 0 ]; then setpriv --reuid=postgres --regid=postgres --init-groups "$@"; else "$@"; fi
}

if [ "${1:-}" = stop ]; then
  PG_CTL=$(ls /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | tail -1 || true)
  [ -n "$PG_CTL" ] && [ -d "$DATA" ] && run_as_pg "$PG_CTL" -D "$DATA" -m fast stop >&2 || true
  command -v docker >/dev/null && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  exit 0
fi

PG_CTL=$(ls /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | tail -1 || true)
if [ -z "$PG_CTL" ]; then PG_CTL=$(command -v pg_ctl 2>/dev/null || true); fi
BIN=""
if [ -n "$PG_CTL" ]; then BIN=$(dirname "$PG_CTL"); fi

if [ -n "$BIN" ] && [ -x "$BIN/pg_ctl" ]; then
  if [ ! -f "$DATA/PG_VERSION" ]; then
    mkdir -p "$DATA"
    [ "$(id -u)" = 0 ] && chown postgres "$DATA"
    run_as_pg "$BIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >&2
  fi
  run_as_pg "$BIN/pg_ctl" -D "$DATA" -l "$DATA/log.txt" -w \
    -o "-p $PORT -k $DATA -c listen_addresses=127.0.0.1 -c max_connections=1000 -c fsync=off" start >&2
elif command -v docker >/dev/null; then
  docker run -d --rm --name "$CONTAINER" -p "127.0.0.1:$PORT:5432" \
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine -c max_connections=1000 -c fsync=off >&2
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 0.5
  done
else
  echo "No Postgres binaries or Docker found" >&2
  exit 1
fi

echo "export ADV_DATABASE_URL=postgresql://postgres@127.0.0.1:$PORT/postgres"
