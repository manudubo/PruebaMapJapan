<#import "template.ftl" as layout>
<#import "password-commons.ftl" as passwordCommons>
<#--
  Passkey enrolment. Same contract as the base theme's page (hidden fields, #registerWebAuthn,
  registerByWebAuthn), with one difference: the passkey label is NOT asked from the user. It is
  generated from the device ("Chrome on Android (2026-10-08)", see js/passkey-label.js) and
  submitted in the hidden "authenticatorLabel" field Keycloak reads.
-->
<@layout.registrationLayout; section>
    <#if section = "title">
        title
    <#elseif section = "header">
        ${msg("webauthn-registration-title")}
    <#elseif section = "subtitle">
        ${msg("jpPasskeyRegisterSubtitle")}
    <#elseif section = "form">
        <div class="jp-passkey-hero" aria-hidden="true"><span class="${properties.kcWebAuthnKeyIcon!}"></span></div>

        <form id="register" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post"
              data-label-joiner="${msg("jpPasskeyLabelOn")}" data-label-fallback="${msg("jpPasskeyLabelFallback")}">
            <input type="hidden" id="clientDataJSON" name="clientDataJSON"/>
            <input type="hidden" id="attestationObject" name="attestationObject"/>
            <input type="hidden" id="publicKeyCredentialId" name="publicKeyCredentialId"/>
            <input type="hidden" id="authenticatorLabel" name="authenticatorLabel"/>
            <input type="hidden" id="transports" name="transports"/>
            <input type="hidden" id="error" name="error"/>
            <@passwordCommons.logoutOtherSessions/>
        </form>

        <script type="module">
            <#outputformat "JavaScript">
            import { registerByWebAuthn } from "${url.resourcesPath}/js/webauthnRegister.js";
            import { installDeviceLabel } from "${url.resourcesPath}/js/passkey-label.js?v=${properties.jpAssetVersion!}";
            const form = document.getElementById('register');
            installDeviceLabel({
                form,
                window,
                navigator,
                text: { joiner: form.dataset.labelJoiner, fallback: form.dataset.labelFallback }
            });
            const registerButton = document.getElementById('registerWebAuthn');
            registerButton.addEventListener("click", function() {
                const input = {
                    challenge : ${challenge?c},
                    userid : ${userid?c},
                    username : ${username?c},
                    signatureAlgorithms : [<#list signatureAlgorithms as sigAlg>${sigAlg?c},</#list>],
                    rpEntityName : ${rpEntityName?c},
                    rpId : ${rpId?c},
                    attestationConveyancePreference : ${attestationConveyancePreference?c},
                    authenticatorAttachment : ${authenticatorAttachment?c},
                    requireResidentKey : ${requireResidentKey?c},
                    userVerificationRequirement : ${userVerificationRequirement?c},
                    createTimeout : ${createTimeout?c},
                    excludeCredentialIds : ${excludeCredentialIds?c},
                    initLabel : ${msg("webauthn-registration-init-label")?c},
                    initLabelPrompt : ${msg("webauthn-registration-init-label-prompt")?c},
                    errmsg : ${msg("webauthn-unsupported-browser-text")?c}
                };
                registerByWebAuthn(input);
            }, { once: true });
            </#outputformat>
        </script>

        <input type="submit"
               class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
               id="registerWebAuthn" value="${msg("doRegisterSecurityKey")}"/>

        <#if !isSetRetry?has_content && isAppInitiatedAction?has_content>
            <form action="${url.loginAction}" class="${properties.kcFormClass!}" id="kc-webauthn-settings-form" method="post">
                <button type="submit"
                        class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}"
                        id="cancelWebAuthnAIA" name="cancel-aia" value="true">${msg("doCancel")}
                </button>
            </form>
        </#if>
    </#if>
</@layout.registrationLayout>
