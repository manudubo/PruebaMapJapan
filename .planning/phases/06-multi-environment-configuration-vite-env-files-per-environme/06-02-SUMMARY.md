---
plan: 06-02
phase: 06-local-infrastructure
status: complete
completed: 2026-05-16
---

# Plan 06-02: KC Realm HCL + Mailpit — Summary

## What was built

- `terraform/keycloak/main.tf`: 4 resource blocks — `keycloak_realm.japan_trip` (browser_flow=browser, webAuthn passwordless rpId=localhost, SMTP→mailpit:1025), `keycloak_openid_client.japan_trip_frontend` (PUBLIC/PKCE/S256), `keycloak_openid_audience_protocol_mapper.audience` (separate resource), `keycloak_openid_client.japan_trip_api` (BEARER_ONLY)
- `keycloak/docker-compose.yml`: Mailpit v1.29 service on ports 1025/8025 with restart=unless-stopped; KC healthcheck on /health/ready with start_period=30s; --import-realm preserved

## Key decisions

- `browser_flow = "browser"` kept — passkey switch is Phase 7 (KC-02)
- `web_authn_passwordless_policy.relying_party_id = "localhost"` preserved from realm-export.json Phase 4
- Audience mapper is a separate `keycloak_openid_audience_protocol_mapper` resource (not inline in client block)
- auth block omitted from smtp_server — Mailpit requires no authentication

## Self-Check: PASSED

All acceptance criteria verified:
- `keycloak_realm.japan_trip` declared with relying_party_id="localhost" in passwordless block ✓
- `browser_flow = "browser"` (not browser-passkey) ✓
- SMTP: host="mailpit", port=1025 ✓
- Audience mapper as separate resource ✓
- api client has access_type="BEARER_ONLY" ✓
- Mailpit v1.29 on ports 1025/8025 ✓
- KC healthcheck on /health/ready with start_period=30s ✓
- --import-realm still present in docker-compose (not yet removed) ✓
