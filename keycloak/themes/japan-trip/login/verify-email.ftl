<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true; section>
    <#if section="header">
        ${msg("emailVerifyTitle")}
    <#elseif section="form">
        <p class="instruction">${msg("emailVerifyInstruction1", user.email)}</p>
        <#if isAppInitiatedAction??>
            <div class="${properties.kcFormGroupClass!}">
                <a href="${url.loginAction}" id="cancelEmailVerification">
                    ${msg("doCancel")}
                </a>
            </div>
        </#if>
    <#elseif section="info">
        <p class="instruction">
            ${msg("emailVerifyInstruction2")}
            <br/>
            <a href="${url.loginAction}">${msg("doClickHere")}</a>
            ${msg("emailVerifyInstruction3")}
        </p>
    </#if>
</@layout.registrationLayout>
