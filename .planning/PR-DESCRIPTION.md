# v3.2: security and code health hardening (Phases 20-26 + QA)

## Summary

Fixes the findings of the 7-pass repo audit and the QA rounds that followed.
Base `main` @ `3c147f6`, head `33ab925`: 151 commits, 303 files (+30.8k / -4.2k).

- Security: CSPRNG OTP, XSS sinks removed, CSP built from env, JWKS cooldown, generic `invalid_token`, atomic OTP, CORS and headers per environment, 404 instead of 403.
- **Keycloak: the old browser flow let a username alone sign in.** Rebuilt; see Risks.
- Backend tests now run on a real Postgres 16 (34 to 1524 tests).
- Integrity moved into the DB (migrations 0004-0009).
- Editor/demo parity, local-date fixes, OSM map tiles (CartoDB now serves placeholders).

Requirements: 75 Complete, 4 Partial, 1 Deferred, 2 Unverified (82, plus DATA-04).
Details: `.planning/REQUIREMENTS.md`, `.planning/phases/TRACEABILITY.md`.

## What changed by phase

- **20 Critical security** (done before this range): OTP via `crypto.getRandomValues`, widget DOM rendering, CSP meta, Cloudflare admin secret removed.
- **21 Deploy safety** (before this range): backend builds, deploys gated on CI, wrangler pinned, KC healthcheck, dependency bumps.
- **22 Reliability**: 16 bugs, one test-first commit each (reorder, 401 hang, first-login race, OTP cap, slug regex).
- **23 Supply chain / a11y**: Leaflet bundled, hashed network-first service worker, gitleaks triage, axe/Lighthouse workflow, contrast fixes, non-blocking font.
- **24 Arch debt**: real-DB harness, typed `createDb`, `dbMiddleware`, global error handler, single-JOIN ownership, e2e rewrite, PWA icons. Migrations 0004-0007: OTP index, unique email, lat/lng CHECKs, one hotel per destination.
- **25 Business logic**: optional/generic/time/maps link/zoom through the editor, 422 validation, date and coordinate rules, local-date parsing. Migration 0008: date-coherence triggers (BIZ-07).
- **26 Security + IdP**: JWKS, JWT, OTP, CORS, headers, health, public payload; 404 on nested routes; Keycloak flow, theme and Terraform. Migration 0009: `otp_issue()`.
- **After the phases** (not requirements): adversarial backend suite (11 defects fixed), frontend QA, OSM tiles, restored overview map, minute countdown, CSP `connect-src` fix, review fixes (migrate-before-deploy, fork-safe deploys, `import.sh`, SW resilience).

## Verification

Re-run on 2026-10-04 (Node 22, real Postgres 16 with UTF8):

```bash
npm ci
npm run typecheck --workspace=backend
npm run typecheck --workspace=frontend
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  npm test --workspace=backend            # 43 files, 1524 tests passed
npm run test:run --workspace=frontend     # 47 files, 1042 tests passed
TZ=America/Argentina/Buenos_Aires npm run test:run --workspace=frontend  # same
VITE_API_URL=https://api.example.com/api VITE_KEYCLOAK_URL=https://kc.example.com \
  npm run build --workspace=frontend      # OK
```

The role in `TEST_DATABASE_URL` must be able to `CREATE DATABASE`. No database
means the backend run fails (it never skips).

Not re-run here: Playwright, Terraform, live Keycloak, axe/Lighthouse,
`wrangler deploy --dry-run` (passed in earlier phase runs). Gaps and how to close
them: `.planning/qa/QA-INDEX.md`. Nothing from this branch has run on GitHub Actions.

## Risks and rollout

**Deploy order** (the workflow enforces 1-3; do it by hand if deploying manually):
1. `db:preflight`, then `db:migrate` (0004-0009)
2. then `wrangler deploy` (the new `otp-request` calls `otp_issue()`, created by 0009)
3. frontend Pages deploy is independent
4. Keycloak Terraform/`import.sh` (below) before real users sign in

`GET /api/health/ready` answers 503 `schema_not_migrated` if step 1 was skipped.

