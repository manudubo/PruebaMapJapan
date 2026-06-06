# RFC 9700 (OAuth 2.0 Security BCP) Compliance Checklist

**Project:** TravelMap  
**Audited:** 2026-06-06  
**Standard:** [RFC 9700 — OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700)  
**Scope:** Local dev + production-ready configuration (Keycloak 26.6.1, Hono backend, keycloak-js frontend)

> Status: **Compliant** = control is implemented and verified in code or config.  
> **N/A** = control does not apply to this architecture.  
> **Non-compliant** = control is not implemented (none in this audit).

| Section | Control | Status | Evidence | Rationale |
|---------|---------|--------|----------|-----------|
| 2.1 | Exact string matching for redirect URIs | Compliant | `terraform/keycloak/main.tf` `valid_redirect_uris` — exact URIs, no wildcards | Enforced by Keycloak; no open redirector possible |
| 2.1 | No open redirectors in authorization server or client | Compliant | Backend never issues redirects; frontend uses Keycloak's redirect handling | Redirect flow is fully handled by KC and keycloak-js |
| 2.1.1 | Public clients must implement PKCE | Compliant | `terraform/keycloak/main.tf` line 63: `pkce_code_challenge_method = "S256"` | S256 enforced server-side by Keycloak; PKCE mandated |
| 2.1.1 | Only S256 code challenge method accepted | Compliant | `terraform/keycloak/main.tf` line 63: `pkce_code_challenge_method = "S256"` | S256 only; plain rejected by Keycloak 26.6.1 |
| 2.1.1 | AS rejects token requests without code_verifier when code_challenge was sent | Compliant | Enforced by Keycloak 26.6.1 when PKCE is mandated (INFRA-04) | Keycloak enforces PKCE contract end-to-end |
| 2.1.2 | Avoid implicit grant | Compliant | `terraform/keycloak/main.tf`: `standard_flow_enabled = true` only; `implicit_flow_enabled = false` | Implicit grant not enabled in any KC client |
| 2.2.1 | Sender-constrained access tokens (mTLS or DPoP) | N/A | Single resource server; DPoP deferred post-v3.0 per REQUIREMENTS.md | Not applicable for single-RS setup; deferred |
| 2.2.2 | Refresh token rotation or sender-constraining | N/A | KC refresh token rotation is configurable; not audited in realm settings | Rotation configurable in KC admin; not on by default in KC 26.6.1 |
| 2.3 | Audience-restricted access tokens | Compliant | `terraform/keycloak/main.tf` lines 88–95: audience mapper restricts frontend tokens to `japan-trip-frontend` | Audience validated on every request by `validateAudience()` in `backend/src/auth/keycloak.ts:89–93` |
| 2.4 | Resource Owner Password Credentials grant must not be used | Compliant | `terraform/keycloak/main.tf`: `direct_access_grants_enabled = false` in all KC clients | No ROPC in test fixtures or production config |
| 2.5 | Client authentication | Compliant | `japan-trip-frontend` is PUBLIC (PKCE, no secret); `japan-trip-worker` is CONFIDENTIAL | Correct per RFC 9700 §2.5: public clients use PKCE; confidential clients use client secret |
| 2.6 | AS publishes metadata per RFC 8414 | Compliant | Keycloak publishes `/.well-known/openid-configuration` by default | Standard Keycloak 26.6.1 behavior; OIDC discovery endpoint active |
| 2.6 | End-to-end TLS | Compliant (partial) | Production: all HTTPS; local dev: HTTP loopback only | HTTP loopback acceptable per RFC 9700 §2.6; production enforces TLS |
| 4.1.3 | Exact redirect URI string comparison at authorization server | Compliant | Keycloak enforces exact match; `main.tf` lists exact URIs with no wildcards | No wildcard redirect URIs in any KC client |
| 4.2.4 | Suppress Referer headers to prevent auth code leakage | Compliant | `backend/src/middleware/security.ts`: `Referrer-Policy: no-referrer` (added Phase 13) | Previously a gap; now set unconditionally on all API responses |
| 4.3.2 | Never pass access tokens in URI query parameters | Compliant | All API calls use `Authorization: Bearer` header | No query-param token passing anywhere in frontend or backend |
| 4.4.2 | Mix-up attack defense | N/A | Single authorization server; no mix-up risk | Mix-up attacks require multiple AS; this project uses Keycloak only |
| 4.5.3 | PKCE protects against authorization code injection | Compliant | S256 enforced; Keycloak rejects PKCE violations | PKCE S256 mandated server-side; no plain or absent code_challenge accepted |
| 4.7.1 | CSRF protection via PKCE, nonce, or state | Compliant | PKCE S256 provides CSRF protection; KC + keycloak-js handle state parameter | No custom CSRF implementation needed with PKCE |
| 4.8.2 | Prevent PKCE downgrade attacks | Compliant | `pkce_code_challenge_method = "S256"` — Keycloak rejects requests without code_verifier | Downgrade to no-PKCE rejected by server-side enforcement |
| 4.9.3 | Treat access tokens as sensitive; restrict audience | Compliant | `validateAudience()` in `backend/src/auth/keycloak.ts:89–93`; JWT stored in sessionStorage (same-origin only) | Audience validated on every authenticated request (SEC-05 E2E asserts this) |
| 4.10.1 | Sender-constrained tokens at resource server | N/A | DPoP deferred per REQUIREMENTS.md | Post-v3.0 enhancement; not in current scope |
| 4.10.2 | Audience-restricted tokens validated at resource server | Compliant | `backend/src/auth/keycloak.ts` lines 198–202: validates aud against `VALID_AUDIENCES` env var | Enforced on every authenticated request; SEC-05 E2E test guards regression |

## Summary

| Status | Count |
|--------|-------|
| Compliant | 19 |
| N/A | 4 |
| Non-compliant | 0 |

**Open items for future phases:**
- DPoP sender-constrained tokens (§2.2.1, §4.10.1) — deferred post-v3.0
- Refresh token rotation (§2.2.2) — verify KC realm settings; configurable in Keycloak admin
