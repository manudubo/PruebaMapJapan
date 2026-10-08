#!/usr/bin/env bash
# shellcheck disable=SC2016  # the PURGE_*_CMD strings are expanded by the script's bash -c
# Tests for deploy/selfhost/scripts/purge-unverified.sh against a stub `curl`
# (Keycloak admin API) and stub database commands (PURGE_VERIFIED_IDS_CMD /
# PURGE_DB_DELETE_CMD). No Docker, Keycloak or Postgres needed.
#
#   bash deploy/selfhost/tests/purge-unverified.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/purge-unverified.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export NO_COLOR=1
export SELFHOST_ENV_FILE="$WORK/.env"
pass=0; failn=0
t_ok() { printf 'ok   %s\n' "$1"; pass=$((pass + 1)); }
t_fail() { printf 'FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '     %s\n' "$2"; failn=$((failn + 1)); }
expect_eq() { if [ "$2" = "$3" ]; then t_ok "$1"; else t_fail "$1" "expected '$2', got '$3'"; fi; }
expect_has() { case "$3" in *"$2"*) t_ok "$1" ;; *) t_fail "$1" "missing '$2' in: $3" ;; esac; }
expect_not_has() { case "$3" in *"$2"*) t_fail "$1" "unexpected '$2' in: $3" ;; *) t_ok "$1" ;; esac; }

ADMIN_PW='adm1n pa$$ secret'
cat > "$WORK/.env" <<EOF
HOST_MODE=single-host
PUBLIC_HOST=box.tail1234.ts.net
EMAIL_FROM=TravelMap <login@example.com>
POSTGRES_SUPERUSER_PASSWORD=x1
APP_DB_PASSWORD=x2
KC_DB_PASSWORD=x3
KC_ADMIN_PASSWORD=$ADMIN_PW
OTP_SECRET=x4
EOF
chmod 600 "$WORK/.env"

# --- stub curl: token, paged user list, DELETE --------------------------------
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/argv.log"
method=GET url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -H) shift 2 ;;
    --data-urlencode) case "$2" in *@-) cat > /dev/null ;; esac; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  */realms/master/protocol/openid-connect/token)
    [ "${STUB_TOKEN_FAIL:-0}" = 1 ] && exit 22
    printf '{"access_token":"tok-123"}'; exit 0 ;;
  */admin/realms/japan-trip/users\?first=*)
    first="${url#*first=}"; first="${first%%&*}"
    cat "$STUB_DIR/page-$first.json" 2>/dev/null || echo '[]'; exit 0 ;;
  */admin/realms/japan-trip/users/*)
    if [ "$method" = DELETE ]; then
      [ "${STUB_DELETE_FAIL:-0}" = 1 ] && exit 22
      echo "DELETE ${url##*/users/}" >> "$STUB_DIR/deleted.log"; exit 0
    fi ;;
esac
exit 22
STUB
chmod +x "$WORK/bin/curl"

now_ms=$(( $(date +%s) * 1000 ))
old=$(( now_ms - 30 * 3600 * 1000 ))   # 30 h ago
young=$(( now_ms - 2 * 3600 * 1000 ))  # 2 h ago
ID_A=aaaaaaaa-0000-4000-8000-000000000001 # old, unverified everywhere -> purge
ID_B=bbbbbbbb-0000-4000-8000-000000000002 # old, verified by the backend code -> keep
ID_C=cccccccc-0000-4000-8000-000000000003 # old, emailVerified in Keycloak (invited) -> keep
ID_D=dddddddd-0000-4000-8000-000000000004 # young -> keep
ID_E=eeeeeeee-0000-4000-8000-000000000005 # service account -> keep
ID_G=99999999-0000-4000-8000-000000000007 # old, unverified, on page 2 -> purge

new_case() {
  STUB_DIR="$WORK/case-$((pass + failn))-$RANDOM"; mkdir -p "$STUB_DIR"
  : > "$STUB_DIR/argv.log"; : > "$STUB_DIR/deleted.log"; : > "$STUB_DIR/dbdel.log"
  python3 - "$STUB_DIR" "$old" "$young" "$ID_A" "$ID_B" "$ID_C" "$ID_D" "$ID_E" "$ID_G" <<'PY'
import json, sys
d, old, young, a, b, c, dd, e, g = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), *sys.argv[4:]
def u(i, email, ts, verified=False, **kw):
    return dict(id=i, username=email, email=email, emailVerified=verified, createdTimestamp=ts, **kw)
page0 = [u(a, "alice@example.org", old), u(b, "bob@example.org", old), u(c, "carol@example.org", old, True),
         u(dd, "dave@example.org", young), u(e, "service-account-travelmap-recovery", old)]
