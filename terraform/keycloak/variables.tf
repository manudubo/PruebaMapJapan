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
    error_message = "app_origins entries must be exact lower-case https origins without path or trailing slash, e.g. https://<user>.github.io."
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

# Self-service sign-up (REG-01/05). Default: on locally, OFF in production. Turning it
# on in production is an explicit opt-in that main.tf preconditions accept only with
# the abuse controls in place (TLS SMTP, brute-force lockouts at <= 10 failures, the
# recovery client, a >= 12 character password policy). The API refuses unverified
# e-mail addresses (backend) and scripts/purge-unverified.sh removes never-verified
# accounts. Keycloak has no sign-up rate limit of its own and stock Caddy has no rate
# limiter: see docs/SELF-HOSTING.md "Open sign-up" for the limits and what is missing.
variable "registration_allowed" {
  description = "Allow self-registration (default: true for local, false for production)"
  type        = bool
  default     = null
}

# REG-04: optional Google reCAPTCHA (v2 checkbox or v3) on the registration form.
# Both keys or neither; the secret only via TF_VAR_recaptcha_secret_key, never in git.
variable "recaptcha_site_key" {
  description = "reCAPTCHA site key for the registration form (empty = no captcha)"
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{0,100}$", var.recaptcha_site_key))
    error_message = "recaptcha_site_key must be empty or a reCAPTCHA site key (letters, digits, _ and -)."
  }
}

variable "recaptcha_secret_key" {
  description = "reCAPTCHA secret key (TF_VAR_recaptcha_secret_key)"
  type        = string
  sensitive   = true
  default     = null
}

variable "require_recaptcha" {
  description = "Fail the plan unless reCAPTCHA keys are provided (for an internet-facing sign-up)"
  type        = bool
  default     = false
}

# REG-06: confidential client travelmap-recovery (realm-management/manage-users only)
# used by the backend to set a password after an e-mail code. Default: true.
variable "create_recovery_client" {
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

# ---------------------------------------------------------------------------
# Sessions and "Remember me" (opt-in). Defaults are the previous behaviour: no
# checkbox, 30 minutes idle, 10 hours max. Longer sessions mean a stolen unlocked
# phone stays signed in longer; production refuses anything above 90 days (2160h).
# Recommended if you want the phone to stay signed in: remember_me = true,
# sso_session_idle_timeout_remember_me = "720h" (30 days),
# sso_session_max_lifespan_remember_me = "2160h" (90 days). Values are <n>s, <n>m or <n>h
# (no days), so 30 days is 720h. Cross-checks live in main.tf (realm preconditions).
# ---------------------------------------------------------------------------
variable "remember_me" {
  description = "Show the Remember me checkbox on the login page and use the remember-me lifetimes when it is ticked"
  type        = bool
  default     = false
}

variable "sso_session_idle_timeout" {
  description = "SSO session idle timeout (<n>s|m|h)"
  type        = string
  default     = "30m"

  validation {
    condition     = can(regex("^[1-9][0-9]{0,5}[smh]$", var.sso_session_idle_timeout))
    error_message = "sso_session_idle_timeout must look like 30m, 10h or 600s (no days: 30 days is 720h)."
  }
}

variable "sso_session_max_lifespan" {
  description = "SSO session max lifespan (<n>s|m|h)"
  type        = string
  default     = "10h"

  validation {
    condition     = can(regex("^[1-9][0-9]{0,5}[smh]$", var.sso_session_max_lifespan))
    error_message = "sso_session_max_lifespan must look like 10h or 600m (no days: 30 days is 720h)."
  }
}

variable "sso_session_idle_timeout_remember_me" {
  description = "Idle timeout when Remember me is ticked (null = not managed; required when remember_me = true)"
  type        = string
  default     = null

  validation {
    condition     = var.sso_session_idle_timeout_remember_me == null ? true : can(regex("^[1-9][0-9]{0,5}[smh]$", var.sso_session_idle_timeout_remember_me))
    error_message = "sso_session_idle_timeout_remember_me must look like 720h (no days: 30 days is 720h)."
  }
}

variable "sso_session_max_lifespan_remember_me" {
  description = "Max lifespan when Remember me is ticked (null = not managed; required when remember_me = true)"
  type        = string
  default     = null

  validation {
    condition     = var.sso_session_max_lifespan_remember_me == null ? true : can(regex("^[1-9][0-9]{0,5}[smh]$", var.sso_session_max_lifespan_remember_me))
    error_message = "sso_session_max_lifespan_remember_me must look like 2160h (no days: 90 days is 2160h)."
  }
}
