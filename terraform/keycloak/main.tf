# The Pages origin and app path live in config/deploy-defaults.json, shared with the
# backend CORS default, so they are written down exactly once.
locals {
  deploy_defaults = jsondecode(file("${path.module}/../../config/deploy-defaults.json"))
  production      = var.profile == "production"
  # Plain http to the admin API is only acceptable when it never leaves the machine
  # (deploy/selfhost/scripts/keycloak-apply.sh uses http://127.0.0.1:<KC_ADMIN_PORT>/auth;
  # the public URL blocks /auth/admin).
  kc_url_loopback = can(regex("^http://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:[0-9]{1,5})?(/|$)", var.kc_url))

  app_origins   = coalesce(var.app_origins, [local.deploy_defaults.pagesOrigin])
  app_base_path = coalesce(var.app_base_path, local.deploy_defaults.appBasePath)
  # Local profile adds the Vite dev origins; production never lists localhost.
  all_origins = local.production ? local.app_origins : concat(local.app_origins, var.local_dev_origins)

  # Exactly the pages keycloak-js redirects back to — no wildcards (a trailing-wildcard redirect
  # URI would let any page under the origin receive authorization codes).
  redirect_pages   = ["dashboard.html", "profile.html", "index.html", "silent-check-sso.html"]
  redirect_uris    = flatten([for o in local.all_origins : [for p in local.redirect_pages : "${o}${local.app_base_path}${p}"]])
  app_home_url     = "${local.production ? local.app_origins[0] : var.local_dev_origins[0]}${local.app_base_path}"
  post_logout_uris = flatten([for o in local.all_origins : ["${o}${local.app_base_path}index.html", "${o}/"]])

  create_test_users    = coalesce(var.create_test_users, !local.production)
  create_worker_client = coalesce(var.create_worker_client, !local.production)
  registration_allowed = coalesce(var.registration_allowed, !local.production)

  # Local: the historical policy every seeded test password satisfies.
  # Production: NIST 800-63B style — long, no composition rules, not the
  # username/email, no reuse of the last 3.
  password_policy = coalesce(
    var.password_policy,
    local.production
    ? "length(12) and maxLength(128) and notUsername and notEmail and passwordHistory(3)"
    : "length(8) and upperCase(1) and digits(1) and specialChars(1)"
  )

  # Locally the negative E2E tests submit wrong passwords on purpose, and Keycloak
  # keeps failure counts between runs, so the local threshold is Keycloak's default.
  max_login_failures = coalesce(var.brute_force_max_login_failures, local.production ? 10 : 30)

  test_passwords = [
    var.e2e_test_password, var.e2e_otp_password, var.testuser_password,
    var.new_user_test_password, var.trip_edit_test_user_password, var.e2e_session_password,
  ]
}

resource "keycloak_realm" "japan_trip" {
  realm        = "japan-trip"
  enabled      = true
  display_name = "Japan Trip"
  login_theme  = "japan-trip"

  registration_allowed     = local.registration_allowed
  login_with_email_allowed = true
  duplicate_emails_allowed = false
  reset_password_allowed   = true
  edit_username_allowed    = false
  # New accounts must prove they own their address before anything uses it (the
  # backend also refuses OTP mail to unverified addresses).
  verify_email = true
  remember_me  = false

  ssl_required = var.ssl_required # SEC-17: "all" in production (enforced below)

  access_token_lifespan            = "5m"
  sso_session_idle_timeout         = "30m"
  sso_session_max_lifespan         = "10h"
  offline_session_idle_timeout     = "720h"
  access_code_lifespan             = "1m"
  access_code_lifespan_user_action = "20m"
  access_code_lifespan_login       = "30m"

  # The SPA never asks for offline_access; cap offline sessions anyway.
  offline_session_max_lifespan_enabled = true
  offline_session_max_lifespan         = "720h"

  # Action tokens (email verification / reset links): short-lived.
  action_token_generated_by_user_lifespan = "15m"

  password_policy = local.password_policy

  attributes = var.frontend_url == "" ? {} : { frontendUrl = var.frontend_url }

  # Guard against an accidental `terraform destroy` of the live realm.
  terraform_deletion_protection = local.production

  security_defenses {
    brute_force_detection {
      # Temporary lockouts only: a permanent lockout lets anyone on the internet who
      # knows a username lock its owner out.
      permanent_lockout                = false
      max_temporary_lockouts           = 0
      max_login_failures               = local.max_login_failures
      wait_increment_seconds           = 60
      quick_login_check_milli_seconds  = 1000
      minimum_quick_login_wait_seconds = 60
      max_failure_wait_seconds         = 900
      failure_reset_time_seconds       = 43200
    }
    headers {
      x_frame_options                     = "SAMEORIGIN"
      content_security_policy             = "frame-src 'self'; frame-ancestors 'self'; object-src 'none';"
      content_security_policy_report_only = ""
      x_content_type_options              = "nosniff"
      x_robots_tag                        = "none"
      x_xss_protection                    = "1; mode=block"
      strict_transport_security           = "max-age=31536000; includeSubDomains"
      referrer_policy                     = "no-referrer"
    }
  }

  # browserFlow is bound by keycloak_authentication_bindings.browser_flow in flows.tf
  # (SEC-13: Terraform is the only thing that sets it; see keycloak/README.md).

  # Both WebAuthn policies use the same rpId. Passkeys are bound to it: set
  # webauthn_rp_id to the Keycloak host name BEFORE the first registration in
  # production; changing it later invalidates every registered passkey.
  web_authn_policy {
    relying_party_entity_name = "japan-trip"
    relying_party_id          = var.webauthn_rp_id
    signature_algorithms      = ["ES256"]
  }

  web_authn_passwordless_policy {
    relying_party_entity_name     = "japan-trip"
    relying_party_id              = var.webauthn_rp_id
    signature_algorithms          = ["ES256"]
    authenticator_attachment      = "platform"
    require_resident_key          = "Yes"
    user_verification_requirement = "required"
  }

  smtp_server {
    host              = var.smtp_host
    port              = var.smtp_port
    from              = var.smtp_from
    from_display_name = var.smtp_from_display_name
    starttls          = var.smtp_starttls
    ssl               = var.smtp_ssl

    # No auth block for Mailpit (D-14); Gmail etc. need user + app password.
    dynamic "auth" {
      for_each = var.smtp_user == "" ? [] : [1]
      content {
        username = var.smtp_user
        password = var.smtp_password
      }
    }
  }

  lifecycle {
    precondition {
      condition     = !local.production || var.ssl_required == "all"
      error_message = "profile=production requires ssl_required = \"all\" (SEC-17)."
    }
    precondition {
      condition     = !local.production || !local.create_test_users
      error_message = "profile=production must not create the Playwright test users (create_test_users = false)."
    }
    precondition {
      condition     = !local.production || var.webauthn_rp_id != "localhost"
      error_message = "profile=production needs webauthn_rp_id = the public Keycloak host name (set it before anyone registers a passkey)."
    }
    precondition {
      condition     = !local.production || ((startswith(var.kc_url, "https://") || local.kc_url_loopback) && !var.kc_tls_insecure_skip_verify)
      error_message = "profile=production: kc_url must be https (or http on 127.0.0.1/localhost, e.g. the self-host admin port) and kc_tls_insecure_skip_verify must be false (the admin password crosses this connection)."
    }
    precondition {
      condition     = !local.production || (var.smtp_host != "mailpit" && (var.smtp_starttls || var.smtp_ssl))
      error_message = "profile=production needs a real SMTP server over TLS (smtp_host, smtp_starttls or smtp_ssl) for verification and reset emails."
    }
    precondition {
      condition     = var.smtp_user == "" || var.smtp_password != null
      error_message = "smtp_user is set but smtp_password is not (pass it via a var-file or TF_VAR_smtp_password)."
    }
    precondition {
      condition     = !local.create_test_users || alltrue([for p in local.test_passwords : p != null])
      error_message = "create_test_users needs all six test-user passwords (SEC-19: set them in local.tfvars)."
    }
  }
}

