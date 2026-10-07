# Production settings for a self-hosted Keycloak. keycloak-apply.sh copies
# this file and selfhost_override.tf next to terraform/keycloak/*.tf in a
# private work directory (deploy/selfhost/state/terraform) and fills the
# values from .env. terraform/keycloak itself is not modified: local
# development keeps its localhost settings and test users.

variable "selfhost_frontend_origin" {
  description = "Origin of the GitHub Pages frontend, e.g. https://manudubo.github.io"
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+(:[0-9]+)?$", var.selfhost_frontend_origin))
    error_message = "selfhost_frontend_origin must be https://host (no path, no trailing slash)."
  }
}

variable "selfhost_frontend_base_path" {
  description = "Path of the app under the origin, e.g. /PruebaMapJapan"
  type        = string
  default     = "/PruebaMapJapan"
}

variable "selfhost_passkey_rp_id" {
  description = "WebAuthn relying party ID: the host name of the Keycloak login page"
  type        = string
}

variable "selfhost_smtp_host" {
  type = string
}

variable "selfhost_smtp_port" {
  type    = string
  default = "587"
}

variable "selfhost_smtp_from" {
  description = "Bare sender address, e.g. login@example.com"
  type        = string
}

variable "selfhost_smtp_from_display_name" {
  type    = string
  default = "TravelMap"
}

variable "selfhost_smtp_user" {
  type = string
}

variable "selfhost_smtp_password" {
  type      = string
  sensitive = true
}

variable "selfhost_smtp_ssl" {
  description = "true for implicit TLS (port 465)"
  type        = bool
  default     = false
}

variable "selfhost_smtp_starttls" {
  description = "true for STARTTLS (port 587)"
  type        = bool
  default     = true
}
