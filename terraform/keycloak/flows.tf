resource "keycloak_authentication_flow" "browser_passkey" {
  realm_id    = keycloak_realm.japan_trip.id
  alias       = "browser-passkey"
  description = "Browser flow with WebAuthn passkey as first factor (passwordless)"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "cookie" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  authenticator     = "auth-cookie"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

resource "keycloak_authentication_subflow" "passkey_forms" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-forms"
  description       = "Username + WebAuthn passwordless"
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 20
}

resource "keycloak_authentication_execution" "username_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  authenticator     = "auth-username-form"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution" "webauthn_passwordless" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  authenticator     = "webauthn-authenticator-passwordless"
  requirement       = "REQUIRED"
  priority          = 20
}

resource "keycloak_authentication_subflow" "password_forms" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "password-forms"
  description       = "Username + password authentication"
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 30
}

resource "keycloak_authentication_execution" "username_password_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.password_forms.alias
  authenticator     = "auth-username-password-form"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_required_action" "webauthn_register_passwordless" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "webauthn-register-passwordless"
  enabled        = true
  default_action = false
  name           = "Webauthn Register Passwordless"
}
