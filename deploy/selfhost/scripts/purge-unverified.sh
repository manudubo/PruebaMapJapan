#!/usr/bin/env bash
# Delete self-registered accounts that never proved their e-mail address.
# DRY RUN by default: lists what would go and changes nothing.
#
#   ./scripts/purge-unverified.sh                 # list candidates (dry run)
#   ./scripts/purge-unverified.sh --apply         # delete them
#   ./scripts/purge-unverified.sh --hours 48      # older than 48 h (default 24)
#   ./scripts/purge-unverified.sh --apply --max 200   # raise the safety cap
#
# A candidate is a Keycloak user of the realm that is
#   - not a service account,
#   - older than --hours (PURGE_UNVERIFIED_AFTER_HOURS, default 24),
#   - emailVerified = false in Keycloak (invited accounts are created verified), AND
#   - NOT verified in the app database (users.email_verified_at, set by the backend's
#     6-digit e-mail code).
# Such accounts cannot use the API (403 email_not_verified). Removing them frees the
# address for its real owner: someone who registers a stranger's e-mail (squatting)
# blocks that owner only until the next run. The matching app row (no data: the API
# refused it) is deleted too, so the address is free in the database as well.
#
# Fail closed: if the database cannot be asked (stack down, backend not migrated yet,
# column missing) nothing is deleted. More than --max (default 50) candidates in one
# run also aborts (a sign that something else is wrong); re-run with a higher --max.
#
# The two database steps are commands, replaceable for tests or another database:
#   PURGE_VERIFIED_IDS_CMD  prints the keycloak_id of every verified app user, one per
#                           line (default: psql in the compose postgres container)
#   PURGE_DB_DELETE_CMD     deletes the unverified app row of keycloak_id "$1"
# Logs: journalctl -u travelmap-purge-unverified.service (with purge-timer.sh).
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

APPLY=0
HOURS="${PURGE_UNVERIFIED_AFTER_HOURS:-24}"
MAX="${PURGE_MAX:-50}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    --hours) HOURS="${2:-}"; shift 2 ;;
    --max) MAX="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done
[[ "$HOURS" =~ ^[0-9]+$ ]] && [ "$HOURS" -ge 1 ] || die "--hours must be a whole number >= 1 (got '$HOURS')."
[[ "$MAX" =~ ^[0-9]+$ ]] || die "--max must be a whole number (got '$MAX')."

load_config
require_secrets
KC_LOCAL_URL="${KC_LOCAL_URL:-http://127.0.0.1:${KC_ADMIN_PORT}/auth}"
REALM="$KEYCLOAK_REALM"

PSQL_SELECT="SELECT keycloak_id FROM users WHERE email_verified_at IS NOT NULL"
default_verified_ids() {
  compose exec -T postgres psql -U postgres -d travelmap -v ON_ERROR_STOP=1 -tAc "$PSQL_SELECT"
}
default_db_delete() {
  # The id travels as a psql variable (:'kid' is quoted by psql), never as SQL text.
  printf '%s\n' "DELETE FROM users WHERE keycloak_id = :'kid' AND email_verified_at IS NULL;" \
    | compose exec -T postgres psql -U postgres -d travelmap -v ON_ERROR_STOP=1 -q -v "kid=$1"
}
verified_ids() {
  if [ -n "${PURGE_VERIFIED_IDS_CMD:-}" ]; then bash -c "$PURGE_VERIFIED_IDS_CMD"; else default_verified_ids; fi
}
db_delete() {
  if [ -n "${PURGE_DB_DELETE_CMD:-}" ]; then bash -c "$PURGE_DB_DELETE_CMD" _ "$1"; else default_db_delete "$1"; fi
}

# a***@example.org: enough to recognise an account in the journal, not the address.
mask_email() { local e="$1"; printf '%s***@%s' "${e:0:1}" "${e#*@}"; }

# --- Keycloak admin token (password via stdin, never argv) ----------------------
token="$(printf '%s' "$KC_ADMIN_PASSWORD" | curl -fsS --noproxy '*' --max-time 15 \
  --data-urlencode client_id=admin-cli --data-urlencode username=admin \
  --data-urlencode password@- --data-urlencode grant_type=password \
  "$KC_LOCAL_URL/realms/master/protocol/openid-connect/token" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')" \
  || die "Could not get an admin token from $KC_LOCAL_URL (is the stack running? see ./scripts/status.sh)."
umask 077
AUTH_FILE="$(mktemp)"
trap 'rm -f "$AUTH_FILE"' EXIT
printf 'Authorization: Bearer %s\n' "$token" > "$AUTH_FILE"
api() { curl -fsS --noproxy '*' --max-time 30 -H @"$AUTH_FILE" "$@"; }
base="$KC_LOCAL_URL/admin/realms/$REALM"

# --- Database first: without it, nothing is deleted -------------------------------
verified="$(verified_ids)" \
  || die "Could not read verified users from the app database (is the stack up and the backend migrated to users.email_verified_at?). Nothing deleted."

# --- Candidates from Keycloak (paged) --------------------------------------------
now_ms="$(( $(date +%s) * 1000 ))"
cutoff_ms="$(( now_ms - HOURS * 3600 * 1000 ))"
candidates=""
first=0
while :; do
  page="$(api "$base/users?first=$first&max=100&briefRepresentation=false")" \
    || die "Keycloak refused the user listing. Nothing deleted."
  count="$(printf '%s' "$page" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
  candidates+="$(printf '%s' "$page" | python3 -c '
import json, sys
cutoff = int(sys.argv[1])
for u in json.load(sys.stdin):
    if u.get("serviceAccountClientId") or u.get("username", "").startswith("service-account-"):
        continue
    if u.get("emailVerified") or int(u.get("createdTimestamp") or 0) > cutoff:
        continue
    print(u["id"] + " " + (u.get("email") or u.get("username") or "?"))
' "$cutoff_ms")"$'\n'
  [ "$count" -lt 100 ] && break
  first=$((first + 100))
done

to_delete=()
while read -r id email; do
  [ -n "${id:-}" ] || continue
  [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || { warn "skipping unexpected Keycloak id '$id'"; continue; }
  if printf '%s\n' "$verified" | grep -qxF "$id"; then continue; fi
  to_delete+=("$id $email")
done <<< "$candidates"

say "Unverified accounts older than ${HOURS} h: ${#to_delete[@]}"
[ "${#to_delete[@]}" -eq 0 ] && { ok "Nothing to purge."; exit 0; }
if [ "${#to_delete[@]}" -gt "$MAX" ]; then
  die "${#to_delete[@]} candidates exceed the safety cap of $MAX. Check them (dry run lists them), then re-run with --max ${#to_delete[@]}."
fi

deleted=0
for entry in "${to_delete[@]}"; do
  id="${entry%% *}"; email="${entry#* }"
  if [ "$APPLY" != 1 ]; then
    say "  [dry-run] would delete $id $(mask_email "$email")"
    continue
  fi
  api -X DELETE "$base/users/$id" >/dev/null || die "Keycloak refused to delete $id (stopped; $deleted deleted)."
  db_delete "$id" >/dev/null || warn "Keycloak account $id deleted, but its app row was not (delete it by hand)."
  say "  deleted $id $(mask_email "$email")"
  deleted=$((deleted + 1))
done
if [ "$APPLY" = 1 ]; then ok "Deleted $deleted unverified account(s)."; else ok "Dry run: nothing deleted. Re-run with --apply."; fi
