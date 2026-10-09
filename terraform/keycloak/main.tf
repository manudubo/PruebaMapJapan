# The Pages origin and app path live in config/deploy-defaults.json, shared with the
# backend CORS default, so they are written down exactly once.
locals {
  # The realm name, written once. Data sources that read Keycloak's built-in objects
  # (client scopes profile/email, the realm-management client and its roles) take THIS
  # instead of keycloak_realm.japan_trip.id/.realm: any reference to a managed resource
  # makes Terraform defer the read to apply time whenever that resource has a pending
  # change (even an in-place one), which turns every id derived from the data source
  # into "known after apply" and plans a destroy/recreate of the protocol mappers and
  # the recovery service-account role. The price: the realm must already exist when
  # the plan reads them, so a FIRST run creates it on its own
  # (`terraform apply -target=keycloak_realm.japan_trip`, done by
  # deploy/selfhost/scripts/keycloak-apply.sh and scripts/ci/keycloak-flow.sh).
  realm_name = "japan-trip"

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
  redirect_pages = ["dashboard.html", "profile.html", "index.html", "silent-check-sso.html"]
  redirect_uris  = flatten([for o in local.all_origins : [for p in local.redirect_pages : "${o}${local.app_base_path}${p}"]])
  app_home_url   = "${local.production ? local.app_origins[0] : var.local_dev_origins[0]}${local.app_base_path}"
  # Loopback/dev hosts: never acceptable as a production client URL (the "Back to
  # application" link of Keycloak's pages comes from the client's base URL).
  loopback_re      = "^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0)([:/]|$)"
  post_logout_uris = flatten([for o in local.all_origins : ["${o}${local.app_base_path}index.html", "${o}/"]])

  # Session lifetimes in seconds (variables.tf only admits <n>s|m|h), for the checks below.
  unit_seconds = { s = 1, m = 60, h = 3600 }
  sso_idle_s   = tonumber(trimsuffix(trimsuffix(trimsuffix(var.sso_session_idle_timeout, "s"), "m"), "h")) * local.unit_seconds[substr(var.sso_session_idle_timeout, -1, 1)]
  sso_max_s    = tonumber(trimsuffix(trimsuffix(trimsuffix(var.sso_session_max_lifespan, "s"), "m"), "h")) * local.unit_seconds[substr(var.sso_session_max_lifespan, -1, 1)]
  rm_idle_s = var.sso_session_idle_timeout_remember_me == null ? 0 : (
    tonumber(trimsuffix(trimsuffix(trimsuffix(var.sso_session_idle_timeout_remember_me, "s"), "m"), "h")) * local.unit_seconds[substr(var.sso_session_idle_timeout_remember_me, -1, 1)]
  )
  rm_max_s = var.sso_session_max_lifespan_remember_me == null ? 0 : (
    tonumber(trimsuffix(trimsuffix(trimsuffix(var.sso_session_max_lifespan_remember_me, "s"), "m"), "h")) * local.unit_seconds[substr(var.sso_session_max_lifespan_remember_me, -1, 1)]
  )
  # A stolen unlocked phone stays signed in this long: production never exceeds 90 days.
  max_session_production_s = 90 * 24 * 3600

  create_test_users    = coalesce(var.create_test_users, !local.production)
  create_worker_client = coalesce(var.create_worker_client, !local.production)
  registration_allowed = coalesce(var.registration_allowed, !local.production)
  # REG-04: reCAPTCHA on the registration form only when both keys are provided.
  recaptcha_enabled = var.recaptcha_site_key != "" && var.recaptcha_secret_key != null
  # REG-06: the e-mail recovery client (backend "password campaign"). Default on.
  create_recovery_client = coalesce(var.create_recovery_client, true)
  # Minimum length in the effective password policy, 0 when the policy has none.
  password_min_length = try(tonumber(regex("length\\(([0-9]+)\\)", local.password_policy)[0]), 0)

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
  realm        = local.realm_name
  enabled      = true
  display_name = "Japan Trip"
  login_theme  = "japan-trip"

  registration_allowed           = local.registration_allowed
  registration_email_as_username = true
  login_with_email_allowed       = true
  duplicate_emails_allowed       = false
  reset_password_allowed         = true
  edit_username_allowed          = false
  # REG-02: e-mail ownership is proven by the BACKEND with a 6-digit code
  # (POST /api/auth/email-verify/*), not by Keycloak's link: the API answers
  # 403 email_not_verified until then. Keycloak's own VERIFY_EMAIL link flow is
  # therefore off (it would send a second, different email on every login).
  # Invited accounts (scripts/add-user.sh) are created with emailVerified=true.
  verify_email = false
  # Opt-in "Remember me" checkbox (login theme renders it when realm.rememberMe is true)
  # and longer sessions for it. Defaults keep it off: see variables.tf and the
  # trade-off in docs/SELF-HOSTING.md "Keeping people signed in".
  remember_me = var.remember_me

  ssl_required = var.ssl_required # SEC-17: "all" in production (enforced below)

  access_token_lifespan    = "5m"
  sso_session_idle_timeout = var.sso_session_idle_timeout
  sso_session_max_lifespan = var.sso_session_max_lifespan
  # null = not managed (Keycloak keeps 0 = "use the regular lifetimes above").
  sso_session_idle_timeout_remember_me = var.sso_session_idle_timeout_remember_me
  sso_session_max_lifespan_remember_me = var.sso_session_max_lifespan_remember_me
  offline_session_idle_timeout         = "720h"
  access_code_lifespan                 = "1m"
  access_code_lifespan_user_action     = "20m"
  access_code_lifespan_login           = "30m"

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
    # Passkeys on the username form: the browser may offer a discoverable passkey
    # before any username is typed (autofill, or the prompt the theme starts on a
    # device that has used a passkey here; docs/design/PASSKEY-FIRST-LOGIN.md).
    # Needs provider >= 5.8.0 and Keycloak >= 26.4.
    passwordless_passkeys_enabled = true
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
    # Session lifetimes / "Remember me" (opt-in; the defaults are the previous behaviour).
    precondition {
      condition     = local.sso_idle_s <= local.sso_max_s
      error_message = "sso_session_idle_timeout must not exceed sso_session_max_lifespan."
    }
    precondition {
      condition     = var.remember_me || (var.sso_session_idle_timeout_remember_me == null && var.sso_session_max_lifespan_remember_me == null)
      error_message = "sso_session_idle_timeout_remember_me / sso_session_max_lifespan_remember_me have no effect unless remember_me = true."
    }
    precondition {
      condition     = !var.remember_me || (var.sso_session_idle_timeout_remember_me != null && var.sso_session_max_lifespan_remember_me != null)
      error_message = "remember_me = true needs sso_session_idle_timeout_remember_me and sso_session_max_lifespan_remember_me (recommended: 720h and 2160h)."
    }
    precondition {
      condition     = !var.remember_me || (local.rm_idle_s <= local.rm_max_s && local.rm_idle_s >= local.sso_idle_s && local.rm_max_s >= local.sso_max_s)
      error_message = "Remember-me lifetimes must satisfy: regular idle <= remember-me idle <= remember-me max, and regular max <= remember-me max (remembering must not shorten the session)."
    }
    precondition {
      condition     = !local.production || (local.sso_max_s <= local.max_session_production_s && local.rm_max_s <= local.max_session_production_s)
      error_message = "profile=production: session lifetimes above 90 days (2160h) are refused: a stolen unlocked phone would stay signed in that long."
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
    precondition {
      condition     = !local.production || local.password_min_length >= 12
      error_message = "profile=production needs a password policy with length(12) or more."
    }
    # REG-06: the only admin-API client allowed in production is travelmap-recovery
    # (manage-users, used by the backend for e-mail recovery). The E2E worker client
    # is local only.
    precondition {
      condition     = !local.production || !local.create_worker_client
      error_message = "profile=production must not create the japan-trip-worker client (create_worker_client = false); the backend uses only travelmap-recovery."
    }
    # REG-05: open sign-up on an internet-facing realm only with its abuse controls.
    precondition {
      condition     = !(local.production && local.registration_allowed) || local.max_login_failures <= 10
      error_message = "registration_allowed in production needs brute-force protection at 10 failures or fewer (brute_force_max_login_failures)."
    }
    precondition {
      condition     = !(local.production && local.registration_allowed) || local.create_recovery_client
      error_message = "registration_allowed in production needs the travelmap-recovery client (users without WebAuthn get a password through it)."
    }
    precondition {
      condition     = !var.require_recaptcha || local.recaptcha_enabled
      error_message = "require_recaptcha = true needs recaptcha_site_key and recaptcha_secret_key (TF_VAR_recaptcha_secret_key)."
    }
    precondition {
      condition     = (var.recaptcha_site_key == "") == (var.recaptcha_secret_key == null)
      error_message = "Set both recaptcha_site_key and recaptcha_secret_key, or neither."
    }
  }
}

