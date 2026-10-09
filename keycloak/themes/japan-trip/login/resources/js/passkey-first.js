// Passkey-first sign-in for the japan-trip login theme (docs/design/PASSKEY-FIRST-LOGIN.md).
// Loaded as a module on every login page (template.ftl); it looks at the page it finds:
//
//  * every page with Keycloak's passkey form (#webauth, sign-in) or the enrolment form
//    (#register): remember in this browser that a passkey was used here (passkey-device.js);
//  * the username page (#jp-passkey, rendered by passkeys.ftl):
//      - a browser that used a passkey here before gets the passkey prompt at once, with no
//        username typed, once per login attempt, and can cancel into the normal form;
//      - every other browser gets the normal form, passkeys in the autofill list of the
//        e-mail field (conditional UI) and a "Sign in with a passkey" button.
//
// Everything is progressive enhancement: the server renders the plain form, the passkey panel
// is `hidden` until this module decides to show it, and any failure here falls back to the form.

import {
  classifyCredentialError,
  createDeviceMemory,
  createTabGate,
  decideAutoPrompt,
  isFreshNavigation,
  safeStorage,
  supportsImmediateMediation,
  tabIdOf,
} from './passkey-device.js';
import { assertionToFields, buildRequestOptions, readServerParams } from './passkey-webauthn.js';

const FIELD_IDS = ['clientDataJSON', 'authenticatorData', 'signature', 'credentialId', 'userHandle'];

/**
 * @param {object} env
 * @param {Document} env.document
 * @param {Window} env.window
 * @param {Navigator} [env.navigator]
 * @param {Storage|null} [env.storage]         localStorage (default: the window's, if usable)
 * @param {Storage|null} [env.sessionStorage]  sessionStorage (default: the window's, if usable)
 * @param {() => number} [env.now]
 */
export function init(env) {
  const doc = env.document;
  const win = env.window;
  const nav = env.navigator ?? win.navigator;
  const storage = env.storage === undefined ? safeStorage(win, 'localStorage') : env.storage;
  const sessionStore = env.sessionStorage === undefined ? safeStorage(win, 'sessionStorage') : env.sessionStorage;
  const memory = createDeviceMemory({ storage, realm: doc.body?.dataset?.realm, now: env.now });

  hookMarker(doc, memory);

  const data = doc.getElementById('jp-passkey');
  if (!data) return;
  try {
    startLoginPage({ doc, win, nav, memory, sessionStore, data });
  } catch (error) {
    // Never leave the user without a form because of a bug here.
    console.error('passkey-first:', error);
    revealForm(doc);
  }
}

/** The one place that says "this browser has a passkey for this realm". */
function hookMarker(doc, memory) {
  const value = (id) => doc.getElementById(id)?.value ?? '';
  doc.getElementById('webauth')?.addEventListener('submit', () => {
    if (value('credentialId') && !value('error')) memory.remember();
  });
  doc.getElementById('register')?.addEventListener('submit', () => {
    if (value('attestationObject') && !value('error')) memory.remember();
  });
}

function revealForm(doc) {
  const panel = doc.getElementById('jp-passkey-first');
  if (panel) panel.hidden = true;
  const form = doc.getElementById('kc-form');
  if (form) form.hidden = false;
  const subtitle = doc.getElementById('kc-page-subtitle');
  if (subtitle) subtitle.hidden = false;
}

