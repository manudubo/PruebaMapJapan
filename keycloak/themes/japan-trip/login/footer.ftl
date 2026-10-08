<#macro content>
  <#-- The client's Base URL (set by Terraform per profile) wins over the theme default,
       so a production login page never links back to localhost. -->
  <#assign appUrl = (client.baseUrl)!properties.appUrl!'http://localhost:5173/PruebaMapJapan/'>
  <#--
    REG-07: passkey steps (sign-in and the sign-up enrolment) offer the e-mail recovery
    page of the app (recover.html, built from the same base URL, i.e. the Pages origin
    and path in config/deploy-defaults.json). There the backend proves the address with
    a 6-digit code and sets a password, so a passkey-only account still gets in from a
    device without WebAuthn. Only the e-mail address the user typed is passed along
    (never a token or code). A small secondary link normally; when the browser has no
    WebAuthn at all the script below promotes it to the main action.
  -->
  <#assign jpPage = pageId!''>
  <#if jpPage?starts_with('webauthn-authenticate') || jpPage?starts_with('webauthn-register') || jpPage?starts_with('webauthn-error')>
    <#assign jpAttempted = (auth.attemptedUsername)!''>
    <#assign jpRecoverUrl = appUrl + 'recover.html'>
    <#if jpAttempted?contains('@')>
      <#assign jpRecoverUrl = jpRecoverUrl + '?email=' + jpAttempted?url('UTF-8')>
    </#if>
    <p id="jp-passkey-recovery" class="jp-passkey-recovery">
      <a id="jp-passkey-recovery-link" href="${jpRecoverUrl}">${msg("jpPasskeyRecovery")}</a>
    </p>
    <script>
      (function () {
        if (typeof window.PublicKeyCredential === 'undefined') {
          var box = document.getElementById('jp-passkey-recovery');
          if (box) box.className += ' jp-passkey-recovery--primary';
        }
      })();
    </script>
  </#if>
  <div class="jp-idp-footer">
    <a class="jp-idp-exit" href="${appUrl}">Return</a>
  </div>
</#macro>
