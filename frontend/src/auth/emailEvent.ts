/**
 * Dispatched on `window` when any API call answers 403 `email_not_verified`: the account's
 * address is not verified yet, so the verification screen (src/auth/verifyEmail.ts) takes over
 * instead of every caller showing its own error. Lives in its own module so the screen does
 * not have to import the whole API client.
 */
export const EMAIL_NOT_VERIFIED_EVENT = 'travelmap:email-not-verified';
