/**
 * Server-side password policy for account recovery, enforced BEFORE the
 * Keycloak Admin API is called (the realm's own policy is a second line, not
 * the first). Pure and synchronous; never logs or returns the password.
 *
 *   - 12..128 characters (Unicode code points, so an emoji counts once);
 *   - no NUL;
 *   - not blank (whitespace only);
 *   - not the account's e-mail, not contained in it, and does not contain it
 *     (compared case-insensitively after NFKC normalisation, so full-width
 *     look-alikes do not slip through).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'contains_nul' | 'too_long' | 'too_short' | 'blank' | 'matches_email';

/** Hard cap before any normalisation, so a megabyte "password" costs nothing. */
const SCAN_LIMIT = 4 * PASSWORD_MAX_LENGTH;

export function passwordProblem(password: string, email: string): PasswordProblem | null {
  if (password.includes('\u0000')) return 'contains_nul';
  // UTF-16 length >= code points, so this can only reject early what would be too long anyway.
  if (password.length > SCAN_LIMIT) return 'too_long';
  const length = Array.from(password).length;
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.trim() === '') return 'blank';

  const pw = password.normalize('NFKC').toLowerCase();
  const mail = email.normalize('NFKC').toLowerCase().trim();
  if (mail !== '' && (pw === mail || mail.includes(pw) || pw.includes(mail))) return 'matches_email';
  return null;
}
