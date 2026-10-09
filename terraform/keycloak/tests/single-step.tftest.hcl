# Single-step apply (no `-target` dance) when the realm itself has a pending change.
#
# Bug: data sources that referenced keycloak_realm.japan_trip.id were deferred to apply
# time ("known after apply") as soon as the realm had ANY pending in-place change, so the
# protocol mappers (mappers.tf) and the recovery service-account role / scope mapping,
# which take ids from those data sources, were planned for destroy + recreate. The data
# sources now take the realm NAME (local.realm_name), which is no dependency at all.
#
# The mocked provider reproduces the deferral (core Terraform logic, not provider logic):
# with the old `realm_id = keycloak_realm.japan_trip.id` the "realm_update_pending" run
# fails with "Unknown condition value" on the mapper client_scope_id. What a mock cannot
# prove is the real provider's behaviour; the owner confirms with `keycloak-apply.sh
# --dry-run` on the real realm (no destroy lines) before applying.
#
#   terraform -chdir=terraform/keycloak test -filter=tests/single-step.tftest.hcl

mock_provider "keycloak" {}

variables {
  profile        = "production"
  kc_url         = "http://127.0.0.1:28081/auth"
  kc_admin_pass  = "not-a-real-password"
  ssl_required   = "all"
  webauthn_rp_id = "box.tail1234.ts.net"
  smtp_host      = "smtp.gmail.com"
  smtp_port      = 587
  smtp_starttls  = true
  smtp_user      = "owner@gmail.com"
  smtp_password  = "not-a-real-app-password"
}

# Brand-new Keycloak (empty state): everything is planned for creation in one plan; the
# ordering of resources comes from their realm_id = keycloak_realm.japan_trip.id edges.
run "fresh_plan_creates_everything" {
  command = plan

  assert {
    condition     = keycloak_realm.japan_trip.realm == "japan-trip"
    error_message = "the realm name comes from local.realm_name"
  }
  assert {
    condition = alltrue([
      keycloak_openid_user_property_protocol_mapper.profile_username.name == "username",
      keycloak_openid_user_attribute_protocol_mapper.avatar_url.name == "avatar_url",
      length(keycloak_generic_role_mapper.recovery_scope_manage_users) == 1,
      length(keycloak_openid_client_service_account_role.recovery_manage_users) == 1,
    ])
    error_message = "mappers and the recovery role mapping are part of the fresh plan"
  }
}

run "existing_realm_applied" {
  command = apply
}

# The realm has a pending in-place change; nothing that depends on the data sources may
# become unknown (= be replaced).
run "realm_update_pending_keeps_mappers_and_recovery_role" {
  command = plan
  variables {
    frontend_url = "https://box.tail1234.ts.net/auth"
  }

  assert {
    condition     = keycloak_realm.japan_trip.attributes["frontendUrl"] == "https://box.tail1234.ts.net/auth"
    error_message = "the realm change is pending (this run is an in-place update)"
  }
  assert {
    condition     = data.keycloak_openid_client_scope.profile.realm_id == "japan-trip" && data.keycloak_openid_client_scope.email.realm_id == "japan-trip"
    error_message = "built-in client scopes are read by realm name, at plan time"
  }
  assert {
    condition     = data.keycloak_openid_client.realm_management.realm_id == "japan-trip" && data.keycloak_role.realm_management_manage_users[0].realm_id == "japan-trip"
    error_message = "realm-management client and its role are read by realm name, at plan time"
  }
  # Comparing a value fails the run when it is "known after apply" (= replacement).
  assert {
    condition = alltrue([
      keycloak_openid_user_property_protocol_mapper.profile_username.client_scope_id != "",
      keycloak_openid_full_name_protocol_mapper.profile_full_name.client_scope_id != "",
      keycloak_openid_user_property_protocol_mapper.email_claim.client_scope_id != "",
      keycloak_openid_user_property_protocol_mapper.email_verified.client_scope_id != "",
      keycloak_openid_user_attribute_protocol_mapper.avatar_url.client_scope_id != "",
      keycloak_openid_user_attribute_protocol_mapper.preferences.client_scope_id != "",
    ])
    error_message = "protocol mapper client_scope_id must stay known during a realm update"
  }
  assert {
    condition = alltrue([
      keycloak_openid_client_service_account_role.recovery_manage_users[0].client_id != "",
      keycloak_openid_client_service_account_role.recovery_manage_users[0].role == "manage-users",
      keycloak_generic_role_mapper.recovery_scope_manage_users[0].role_id != "",
    ])
    error_message = "recovery service-account role and scope mapping must stay known during a realm update"
  }
}

# Static guard for what a mock cannot see: no data source may reference the realm
# resource (any reference makes the read deferrable). Looks at every `data` block.
run "no_data_source_references_the_realm_resource" {
  command = plan

  assert {
    condition = alltrue([
      for f in ["main.tf", "mappers.tf", "flows.tf", "outputs.tf"] :
      length(regexall("data \"[a-z_]+\" \"[a-z_]+\" \\{[^}]*=\\s*keycloak_realm\\.", file("${path.module}/${f}"))) == 0
    ])
    error_message = "a data source references keycloak_realm.japan_trip: use local.realm_name (see main.tf), or a realm update will plan destroys of mappers and the recovery role"
  }
}
