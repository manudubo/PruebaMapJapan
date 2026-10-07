#!/usr/bin/env bash
# docker compose for the TravelMap stack, with .env loaded and the URLs and
# profiles for your HOST_MODE filled in. Use it instead of `docker compose`:
#
#   ./scripts/compose.sh ps
#   ./scripts/compose.sh logs -f backend
#   ./scripts/compose.sh config      # the fully resolved file (contains secrets!)
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib/common.sh
. "$(dirname "$0")/lib/common.sh"
load_config
compose "$@"