resource "keycloak_openid_client" "japan_trip_frontend" {
  realm_id  = keycloak_realm.japan_trip.id
  client_id = "japan-trip-frontend"
  name      = "Japan Trip Frontend"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  pkce_code_challenge_method   = "S256"
  direct_access_grants_enabled = false

  valid_redirect_uris             = local.redirect_uris
  valid_post_logout_redirect_uris = local.post_logout_uris
  # Explicit CORS origins for token/userinfo calls (never the plus or star shorthands).
  web_origins = local.all_origins
  # Login-page "Return" link (theme footer.ftl): the real app, never localhost in production.
  base_url = local.app_home_url

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
# The backend never calls the admin API (KC_ADMIN_CLIENT_* are unused in code);
# the client exists for local E2E fixtures. A confidential client holding
# manage-users is a standing account-takeover credential on an internet-facing
# Keycloak, so production does not create it unless asked (create_worker_client).
resource "keycloak_openid_client" "japan_trip_worker" {
  count = local.create_worker_client ? 1 : 0

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
  count = local.create_worker_client ? 1 : 0

  realm_id                = keycloak_realm.japan_trip.id
  service_account_user_id = keycloak_openid_client.japan_trip_worker[0].service_account_user_id
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
  value     = one(keycloak_openid_client.japan_trip_worker[*].client_secret)
  sensitive = true
}

# E2E-01: Pre-seeded test user for general auth + passkey tests
resource "keycloak_user" "e2e_test_user" {
  count = local.create_test_users ? 1 : 0

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
  count = local.create_test_users ? 1 : 0

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
  count = local.create_test_users ? 1 : 0

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
  count = local.create_test_users ? 1 : 0

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
  count = local.create_test_users ? 1 : 0

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

# INFRA-04: session-test@local — dedicated user for session-management.spec.ts (Phase 19)
# Uses required_actions = [] so loginViaKcForm sees password form directly (no webauthn prompt).
resource "keycloak_user" "session_test_user" {
  count = local.create_test_users ? 1 : 0

  realm_id         = keycloak_realm.japan_trip.id
  username         = "session-test@local"
  enabled          = true
  email            = "session-test@local"
  email_verified   = true
  first_name       = "Session"
  last_name        = "Test"
  required_actions = []

  initial_password {
    value     = var.e2e_session_password
    temporary = false
  }
}

# Test users became conditional (count) for the production profile; keep
# existing local state instead of destroying and re-creating them.
moved {
  from = keycloak_user.e2e_test_user
  to   = keycloak_user.e2e_test_user[0]
}

moved {
  from = keycloak_user.otp_test_user
  to   = keycloak_user.otp_test_user[0]
}

moved {
  from = keycloak_user.testuser
  to   = keycloak_user.testuser[0]
}

moved {
  from = keycloak_user.new_user_test
  to   = keycloak_user.new_user_test[0]
}

moved {
  from = keycloak_user.trip_edit_test_user
  to   = keycloak_user.trip_edit_test_user[0]
}

moved {
  from = keycloak_user.session_test_user
  to   = keycloak_user.session_test_user[0]
}

moved {
  from = keycloak_openid_client.japan_trip_worker
  to   = keycloak_openid_client.japan_trip_worker[0]
}

moved {
  from = keycloak_openid_client_service_account_role.worker_manage_users
  to   = keycloak_openid_client_service_account_role.worker_manage_users[0]
}