# REG-01: first and last name are optional (the registration form asks only for the
# e-mail address, which is also the username). Everything else is Keycloak 26's
# default user profile, written out because this resource replaces the whole profile.
resource "keycloak_realm_user_profile" "japan_trip" {
  realm_id = keycloak_realm.japan_trip.id

  attribute {
    name         = "username"
    display_name = "$${username}"
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator {
      name   = "length"
      config = { min = "3", max = "255" }
    }
    validator { name = "username-prohibited-characters" }
    validator { name = "up-username-not-idn-homograph" }
  }

  attribute {
    name               = "email"
    display_name       = "$${email}"
    required_for_roles = ["user"]
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator { name = "email" }
    validator {
      name   = "length"
      config = { max = "255" }
    }
  }

  attribute {
    name         = "firstName"
    display_name = "$${firstName}"
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator {
      name   = "length"
      config = { max = "255" }
    }
    validator { name = "person-name-prohibited-characters" }
  }

  attribute {
    name         = "lastName"
    display_name = "$${lastName}"
    permissions {
      view = ["admin", "user"]
      edit = ["admin", "user"]
    }
    validator {
      name   = "length"
      config = { max = "255" }
    }
    validator { name = "person-name-prohibited-characters" }
  }

  group {
    name                = "user-metadata"
    display_header      = "User metadata"
    display_description = "Attributes, which refer to user metadata"
  }
}

