// Behaviour shared by every page of the japan-trip login theme. Classic script, loaded with
// `defer` from template.ftl; no inline handlers anywhere in the theme's own templates.
(function () {
  'use strict';

  // Double-submit guard for forms marked data-jp-once. The buttons are disabled one tick
  // after the submit event so the clicked button's name/value is still part of the post.
  function guardForm(form) {
    var buttons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
    form.addEventListener('submit', function () {
      setTimeout(function () {
        form.setAttribute('aria-busy', 'true');
        buttons.forEach(function (button) { button.disabled = true; });
      }, 0);
    });
    // Back/forward cache restores the page as it was left: give the form back.
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      form.removeAttribute('aria-busy');
      buttons.forEach(function (button) { button.disabled = false; });
    });
  }
  document.querySelectorAll('form[data-jp-once]').forEach(guardForm);

  // REG-07: without WebAuthn at all, the e-mail recovery link is the way in, not a footnote
  // (footer.ftl renders it on the passkey steps).
  if (typeof window.PublicKeyCredential === 'undefined') {
    var recovery = document.getElementById('jp-passkey-recovery');
    if (recovery) recovery.classList.add('jp-passkey-recovery--primary');
  }
})();
