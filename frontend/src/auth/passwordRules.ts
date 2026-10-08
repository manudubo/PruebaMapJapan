/**
 * Password requirements shown live on recover.html. They mirror what the backend enforces
 * (>= 12 characters, not the account's email); the server stays the authority and may still
 * answer 422 weak_password, which the page reports without guessing why.
 */

export const MIN_PASSWORD_LENGTH = 12;
/** Beyond this nobody types a password; it also bounds what we send. */
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordRuleId = 'length' | 'notEmail' | 'match';

export interface PasswordRuleResult {
  id: PasswordRuleId;
  met: boolean;
}

/** Code points, not UTF-16 units: an emoji is one character to the user. */
export function passwordLength(password: string): number {
  return Array.from(password).length;
}

export function checkPassword(password: string, confirmation: string, email: string): PasswordRuleResult[] {
  const normalizedEmail = email.trim().toLowerCase();
  const typed = password.trim().toLowerCase();
  return [
    {
      id: 'length',
      met: passwordLength(password) >= MIN_PASSWORD_LENGTH && passwordLength(password) <= MAX_PASSWORD_LENGTH,
    },
    // Empty password: nothing typed yet, so it is not "met" (the checklist starts unmet).
    { id: 'notEmail', met: password !== '' && (normalizedEmail === '' || typed !== normalizedEmail) },
    { id: 'match', met: password !== '' && password === confirmation },
  ];
}

export function allMet(results: readonly PasswordRuleResult[]): boolean {
  return results.every((r) => r.met);
}
