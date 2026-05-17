variable "cf_account_id" {
  type        = string
  description = "Cloudflare account ID (find in Cloudflare Dashboard → right sidebar)"
}

variable "cf_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token with Workers:Edit permission"
}

variable "resend_api_key" {
  type      = string
  sensitive = true
}

variable "kc_admin_client_secret" {
  type      = string
  sensitive = true
}
