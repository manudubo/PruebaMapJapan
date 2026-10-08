<#macro content>
  <#-- The client's Base URL (set by Terraform per profile) wins over the theme default,
       so a production login page never links back to localhost. -->
  <#assign appUrl = (client.baseUrl)!properties.appUrl!'http://localhost:5173/PruebaMapJapan/'>
  <div class="jp-idp-footer">
    <a class="jp-idp-exit" href="${appUrl}">Return</a>
  </div>
</#macro>
