variable "kc_url" {
  type    = string
  default = "http://localhost:8080"
}

variable "kc_admin_user" {
  type    = string
  default = "admin"
}

variable "kc_admin_pass" {
  type      = string
  sensitive = true
}

# SEC-17: realm sslRequired. "external" lets private/loopback clients use plain HTTP
# (needed for local http://localhost:8080). Production should use "all", but only after
# Railway forwards X-Forwarded-Proto and Keycloak trusts it (KC_PROXY_HEADERS=xforwarded);
# otherwise Keycloak sees HTTP and rejects every login with "HTTPS required".
# See keycloak/README.md "TLS behind the Railway proxy" for the verification steps.
variable "ssl_required" {
  description = "Realm sslRequired: external (local) or all (production)"
  type        = string
  default     = "external"

  validation {
    condition     = contains(["external", "all"], var.ssl_required)
    error_message = "ssl_required must be \"external\" (local) or \"all\" (production); \"none\" is not allowed."
  }
}

# SEC-19: test-user passwords have no defaults. Set them in local.tfvars (gitignored,
# see local.tfvars.example) and apply with -var-file=local.tfvars; a missing value
# fails the plan instead of silently creating users with passwords published in git.
variable "e2e_test_password" {
  description = "Password for e2e-test@local Playwright test user"
  type        = string
  sensitive   = true
}

variable "e2e_otp_password" {
  description = "Password for otp-test@local Playwright test user"
  type        = string
  sensitive   = true
}

variable "testuser_password" {
  description = "Password for testuser Playwright test user"
  type        = string
  sensitive   = true
}

variable "new_user_test_password" {
  description = "Password for new_user_test Playwright test user"
  type        = string
  sensitive   = true
}

variable "trip_edit_test_user_password" {
  description = "Password for trip_edit_test_user Playwright test user"
  type        = string
  sensitive   = true
}

variable "e2e_session_password" {
  description = "Password for session-test@local Playwright test user"
  type        = string
  sensitive   = true
}
