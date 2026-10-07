#!/usr/bin/env bash
# Fill every secret in .env that is still empty or CHANGE_ME_SECRET with a
# fresh random value. Never touches a secret that is already set, so it is
# safe to run again. Prints only the NAMES it changed, never the values.
#
#   ./scripts/gen-secrets.sh            # fill missing secrets
#   ./scripts/gen-secrets.sh --dry-run  # show which ones would be filled
#   ./scripts/gen-secrets.sh --rotate OTP_SECRET
#        replace one secret; see docs/SELF-HOSTING.md "Rotating secrets" for
#        what else each one needs (DB passwords must also change in Postgres).
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

SECRETS=(POSTGRES_SUPERUSER_PASSWORD APP_DB_PASSWORD KC_DB_PASSWORD KC_ADMIN_PASSWORD OTP_SECRET)
ROTATE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --rotate)
      [ $# -ge 2 ] || die "--rotate needs a secret name: ${SECRETS[*]}"
      ROTATE="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done

if [ -n "$ROTATE" ]; then
  case " ${SECRETS[*]} " in *" $ROTATE "*) ;; *) die "--rotate: '$ROTATE' is not one of: ${SECRETS[*]}" ;; esac
fi

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. First: cp $SELFHOST_DIR/.env.example $ENV_FILE"

# 32 random bytes as hex: URL-safe (DB passwords go inside DATABASE_URL),
# no quoting problems in .env, 256 bits of entropy.
random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

current_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

changed=()
tmp="$(mktemp "$ENV_FILE.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
cp "$ENV_FILE" "$tmp"

for name in "${SECRETS[@]}"; do
  value="$(current_value "$name")"
  if [ "$name" = "$ROTATE" ] || [ -z "$value" ] || [ "${value#CHANGE_ME}" != "$value" ]; then
    new="$(random_secret)"
    if grep -q "^$name=" "$tmp"; then
      sed -i "s/^$name=.*/$name=$new/" "$tmp"
    else
      printf '%s=%s\n' "$name" "$new" >> "$tmp"
    fi
    changed+=("$name")
  fi
done

if [ "${#changed[@]}" -eq 0 ]; then
  ok "All secrets already set; nothing changed."
  exit 0
fi

if [ "$DRY_RUN" = 1 ]; then
  say "Would generate: ${changed[*]}"
  exit 0
fi

mv "$tmp" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"
ok "Generated: ${changed[*]} (values are only in $ENV_FILE, mode 600)."
