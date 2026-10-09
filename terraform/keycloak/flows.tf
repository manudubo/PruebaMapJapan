# Browser flow: username first, then exactly one credential the user HAS.
#
#   browser-passkey (top level, basic-flow)
#   ├── auth-cookie                                ALTERNATIVE  (existing SSO session)
#   └── passkey-forms                              ALTERNATIVE  (basic-flow)
#       ├── auth-username-form                     REQUIRED     (identifies the user only)
#       └── passkey-or-password                    REQUIRED     (basic-flow — the credential step)
#           ├── passkey-done                       ALTERNATIVE  (basic-flow; priority 5)
#           │   └── passkey-done-if-used           CONDITIONAL  (basic-flow)
#           │       ├── conditional-credential               REQUIRED (condition: webauthn-passwordless used)
#           │       └── allow-access-authenticator           REQUIRED
#           ├── passkey                            ALTERNATIVE  (basic-flow)
#           │   └── passkey-if-configured          CONDITIONAL  (basic-flow)
#           │       ├── webauthn-authenticator-passwordless  REQUIRED
#           │       └── conditional-user-configured          REQUIRED (condition)
#           └── password                           ALTERNATIVE  (basic-flow)
#               └── password-if-configured         CONDITIONAL  (basic-flow)
#                   ├── auth-password-form                   REQUIRED
#                   └── conditional-user-configured          REQUIRED (condition)
#
# KC-01 / SEC-12: the pre-Phase-26 layout mixed REQUIRED auth-username-form with an
# ALTERNATIVE webauthn execution at the same level. Keycloak's DefaultAuthenticationFlow
# drops every ALTERNATIVE when a REQUIRED sibling exists ("REQUIRED and ALTERNATIVE
# elements at same level! Those alternative executions will be ignored"), so the old
# passkey-forms subflow reduced to "username form only" and issued an authorization
# code for ANY existing username with no credential at all (reproduced on KC 26.6.1).
#
# REG-03: each credential branch is conditional on the user HAVING that credential,
# verified on Keycloak 26.6.1 (tests/e2e/idp-flow.spec.ts, virtual authenticator on/off):
#   - passkey only        → WebAuthn step, never a password form. On a device without
#                           WebAuthn the theme (footer.ftl) promotes the link to the app's
#                           e-mail recovery page, which sets a password via the backend.
#   - password only       → password form, no "Try another way".
#   - passkey + password  → the user's PREFERRED credential first (Keycloak's credential
#                           priority: the one enrolled first — the passkey for accounts made
#                           by the registration flow), the other under "Try another way".
#                           A browser without WebAuthn uses "Try another way" → password.
#   - neither             → both branches are empty, the credential step fails.
#
# Invariants of this layout (keep them when editing; tests/e2e/idp-config.spec.ts checks
# them statically):
#   1. No level mixes REQUIRED/CONDITIONAL with ALTERNATIVE siblings (conditions such as
#      conditional-user-configured are excluded from that check by Keycloak).
#   2. The credential step is a single REQUIRED subflow, so passkey-forms can only
#      succeed after one of its ALTERNATIVE credentials succeeds.
#   3. Every credential authenticator is REQUIRED only inside a CONDITIONAL subflow guarded
#      by conditional-user-configured. A REQUIRED authenticator the user has not configured
#      is otherwise marked SETUP_REQUIRED and counted as passed (Keycloak queues the
#      register-passkey / update-password required action instead) — i.e. an attacker
#      knowing a username could enrol their own credential.
#   4. The authenticator is the FIRST execution of its conditional subflow (condition
#      second). Keycloak's AuthenticationSelectionResolver only looks at the sibling
#      branches — and so offers "Try another way" — when the current execution is the
#      first of its subflow; with the condition first, passkey users had no fallback.
#   5. A user with neither a passkey nor a password fails the flow (both ALTERNATIVEs are
#      empty) — see tests/e2e/idp-flow.spec.ts for the negative checks.
#   6. PASSKEY-FIRST: with passkeys on for the realm, a passkey can sign the user in on the
#      username page itself (no username typed). The username form then knows the user, and
#      `passkey-done` closes the credential step so the passkey is not asked for twice. It is
#      an extra ALTERNATIVE and never a CONDITIONAL requirement on the credential step (a
#      CONDITIONAL subflow without a condition is skipped: fail-open), its condition comes
#      before allow-access (selection resolver, see the resources below), and
#      allow-access-authenticator is used nowhere else. docs/design/PASSKEY-FIRST-LOGIN.md.