# REG-06: least-privilege client for the backend's e-mail recovery ("password
# campaign"): look a user up by e-mail, set a password, drop the pending passkey
# action and other credentials of an unverified (squatted) account. It holds exactly
# one role, realm-management/manage-users — Keycloak has no narrower built-in role that
# can reset a password. Its secret lives only in the backend .env
# (KC_RECOVERY_CLIENT_SECRET) and the backend reaches Keycloak on the internal URL;
# the public proxy blocks /auth/admin. Residual risk: whoever controls the backend can
# reset any password in this realm (docs/SELF-HOSTING.md, "Open sign-up").
resource "keycloak_openid_client" "travelmap_recovery" {
  count = local.create_recovery_client ? 1 : 0

  realm_id  = keycloak_realm.japan_trip.id
  client_id = "travelmap-recovery"
  name      = "TravelMap e-mail recovery (backend)"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  full_scope_allowed           = false
}

resource "keycloak_openid_client_service_account_role" "recovery_manage_users" {
  count = local.create_recovery_client ? 1 : 0

  realm_id                = keycloak_realm.japan_trip.id
  service_account_user_id = keycloak_openid_client.travelmap_recovery[0].service_account_user_id
  client_id               = data.keycloak_openid_client.realm_management.id
  role                    = "manage-users"
}

# full_scope_allowed = false means the token only carries roles listed in the client's
# scope (Scope tab). Without this mapping the service-account token has NO roles and
# every Admin API call answers 403 (found by the integration run: recovery/confirm 503).
data "keycloak_role" "realm_management_manage_users" {
  count = local.create_recovery_client ? 1 : 0

  realm_id  = local.realm_name # not keycloak_realm.japan_trip.*: see local.realm_name
  client_id = data.keycloak_openid_client.realm_management.id
  name      = "manage-users"
}

resource "keycloak_generic_role_mapper" "recovery_scope_manage_users" {
  count = local.create_recovery_client ? 1 : 0

  realm_id  = keycloak_realm.japan_trip.id
  client_id = keycloak_openid_client.travelmap_recovery[0].id
  role_id   = data.keycloak_role.realm_management_manage_users[0].id
}

output "recovery_client_secret" {
  value     = one(keycloak_openid_client.travelmap_recovery[*].client_secret)
  sensitive = true
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
  # Login-page "Return" link (theme footer.ftl) and the "Back to application" link of
  # Keycloak's error pages (e.g. "Registration not allowed"). Production derives both
  # from config/deploy-defaults.json (or app_origins/app_base_path), never localhost.
  root_url = local.app_home_url
  base_url = local.app_home_url

  full_scope_allowed = true

  lifecycle {
    precondition {
      condition     = !local.production || (!can(regex(local.loopback_re, local.app_home_url)) && !anytrue([for o in local.all_origins : can(regex(local.loopback_re, o))]))
      error_message = "profile=production: the japan-trip-frontend root/base URL, redirect URIs and web origins must not be localhost (got ${local.app_home_url}). Set app_origins or fix config/deploy-defaults.json pagesOrigin."
    }
  }
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
  realm_id  = local.realm_name # not keycloak_realm.japan_trip.*: see local.realm_name
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

# REG-02: VERIFY_EMAIL stays available (an admin can still send the link) but is no
# longer a default action: new accounts verify their address with the backend's
# 6-digit code instead (see verify_email on the realm).
resource "keycloak_required_action" "verify_email" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "VERIFY_EMAIL"
  enabled        = true
  default_action = false
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
  # No default required actions (webauthn-register-passwordless) for seeded users.
  required_actions = []

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
  # No default required actions (webauthn-register-passwordless) for seeded users.
  required_actions = []

  initial_password {
    value     = var.e2e_otp_password
    temporary = false
  }
}

# INFRA-01: testuser for trip-edit-integration.spec.ts (Test1234! matches hardcoded spec credential)
resource "keycloak_user" "testuser" {
  count = local.create_test_users ? 1 : 0

  realm_id         = keycloak_realm.japan_trip.id
  username         = "testuser@local" # = email: registration_email_as_username
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
  username         = "new_user_test@local" # = email: registration_email_as_username
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
  username         = "trip_edit_test_user@local" # = email: registration_email_as_username
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
