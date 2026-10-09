<#macro content>
  <#-- The client's Base URL (set by Terraform per profile) is the ONLY address this page links
       back to. There is no theme-level fallback: a development address once
       leaked into production. Without a Base URL the links below are simply not rendered. -->
  <#assign appUrl = (client.baseUrl)!''>
  <#if appUrl?has_content>
  <footer class="jp-foot">
    <#--
      REG-07: passkey steps (sign-in and the sign-up enrolment) offer the e-mail recovery
      page of the app (recover.html, built from the same base URL, i.e. the Pages origin
      and path in config/deploy-defaults.json). There the backend proves the address with
      a 6-digit code and sets a password, so a passkey-only account still gets in from a
      device without WebAuthn. Only the e-mail address the user typed is passed along
      (never a token or code). A small secondary link normally; when the browser has no
      WebAuthn at all, js/jp-login.js promotes it to the main action.
    -->
    <#assign jpPage = pageId!''>
    <#if jpPage?starts_with('webauthn-authenticate') || jpPage?starts_with('webauthn-register') || jpPage?starts_with('webauthn-error')>
      <#assign jpAttempted = (auth.attemptedUsername)!''>
      <#assign jpRecoverUrl = appUrl?ensure_ends_with('/') + 'recover.html'>
      <#if jpAttempted?contains('@')>
        <#assign jpRecoverUrl = jpRecoverUrl + '?email=' + jpAttempted?url('UTF-8')>
      </#if>
      <p id="jp-passkey-recovery" class="jp-passkey-recovery">
        <a id="jp-passkey-recovery-link" href="${jpRecoverUrl}">${msg("jpPasskeyRecovery")}</a>
      </p>
    </#if>
    <#-- The error page can carry the way back as its own button (error.ftl): one is enough. -->
    <#if !(jpErrorOwnsBack!false)>
    <a class="jp-idp-exit" href="${appUrl}">${msg("jpBackToApp", realm.displayName!'Japan Trip')}</a>
    </#if>
  </footer>
  </#if>
</#macro>