resource "keycloak_authentication_flow" "browser_passkey" {
  realm_id    = keycloak_realm.japan_trip.id
  alias       = "browser-passkey"
  description = "Browser flow: username, then passkey or password (KC-01)"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_execution" "cookie" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  authenticator     = "auth-cookie"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

resource "keycloak_authentication_subflow" "passkey_forms" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-forms"
  description       = "Username, then one credential (passkey or password)"
  parent_flow_alias = keycloak_authentication_flow.browser_passkey.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 20
}

resource "keycloak_authentication_execution" "username_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  authenticator     = "auth-username-form"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_subflow" "credential" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-or-password"
  description       = "Credential step: exactly one of passkey or password must succeed"
  parent_flow_alias = keycloak_authentication_subflow.passkey_forms.alias
  provider_id       = "basic-flow"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.username_form]
}

resource "keycloak_authentication_subflow" "passkey" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey"
  description       = "Passkey branch — empty (fails) for users without a registered passkey"
  parent_flow_alias = keycloak_authentication_subflow.credential.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 10
}

resource "keycloak_authentication_subflow" "passkey_if_configured" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-if-configured"
  description       = "Runs WebAuthn passwordless only when the user already has a passkey"
  parent_flow_alias = keycloak_authentication_subflow.passkey.alias
  provider_id       = "basic-flow"
  requirement       = "CONDITIONAL"
  priority          = 10
}

# The credential authenticator comes FIRST in its conditional subflow and the condition
# second (Keycloak evaluates every condition of a conditional subflow before running it,
# whatever its position). The order matters for "Try another way": Keycloak's
# AuthenticationSelectionResolver only climbs to the parent flows (and so lists the
# other branch) when the current execution is the first one of its subflow.
resource "keycloak_authentication_execution" "webauthn_passwordless" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_if_configured.alias
  authenticator     = "webauthn-authenticator-passwordless"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution" "passkey_condition" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_if_configured.alias
  authenticator     = "conditional-user-configured"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.webauthn_passwordless]
}

resource "keycloak_authentication_subflow" "password" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "password"
  description       = "Password branch — empty (fails) for users without a password"
  parent_flow_alias = keycloak_authentication_subflow.credential.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 20

  depends_on = [keycloak_authentication_subflow.passkey]
}

resource "keycloak_authentication_subflow" "password_if_configured" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "password-if-configured"
  description       = "Runs the password form only when the user has a password"
  parent_flow_alias = keycloak_authentication_subflow.password.alias
  provider_id       = "basic-flow"
  requirement       = "CONDITIONAL"
  priority          = 10
}

resource "keycloak_authentication_execution" "password_form" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.password_if_configured.alias
  authenticator     = "auth-password-form"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution" "password_condition" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.password_if_configured.alias
  authenticator     = "conditional-user-configured"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.password_form]
}

