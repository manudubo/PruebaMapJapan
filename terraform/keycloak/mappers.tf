data "keycloak_openid_client_scope" "profile" {
  realm_id = keycloak_realm.japan_trip.id
  name     = "profile"
}

data "keycloak_openid_client_scope" "email" {
  realm_id = keycloak_realm.japan_trip.id
  name     = "email"
}

resource "keycloak_openid_user_property_protocol_mapper" "profile_username" {
  realm_id         = keycloak_realm.japan_trip.id
  client_scope_id  = data.keycloak_openid_client_scope.profile.id
  name             = "username"
  user_property    = "username"
  claim_name       = "preferred_username"
  claim_value_type = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_full_name_protocol_mapper" "profile_full_name" {
  realm_id        = keycloak_realm.japan_trip.id
  client_scope_id = data.keycloak_openid_client_scope.profile.id
  name            = "full name"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "avatar_url" {
  realm_id         = keycloak_realm.japan_trip.id
  client_scope_id  = data.keycloak_openid_client_scope.profile.id
  name             = "avatar_url"
  user_attribute   = "avatar_url"
  claim_name       = "avatar_url"
  claim_value_type = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_attribute_protocol_mapper" "preferences" {
  realm_id         = keycloak_realm.japan_trip.id
  client_scope_id  = data.keycloak_openid_client_scope.profile.id
  name             = "preferences"
  user_attribute   = "preferences"
  claim_name       = "preferences"
  claim_value_type = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_property_protocol_mapper" "email_claim" {
  realm_id         = keycloak_realm.japan_trip.id
  client_scope_id  = data.keycloak_openid_client_scope.email.id
  name             = "email"
  user_property    = "email"
  claim_name       = "email"
  claim_value_type = "String"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

resource "keycloak_openid_user_property_protocol_mapper" "email_verified" {
  realm_id         = keycloak_realm.japan_trip.id
  client_scope_id  = data.keycloak_openid_client_scope.email.id
  name             = "email verified"
  user_property    = "emailVerified"
  claim_name       = "email_verified"
  claim_value_type = "boolean"
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}
