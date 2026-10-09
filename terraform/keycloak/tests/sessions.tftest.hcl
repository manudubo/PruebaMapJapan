# Session lifetimes and the opt-in "Remember me" (variables.tf, realm preconditions in
# main.tf). Defaults must stay exactly the previous behaviour; the opt-in changes only
# the realm attributes; inconsistent or too-long values fail the plan.
#
#   terraform -chdir=terraform/keycloak test -filter=tests/sessions.tftest.hcl

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

run "defaults_are_unchanged" {
  command = plan

  assert {
    condition = alltrue([
      keycloak_realm.japan_trip.remember_me == false,
      keycloak_realm.japan_trip.sso_session_idle_timeout == "30m",
      keycloak_realm.japan_trip.sso_session_max_lifespan == "10h",
    ])
    error_message = "defaults must keep remember_me off, 30m idle, 10h max"
  }
  assert {
    # (Optional+computed attributes read back as "known after apply" when unset, so the
    # inputs are what can be asserted.)
    condition     = var.sso_session_idle_timeout_remember_me == null && var.sso_session_max_lifespan_remember_me == null
    error_message = "remember-me lifetimes are not managed unless asked for"
  }
}

run "recommended_opt_in_changes_the_realm" {
  command = plan
  variables {
    remember_me                          = true
    sso_session_idle_timeout_remember_me = "720h"
    sso_session_max_lifespan_remember_me = "2160h"
  }

  assert {
    condition = alltrue([
      keycloak_realm.japan_trip.remember_me == true,
      keycloak_realm.japan_trip.sso_session_idle_timeout_remember_me == "720h",
      keycloak_realm.japan_trip.sso_session_max_lifespan_remember_me == "2160h",
      keycloak_realm.japan_trip.sso_session_idle_timeout == "30m",
      keycloak_realm.japan_trip.sso_session_max_lifespan == "10h",
    ])
    error_message = "opt-in sets remember_me and its two lifetimes and leaves the regular ones"
  }
}

run "longer_regular_sessions_plan" {
  command = plan
  variables {
    sso_session_idle_timeout = "8h"
    sso_session_max_lifespan = "48h"
  }
  assert {
    condition     = keycloak_realm.japan_trip.sso_session_idle_timeout == "8h" && keycloak_realm.japan_trip.sso_session_max_lifespan == "48h"
    error_message = "regular lifetimes are configurable"
  }
}

run "idle_above_max_fails" {
  command = plan
  variables {
    sso_session_idle_timeout = "11h"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "remember_me_without_lifetimes_fails" {
  command = plan
  variables {
    remember_me = true
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "remember_me_lifetimes_without_remember_me_fail" {
  command = plan
  variables {
    sso_session_max_lifespan_remember_me = "720h"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "remember_me_idle_above_max_fails" {
  command = plan
  variables {
    remember_me                          = true
    sso_session_idle_timeout_remember_me = "800h"
    sso_session_max_lifespan_remember_me = "720h"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "remember_me_shorter_than_regular_fails" {
  command = plan
  variables {
    remember_me                          = true
    sso_session_idle_timeout_remember_me = "10m"
    sso_session_max_lifespan_remember_me = "5h"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_remember_me_above_90_days_fails" {
  command = plan
  variables {
    remember_me                          = true
    sso_session_idle_timeout_remember_me = "720h"
    sso_session_max_lifespan_remember_me = "2161h"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "production_regular_max_above_90_days_fails" {
  command = plan
  variables {
    sso_session_max_lifespan = "2161h"
  }
  expect_failures = [keycloak_realm.japan_trip]
}

run "local_profile_allows_a_year_for_experiments" {
  command = plan
  variables {
    profile                              = "local"
    kc_url                               = "http://localhost:8080"
    ssl_required                         = "external"
    webauthn_rp_id                       = "localhost"
    smtp_host                            = "mailpit"
    smtp_starttls                        = false
    smtp_user                            = ""
    e2e_test_password                    = "x"
    e2e_otp_password                     = "x"
    testuser_password                    = "x"
    new_user_test_password               = "x"
    trip_edit_test_user_password         = "x"
    e2e_session_password                 = "x"
    remember_me                          = true
    sso_session_idle_timeout_remember_me = "720h"
    sso_session_max_lifespan_remember_me = "8760h"
  }
  assert {
    condition     = keycloak_realm.japan_trip.sso_session_max_lifespan_remember_me == "8760h"
    error_message = "the 90-day cap is a production guard"
  }
}

run "days_unit_is_rejected" {
  command = plan
  variables {
    sso_session_idle_timeout_remember_me = "30d"
  }
  expect_failures = [var.sso_session_idle_timeout_remember_me]
}

run "zero_is_rejected" {
  command = plan
  variables {
    sso_session_idle_timeout = "0m"
  }
  expect_failures = [var.sso_session_idle_timeout]
}