# PASSKEY-FIRST (docs/design/PASSKEY-FIRST-LOGIN.md): a passkey can sign the user in from
# the username page itself, before any username is typed (realm passkeys, main.tf). The
# username form then identifies the user from the assertion's user handle, and the
# credential step would ask for the passkey a second time (two Face ID prompts). This
# third ALTERNATIVE branch closes the credential step when - and only when - a passkey
# assertion (webauthn-passwordless, user verification required by the realm policy) was
# already validated in this authentication session.
#
# Same shape as `passkey` / `password` above: an ALTERNATIVE subflow whose only child is
# a CONDITIONAL subflow. When the condition is false the subflow is skipped, the branch
# counts as empty and fails, and Keycloak tries the next branch. allow-access-authenticator
# lives nowhere else in these flows (tests/e2e/idp-config.spec.ts pins that).
#
# It is deliberately an additional branch and not a CONDITIONAL requirement on the
# credential subflow: Keycloak skips a CONDITIONAL subflow that has no condition yet, so
# flipping `passkey-or-password` to CONDITIONAL would let a bare username through for the
# moment between two API calls of an upgrade (reproduced on 26.6.1). A new branch is
# fail-closed at every step of an apply.
resource "keycloak_authentication_subflow" "passkey_done" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-done"
  description       = "Credential step already satisfied: a passkey was used on the username page"
  parent_flow_alias = keycloak_authentication_subflow.credential.alias
  provider_id       = "basic-flow"
  requirement       = "ALTERNATIVE"
  priority          = 5

  depends_on = [keycloak_authentication_subflow.password]
}

resource "keycloak_authentication_subflow" "passkey_done_if_used" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "passkey-done-if-used"
  description       = "Allows the credential step only when a passkey has been validated in this session"
  parent_flow_alias = keycloak_authentication_subflow.passkey_done.alias
  provider_id       = "basic-flow"
  requirement       = "CONDITIONAL"
  priority          = 10
}

# Condition first, allow-access second: the reverse of the credential branches above, on
# purpose. When allow-access is the FIRST execution of its subflow, Keycloak's
# AuthenticationSelectionResolver climbs to the sibling branches and swaps it for the
# user's preferred credential (the WebAuthn authenticator), which asks for the passkey
# again - exactly what this branch exists to prevent (reproduced on 26.6.1).
resource "keycloak_authentication_execution" "passkey_done_condition" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_done_if_used.alias
  authenticator     = "conditional-credential"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution" "passkey_done_allow" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.passkey_done_if_used.alias
  authenticator     = "allow-access-authenticator"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.passkey_done_condition]
}

resource "keycloak_authentication_execution_config" "passkey_done_condition" {
  realm_id     = keycloak_realm.japan_trip.id
  execution_id = keycloak_authentication_execution.passkey_done_condition.id
  alias        = "passkey-used"
  config = {
    credentials = "webauthn-passwordless"
    included    = "true"
  }
}

# SEC-13 / ARCH-08: Terraform is the single source of truth for which flow the realm
# uses. Bound here (not via keycloak_realm.browser_flow) so a fresh `terraform apply`
# creates the flow before binding it — setting browser_flow on the realm resource made
# the realm POST fail with a 500 (flow does not exist yet) on an empty Keycloak.
resource "keycloak_authentication_bindings" "browser_flow" {
  realm_id          = keycloak_realm.japan_trip.id
  browser_flow      = keycloak_authentication_flow.browser_passkey.alias
  registration_flow = keycloak_authentication_flow.registration_passkey.alias

  depends_on = [
    keycloak_authentication_execution.cookie,
    keycloak_authentication_execution.username_form,
    keycloak_authentication_execution.webauthn_passwordless,
    keycloak_authentication_execution.password_form,
    keycloak_authentication_execution_config.passkey_done_condition,
    keycloak_authentication_execution.registration_user_creation,
    keycloak_authentication_execution_config.registration_recaptcha,
  ]
}

