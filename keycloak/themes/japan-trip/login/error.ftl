<#import "template.ftl" as layout>
<#-- Error page. The layout's own alert is off (displayMessage=false): the message is the body
     of the page, shown once, in the same alert style. -->
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        ${msg("errorTitle")}
    <#elseif section = "form">
        <div id="kc-error-message">
            <div class="alert-error ${properties.kcAlertClass!} jp-alert--error" role="alert">
                <span class="${properties.kcFeedbackErrorIcon!}" aria-hidden="true"></span>
                <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
            </div>
        </div>
    </#if>
</@layout.registrationLayout>
