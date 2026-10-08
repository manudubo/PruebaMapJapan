<#import "template.ftl" as layout>
<#-- Generic notice ("You are logged out", "Your account has been updated", ...). The base page
     prints the message twice (as the title and again as the body); here it is printed once,
     and the way forward is a button. The way back to the app is the footer link. -->
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <#if messageHeader??>
            ${kcSanitize(msg("${messageHeader}"))?no_esc}
        <#else>
            ${message.summary}
        </#if>
    <#elseif section = "form">
        <div id="kc-info-message">
            <#if messageHeader?? || requiredActions??>
                <p class="instruction">${message.summary}<#if requiredActions??><#list requiredActions>: <b><#items as reqActionItem>${kcSanitize(msg("requiredAction.${reqActionItem}"))?no_esc}<#sep>, </#items></b></#list></#if></p>
            </#if>
            <#if !skipLink??>
                <#if pageRedirectUri?has_content>
                    <a class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" href="${pageRedirectUri}">${msg("backToApplication")}</a>
                <#elseif actionUri?has_content>
                    <a class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" href="${actionUri}">${msg("proceedWithAction")}</a>
                </#if>
            </#if>
        </div>
    </#if>
</@layout.registrationLayout>
