<#import "template.ftl" as layout>
<#-- Credential step after the username (flows.tf: password branch of "passkey-or-password"). -->
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('password'); section>
    <#if section = "header">
        ${msg("jpPasswordTitle")}
    <#elseif section = "form">
        <div id="kc-form">
            <div id="kc-form-wrapper">
                <form id="kc-form-login" class="${properties.kcFormClass!}" data-jp-once action="${url.loginAction}" method="post">
                    <div class="${properties.kcFormGroupClass!}">
                        <label for="password" class="${properties.kcLabelClass!}">${msg("password")}</label>
                        <div class="${properties.kcInputGroup!}" dir="ltr">
                            <input tabindex="2" id="password" class="${properties.kcInputClass!}" name="password" type="password"
                                   autocomplete="current-password" autofocus
                                   aria-invalid="<#if messagesPerField.existsError('password')>true<#else>false</#if>"
                                   <#if messagesPerField.existsError('password')>aria-describedby="input-error-password"</#if>/>
                            <button class="${properties.kcFormPasswordVisibilityButtonClass!}" type="button" aria-label="${msg('showPassword')}"
                                    aria-controls="password" data-password-toggle
                                    data-icon-show="${properties.kcFormPasswordVisibilityIconShow!}" data-icon-hide="${properties.kcFormPasswordVisibilityIconHide!}"
                                    data-label-show="${msg('showPassword')}" data-label-hide="${msg('hidePassword')}">
                                <i class="${properties.kcFormPasswordVisibilityIconShow!}" aria-hidden="true"></i>
                            </button>
                        </div>
                        <#if messagesPerField.existsError('password')>
                            <span id="input-error-password" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                ${kcSanitize(messagesPerField.get('password'))?no_esc}
                            </span>
                        </#if>
                    </div>

                    <#if realm.resetPasswordAllowed>
                        <p class="jp-form__aside"><a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a></p>
                    </#if>

                    <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                        <button tabindex="4" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" name="login" id="kc-login" type="submit">${msg("doLogIn")}</button>
                    </div>
                </form>
            </div>
        </div>
        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    </#if>
</@layout.registrationLayout>
