<#import "template.ftl" as layout>
<#import "passkeys.ftl" as passkeys>
<#-- Username-first step of the browser flow (flows.tf): e-mail here, then passkey or password. -->
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username') displayInfo=(realm.password && realm.registrationAllowed && !registrationDisabled??); section>
    <#if section = "header">
        ${msg("jpSignInTitle")}
    <#elseif section = "subtitle">
        ${msg("jpSignInSubtitle")}
    <#elseif section = "form">
        <@passkeys.firstPanel />
        <div id="kc-form">
            <div id="kc-form-wrapper">
                <#if realm.password>
                    <form id="kc-form-login" class="${properties.kcFormClass!}" data-jp-once action="${url.loginAction}" method="post">
                        <#if !usernameHidden??>
                            <div class="${properties.kcFormGroupClass!}">
                                <label for="username" class="${properties.kcLabelClass!}"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                                <input id="username" class="${properties.kcInputClass!}" name="username"
                                       value="${(login.username!'')}" type="text" autofocus dir="ltr"
                                       autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}"
                                       autocapitalize="none" spellcheck="false"<#if realm.loginWithEmailAllowed> inputmode="email"</#if>
                                       aria-invalid="<#if messagesPerField.existsError('username')>true<#else>false</#if>"
                                       <#if messagesPerField.existsError('username')>aria-describedby="input-error-username"</#if>/>
                                <#if messagesPerField.existsError('username')>
                                    <span id="input-error-username" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.get('username'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                        </#if>

                        <#if realm.rememberMe && !usernameHidden??>
                            <div class="${properties.kcFormGroupClass!}">
                                <label class="${properties.kcCheckLabelClass!}" for="rememberMe">
                                    <input id="rememberMe" name="rememberMe" type="checkbox" class="${properties.kcCheckInputClass!}"<#if login.rememberMe??> checked</#if>>
                                    <span>${msg("rememberMe")}</span>
                                </label>
                            </div>
                        </#if>

                        <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                            <button class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" name="login" id="kc-login" type="submit">${msg("doLogIn")}</button>
                        </div>
                    </form>
                </#if>
            </div>
        </div>
        <@passkeys.conditionalUIData />
    <#elseif section = "info">
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <p id="kc-registration">${msg("noAccount")} <a href="${url.registrationUrl}">${msg("doRegister")}</a></p>
        </#if>
    <#elseif section = "socialProviders">
        <#if realm.password && social?? && social.providers?has_content>
            <div id="kc-social-providers" class="${properties.kcFormSocialAccountSectionClass!}">
                <h2 class="jp-social__title">${msg("identity-provider-login-label")}</h2>
                <ul class="${properties.kcFormSocialAccountListClass!}">
                    <#list social.providers as p>
                        <li><a data-once-link data-disabled-class="${properties.kcFormSocialAccountListButtonDisabledClass!}" id="social-${p.alias}"
                               class="${properties.kcFormSocialAccountListButtonClass!}" href="${p.loginUrl}">
                            <span class="${properties.kcFormSocialAccountNameClass!}">${p.displayName!}</span>
                        </a></li>
                    </#list>
                </ul>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
