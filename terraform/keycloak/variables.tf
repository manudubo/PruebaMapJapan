variable "kc_url" {
  description = "Keycloak base URL used by Terraform (admin API). Include the relative path in single-host mode, e.g. https://box.tailnet.ts.net/auth"
  type        = string
  default     = "http://localhost:8080"
}

variable "kc_admin_user" {
  type    = string
  default = "admin"
}

variable "kc_admin_pass" {
  type      = string
  sensitive = true
}

# Only for a local Keycloak with a self-signed certificate. Never in production:
# the admin password travels over this connection.
variable "kc_tls_insecure_skip_verify" {
  type    = bool
  default = false
}

# ---------------------------------------------------------------------------
# Profile: everything that differs between a laptop and the internet-facing
# instance hangs off this one switch, and production values are enforced by
# preconditions in main.tf (not just documented).
# ---------------------------------------------------------------------------
variable "profile" {
  description = "local (developer machine, test users, localhost redirects) or production (internet-facing)"
  type        = string
  default     = "local"

  validation {
    condition     = contains(["local", "production"], var.profile)
    error_message = "profile must be \"local\" or \"production\"."
  }
}

# SEC-17: realm sslRequired. "external" lets private/loopback clients use plain HTTP
# (needed for local http://localhost:8080). Production must be "all" (enforced), with
# the reverse proxy forwarding X-Forwarded-Proto and Keycloak trusting it
# (KC_PROXY_HEADERS=xforwarded); otherwise every login fails with "HTTPS required".
variable "ssl_required" {
  description = "Realm sslRequired: external (local) or all (production)"
  type        = string
  default     = "external"

  validation {
    condition     = contains(["external", "all"], var.ssl_required)
    error_message = "ssl_required must be \"external\" (local) or \"all\" (production); \"none\" is not allowed."
  }
}

# Browser origins of the SPA (exact origins, no path). Default: the Pages origin in
# config/deploy-defaults.json. Redirect URIs are built as <origin><app_base_path><page>.
variable "app_origins" {
  description = "Exact https origins serving the frontend (default: config/deploy-defaults.json pagesOrigin)"
  type        = list(string)
  default     = null

  validation {
    condition = var.app_origins == null ? true : alltrue([
      for o in var.app_origins : can(regex("^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$", o))
    ])
    error_message = "app_origins entries must be exact lower-case https origins without path or trailing slash, e.g. https://manudubo.github.io."
  }
}

variable "app_base_path" {
  description = "Path the SPA is served under (default: config/deploy-defaults.json appBasePath)"
  type        = string
  default     = null

  validation {
    condition     = var.app_base_path == null ? true : can(regex("^/([A-Za-z0-9._-]+/)*$", var.app_base_path))
    error_message = "app_base_path must start and end with / (e.g. /PruebaMapJapan/)."
  }
}

# Vite dev/preview origins; only used by the local profile.
variable "local_dev_origins" {
  type    = list(string)
  default = ["http://localhost:5173"]
}

# WebAuthn relying party id. Passkeys are bound to it FOREVER: changing it later
# invalidates every registered passkey. Set it to the registrable host that serves
# Keycloak (the hostname only — no scheme, port or path; in single-host mode the
# /auth path does not matter) BEFORE anyone registers a passkey in production.
variable "webauthn_rp_id" {
  description = "WebAuthn rpId: the Keycloak host name, e.g. box.tailnet.ts.net or auth.example.org (localhost for local)"
  type        = string
  default     = "localhost"

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$", var.webauthn_rp_id))
    error_message = "webauthn_rp_id must be a bare lower-case host name (no scheme, port, path or trailing dot)."
  }
}

# Public Keycloak URL as browsers see it (realm frontendUrl), e.g.
# https://box.tailnet.ts.net/auth or https://auth.example.org. Empty = let
# Keycloak derive it from KC_HOSTNAME (recommended when KC_HOSTNAME is set).
variable "frontend_url" {
  type    = string
  default = ""

  validation {
    condition     = var.frontend_url == "" || can(regex("^https://[a-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._-]+)*$", var.frontend_url))
    error_message = "frontend_url must be empty or an https URL without trailing slash."
  }
}

# Self-service sign-up. Default: on locally, OFF in production (an internet-facing
# personal app should not let strangers create accounts that can call the API).
variable "registration_allowed" {
  type    = bool
  default = null
}

# Keycloak password policy. Default per profile (see locals in main.tf).
variable "password_policy" {
  type    = string
  default = null
}

# Brute-force detection: temporary lockouts only (a permanent lockout lets anyone who
# knows a username lock its owner out from the internet). Default per profile.
variable "brute_force_max_login_failures" {
  type    = number
  default = null

  validation {
    condition     = var.brute_force_max_login_failures == null ? true : (var.brute_force_max_login_failures >= 3 && var.brute_force_max_login_failures <= 50)
    error_message = "brute_force_max_login_failures must be between 3 and 50."
  }
}

# Confidential "japan-trip-worker" client with manage-users (local E2E admin
# fixtures). Default: true locally, false in production.
variable "create_worker_client" {
  type    = bool
  default = null
}

# ---------------------------------------------------------------------------
# Realm SMTP (verification and reset-password emails). Gmail with an app
# password works without a domain: host smtp.gmail.com, port 587 + starttls
# (or 465 + ssl), user = from = the Gmail address. The password only ever
# comes from a var-file or TF_VAR_smtp_password, never from git.
# ---------------------------------------------------------------------------
variable "smtp_host" {
  type    = string
  default = "mailpit"
}

variable "smtp_port" {
  type    = number
  default = 1025
}

variable "smtp_from" {
  type    = string
  default = "noreply@japan-trip.local"
}

variable "smtp_from_display_name" {
  type    = string
  default = "Japan Trip"
}

variable "smtp_starttls" {
  type    = bool
  default = false
}

variable "smtp_ssl" {
  description = "Implicit TLS (port 465)"
  type        = bool
  default     = false
}

variable "smtp_user" {
  type    = string
  default = ""
}

variable "smtp_password" {
  type      = string
  sensitive = true
  default   = null
}

# ---------------------------------------------------------------------------
# Playwright test users (local profile only; production refuses to create them).
# SEC-19: no password defaults that could be published; null = not provided, and a
# precondition requires them whenever test users are created.
# ---------------------------------------------------------------------------
variable "create_test_users" {
  description = "Seed the Playwright test users (default: true for local, must be false for production)"
  type        = bool
  default     = null
}

variable "e2e_test_password" {
  description = "Password for e2e-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = null
}

variable "e2e_otp_password" {
  description = "Password for otp-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = null
}

variable "testuser_password" {
  description = "Password for testuser Playwright test user"
  type        = string
  sensitive   = true
  default     = null
}

variable "new_user_test_password" {
  description = "Password for new_user_test Playwright test user"
  type        = string
  sensitive   = true
  default     = null
}

variable "trip_edit_test_user_password" {
  description = "Password for trip_edit_test_user Playwright test user"
  type        = string
  sensitive   = true
  default     = null
}

variable "e2e_session_password" {
  description = "Password for session-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = null
}