# Fill page 0 to 100 entries with verified users so the script must fetch page 100.
page0 += [u("f%07d-0000-4000-8000-000000000000" % n, "v%d@example.org" % n, old, True) for n in range(100 - len(page0))]
json.dump(page0, open(f"{d}/page-0.json", "w"))
json.dump([u(g, "gina@example.org", old)], open(f"{d}/page-100.json", "w"))
PY
  export STUB_DIR
  export PURGE_VERIFIED_IDS_CMD="printf '%s\n' $ID_B"
  export PURGE_DB_DELETE_CMD='echo "$1" >> "$STUB_DIR/dbdel.log"'
  unset STUB_TOKEN_FAIL STUB_DELETE_FAIL
}
purge() { PATH="$WORK/bin:$PATH" "$SCRIPT" "$@" 2>&1; }

# 1. Dry run (default): lists exactly A and G, deletes nothing.
new_case
out="$(purge)"; rc=$?
expect_eq "dry run exits 0" 0 "$rc"
expect_has "dry run counts two candidates" "older than 24 h: 2" "$out"
expect_has "dry run lists A" "would delete $ID_A" "$out"
expect_has "dry run lists G from the second page" "would delete $ID_G" "$out"
for id in "$ID_B" "$ID_C" "$ID_D" "$ID_E"; do expect_not_has "dry run keeps $id" "$id" "$out"; done
expect_eq "dry run sends no DELETE" "" "$(cat "$STUB_DIR/deleted.log")"
expect_eq "dry run touches no app row" "" "$(cat "$STUB_DIR/dbdel.log")"
expect_has "e-mail addresses are masked in the output" "a***@example.org" "$out"
expect_not_has "full e-mail never printed" "alice@example.org" "$out"

# 2. --apply deletes A and G in Keycloak and in the app database.
new_case
out="$(purge --apply)"; rc=$?
expect_eq "apply exits 0" 0 "$rc"
expect_eq "apply deletes A and G in Keycloak" "DELETE $ID_A
DELETE $ID_G" "$(cat "$STUB_DIR/deleted.log")"
expect_eq "apply deletes their app rows" "$ID_A
$ID_G" "$(cat "$STUB_DIR/dbdel.log")"
expect_has "apply reports the count" "Deleted 2 unverified account(s)" "$out"

# 3. --hours widens/narrows the window: 1 h also catches D (2 h old).
new_case
out="$(purge --hours 1)"
expect_has "--hours 1 includes the 2-hour-old account" "would delete $ID_D" "$out"
new_case
out="$(purge --hours 48)"
expect_has "--hours 48 leaves 30-hour-old accounts" "older than 48 h: 0" "$out"

# 4. Fail closed when the database cannot be asked.
new_case
export PURGE_VERIFIED_IDS_CMD='echo "psql: column email_verified_at does not exist" >&2; exit 1'
out="$(purge --apply)"; rc=$?
expect_eq "database failure exits non-zero" 1 "$rc"
expect_has "database failure explains" "Nothing deleted" "$out"
expect_eq "database failure deletes nothing" "" "$(cat "$STUB_DIR/deleted.log")"

# 5. Safety cap.
new_case
out="$(purge --apply --max 1)"; rc=$?
expect_eq "over the cap exits non-zero" 1 "$rc"
expect_has "over the cap explains" "exceed the safety cap of 1" "$out"
expect_eq "over the cap deletes nothing" "" "$(cat "$STUB_DIR/deleted.log")"

# 6. Keycloak errors.
new_case
export STUB_TOKEN_FAIL=1
out="$(purge --apply)"; rc=$?
expect_eq "no admin token exits non-zero" 1 "$rc"
expect_eq "no admin token deletes nothing" "" "$(cat "$STUB_DIR/deleted.log")"
new_case
export STUB_DELETE_FAIL=1
out="$(purge --apply)"; rc=$?
expect_eq "a refused DELETE stops the run" 1 "$rc"
expect_eq "a refused DELETE leaves the app row" "" "$(cat "$STUB_DIR/dbdel.log")"

# 7. Arguments and secrets.
new_case
out="$(purge --hours 0)"; rc=$?
expect_eq "--hours 0 refused" 1 "$rc"
out="$(purge --bogus)"; rc=$?
expect_eq "unknown argument refused" 1 "$rc"
new_case
purge --apply >/dev/null
expect_not_has "admin password never in curl argv" "$ADMIN_PW" "$(cat "$STUB_DIR/argv.log")"
expect_not_has "bearer token never in curl argv" "tok-123" "$(cat "$STUB_DIR/argv.log")"

# 8. Default database commands: the id is a psql variable, never SQL text.
src="$(cat "$SCRIPT")"
expect_has "default delete binds the id with :'kid'" "keycloak_id = :'kid' AND email_verified_at IS NULL" "$src"
expect_has "default verified query keys on the backend flag" "WHERE email_verified_at IS NOT NULL" "$src"

printf '\n%d passed, %d failed\n' "$pass" "$failn"
[ "$failn" -eq 0 ]
