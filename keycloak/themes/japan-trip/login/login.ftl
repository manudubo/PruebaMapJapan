<#import "template.ftl" as layout>
<#-- Combined username + password page: only used when the realm runs Keycloak's stock browser flow.
     The japan-trip realm uses the username-first flow (login-username.ftl, login-password.ftl). -->
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=(realm.password && realm.registrationAllowed && !registrationDisabled??); section>
    <#if section = "header">
        ${msg("jpSignInTitle")}
    <#elseif section = "subtitle">
        ${msg("jpSignInSubtitle")}
    <#elseif section = "form">
        <div id="kc-form">
            <div id="kc-form-wrapper">
                <form id="kc-form-login" class="${properties.kcFormClass!}" data-jp-once action="${url.loginAction}" method="post">
                    <div class="${properties.kcFormGroupClass!}">
                        <label for="username" class="${properties.kcLabelClass!}"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                        <input tabindex="1" id="username" class="${properties.kcInputClass!}" name="username" value="${(login.username!'')}"
                               type="text" autofocus dir="ltr" autocapitalize="none" spellcheck="false"
                               autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>"/>
                    </div>

                    <div class="${properties.kcFormGroupClass!}">
                        <label for="password" class="${properties.kcLabelClass!}">${msg("password")}</label>
                        <div class="${properties.kcInputGroup!}" dir="ltr">
                            <input tabindex="2" id="password" class="${properties.kcInputClass!}" name="password" type="password"
                                   autocomplete="current-password"
                                   aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>"
                                   <#if messagesPerField.existsError('username','password')>aria-describedby="input-error"</#if>/>
                            <button class="${properties.kcFormPasswordVisibilityButtonClass!}" type="button" aria-label="${msg('showPassword')}"
                                    aria-controls="password" data-password-toggle
                                    data-icon-show="${properties.kcFormPasswordVisibilityIconShow!}" data-icon-hide="${properties.kcFormPasswordVisibilityIconHide!}"
                                    data-label-show="${msg('showPassword')}" data-label-hide="${msg('hidePassword')}">
                                <i class="${properties.kcFormPasswordVisibilityIconShow!}" aria-hidden="true"></i>
                            </button>
                        </div>
                        <#if messagesPerField.existsError('username','password')>
                            <span id="input-error" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                            </span>
                        </#if>
                    </div>

                    <#if realm.rememberMe && !usernameEditDisabled??>
                        <div class="${properties.kcFormGroupClass!}">
                            <label class="${properties.kcCheckLabelClass!}" for="rememberMe">
                                <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox" class="${properties.kcCheckInputClass!}"<#if login.rememberMe??> checked</#if>>
                                <span>${msg("rememberMe")}</span>
                            </label>
                        </div>
                    </#if>

                    <#if realm.resetPasswordAllowed>
                        <p class="jp-form__aside"><a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a></p>
                    </#if>

                    <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                        <input type="hidden" id="id-hidden-input" name="credentialId"<#if auth.selectedCredential?has_content> value="${auth.selectedCredential}"</#if>/>
                        <button tabindex="4" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" name="login" id="kc-login" type="submit">${msg("doLogIn")}</button>
                    </div>
                </form>
            </div>
        </div>
        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    <#elseif section = "info">
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <p id="kc-registration">${msg("noAccount")} <a tabindex="6" href="${url.registrationUrl}">${msg("doRegister")}</a></p>
        </#if>
    </#if>
</@layout.registrationLayout>
