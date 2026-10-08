<#import "template.ftl" as layout>
<#-- "Forgot your password?": e-mail in, instructions out. The instruction line is the subtitle
     (it was a footnote under the form in the base template). -->
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username'); section>
    <#if section = "header">
        ${msg("emailForgotTitle")}
    <#elseif section = "subtitle">
        <#if realm.duplicateEmailsAllowed>${msg("emailInstructionUsername")}<#else>${msg("emailInstruction")}</#if>
    <#elseif section = "form">
        <form id="kc-reset-password-form" class="${properties.kcFormClass!}" data-jp-once action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="username" class="${properties.kcLabelClass!}"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                <input type="text" id="username" name="username" class="${properties.kcInputClass!}" autofocus dir="ltr"
                       autocomplete="username" autocapitalize="none" spellcheck="false"<#if realm.loginWithEmailAllowed> inputmode="email"</#if>
                       value="${(auth.attemptedUsername!'')}"
                       aria-invalid="<#if messagesPerField.existsError('username')>true<#else>false</#if>"
                       <#if messagesPerField.existsError('username')>aria-describedby="input-error-username"</#if>/>
                <#if messagesPerField.existsError('username')>
                    <span id="input-error-username" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('username'))?no_esc}
                    </span>
                </#if>
            </div>

            <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                <button class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" type="submit">${msg("jpSendResetLink")}</button>
                <a class="${properties.kcButtonClass!} ${properties.kcButtonSecondaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" href="${url.loginUrl}">${msg("backToLogin")}</a>
            </div>
        </form>
    </#if>
</@layout.registrationLayout>
