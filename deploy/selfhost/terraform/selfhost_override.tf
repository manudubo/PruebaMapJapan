# Terraform override file (https://developer.hashicorp.com/terraform/language/files/override):
# merged over terraform/keycloak/*.tf by keycloak-apply.sh for production.
# Only the attributes below change; everything else (flows, mappers, brute
# force settings, ...) comes from terraform/keycloak unchanged.
#
# A nested block here (smtp_server, web_authn_*_policy) REPLACES the original
# block of that type entirely, so these blocks repeat every field. If
# terraform/keycloak/main.tf changes one of them, mirror the change here.

resource "keycloak_realm" "japan_trip" {
  # Plain HTTP is refused everywhere; the proxy forwards X-Forwarded-Proto=https.
  ssl_required = "all"

  web_authn_policy {
    relying_party_entity_name = "japan-trip"
    relying_party_id          = var.selfhost_passkey_rp_id
    signature_algorithms      = ["ES256"]
  }

  # Passkeys are bound to this host name. Changing it later (new machine or
  # tailnet name, new domain) invalidates every registered passkey.
  web_authn_passwordless_policy {
    relying_party_entity_name     = "japan-trip"
    relying_party_id              = var.selfhost_passkey_rp_id
    signature_algorithms          = ["ES256"]
    authenticator_attachment      = "platform"
    require_resident_key          = "Yes"
    user_verification_requirement = "required"
  }

  # Verification and password-reset emails.
  smtp_server {
    host              = var.selfhost_smtp_host
    port              = var.selfhost_smtp_port
    from              = var.selfhost_smtp_from
    from_display_name = var.selfhost_smtp_from_display_name
    ssl               = var.selfhost_smtp_ssl
    starttls          = var.selfhost_smtp_starttls

    auth {
      username = var.selfhost_smtp_user
      password = var.selfhost_smtp_password
    }
  }
}

resource "keycloak_openid_client" "japan_trip_frontend" {
  # Production pages only: no localhost redirect targets on a public server.
  valid_redirect_uris = [
    "${var.selfhost_frontend_origin}${var.selfhost_frontend_base_path}/*",
  ]
  valid_post_logout_redirect_uris = [
    "${var.selfhost_frontend_origin}${var.selfhost_frontend_base_path}/*",
  ]
  web_origins = [var.selfhost_frontend_origin]
}

# No test users with known passwords on an internet-facing server.
resource "keycloak_user" "e2e_test_user" {
  count = 0
}

resource "keycloak_user" "otp_test_user" {
  count = 0
}

resource "keycloak_user" "testuser" {
  count = 0
}

resource "keycloak_user" "new_user_test" {
  count = 0
}

resource "keycloak_user" "trip_edit_test_user" {
  count = 0
}

resource "keycloak_user" "session_test_user" {
  count = 0
}
