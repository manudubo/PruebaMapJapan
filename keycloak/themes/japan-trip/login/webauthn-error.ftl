<#import "template.ftl" as layout>
<#--
  Passkey error page (registration or sign-in). Same contract as the base theme's page
  ("Try again" posts isSetRetry=retry and the current execution; an app-initiated action also
  gets "Cancel"), with two differences:

  1. "Try again" is a real submit button, not an inline onclick handler.
  2. Keycloak's message is "Failed to register your Passkey. <what the browser or server said>",
     where the second half is raw English (a DOMException name, or "Device already exists with the
     same name"). The cases a person can act on get plain language, in the page's locale; any
     other message is printed as Keycloak wrote it. Either way the original sentence is kept in a
     collapsed "Details for support". Every Keycloak string printed goes through kcSanitize (SEC-11).

     name       the server already has a passkey with this label (js/passkey-label.js makes the
                label unique; if it still collides, "Try again" makes a new one)
     duplicate  the browser refused: this authenticator is already registered for the account
                (WebAuthn excludeCredentials, InvalidStateError)
     cancelled  the person dismissed the browser prompt, or it timed out (NotAllowedError)
-->
<#assign jpSummary = (message.summary)!''>
<#assign jpKind = 'generic'>
<#if jpSummary?contains('Device already exists with the same name')>
    <#assign jpKind = 'name'>
<#elseif jpSummary?contains('InvalidStateError')>
    <#assign jpKind = 'duplicate'>
<#elseif jpSummary?contains('NotAllowedError')>
    <#assign jpKind = 'cancelled'>
</#if>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        ${kcSanitize(msg("webauthn-error-title"))?no_esc}
    <#elseif section = "form">
        <div id="jp-passkey-error" data-error-kind="${jpKind}">
        <#if message?has_content>
            <div class="alert-${message.type} ${properties.kcAlertClass!} jp-alert--${message.type}" role="alert">
                <span class="${properties['kcFeedback' + message.type?cap_first + 'Icon']!}" aria-hidden="true"></span>
                <span class="${properties.kcAlertTitleClass!}" id="jp-passkey-error-text"><#if jpKind == 'name'>${msg("jpPasskeyErrName")}<#elseif jpKind == 'duplicate'>${msg("jpPasskeyErrDuplicate")}<#elseif jpKind == 'cancelled'>${msg("jpPasskeyErrCancelled")}<#else>${kcSanitize(jpSummary)?no_esc}</#if></span>
            </div>
        </#if>

        <form id="kc-error-credential-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
            <input type="hidden" id="executionValue" name="authenticationExecution" value="${execution}"/>
            <input type="hidden" id="isSetRetry" name="isSetRetry" value="retry"/>
            <button type="submit" id="kc-try-again" name="try-again" value="true"
                    class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">${kcSanitize(msg("doTryAgain"))?no_esc}</button>
        </form>

        <#if isAppInitiatedAction??>
            <form action="${url.loginAction}" class="${properties.kcFormClass!}" id="kc-webauthn-settings-form" method="post">
                <button type="submit"
                        class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                        id="cancelWebAuthnAIA" name="cancel-aia" value="true">${msg("doCancel")}
                </button>
            </form>
        </#if>

        <#if jpKind != 'generic' && jpSummary?has_content>
            <details id="jp-error-details" class="jp-details">
                <summary>${msg("jpErrDetails")}</summary>
                <p id="jp-error-original">${kcSanitize(jpSummary)?no_esc}</p>
            </details>
        </#if>
        </div>
    </#if>
</@layout.registrationLayout>
