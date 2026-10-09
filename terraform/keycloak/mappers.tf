# Lookups of Keycloak's built-in objects use the realm NAME (local.realm_name), never
# keycloak_realm.japan_trip.*: Terraform defers a data source to apply time ("known after
# apply") whenever a resource it references has a pending change, and everything that
# uses its id is then destroyed and recreated. See the comment on local.realm_name.
data "keycloak_openid_client_scope" "profile" {
  realm_id = local.realm_name
  name     = "profile"
}

data "keycloak_openid_client_scope" "email" {
  realm_id = local.realm_name
  name     = "email"
}

resource "keycloak_openid_user_property_protocol_mapper" "profile_username" {
  realm_id            = keycloak_realm.japan_trip.id
  client_scope_id     = data.keycloak_openid_client_scope.profile.id
  name                = "username"
  user_property       = "username"
  claim_name          = "preferred_username"
  claim_value_type    = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_full_name_protocol_mapper" "profile_full_name" {
  realm_id            = keycloak_realm.japan_trip.id
  client_scope_id     = data.keycloak_openid_client_scope.profile.id
  name                = "full name"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "avatar_url" {
  realm_id            = keycloak_realm.japan_trip.id
  client_scope_id     = data.keycloak_openid_client_scope.profile.id
  name                = "avatar_url"
  user_attribute      = "avatar_url"
  claim_name          = "avatar_url"
  claim_value_type    = "String"
  add_to_id_token     = true
  add_to_access_token = false # SEC-25: user-editable; not needed by the API
  # Provider >= 5.8 defaults this to true; user-editable claims stay out of introspection too.
  add_to_token_introspection = false
  add_to_userinfo            = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "preferences" {
  realm_id            = keycloak_realm.japan_trip.id
  client_scope_id     = data.keycloak_openid_client_scope.profile.id
  name                = "preferences"
  user_attribute      = "preferences"
  claim_name          = "preferences"
  claim_value_type    = "String"
  add_to_id_token     = true
  add_to_access_token = false # SEC-25: user-editable; not needed by the API
  # Provider >= 5.8 defaults this to true; user-editable claims stay out of introspection too.
  add_to_token_introspection = false
  add_to_userinfo            = true
}

resource "keycloak_openid_user_property_protocol_mapper" "email_claim" {
  realm_id            = keycloak_realm.japan_trip.id
  client_scope_id     = data.keycloak_openid_client_scope.email.id
  name                = "email"
  user_property       = "email"
  claim_name          = "email"
  claim_value_type    = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_property_protocol_mapper" "email_verified" {
  realm_id            = keycloak_realm.japan_trip.id
  client_scope_id     = data.keycloak_openid_client_scope.email.id
  name                = "email verified"
  user_property       = "emailVerified"
  claim_name          = "email_verified"
  claim_value_type    = "boolean"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}
