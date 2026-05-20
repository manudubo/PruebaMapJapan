<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('totp'); section>
    <#if section="header">
        ${msg("doLogIn")}
    <#elseif section="form">
        <form id="kc-otp-login-form" class="${properties.kcFormClass!}"
              onsubmit="login.disabled = true; return true;"
              action="${url.loginAction}" method="post">
            <div class="${properties.kcFormGroupClass!}">
                <label for="otp" class="${properties.kcLabelClass!}">${msg("loginOtpOneTime")}</label>
                <input id="otp" name="otp" autocomplete="one-time-code" type="text"
                       class="${properties.kcInputClass!}"
                       autofocus
                       aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>" dir="ltr"/>
                <#if messagesPerField.existsError('totp')>
                    <span class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                        ${kcSanitize(messagesPerField.get('totp'))?no_esc}
                    </span>
                </#if>
            </div>
            <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}"
                   name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
        </form>
    </#if>
</@layout.registrationLayout>
