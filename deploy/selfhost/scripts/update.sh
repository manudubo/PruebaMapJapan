#!/usr/bin/env bash
# Update to the latest code: backup -> git pull -> deploy -> Keycloak plan.
#
#   ./scripts/update.sh            # pull the current branch and redeploy
#   ./scripts/update.sh --no-pull  # redeploy the code already checked out
#   ./scripts/update.sh --dry-run  # show what would happen
#
# Rollback: git checkout <previous commit> && ./scripts/deploy.sh. The
# database is never rolled back automatically (migrations only go forward);
# if a release broke data, use ./scripts/restore.sh with the backup taken here.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

PULL=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done
load_config
extra=()
[ "$DRY_RUN" = 1 ] && extra+=(--dry-run)

step "Backup before updating"
"$SELFHOST_DIR/scripts/backup.sh" "${extra[@]}"

if [ "$PULL" = 1 ]; then
  step "Pulling new code"
  [ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ] \
    || die "The checkout has local changes (git -C $REPO_DIR status). Commit or revert them first."
  before="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
  run git -C "$REPO_DIR" pull --ff-only
  after="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
  if [ "$before" = "$after" ]; then ok "Already at the latest commit ($after)"; else ok "Updated $before -> $after"; fi
fi

"$SELFHOST_DIR/scripts/deploy.sh" "${extra[@]}"

step "Keycloak configuration changes in this update (plan only)"
"$SELFHOST_DIR/scripts/keycloak-apply.sh" --dry-run || warn "Keycloak plan failed; see the output above."
say "If the plan lists changes, apply them with: ./scripts/keycloak-apply.sh"
