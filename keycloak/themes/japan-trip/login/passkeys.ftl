<#--
  Passkeys on the username page. Replaces the base theme's passkeys.ftl (same macro name,
  login-username.ftl imports it by that name), because the base macro ships an inline script
  that cannot be told "start by yourself" or "stay on the page when the user cancels".

  Passkeys are on for the realm (terraform: passwordless_passkeys_enabled), which makes
  Keycloak set `enableWebAuthnConditionalUI` and the challenge values below. js/passkey-first.js
  does the rest; this file only renders:
    - the hidden `webauth` form Keycloak's action reads (same ids as the base theme);
    - the values the script needs, as data attributes (no inline script, no secrets: the
      challenge is single-use and is also in the base theme's inline script);
    - the passkey panel (hidden until the script decides to show it) and the
      "Sign in with a passkey" button under the form.
  Without JavaScript or WebAuthn the page is the plain username form.
-->
<#macro conditionalUIData>
    <#if enableWebAuthnConditionalUI?has_content>
        <#-- A plain sign-in page: no message of any kind (error, expired session, ...). The script never starts a prompt on its own on any other page. -->
        <#assign jpPasskeyAuto = !(message?has_content) && !messagesPerField.existsError('username')>
        <div id="jp-passkey" hidden
             data-realm="${realm.name}"
             data-auto="${jpPasskeyAuto?c}"
             data-challenge="${challenge}"
             data-rp-id="${rpId}"
             data-user-verification="${userVerification}"
             data-timeout="${createTimeout?c}"
             data-text-waiting="${msg("jpPasskeyWaiting")}"
             data-text-signing-in="${msg("jpPasskeySigningIn")}"
             data-text-dismissed="${msg("jpPasskeyDismissed")}"
             data-text-failed="${msg("jpPasskeyFailed")}"
             data-text-unsupported="${msg("jpPasskeyUnsupported")}"></div>

        <form id="webauth" action="${url.loginAction}" method="post">
            <input type="hidden" id="clientDataJSON" name="clientDataJSON"/>
            <input type="hidden" id="authenticatorData" name="authenticatorData"/>
            <input type="hidden" id="signature" name="signature"/>
            <input type="hidden" id="credentialId" name="credentialId"/>
            <input type="hidden" id="userHandle" name="userHandle"/>
            <input type="hidden" id="error" name="error"/>
        </form>

        <div id="jp-passkey-alt" class="jp-passkey-alt" hidden>
            <button type="button" id="jp-passkey-button" class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!} ${properties.kcButtonBlockClass!}">${msg("jpPasskeyButton")}</button>
            <p id="jp-passkey-alt-status" class="jp-passkey-status" role="status" aria-live="polite"></p>
        </div>
    </#if>
</#macro>

<#-- The passkey-first panel, placed above the username form. Hidden: only the script shows it. -->
<#macro firstPanel>
    <#if enableWebAuthnConditionalUI?has_content>
        <div id="jp-passkey-first" class="jp-passkey-first" hidden aria-busy="false">
            <div class="jp-passkey-hero" aria-hidden="true"><span class="${properties.kcWebAuthnKeyIcon!}"></span></div>
            <p class="jp-passkey-lead">${msg("jpPasskeyLead")}</p>
            <p id="jp-passkey-status" class="jp-passkey-status" role="status" aria-live="polite"></p>
            <button type="button" id="jp-passkey-continue" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}">${msg("jpPasskeyContinue")}</button>
            <button type="button" id="jp-passkey-other" class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!} ${properties.kcButtonBlockClass!}">${msg("jpPasskeyOther")}</button>
        </div>
    </#if>
</#macro>
