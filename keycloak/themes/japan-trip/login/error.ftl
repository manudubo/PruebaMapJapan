<#import "template.ftl" as layout>
<#--
  Error page. Keycloak hands over a message in its own words ("Invalid parameter: redirect_uri",
  "Login timeout. Please sign in again.", ...). The person looking at the screen needs to know
  what to do, so the message is sorted into a few cases, each with plain language and ONE clear
  action; the original sentence is kept in a collapsed "Details for support".

  The sorting compares the summary with the bundle's own sentence for the same key (msg()), so
  it follows the locale and needs no key from Keycloak. Anything not recognised gets the generic
  copy. Every Keycloak string that is printed goes through kcSanitize (SEC-11); nothing but the
  message and the support trace id is shown, never a stack, URL or parameter value.

    start    the request that began the sign-in was not valid (bad redirect_uri, unknown client...)
             -> "go back to the app" (the client's Base URL; no button when the client has none)
    expired  the sign-in session, page or link is too old                  -> "Start again" while the
             sign-in session still exists (Keycloak can restart it); once the session is gone
             (cookie lost or expired) restarting would show this same page, so -> back to the app,
             which begins a new sign-in
    closed   sign-up is switched off                                       -> "Sign in"
    disabled the account is disabled (explicitly, by an administrator)     -> contact the inviter
-->
<#assign jpSummary = (message.summary)!''>
<#assign jpStartKeys = ['invalidRequestMessage', 'invalidRedirectUriMessage', 'unknownLoginRequesterMessage', 'invalidRequesterMessage', 'standardFlowDisabledMessage', 'implicitFlowDisabledMessage', 'clientNotFoundMessage', 'clientDisabledMessage']>
<#assign jpExpiredKeys = ['expiredCodeMessage', 'expiredActionMessage', 'expiredActionTokenNoSessionMessage', 'expiredActionTokenSessionExistsMessage', 'staleCodeMessage', 'invalidCodeMessage', 'sessionNotActiveMessage', 'cookieNotFoundMessage', 'loginTimeout']>
<#assign jpKind = 'generic'>
<#if jpSummary?starts_with(msg('invalidParameterMessage', '')?trim)>
    <#assign jpKind = 'start'>
<#else>
    <#list jpStartKeys as k><#if jpSummary == msg(k)><#assign jpKind = 'start'></#if></#list>
    <#list jpExpiredKeys as k><#if jpSummary == msg(k)><#assign jpKind = 'expired'></#if></#list>
    <#if jpSummary == msg('registrationNotAllowedMessage')><#assign jpKind = 'closed'></#if>
    <#if jpSummary == msg('accountDisabledMessage')><#assign jpKind = 'disabled'></#if>
</#if>
<#assign jpBackUrl = (client.baseUrl)!''>
<#assign jpRestartUrl = (url.loginRestartFlowUrl)!''>
<#-- Restarting needs a live sign-in session; without one the way out is the app. -->
<#assign jpCanRestart = authenticationSession?? && jpRestartUrl?has_content>
<#-- When the back button is the action, the footer's text link would be a second one. -->
<#if (jpKind == 'start' || (jpKind == 'expired' && !jpCanRestart)) && jpBackUrl?has_content>
    <#global jpErrorOwnsBack = true>
</#if>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <#if jpKind == 'start'>${msg("jpErrStartTitle")}
        <#elseif jpKind == 'expired'>${msg("jpErrExpiredTitle")}
        <#elseif jpKind == 'closed'>${msg("jpErrClosedTitle")}
        <#elseif jpKind == 'disabled'>${msg("jpErrDisabledTitle")}
        <#else>${msg("errorTitle")}</#if>
    <#elseif section = "subtitle">
        <#if jpKind == 'start'>${msg("jpErrStartBody", realm.displayName!'Japan Trip')}
        <#elseif jpKind == 'expired'>${jpCanRestart?then(msg("jpErrExpiredBody"), msg("jpErrExpiredBodyApp", realm.displayName!'Japan Trip'))}
        <#elseif jpKind == 'closed'>${msg("jpErrClosedBody")}
        <#elseif jpKind == 'disabled'>${msg("jpErrDisabledBody")}
        <#else>${msg("jpErrGenericBody")}</#if>
    <#elseif section = "form">
        <div id="kc-error-message" class="jp-error" data-error-kind="${jpKind}">
            <#assign jpActionUrl = ''>
            <#assign jpActionLabel = ''>
            <#if jpKind == 'start' && jpBackUrl?has_content>
                <#assign jpActionUrl = jpBackUrl>
                <#assign jpActionLabel = msg("jpBackToApp", realm.displayName!'Japan Trip')>
            <#elseif jpKind == 'expired' && jpCanRestart>
                <#assign jpActionUrl = jpRestartUrl>
                <#assign jpActionLabel = msg("jpErrStartAgain")>
            <#elseif jpKind == 'expired' && jpBackUrl?has_content>
                <#assign jpActionUrl = jpBackUrl>
                <#assign jpActionLabel = msg("jpBackToApp", realm.displayName!'Japan Trip')>
            <#elseif jpKind == 'closed' && jpRestartUrl?has_content>
                <#assign jpActionUrl = jpRestartUrl>
                <#assign jpActionLabel = msg("doLogIn")>
            </#if>
            <#if jpActionUrl?has_content>
                <a id="jp-error-action" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}" href="${jpActionUrl}">${jpActionLabel}</a>
            </#if>
            <#if jpSummary?has_content || traceId??>
                <details id="jp-error-details" class="jp-details">
                    <summary>${msg("jpErrDetails")}</summary>
                    <#if jpSummary?has_content><p id="jp-error-original">${kcSanitize(jpSummary)?no_esc}</p></#if>
                    <#if traceId??><p id="traceId">${msg("traceIdSupportMessage", traceId)}</p></#if>
                </details>
            </#if>
        </div>
    </#if>
</@layout.registrationLayout>
