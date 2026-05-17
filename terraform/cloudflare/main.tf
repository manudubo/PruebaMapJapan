resource "cloudflare_worker_secret" "resend_api_key" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "RESEND_API_KEY"
  secret_text = var.resend_api_key
}

resource "cloudflare_worker_secret" "kc_admin_client_secret" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "KC_ADMIN_CLIENT_SECRET"
  secret_text = var.kc_admin_client_secret
}