# ---------------------------------------------------------------------------
# REG-01: self-registration, passkey first, no password at sign-up.
#
#   registration-passkey (basic-flow)                 bound as the realm registration flow
#   └── registration-passkey-form (form-flow, registration-page-form)  REQUIRED
#       ├── registration-user-creation       REQUIRED  (email = username, names optional)
#       └── registration-recaptcha-action    REQUIRED  only when recaptcha_site_key is set
#
# There is deliberately no registration-password-action: the form asks for no password.
# The account is created when the form is posted, and the default required action
# webauthn-register-passwordless (below) makes the user enrol a passkey in the same
# browser session before any authorization code is issued. A device without WebAuthn
# cannot finish that step; the theme then links to the app's e-mail recovery page,
# where the backend proves the address with a 6-digit code and sets a password (and
# drops the pending passkey action) through the dedicated travelmap-recovery client.
#
# Until one of those two credentials exists the account cannot sign in (both
# credential branches of browser-passkey are empty for it), and it is never
# e-mail-verified, so scripts/purge-unverified.sh removes it after the purge window.
# ---------------------------------------------------------------------------
resource "keycloak_authentication_flow" "registration_passkey" {
  realm_id    = keycloak_realm.japan_trip.id
  alias       = "registration-passkey"
  description = "Self-registration without a password; a passkey is enrolled right after (REG-01)"
  provider_id = "basic-flow"
}

resource "keycloak_authentication_subflow" "registration_form" {
  realm_id          = keycloak_realm.japan_trip.id
  alias             = "registration-passkey-form"
  description       = "Registration form: profile fields only (no password)"
  parent_flow_alias = keycloak_authentication_flow.registration_passkey.alias
  provider_id       = "form-flow"
  authenticator     = "registration-page-form"
  requirement       = "REQUIRED"
  priority          = 10
}

resource "keycloak_authentication_execution" "registration_user_creation" {
  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.registration_form.alias
  authenticator     = "registration-user-creation"
  requirement       = "REQUIRED"
  priority          = 10
}

# REG-04 (optional): Google reCAPTCHA on the registration form. Off unless both keys
# are provided (TF_VAR_recaptcha_site_key / TF_VAR_recaptcha_secret_key).
resource "keycloak_authentication_execution" "registration_recaptcha" {
  count = local.recaptcha_enabled ? 1 : 0

  realm_id          = keycloak_realm.japan_trip.id
  parent_flow_alias = keycloak_authentication_subflow.registration_form.alias
  authenticator     = "registration-recaptcha-action"
  requirement       = "REQUIRED"
  priority          = 20

  depends_on = [keycloak_authentication_execution.registration_user_creation]
}

resource "keycloak_authentication_execution_config" "registration_recaptcha" {
  count = local.recaptcha_enabled ? 1 : 0

  realm_id     = keycloak_realm.japan_trip.id
  execution_id = keycloak_authentication_execution.registration_recaptcha[0].id
  alias        = "registration-recaptcha"
  config = {
    "site.key"        = var.recaptcha_site_key
    "secret.key"      = var.recaptcha_secret_key
    "action"          = "register"
    "useRecaptchaNet" = "false"
  }
}

# Every account created by the registration form must enrol a passkey before its first
# sign-in completes. Accounts made by scripts/add-user.sh have their required actions
# cleared (the invite link sets a password instead), and the Terraform test users set
# required_actions = [].
resource "keycloak_required_action" "webauthn_register_passwordless" {
  realm_id       = keycloak_realm.japan_trip.realm
  alias          = "webauthn-register-passwordless"
  enabled        = true
  default_action = true
  name           = "Webauthn Register Passwordless"

  # On an empty Keycloak, users created after this action became a default get it
  # although they ask for required_actions = [] (Keycloak adds default actions on
  # create; only a second apply removed it, and the seeded E2E users could not sign
  # in until then). Creating the seeded users first keeps a fresh apply converged.
  depends_on = [
    keycloak_user.e2e_test_user,
    keycloak_user.otp_test_user,
    keycloak_user.testuser,
    keycloak_user.new_user_test,
    keycloak_user.trip_edit_test_user,
    keycloak_user.session_test_user,
  ]
}
