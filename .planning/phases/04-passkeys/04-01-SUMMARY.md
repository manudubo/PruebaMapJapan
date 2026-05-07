---
phase: 04-passkeys
plan: 01
subsystem: infra
tags: [keycloak, webauthn, passkeys, docker, keycloak-js, typescript]

# Dependency graph
requires:
  - phase: 03-public-sharing
    provides: Completed trip-sharing UI; Keycloak auth stack unchanged
provides:
  - Keycloak 26.6.1 image + renamed bootstrap admin env vars
  - webAuthnPolicyPasswordlessRpId set to "localhost" in realm-export.json
  - keycloak-js 26.2.4 installed; TypeScript gate confirms no API surface breaks
affects: [04-02-profile-passkeys]

# Tech tracking
tech-stack:
  added: [keycloak-js@26.2.4]
  patterns: [KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD env var naming for KC 26+]

key-files:
  created: []
  modified:
    - keycloak/docker-compose.yml
    - keycloak/Dockerfile
    - keycloak/realm-export.json
    - frontend/package.json
    - package-lock.json

key-decisions:
  - "D-01: Keycloak upgraded from 25.0 to 26.6.1 — PROJECT.md constraint superseded by explicit decision"
  - "D-02: webAuthnPolicyPasswordlessRpId set to localhost in realm-export.json (not via script)"
  - "keycloak-js 26.2.4 is correct — latest stable 26.x; independent release cycle from KC server"
  - "Dockerfile bump is correct for completeness but has no effect on docker compose up (uses image directly)"

patterns-established:
  - "KC 26 admin bootstrap: KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD"

requirements-completed: [PASS-02]

# Metrics
duration: 15min
completed: 2026-05-07
---

# Phase 4 Plan 01: Keycloak 26.6.1 Upgrade + WebAuthn RP ID Config Summary

**Keycloak upgraded 25.0 to 26.6.1 with KC_BOOTSTRAP_ADMIN env vars, realm-export RP ID set to "localhost", and keycloak-js bumped to 26.2.4 with clean TypeScript compile**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-07T23:00:00Z
- **Completed:** 2026-05-07T23:13:03Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Keycloak image tag updated to 26.6.1 in both docker-compose.yml and Dockerfile
- Admin bootstrap env vars renamed to KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD (eliminates KC 26 startup warnings)
- webAuthnPolicyPasswordlessRpId set to "localhost" — browser WebAuthn API will now accept passkey registration on http://localhost:5173
- keycloak-js 26.2.4 installed; npm run typecheck exits 0 — no namespace or API surface changes require code fixes

## Task Commits

Each task was committed atomically:

1. **Task 1: Upgrade Keycloak config files to 26.6.1 and set WebAuthn RP ID** - `dceb15b` (chore)
2. **Task 2: Bump keycloak-js to ^26.0.0, install, and run typecheck gate** - `e7959f1` (chore)

## Files Created/Modified
- `keycloak/docker-compose.yml` - Image tag 25.0 → 26.6.1; env vars renamed to KC_BOOTSTRAP_ADMIN_*
- `keycloak/Dockerfile` - Both FROM lines updated to 26.6.1 (no runtime effect on local dev)
- `keycloak/realm-export.json` - webAuthnPolicyPasswordlessRpId: "" → "localhost"
- `frontend/package.json` - keycloak-js ^25.0.0 → ^26.0.0
- `package-lock.json` - Lock file updated to resolve keycloak-js 26.2.4

## Decisions Made
- keycloak-js latest 26.x is 26.2.4 (independent release cycle from server; ^26.0.0 resolves to this)
- TypeScript check passed clean on first run — no Keycloak.KeycloakTokenParsed namespace adjustment needed (Risk 4 from RESEARCH did not materialize)
- Dockerfile change is correct for completeness but has zero effect on local `docker compose up` (which pulls the image directly, not via the Dockerfile)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The typecheck gate (Risk 4) passed on first run without any TypeScript fixes required.

## CRITICAL: Re-import Required Before Testing Passkeys

**WARNING:** After this commit, a simple `docker compose restart` or `docker compose up` will NOT apply the new RP ID. Keycloak silently skips realm import if the realm already exists in the postgres volume.

**Required command sequence (from keycloak/ directory):**
```bash
docker compose down -v
docker compose up -d
```

The `-v` flag removes the `postgres_data` volume, forcing a fresh realm import on next startup. Without `-v`, the webAuthnPolicyPasswordlessRpId change is NOT applied to the running Keycloak instance.

## Manual Verification After Container Restart

After running `docker compose down -v && docker compose up -d`:

1. Navigate to http://localhost:8080/admin → japan-trip realm
2. Authentication → Required Actions
3. Verify "Webauthn Register Passwordless" is **Enabled**
4. If not enabled: toggle it on manually — this cannot be set via realm-export.json import (KC limitation)

This step is required for `keycloak.login({ action: 'webauthn-register-passwordless' })` to work. If the required action is not enabled, the AIA redirect will silently fail (redirects back without error).

## User Setup Required

None for this plan — all changes are config files and lock file updates.

## Next Phase Readiness

- Plan 04-02 (profile.ts fixes: action string, type filter, delete UI) can now be executed
- The keycloak-js TypeScript gate is passed — safe to write new profile.ts code with 26.x types
- After Plan 04-02 is complete AND `docker compose down -v && docker compose up` is run, the end-to-end passkey registration + delete flow is testable

---
*Phase: 04-passkeys*
*Completed: 2026-05-07*
