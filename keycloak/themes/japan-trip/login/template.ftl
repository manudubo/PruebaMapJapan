<#import "footer.ftl" as loginFooter>
<#--
  Page shell for every login-theme screen: brand, ONE card, footer links. Derived from the
  `base` theme's template.ftl; differences:
    - the card is the only box (no card inside a card), and the brand sits above it;
    - the page title is always an <h1>, with an optional "subtitle" section under it;
    - the "restart login" username chip is part of the header, not a replacement for the title;
    - "Try another way" is a real submit button (no inline script handler);
    - alerts carry role="alert" and icons from the theme's own set.
-->
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" lang="${lang}"<#if realm.internationalizationEnabled> dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <meta name="color-scheme" content="light dark">
    <title>${msg("loginTitle",(realm.displayName!''))}</title>
    <link rel="icon" href="${url.resourcesPath}/img/favicon.svg" type="image/svg+xml" />
    <#-- Same web font as the app (frontend/index.html); the fallback face in login.css keeps the layout still while it loads. -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript" defer></script>
        </#list>
    </#if>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";

        startSessionPolling(
            "${url.ssoLoginInOtherTabsUrl?no_esc}"
        );
    </script>
    <script type="module">
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[data-once-link]");

            if (!link) {
                return;
            }

            if (link.getAttribute("aria-disabled") === "true") {
                event.preventDefault();
                return;
            }

            const { disabledClass } = link.dataset;

            if (disabledClass) {
                link.classList.add(...disabledClass.trim().split(/\s+/));
            }

            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
        });
    </script>
    <#if authenticationSession??>
        <script type="module">
            import { checkAuthSession } from "${url.resourcesPath}/js/authChecker.js";

            checkAuthSession(
                "${authenticationSession.authSessionIdHash}"
            );
        </script>
    </#if>
</head>

<body class="${properties.kcBodyClass!}" data-page-id="login-${pageId}">
<div class="${properties.kcLoginClass!}">
    <div id="kc-header" class="${properties.kcHeaderClass!}">
        <svg class="jp-brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <rect width="32" height="32" fill="currentColor"/>
            <path d="M16 6.5c-3.6 0-6.5 2.8-6.5 6.4 0 4.6 6.5 12.6 6.5 12.6s6.5-8 6.5-12.6c0-3.6-2.9-6.4-6.5-6.4zm0 8.7a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6z" fill="#fff"/>
        </svg>
        <div id="kc-header-wrapper" class="${properties.kcHeaderWrapperClass!}">${realm.displayName!'Japan Trip'}</div>
    </div>

    <main class="${properties.kcFormCardClass!}">
        <header class="${properties.kcFormHeaderClass!}">
            <#if realm.internationalizationEnabled && locale.supported?size gt 1>
                <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
                    <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                        <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                            <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                            <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                                <#assign i = 1>
                                <#list locale.supported as l>
                                    <li class="${properties.kcLocaleListItemClass!}" role="none">
                                        <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                                    </li>
                                    <#assign i++>
                                </#list>
                            </ul>
                        </div>
                    </div>
                </div>
            </#if>

            <h1 id="kc-page-title"><#nested "header"></h1>

            <#assign jpSubtitle><#nested "subtitle"></#assign>
            <#if jpSubtitle?markup_string?trim?has_content>
                <p class="jp-subtitle" id="kc-page-subtitle">${jpSubtitle}</p>
            </#if>

            <#if auth?has_content && auth.showUsername() && !auth.showResetCredentials()>
                <#nested "show-username">
                <div id="kc-username" class="jp-user">
                    <span id="kc-attempted-username" class="jp-user__name">${auth.attemptedUsername}</span>
                    <a id="reset-login" class="jp-user__change" href="${url.loginRestartFlowUrl}">${msg("jpNotYou")}</a>
                </div>
            </#if>
        </header>

        <div id="kc-content">
            <div id="kc-content-wrapper">
                <#-- App-initiated actions should not see warning messages about the need to complete the action during login. -->
                <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                    <div class="alert-${message.type} ${properties.kcAlertClass!} jp-alert--${message.type}" role="<#if message.type = 'error' || message.type = 'warning'>alert<#else>status</#if>">
                        <span class="${properties['kcFeedback' + message.type?cap_first + 'Icon']!}" aria-hidden="true"></span>
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                </#if>

                <#if displayRequiredFields>
                    <p class="${properties.kcContentWrapperClass!}"><span aria-hidden="true">*</span> ${msg("requiredFields")}</p>
                </#if>

                <#nested "form">

                <#if auth?has_content && auth.showTryAnotherWayLink()>
                    <form id="kc-select-try-another-way-form" class="jp-try-another" action="${url.loginAction}" method="post">
                        <input type="hidden" name="tryAnotherWay" value="on"/>
                        <button type="submit" id="try-another-way" class="jp-btn jp-btn--secondary jp-btn--block">${msg("doTryAnotherWay")}</button>
                    </form>
                </#if>

                <#nested "socialProviders">

                <#-- The sign-up link is for people who are not identified yet. -->
                <#if displayInfo && !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
                    <div id="kc-info" class="${properties.kcSignUpClass!}">
                        <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                            <#nested "info">
                        </div>
                    </div>
                </#if>
            </div>
        </div>
    </main>

    <@loginFooter.content/>
</div>
</body>
</html>
</#macro>
