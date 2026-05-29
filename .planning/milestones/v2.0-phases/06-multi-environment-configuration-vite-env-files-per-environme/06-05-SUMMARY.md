---
plan: 06-05
phase: 06-local-infrastructure
status: complete
completed: 2026-05-16
---

# Plan 06-05: KC Protocol Mapper HCL — Summary

## What was built

- `terraform/keycloak/mappers.tf`: 2 data sources + 6 protocol mapper resources
  - `data.keycloak_openid_client_scope.profile` and `.email`: reference built-in KC scopes (not created)
  - `keycloak_openid_user_property_protocol_mapper.profile_username`: user_property=username, claim_name=preferred_username
  - `keycloak_openid_full_name_protocol_mapper.profile_full_name`: full name mapper
  - `keycloak_openid_user_attribute_protocol_mapper.avatar_url`: user_attribute=avatar_url
  - `keycloak_openid_user_attribute_protocol_mapper.preferences`: user_attribute=preferences
  - `keycloak_openid_user_property_protocol_mapper.email_claim`: user_property=email
  - `keycloak_openid_user_property_protocol_mapper.email_verified`: user_property=emailVerified (camelCase), claim_value_type=boolean

## Key decisions

- All mappers use `client_scope_id` (not `client_id`) — attaches to scope, not to client directly
- `emailVerified` camelCase preserved from realm-export.json KC internal attribute name
- `claim_value_type = "boolean"` (lowercase) for email_verified, matching realm-export.json jsonType.label
- Used `data "keycloak_openid_client_scope"` data sources (primary path, not fallback terraform import)

## Self-Check: PASSED

All acceptance criteria verified:
- 2 data sources for profile and email scopes ✓
- 6 mapper resources with correct types ✓
- All 6 use client_scope_id ✓
- No `client_id =` in mapper resources ✓
- emailVerified camelCase ✓
- claim_value_type = "boolean" for email_verified ✓
- preferred_username as claim_name for profile_username ✓
