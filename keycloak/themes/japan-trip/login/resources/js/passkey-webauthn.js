// The WebAuthn half of passkey-first sign-in: turn the values Keycloak rendered into a
// navigator.credentials.get() request, and the answer into the hidden fields Keycloak's
// action reads (clientDataJSON, authenticatorData, signature, credentialId, userHandle).
//
// Keycloak ships the same ceremony in js/webauthnAuthenticate.js, but that module reports a
// cancelled prompt by posting an error back to the server (an error page). Passkey-first needs
// a cancel to leave the user on the page, so the ceremony is repeated here, without the
// import map (rfc4648) and without the shared abort controller. Pure functions: no DOM.

const USER_VERIFICATION = new Set(['required', 'preferred', 'discouraged']);

/** Bytes to base64url, no padding (the encoding Keycloak's action expects). */
export function bytesToBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (padded or not) to bytes. Throws on anything that is not base64url. */
export function base64UrlToBytes(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) {
    throw new TypeError('not base64url');
  }
  const standard = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The server values the template put on the data element (data-challenge, data-rp-id,
 * data-user-verification, data-timeout).
 *
 * @param {Record<string, string | undefined>} dataset  element.dataset
 * @returns {{ challenge: string, rpId?: string, userVerification?: string, timeoutMs?: number } | null}
 *          null when the challenge is missing or not base64url (the page then stays a plain form)
 */
export function readServerParams(dataset) {
  const challenge = dataset?.challenge;
  if (typeof challenge !== 'string' || !challenge) return null;
  try {
    base64UrlToBytes(challenge);
  } catch {
    return null;
  }
  const rpId = dataset.rpId?.trim() || undefined;
  const uv = dataset.userVerification?.trim();
  const seconds = Number(dataset.timeout);
  return {
    challenge,
    rpId,
    // "not specified" means the browser default: leave the member out
    userVerification: uv && USER_VERIFICATION.has(uv) ? uv : undefined,
    timeoutMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined,
  };
}

/**
 * Arguments for navigator.credentials.get(). allowCredentials stays empty on purpose: the
 * user is not identified yet, so the browser offers the discoverable passkeys it has for the
 * relying party (that is what lets the page skip the username).
 *
 * @param {NonNullable<ReturnType<typeof readServerParams>>} params
 * @param {{ mediation?: 'conditional' | 'immediate', signal?: AbortSignal }} [options]
 */
export function buildRequestOptions(params, { mediation, signal } = {}) {
  const publicKey = { challenge: base64UrlToBytes(params.challenge) };
  if (params.rpId) publicKey.rpId = params.rpId;
  if (params.userVerification) publicKey.userVerification = params.userVerification;
  if (params.timeoutMs) publicKey.timeout = params.timeoutMs;
  const options = { publicKey };
  if (mediation) options.mediation = mediation;
  if (signal) options.signal = signal;
  return options;
}

/** The hidden fields of Keycloak's `webauth` form for an assertion (PublicKeyCredential). */
export function assertionToFields(credential) {
  const r = credential.response;
  const fields = {
    clientDataJSON: bytesToBase64Url(r.clientDataJSON),
    authenticatorData: bytesToBase64Url(r.authenticatorData),
    signature: bytesToBase64Url(r.signature),
    credentialId: credential.id,
  };
  if (r.userHandle && r.userHandle.byteLength) fields.userHandle = bytesToBase64Url(r.userHandle);
  return fields;
}
