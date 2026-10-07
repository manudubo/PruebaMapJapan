#!/usr/bin/env bash
# Port and container checks shared by deploy.sh and status.sh. Source it.

# Print "port<TAB>process" for every listening TCP port on the host.
listening_ports() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH 2>/dev/null | awk '{
      addr=$4; sub(/.*:/, "", addr);
      proc=$0; if (match(proc, /users:\(\("[^"]+"/)) { proc=substr(proc, RSTART+9, RLENGTH-9) } else { proc="?" }
      print addr "\t" proc }' | sort -un
  else
    # Fallback without iproute2: /proc/net/tcp{,6}, state 0A = LISTEN.
    local f
    for f in /proc/net/tcp /proc/net/tcp6; do
      [ -r "$f" ] || continue
      awk 'NR>1 && $4=="0A" { split($2,a,":"); print a[2] }' "$f"
    done | while read -r hex; do printf '%d\t?\n' "0x$hex"; done | sort -un
  fi
}

port_in_use() {
  listening_ports | awk -F'\t' -v p="$1" '$1==p {found=1} END {exit !found}'
}

# Host ports our compose project publishes right now (so a re-deploy does
# not flag its own ports as conflicts).
our_published_ports() {
  docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --format '{{.Ports}}' 2>/dev/null | tr ',' '\n' | sed -n 's/.*:\([0-9][0-9]*\)->.*/\1/p' | sort -u
}

# Ports this configuration will publish on the host.
planned_host_ports() {
  echo "$KC_ADMIN_PORT"
  case "$COMPOSE_PROFILES" in
    *public-proxy*) echo 80; echo 443 ;;
    *local-proxy*) echo "$PROXY_PORT" ;;
  esac
}

# Fail when a planned port is taken by something that is not this stack.
check_port_conflicts() {
  local port ours conflicts=0
  ours="$(our_published_ports)"
  for port in $(planned_host_ports); do
    if printf '%s\n' "$ours" | grep -qx "$port"; then
      continue
    fi
    if port_in_use "$port"; then
      fail "Port $port is already used by another program on this server ($(listening_ports | awk -F'\t' -v p="$port" '$1==p {print $2}' | head -1))."
      conflicts=1
    fi
  done
  if [ "$conflicts" = 1 ]; then
    say "  Pick free ports in .env (PROXY_PORT, KC_ADMIN_PORT). Used ports: $(listening_ports | cut -f1 | tr '\n' ' ')"
    return 1
  fi
  return 0
}

# Containers NOT in our project whose names collide with ours.
foreign_name_conflicts() {
  local name svc
  for svc in postgres backend keycloak proxy proxy-public cloudflared; do
    name="$COMPOSE_PROJECT_NAME-$svc"
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      local project
      project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$name" 2>/dev/null || true)"
      [ "$project" = "$COMPOSE_PROJECT_NAME" ] || printf '%s\n' "$name"
    fi
  done
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing
}

# Wait for a container's healthcheck to report healthy.
wait_healthy() {
  local name="$1" seconds="${2:-180}" waited=0 state
  while [ "$waited" -lt "$seconds" ]; do
    state="$(container_health "$name")"
    [ "$state" = healthy ] && return 0
    sleep 3
    waited=$((waited + 3))
  done
  fail "$name is '$(container_health "$name")' after ${seconds}s. Logs: ./scripts/compose.sh logs --tail=50 ${name#"$COMPOSE_PROJECT_NAME"-}"
  return 1
}

# GET a URL from inside the backend container (no curl needed there).
backend_get_status() {
  docker exec "$COMPOSE_PROJECT_NAME-backend" node -e \
    "fetch('http://127.0.0.1:8787$1').then(r=>{console.log(r.status)},()=>console.log('000'))" 2>/dev/null || echo 000
}

wait_backend_ready() {
  local seconds="${1:-120}" waited=0 code
  while [ "$waited" -lt "$seconds" ]; do
    code="$(backend_get_status /api/health/ready)"
    [ "$code" = 200 ] && return 0
    sleep 3
    waited=$((waited + 3))
  done
  fail "/api/health/ready answered $code after ${seconds}s. Logs: ./scripts/compose.sh logs --tail=50 backend"
  return 1
}

# Number of applied drizzle migrations (empty when the table does not exist).
applied_migrations() {
  docker exec "$COMPOSE_PROJECT_NAME-postgres" psql -U postgres -d travelmap -tAc \
    "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo 0
}
