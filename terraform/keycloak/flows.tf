# Browser flow: username first, then exactly one credential (passkey OR password).
#
#   browser-passkey (top level, basic-flow)
#   ├── auth-cookie                                ALTERNATIVE  (existing SSO session)
#   └── passkey-forms                              ALTERNATIVE  (basic-flow)
#       ├── auth-username-form                     REQUIRED     (identifies the user only)
#       └── passkey-or-password                    REQUIRED     (basic-flow — the credential step)
#           ├── passkey                            ALTERNATIVE  (basic-flow)
#           │   └── passkey-if-configured          CONDITIONAL  (basic-flow)
#           │       ├── conditional-user-configured          REQUIRED (condition)
#           │       └── webauthn-authenticator-passwordless  REQUIRED
#           └── auth-password-form                 ALTERNATIVE
#
# KC-01 / SEC-12: the previous layout mixed REQUIRED auth-username-form with an
# ALTERNATIVE webauthn execution at the same level. Keycloak's DefaultAuthenticationFlow
# drops every ALTERNATIVE when a REQUIRED sibling exists ("REQUIRED and ALTERNATIVE
# elements at same level! Those alternative executions will be ignored"), so the old
# passkey-forms subflow reduced to "username form only" and issued an authorization
# code for ANY existing username with no credential at all (reproduced on KC 26.6.1).
#
# Invariants of this layout (keep them when editing):
#   1. No level mixes REQUIRED/CONDITIONAL with ALTERNATIVE siblings (conditions such as
#      conditional-user-configured are excluded from that check by Keycloak).
#   2. The credential step is a single REQUIRED subflow, so passkey-forms can only
#      succeed after one of its ALTERNATIVE credentials succeeds.
#   3. webauthn is REQUIRED only inside a CONDITIONAL subflow guarded by
#      conditional-user-configured. A REQUIRED authenticator the user has not configured
#      is otherwise marked SETUP_REQUIRED and counted as passed (Keycloak queues the
#      register-passkey required action instead) — i.e. an attacker knowing a username
#      could enrol their own passkey. The condition makes the passkey branch evaporate
#      for users without a passkey, so they fall through to auth-password-form.
#   4. A user with neither a passkey nor a password fails the flow (both ALTERNATIVEs
#      fail) — see tests/e2e/idp-flow.spec.ts for the negative checks.

resource "keycloak_authentication_flow" "browser_passkey" {
  realm_id    = keycloak_realm.japan_trip.id
  alias       = "browser-passkey"
  description = "Browser flow: username, then passkey or password (KC-01)"
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
  description       = "Username, then one credential (passkey or password)"
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

resource "keycloak_authentication_subflow" "credential" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-or-password"
  description       = "Credential step: exactly one of passkey or password must succeed"
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  provider_id       = "basic-flow"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.username_form]
}

resource "keycloak_authentication_subflow" "passkey" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey"
  description       = "Passkey branch — empty (fails) for users without a registered passkey"
  parent_flow_alias = keycloak_authentication_subflow.credential.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

resource "keycloak_authentication_subflow" "passkey_if_configured" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-if-configured"
  description       = "Runs WebAuthn passwordless only when the user already has a passkey"
  parent_flow_alias = keycloak_authentication_subflow.passkey.alias
  provider_id       = "basic-flow"
  requirement       = "CONDITIONAL"
  priority          = 10
}

resource "keycloak_authentication_execution" "passkey_condition" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_if_configured.alias
  authenticator     = "conditional-user-configured"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution" "webauthn_passwordless" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_if_configured.alias
  authenticator     = "webauthn-authenticator-passwordless"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.passkey_condition]
}

resource "keycloak_authentication_execution" "password_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.credential.alias
  authenticator     = "auth-password-form"
  requirement       = "ALTERNATIVE"
  priority          = 20

  depends_on = [keycloak_authentication_subflow.passkey]
}

# SEC-13 / ARCH-08: Terraform is the single source of truth for which flow the realm
# uses. Bound here (not via keycloak_realm.browser_flow) so a fresh `terraform apply`
# creates the flow before binding it — setting browser_flow on the realm resource made
# the realm POST fail with a 500 (flow does not exist yet) on an empty Keycloak.
resource "keycloak_authentication_bindings" "browser_flow" {
  realm_id     = keycloak_realm.japan_trip.id
  browser_flow = keycloak_authentication_flow.browser_passkey.alias

  depends_on = [
    keycloak_authentication_execution.cookie,
    keycloak_authentication_execution.username_form,
    keycloak_authentication_execution.webauthn_passwordless,
    keycloak_authentication_execution.password_form,
  ]
}

resource "keycloak_required_action" "webauthn_register_passwordless" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "webauthn-register-passwordless"
  enabled        = true
  default_action = false
  name           = "Webauthn Register Passwordless"
}
