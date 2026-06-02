resource "keycloak_realm" "japan_trip" {
  realm        = "japan-trip"
  enabled      = true
  display_name = "Japan Trip"
  login_theme  = "japan-trip"

  registration_allowed     = true
  login_with_email_allowed = true
  duplicate_emails_allowed = false
  reset_password_allowed   = true
  edit_username_allowed    = false

  ssl_required = "external"

  access_token_lifespan            = "5m"
  sso_session_idle_timeout         = "30m"
  sso_session_max_lifespan         = "10h"
  offline_session_idle_timeout     = "720h"
  access_code_lifespan             = "1m"
  access_code_lifespan_user_action = "20m"
  access_code_lifespan_login       = "30m"

  password_policy = "length(8) and upperCase(1) and digits(1) and specialChars(1)"

  # KC-02: switched to browser-passkey flow (password-forms ALTERNATIVE pre-declared in flows.tf)
  browser_flow = "browser-passkey"

  # Standard (non-passwordless) WebAuthn — rpId is empty per realm-export.json line 32
  web_authn_policy {
    relying_party_entity_name = "japan-trip"
    relying_party_id          = ""
    signature_algorithms      = ["ES256"]
  }

  # Passwordless WebAuthn — rpId = "localhost" per Phase 4 (MUST be preserved; changing to prod hostname
  # requires full passkey re-registration by all users)
  web_authn_passwordless_policy {
    relying_party_entity_name     = "japan-trip"
    relying_party_id              = "localhost"
    signature_algorithms          = ["ES256"]
    authenticator_attachment      = "platform"
    require_resident_key          = "Yes"
    user_verification_requirement = "required"
  }

  smtp_server {
    host = "mailpit"
    port = 1025
    from = "noreply@japan-trip.local"
    ssl  = false
    # auth block omitted — Mailpit requires no authentication (D-14)
  }
}

resource "keycloak_openid_client" "japan_trip_frontend" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-frontend"
  name      = "Japan Trip Frontend"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  pkce_code_challenge_method   = "S256"
  direct_access_grants_enabled = false

  valid_redirect_uris = [
    "http://localhost:5173/PruebaMapJapan/dashboard.html",
    "http://localhost:5173/PruebaMapJapan/profile.html",
    "http://localhost:5173/PruebaMapJapan/index.html",
    "http://localhost:5173/PruebaMapJapan/silent-check-sso.html",
    "https://manud.github.io/PruebaMapJapan/dashboard.html",
    "https://manud.github.io/PruebaMapJapan/profile.html",
    "https://manud.github.io/PruebaMapJapan/index.html",
    "https://manud.github.io/PruebaMapJapan/silent-check-sso.html",
  ]

  valid_post_logout_redirect_uris = [
    "http://localhost:5173/PruebaMapJapan/index.html",
    "http://localhost:5173/",
    "https://manud.github.io/PruebaMapJapan/index.html",
    "https://manud.github.io/",
  ]
  web_origins                     = ["+"]

  full_scope_allowed = true
}

resource "keycloak_openid_audience_protocol_mapper" "audience" {
  realm_id                 = keycloak_realm.japan_trip.id
  client_id                = keycloak_openid_client.japan_trip_frontend.id
  name                     = "audience-mapper"
  included_client_audience = keycloak_openid_client.japan_trip_frontend.client_id
  add_to_id_token          = false
  add_to_access_token      = true
}

resource "keycloak_openid_client" "japan_trip_api" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-api"
  name      = "Japan Trip API"
  enabled   = true

  access_type           = "BEARER-ONLY"
  standard_flow_enabled = false
  full_scope_allowed    = false
}

# D-01: Worker client with service account (BACK-04)
resource "keycloak_openid_client" "japan_trip_worker" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-worker"
  name      = "Japan Trip Worker"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  direct_access_grants_enabled = false
}

# Lookup built-in realm-management client (contains manage-users as a CLIENT role)
data "keycloak_openid_client" "realm_management" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "realm-management"
}

# D-02: Assign manage-users CLIENT role to the worker service account
# IMPORTANT: Use keycloak_openid_client_service_account_role (no _realm_ infix)
# manage-users is a CLIENT role on realm-management, NOT a top-level realm role.
# Using the _realm_role variant would fail to find the role.
resource "keycloak_openid_client_service_account_role" "worker_manage_users" {
  realm_id                = keycloak_realm.japan_trip.id
  service_account_user_id = keycloak_openid_client.japan_trip_worker.service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = "manage-users"
}

# KC-01: VERIFY_EMAIL required action with default_action = true
resource "keycloak_required_action" "verify_email" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "VERIFY_EMAIL"
  enabled        = true
  default_action = true
  name           = "Verify Email"
}

# Expose worker client secret as a sensitive output so it can be retrieved
# via `terraform output -raw worker_client_secret` and placed in .dev.vars
output "worker_client_secret" {
  value     = keycloak_openid_client.japan_trip_worker.client_secret
  sensitive = true
}

# E2E-01: Pre-seeded test user for general auth + passkey tests
resource "keycloak_user" "e2e_test_user" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "e2e-test@local"
  enabled        = true
  email          = "e2e-test@local"
  email_verified = true
  first_name     = "E2E"
  last_name      = "Test"

  initial_password {
    value     = var.e2e_test_password
    temporary = false
  }
}

# E2E-04: Pre-seeded test user for OTP tests — no passkeys registered (D-13)
resource "keycloak_user" "otp_test_user" {
  realm_id       = keycloak_realm.japan_trip.id
  username       = "otp-test@local"
  enabled        = true
  email          = "otp-test@local"
  email_verified = true
  first_name     = "OTP"
  last_name      = "Test"

  initial_password {
    value     = var.e2e_otp_password
    temporary = false
  }
}

# INFRA-01: testuser for trip-edit-integration.spec.ts (Test1234! matches hardcoded spec credential)
resource "keycloak_user" "testuser" {
  realm_id         = keycloak_realm.japan_trip.id
  username         = "testuser"
  enabled          = true
  email            = "testuser@local"
  email_verified   = true
  first_name       = "Test"
  last_name        = "User"
  required_actions = []

  initial_password {
    value     = var.testuser_password
    temporary = false
  }
}

# INFRA-02: new_user_test for new-user E2E spec (starts with no trips)
resource "keycloak_user" "new_user_test" {
  realm_id         = keycloak_realm.japan_trip.id
  username         = "new_user_test"
  enabled          = true
  email            = "new_user_test@local"
  email_verified   = true
  first_name       = "New"
  last_name        = "UserTest"
  required_actions = []

  initial_password {
    value     = var.new_user_test_password
    temporary = false
  }
}

# INFRA-03: trip_edit_test_user for trip-edit-integration.spec.ts
resource "keycloak_user" "trip_edit_test_user" {
  realm_id         = keycloak_realm.japan_trip.id
  username         = "trip_edit_test_user"
  enabled          = true
  email            = "trip_edit_test_user@local"
  email_verified   = true
  first_name       = "TripEdit"
  last_name        = "TestUser"
  required_actions = []

  initial_password {
    value     = var.trip_edit_test_user_password
    temporary = false
  }
}
