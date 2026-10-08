# Plan-time guards of terraform/keycloak (PROD-HARDENING #9, REG-05/06).
#
# Every misconfiguration below must fail `terraform plan` (precondition or variable
# validation); the valid profiles must plan. Runs offline against a mocked Keycloak
# provider, so no Keycloak and no credentials are needed:
#
#   terraform -chdir=terraform/keycloak init -lockfile=readonly
#   terraform -chdir=terraform/keycloak test
#
# (terraform test needs Terraform >= 1.7 for mock_provider; CI uses 1.9.8.)

mock_provider "keycloak" {}

# A complete, valid production configuration; each run changes one thing.
variables {
  profile                     = "production"
  kc_url                      = "http://127.0.0.1:28081/auth"
  kc_admin_pass               = "not-a-real-password"
  ssl_required                = "all"
  webauthn_rp_id              = "box.tail1234.ts.net"
  smtp_host                   = "smtp.gmail.com"
  smtp_port                   = 587
  smtp_starttls               = true
  smtp_user                   = "owner@gmail.com"
  smtp_password               = "not-a-real-app-password"
  kc_tls_insecure_skip_verify = false
}

run "production_registration_off_plans" {
  command = plan

  assert {
    condition     = keycloak_realm.japan_trip.registration_allowed == false
    error_message = "production must default to registration off"
  }
  assert {
    condition     = keycloak_realm.japan_trip.verify_email == false
    error_message = "e-mail is verified by the backend code, not by Keycloak's link"
  }
  assert {
    condition     = length(keycloak_openid_client.japan_trip_worker) == 0 && length(keycloak_openid_client.travelmap_recovery) == 1
    error_message = "production: no worker client, one travelmap-recovery client"
  }
  assert {
    condition     = keycloak_openid_client_service_account_role.recovery_manage_users[0].role == "manage-users"
    error_message = "travelmap-recovery holds manage-users only"
  }
  assert {
    condition     = length(keycloak_authentication_execution.registration_recaptcha) == 0
    error_message = "no captcha execution without keys"
  }
}

run "production_registration_on_with_guards_plans" {
  command = plan
  variables {
    registration_allowed = true
    recaptcha_site_key   = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
    recaptcha_secret_key = "not-a-real-secret"
    require_recaptcha    = true
  }

  assert {
    condition     = keycloak_realm.japan_trip.registration_allowed && keycloak_realm.japan_trip.registration_email_as_username
    error_message = "registration on, e-mail as username"
  }
  assert {
    condition     = length(keycloak_authentication_execution.registration_recaptcha) == 1
    error_message = "captcha execution expected with both keys"
  }
}

run "local_profile_plans" {
  command = plan
  variables {
    profile                      = "local"
    kc_url                       = "http://localhost:8080"
    ssl_required                 = "external"
    webauthn_rp_id               = "localhost"
    smtp_host                    = "mailpit"
    smtp_port                    = 1025
    smtp_starttls                = false
    smtp_user                    = ""
    e2e_test_password            = "x-Local-Test-1!"
    e2e_otp_password             = "x-Local-Test-1!"
    testuser_password            = "x-Local-Test-1!"
    new_user_test_password       = "x-Local-Test-1!"
    trip_edit_test_user_password = "x-Local-Test-1!"
    e2e_session_password         = "x-Local-Test-1!"
  }

  assert {
    condition     = keycloak_realm.japan_trip.registration_allowed
    error_message = "local defaults to registration on"
  }
}

# --- REG-05: open sign-up only with its abuse controls ---------------------------

run "registration_with_lax_brute_force_fails" {
  command = plan
  variables {
    registration_allowed           = true
    brute_force_max_login_failures = 20
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "registration_without_recovery_client_fails" {
  command = plan
  variables {
    registration_allowed   = true
    create_recovery_client = false
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "require_recaptcha_without_keys_fails" {
  command = plan
  variables {
    registration_allowed = true
    require_recaptcha    = true
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "recaptcha_site_key_without_secret_fails" {
  command = plan
  variables {
    recaptcha_site_key = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "recaptcha_site_key_with_garbage_fails" {
  command = plan
  variables {
    recaptcha_site_key = "<script>"
  }
  expect_failures = [var.recaptcha_site_key]
}

run "production_weak_password_policy_fails" {
  command = plan
  variables {
    password_policy = "length(8) and notUsername"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_policy_without_length_fails" {
  command = plan
  variables {
    password_policy = "notUsername and notEmail"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

# --- REG-06: no broader admin client than travelmap-recovery in production --------

run "production_worker_client_fails" {
  command = plan
  variables {
    create_worker_client = true
  }
  expect_failures = [keycloak_realm.japan_trip]
}

# --- The production guards that predate open sign-up (PROD-HARDENING #9) ---------

run "production_ssl_external_fails" {
  command = plan
  variables {
    ssl_required = "external"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_test_users_fail" {
  command = plan
  variables {
    create_test_users = true
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_rp_id_localhost_fails" {
  command = plan
  variables {
    webauthn_rp_id = "localhost"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_insecure_admin_tls_fails" {
  command = plan
  variables {
    kc_url                      = "https://kc.example.org"
    kc_tls_insecure_skip_verify = true
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_remote_http_admin_url_fails" {
  command = plan
  variables {
    kc_url = "http://kc.example.org/auth"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_mailpit_smtp_fails" {
  command = plan
  variables {
    smtp_host     = "mailpit"
    smtp_starttls = false
    smtp_user     = ""
    smtp_password = null
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "origin_with_trailing_slash_fails" {
  command = plan
  variables {
    app_origins = ["https://manudubo.github.io/"]
  }
  expect_failures = [var.app_origins]
}

run "http_origin_fails" {
  command = plan
  variables {
    app_origins = ["http://manudubo.github.io"]
  }
  expect_failures = [var.app_origins]
}

run "rp_id_with_scheme_fails" {
  command = plan
  variables {
    webauthn_rp_id = "https://box.tail1234.ts.net"
  }
  expect_failures = [var.webauthn_rp_id]
}

run "absurd_brute_force_threshold_fails" {
  command = plan
  variables {
    brute_force_max_login_failures = 1000
  }
  expect_failures = [var.brute_force_max_login_failures]
}

run "unknown_profile_fails" {
  command = plan
  variables {
    profile = "staging"
  }
  expect_failures = [var.profile]
}

run "local_without_test_passwords_fails" {
  command = plan
  variables {
    profile        = "local"
    kc_url         = "http://localhost:8080"
    ssl_required   = "external"
    webauthn_rp_id = "localhost"
  }
  expect_failures = [keycloak_realm.japan_trip]
}