**Migrations**
- 0005 (unique `lower(email)`) **aborts** if two users share an email (case-insensitive). The migrator rolls the run back. `db:preflight` lists them; merge by hand.
- 0006 sets BOTH coordinates to NULL on out-of-range rows and cannot detect swapped lat/lng (query in `backend/src/db/README.md`).
- 0007 deletes duplicate hotels per destination (keeps the newest).
- 0008 validates no existing data; triggers fire only when dates change.
- A database built with `drizzle-kit push` is refused by preflight; rebuild it from migrations.

**Keycloak**
- Old `browser-passkey` flow: username alone returned a token, and with `kc_action` a passkey could be registered for that account. Masked locally, **not** in a prod realm that ran this Terraform. Treat such a realm as exposed until fixed.
- Passkey users now have no "Try another way" password option. Recovery is Forgot password or an admin deleting the credential.
- Prod image has no theme (Dockerfile never copies `themes/`).

**CI**
- `e2e` is no longer `continue-on-error`: a red e2e run on `main` blocks both deploys. ARCH-09 has never been green on Actions.
- Backend deploy with no `CLOUDFLARE_API_TOKEN` is green and skipped. With the token but no `MIGRATION_DATABASE_URL` it fails on purpose.

**Maps**
- Tiles come from `tile.openstreetmap.org` (keyless). Light, attributed use only: no prefetch, no offline caching (the SW never caches tiles). Heavy traffic needs another provider; change `frontend/src/data/tiles.ts`. The CSP `img-src` follows that file.
- The live demo still shows CartoDB placeholders until this is merged.

**Other**: CSP keeps `script-src 'unsafe-inline'` (second line of defence only). Frontend build now fails if exactly one of `VITE_API_URL`/`VITE_KEYCLOAK_URL` is set.

## Not done / follow-ups

- **Deferred:** SEC-18 Nominatim proxy (low risk for one user; needed before public use).
- **Partial:** SEC-17 (`ssl_required` still `external`, Railway unchecked), A11Y-04 (marker target size), A11Y-05 (landing LCP), DEP-02 (leaked local KC secret redacted, rotation unverified).
- **Unverified:** ARCH-09 (e2e on Actions), DEP-03 (`security.yml` on Actions); the Actions Postgres service is also unobserved.
- S3: no CI job runs Keycloak, so the KC-01 regression tests run by hand only. Proposal in `.planning/qa/REVIEW-FIXES.md`.
- S4: the Neon HTTP driver path has never run. Checklist in `.planning/qa/NEON-SMOKE-CHECKLIST.md`.
- Test debt: 3 `waitForTimeout` and 6 `test.skip(` in newer specs, `api.spec.ts` still has `[404, 500]`.
- Not enforced: day in an undated destination vs trip range; hotel dates vs destination.

## Manual actions for the owner

None are needed for the current GitHub Pages demo. Before a production deploy:

1. Push the branch, open the PR, read the first Actions run (CI, Security & Accessibility). Record ARCH-09, DEP-03 and the Postgres service result in `REQUIREMENTS.md`.
2. Production Keycloak: `KC_URL=https://<kc> bash terraform/keycloak/import.sh` (dry run), then again with `--remove-stale-flows`, then `terraform plan` and `apply -var-file=local.tfvars` (six test-user password variables are now required). Afterwards review login events for credential-less logins, list WebAuthn credentials you did not register, and sign out all sessions.
3. Railway: set `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true`, `KC_HOSTNAME=https://...`, run the curl check in `keycloak/README.md`, then `ssl_required = "all"`.
4. GitHub secrets: `MIGRATION_DATABASE_URL` (direct Neon URL, pooling off, table-owner role; make a Neon backup branch first), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; both `VITE_API_URL` (Worker URL + `/api`) and `VITE_KEYCLOAK_URL`, plus realm and client id. See `SETUP.md` "Production backend (optional)".
5. Before the first migration, run `DATABASE_URL=<direct url> npm run db:preflight --workspace=backend` (lists duplicate emails) and the swapped-coordinates query in `backend/src/db/README.md`.
6. Run `.planning/qa/NEON-SMOKE-CHECKLIST.md` once on a Neon branch; check `GET <worker>/api/health/ready` after the first deploy.
7. Rotate the local `japan-trip-worker` Keycloak client secret wherever it was used.
8. Never paste secrets or the Keycloak admin password into chat, issues or logs.
