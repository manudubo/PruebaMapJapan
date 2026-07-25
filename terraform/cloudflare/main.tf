resource "cloudflare_worker_secret" "resend_api_key" {
  account_id  = var.cf_account_id
  script_name = "prueba-map-japan-api"
  name        = "RESEND_API_KEY"
  secret_text = var.resend_api_key
}
