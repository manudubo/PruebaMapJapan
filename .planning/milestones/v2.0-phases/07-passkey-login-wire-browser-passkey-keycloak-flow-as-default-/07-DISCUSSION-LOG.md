# Phase 7: Backend Hardening + KC Config — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 07 — Backend Hardening + KC Config
**Areas discussed:** KC Admin client identity, FTL theme override depth, Drizzle migration approach

---

## KC Admin client identity

| Option | Description | Selected |
|--------|-------------|----------|
| New japan-trip-worker client | Create a dedicated service account client in Terraform. Clean separation — japan-trip-frontend stays as-is, worker gets its own client credentials. | ✓ |
| Promote japan-trip-api | Enable serviceAccountsEnabled on the existing japan-trip-api client. Fewer Terraform resources but mixes the API client's purpose. | |

**User's choice:** New dedicated `japan-trip-worker` service account client  
**Notes:** Credentials via `KC_ADMIN_CLIENT_ID` + `KC_ADMIN_CLIENT_SECRET` in `wrangler.dev.toml` (local) and Worker secrets (prod).

---

## FTL theme override depth

| Option | Description | Selected |
|--------|-------------|----------|
| Messages file + minimal FTL stubs | Only messages_es.properties + minimal FTL stubs extending parent. Fast, low maintenance. | |
| Full FTL template overrides | Full KC 26 template overrides for login.ftl, login-otp.ftl, verify-email.ftl, error.ftl. | ✓ |

**User's choice:** Full FTL template overrides  
**Notes:** Branding goal is to match the app's dashboard look, not just i18n. FTL files reference existing login.css and adopt the app's card/form visual patterns. `locales=es,en`, `defaultLocale=es` in theme.properties.

---

## FTL theme branding goal

| Option | Description | Selected |
|--------|-------------|----------|
| i18n only — Spanish strings + error keys | FTL files extend KC base; override text only. | |
| Custom branding too | Also restyle layout, add logo, apply japan-trip CSS. | ✓ |

**User's choice:** Custom branding (dashboard look parity)

---

## FTL theme branding level

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — apply existing login.css + japan-trip colors | Reference existing login.css. No new design work. | |
| Match the app's dashboard look | Closer visual parity with the app — new CSS in login.css if needed. | ✓ |

**User's choice:** Match app's dashboard look

---

## Drizzle migration approach

| Option | Description | Selected |
|--------|-------------|----------|
| drizzle-kit generate + committed SQL file | schema.ts addition + drizzle-kit generate → 0003_add_email_otp_codes.sql committed. | ✓ |
| Schema-only, push to dev DB | schema.ts only, drizzle-kit push. No SQL migration committed. | |

**User's choice:** drizzle-kit generate + committed SQL file  
**Notes:** Follows existing 0000/0001/0002 migration file convention in `backend/src/db/migrations/`.

---

## Claude's Discretion

- Email field DB nullability — not discussed; deferred. Keep `users.email varchar NOT NULL` and empty-string fallback.
- VALID_AUDIENCES env var extraction (BACK-01) — implementation approach straightforward; no discussion needed.
- KC-02 flow switch timing and KC-01/KC-03 Terraform resources — approach clear from requirements + prior phase Terraform structure.

## Deferred Ideas

- Making `users.email` nullable in DB — belongs in a future phase; not Phase 7 scope.
