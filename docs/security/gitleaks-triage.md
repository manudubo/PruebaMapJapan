# Gitleaks triage (DEP-02)

Scan: gitleaks v8.21.2, `gitleaks detect --source .` (full git history, 611 commits after
`git fetch --unshallow`) and `--no-git` (working tree at HEAD). Reproduce with the same commands.
Secret values are deliberately not recorded here.

Result before triage: 14 history findings (all rule `generic-api-key`), 10 in the working tree.
This matches the 14 findings reported in ANALISIS-REPO.md / codex #21. No new findings appeared
in the commits added since that scan.

## Classification

| Group | Findings | Where | Verdict |
|-------|----------|-------|---------|
| `OTP_SECRET` test fixtures (62 chars, alternating letter/digit synthetic pattern) | 7 history / 5 HEAD | `backend/src/index.test.ts`, `backend/src/auth/keycloak.test.ts`, `backend/src/routes/public.test.ts`, planning docs 08-01, 13-01, 13-02 | False positive: unit-test fixture, not used by any deployed environment |
| `OTP_SECRET` example placeholder (24 chars, text is `replace-with-...-char...`) | 3 history / 2 HEAD | `backend/.dev.vars.example`, planning doc 08-01 | False positive: documented placeholder |
| Keycloak `japan-trip-worker` client secret (32 chars, random mixed case) | 4 history / 2 HEAD | planning docs 07-08-SUMMARY, 13-03-PLAN (v2.0/v3.0 milestones) | Real-looking credential for the LOCAL dev Keycloak (`localhost:8080`, from `tests/.env.test`). Not a false positive. |

## Actions taken

- The Keycloak secret was redacted from the two files at HEAD (`<redacted: see docs/security/gitleaks-triage.md>`).
- `.gitleaksignore` lists commit/file/rule/line fingerprints (no values) for all 14 historical
  findings so the scan reports 0 unresolved. Full-history and working-tree scans both exit clean.
- The history still contains the Keycloak value (no history rewrite was done).
- Phase 20 (SEC-14) already removed `KC_ADMIN_CLIENT_SECRET` from the production Cloudflare Worker,
  so production does not consume this client secret.

## Owner action required (cannot be done from this repo)

Rotate the `japan-trip-worker` client secret in every Keycloak that ever used the leaked value
(regenerate in the admin console or via Terraform, then update `tests/.env.test` /
`backend/.dev.vars`). I could not verify whether any shared or hosted Keycloak (e.g. Railway) used
the same value; if it did, rotate it there first. Until then the finding is "redacted and
allow-listed, rotation unconfirmed", not "rotated".

## CI

`.github/workflows/security.yml` runs Gitleaks on every push and pull request (full history,
honouring `.gitleaksignore`), so any new secret fails the build.