function startLoginPage({ doc, win, nav, memory, sessionStore, data }) {
  const $ = (id) => doc.getElementById(id);
  const text = (name, fallback) => data.dataset[name] || fallback;
  const params = readServerParams(data.dataset);
  const webauthn = !!win.PublicKeyCredential && typeof nav?.credentials?.get === 'function';

  const panel = $('jp-passkey-first');
  const status = $('jp-passkey-status');
  const continueButton = $('jp-passkey-continue');
  const otherButton = $('jp-passkey-other');
  const alt = $('jp-passkey-alt');
  const altButton = $('jp-passkey-button');
  const altStatus = $('jp-passkey-alt-status');
  const formBlock = $('kc-form');
  const subtitle = $('kc-page-subtitle');
  const loginForm = $('kc-form-login');
  const usernameField = $('username');
  const passkeyForm = $('webauth');
  if (!params || !webauthn || !panel || !status || !continueButton || !otherButton || !alt || !altButton || !altStatus || !formBlock || !passkeyForm) {
    return; // no passkey on this page or in this browser: the plain form it is
  }

  const serverAllows = data.dataset.auto === 'true';
  // The login attempt is named by the tab_id in Keycloak's form action (the first page is
  // served at the /auth URL, which has no tab_id yet; every later page of the attempt has it).
  const gate = createTabGate(sessionStore, tabIdOf(passkeyForm.getAttribute('action')) || tabIdOf(win.location.href));
  let current = null; // AbortController of the request in flight
  let otherChosen = false;
  let immediate = false;

  // A passkey answer was posted from this login attempt and the next page of it is an error
  // page: the server did not accept it (the passkey was deleted, say). Stop prompting.
  if (gate.wasPending()) {
    gate.clearPending();
    if (!serverAllows) memory.forget();
  }

  // ---- what the user sees ------------------------------------------------------------
  const say = (el, message) => {
    el.textContent = message;
  };
  function showPlain() {
    panel.hidden = true;
    formBlock.hidden = false;
    if (subtitle) subtitle.hidden = false;
    alt.hidden = false;
  }
  function showPanel(message, { busy, withOther, withForm }) {
    panel.hidden = false;
    panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    say(status, message);
    continueButton.disabled = busy;
    otherButton.hidden = !withOther;
    formBlock.hidden = !withForm;
    if (subtitle) subtitle.hidden = true;
    alt.hidden = true;
  }

  // ---- the WebAuthn request ------------------------------------------------------------
  function complete(credential) {
    const fields = assertionToFields(credential);
    for (const id of FIELD_IDS) {
      const input = $(id);
      if (input) input.value = fields[id] ?? '';
    }
    gate.markPending();
    if (!panel.hidden) showPanel(text('textSigningIn', 'Signing you in…'), { busy: true, withOther: false, withForm: false });
    if (typeof passkeyForm.requestSubmit === 'function') passkeyForm.requestSubmit();
    else passkeyForm.submit();
  }

  function onError(source, error) {
    const kind = classifyCredentialError(error);
    const message =
      kind === 'dismissed'
        ? text('textDismissed', 'Passkey sign-in was cancelled.')
        : kind === 'blocked' || kind === 'unsupported'
          ? text('textUnsupported', 'This device cannot use a passkey here.')
          : text('textFailed', 'We could not use your passkey.');
    if (source === 'auto' || source === 'panel') {
      if (source === 'auto' && kind === 'dismissed') memory.recordMiss();
      showPanel(message, { busy: false, withOther: false, withForm: true });
      continueButton.focus();
    } else {
      say(altStatus, message);
    }
    startConditional();
  }

  /**
   * @param {'auto'|'panel'|'manual'|'conditional'} source
   *   auto: started by the page; panel: "Continue with passkey" in the panel; manual: the
   *   "Sign in with a passkey" button under the form; conditional: the e-mail field's autofill list
   */
  async function ask(source) {
    current?.abort();
    const mine = new win.AbortController();
    current = mine;
    const mediation = source === 'conditional' ? 'conditional' : source === 'auto' && immediate ? 'immediate' : undefined;
    try {
      const credential = await nav.credentials.get(buildRequestOptions(params, { mediation, signal: mine.signal }));
      if (current !== mine) return;
      if (!credential) throw Object.assign(new Error('no credential'), { name: 'NotAllowedError' });
      complete(credential);
    } catch (error) {
      if (current !== mine) return; // superseded by a newer request or by "Use another account"
      current = null;
      if (source === 'conditional') return; // autofill is optional: stay silent, as Keycloak does
      onError(source, error);
    }
  }

  async function startConditional() {
    try {
      if (formBlock.hidden || !usernameField) return;
      if (typeof win.PublicKeyCredential.isConditionalMediationAvailable !== 'function') return;
      if (!(await win.PublicKeyCredential.isConditionalMediationAvailable())) return;
      if (formBlock.hidden || current) return;
      ask('conditional');
    } catch {
      // autofill is optional
    }
  }

  // ---- buttons -------------------------------------------------------------------------
  continueButton.addEventListener('click', () => {
    showPanel(text('textWaiting', 'Waiting for your passkey.'), { busy: true, withOther: formBlock.hidden, withForm: !formBlock.hidden });
    ask('panel');
  });
  altButton.addEventListener('click', () => {
    say(altStatus, text('textWaiting', 'Waiting for your passkey.'));
    ask('manual');
  });
  otherButton.addEventListener('click', () => {
    otherChosen = true;
    current?.abort();
    current = null;
    showPlain();
    usernameField?.focus();
    startConditional();
  });
  // Another account signs in with its own credentials here: this browser's passkey memory is
  // not that account's, so it goes (it comes back with the next passkey sign-in).
  loginForm?.addEventListener('submit', () => {
    if (otherChosen) memory.forget();
  });
  // Back/forward cache: the page is shown as it was left, but its WebAuthn request is gone.
  win.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    current?.abort();
    current = null;
    if (!panel.hidden) showPanel(text('textDismissed', 'Passkey sign-in was cancelled.'), { busy: false, withOther: false, withForm: true });
  });

  // ---- decide what the page does on load --------------------------------------------------
  const topLevel = (() => {
    try {
      return win.top === win.self;
    } catch {
      return false;
    }
  })();
  const navigationType = (() => {
    try {
      return win.performance.getEntriesByType('navigation')[0]?.type;
    } catch {
      return undefined;
    }
  })();
  const base = {
    serverAllows,
    topLevel,
    webauthn,
    markerActive: memory.isActive(),
    freshNavigation: isFreshNavigation(navigationType),
    alreadyPrompted: gate.hasPrompted(),
  };

  const settle = async () => {
    // Optimistic first answer (no platform check yet) so the panel replaces the form at once.
    if (!decideAutoPrompt({ ...base, platformAuthenticator: true }).auto) {
      showPlain();
      startConditional();
      return;
    }
    showPanel(text('textWaiting', 'Waiting for your passkey.'), { busy: true, withOther: true, withForm: false });
    let platform = false;
    try {
      platform = !!(await win.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.());
    } catch {
      platform = false;
    }
    if (!decideAutoPrompt({ ...base, platformAuthenticator: platform }).auto || !gate.claimAutoPrompt()) {
      showPlain();
      startConditional();
      return;
    }
    try {
      immediate = supportsImmediateMediation(await win.PublicKeyCredential.getClientCapabilities?.());
    } catch {
      immediate = false;
    }
    await visible(doc);
    if (otherChosen) return;
    ask('auto');
  };
  settle().catch((error) => {
    console.error('passkey-first:', error);
    showPlain();
  });
}

/** Resolves when the tab is in the foreground (a background tab cannot show the passkey sheet). */
function visible(doc) {
  return new Promise((resolve) => {
    if (doc.visibilityState !== 'hidden') return resolve();
    const onChange = () => {
      if (doc.visibilityState === 'hidden') return;
      doc.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    doc.addEventListener('visibilitychange', onChange);
  });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  init({ document, window });
}
