terraform {
  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = ">= 5.7.0"
    }
  }
}

provider "keycloak" {
  client_id                = "admin-cli"
  username                 = var.kc_admin_user
  password                 = var.kc_admin_pass
  url                      = var.kc_url
  tls_insecure_skip_verify = true
}
