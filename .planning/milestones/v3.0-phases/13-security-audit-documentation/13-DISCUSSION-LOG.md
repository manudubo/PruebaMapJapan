# Phase 13: Security Audit + Documentation — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 13-security-audit-documentation
**Areas discussed:** CSP + security headers scope, SEC-05 audience test token, RFC 9700 checklist format + location, Documentation scope

---

## CSP + Security Headers Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal API-safe CSP | `Content-Security-Policy: default-src 'none'` — standard for JSON APIs, blocks everything correctly | ✓ |
| Hono secureHeaders defaults | Use Hono's built-in secureHeaders() middleware with its defaults | |

**User's choice:** Minimal API-safe CSP — `default-src 'none'` + `X-Frame-Options: DENY` + `Strict-Transport-Security: max-age=31536000; includeSubDomains`

---

| Option | Description | Selected |
|--------|-------------|----------|
| Always include HSTS | HSTS on HTTP is ignored by browsers — unconditional is safe and simpler | ✓ |
| Prod-only HSTS | Detect environment and skip HSTS in dev | |

**User's choice:** Always include HSTS (no environment detection)

---

| Option | Description | Selected |
|--------|-------------|----------|
| New backend/src/middleware/security.ts | Matches existing cors.ts + auth.ts pattern | ✓ |
| Inline in index.ts | Add app.use() directly without a separate file | |

**User's choice:** New `backend/src/middleware/security.ts`

---

## SEC-05 Audience Test Token

| Option | Description | Selected |
|--------|-------------|----------|
| kc-admin client_credentials | Use existing kc-admin-worker client (service_accounts_enabled) — its token won't include japan-trip-frontend audience | ✓ |
| New test-only KC client | Add a Terraform KC client without the audience mapper | |
| Strip audience from existing token | Modify storageState token — backend rejects for invalid signature, not audience | |

**User's choice:** kc-admin client_credentials (existing kc-admin-worker client)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Add to existing tests/e2e/api.spec.ts | Natural fit alongside existing API assertions | ✓ |
| New tests/e2e/security.spec.ts | Dedicated security spec file | |

**User's choice:** Add to `tests/e2e/api.spec.ts`

---

## RFC 9700 Checklist Format + Location

| Option | Description | Selected |
|--------|-------------|----------|
| docs/security/rfc9700-checklist.md | Developer-facing compliance reference, version-controlled | ✓ |
| .planning/phases/13-security-audit-documentation/ | Purely a planning artifact | |
| SECURITY.md at repo root | Common pattern but typically for vulnerability reporting | |

**User's choice:** `docs/security/rfc9700-checklist.md`

---

| Option | Description | Selected |
|--------|-------------|----------|
| Code reference + one-line rationale | status + file:line reference + one sentence — practical and auditable | ✓ |
| Prose paragraph per control | Full explanation per control — thorough but high maintenance | |
| Status + reference only | Tabular status + reference, no prose | |

**User's choice:** Code reference + one-line rationale per control

---

## Documentation Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh dev machine setup | Prerequisites + clone + terraform apply + npm install + npm run dev | ✓ |
| Fresh machine + CI configuration | Also covers CI env var configuration (CI-in-KC is post-v3.0) | |
| Fresh machine + production | Production deployment is explicitly post-v3.0 | |

**User's choice:** Fresh dev machine setup — prerequisites (Docker Desktop, Node 22, Terraform), clone, env vars, terraform apply, npm install, npm run dev

---

| Option | Description | Selected |
|--------|-------------|----------|
| docs/use-cases.md — markdown table | Columns: User Action \| E2E Spec \| Coverage Status | ✓ |
| Inline in SETUP.md as appendix | Consolidates docs but mixes setup instructions with coverage tracking | |
| .planning/ artifact only | Less visible to contributors | |

**User's choice:** `docs/use-cases.md` — standalone markdown table

---

## Claude's Discretion

- Exact CSP directives beyond `default-src 'none'`
- Whether to extend JWKS retry to signature-verification failures or accept existing kid-not-found retry as sufficient for SEC-02
- Exact structure and section headings for SETUP.md
- Which env vars to document in SETUP.md beyond the core four
- GFM table format for use-cases.md (no library needed)

## Deferred Ideas

None raised during discussion.
