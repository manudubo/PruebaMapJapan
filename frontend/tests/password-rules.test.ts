import { describe, it, expect } from 'vitest';
import { allMet, checkPassword, passwordLength, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/auth/passwordRules';

const met = (pw: string, confirm = pw, email = 'ana@example.com') =>
  Object.fromEntries(checkPassword(pw, confirm, email).map((r) => [r.id, r.met]));

describe('password rules', () => {
  it('starts unmet when nothing is typed', () => {
    expect(met('', '')).toEqual({ length: false, notEmail: false, match: false });
  });

  it('length boundary: 11 fails, 12 passes, max passes, max+1 fails', () => {
    expect(met('a'.repeat(MIN_PASSWORD_LENGTH - 1)).length).toBe(false);
    expect(met('a'.repeat(MIN_PASSWORD_LENGTH)).length).toBe(true);
    expect(met('a'.repeat(MAX_PASSWORD_LENGTH)).length).toBe(true);
    expect(met('a'.repeat(MAX_PASSWORD_LENGTH + 1)).length).toBe(false);
  });

  it('counts characters the way the user sees them (emoji = 1)', () => {
    expect(passwordLength('😀😀😀')).toBe(3);
    expect(met('😀'.repeat(12)).length).toBe(true);
    expect(met('😀'.repeat(11)).length).toBe(false);
  });

  it('the email itself is rejected, case- and space-insensitively', () => {
    expect(met('ana@example.com').notEmail).toBe(false);
    expect(met('ANA@Example.com').notEmail).toBe(false);
    expect(met(' ana@example.com ').notEmail).toBe(false);
    expect(met('ana@example.com!').notEmail).toBe(true);
    expect(met('correct horse battery').notEmail).toBe(true);
  });

  it('with no email known the email rule cannot fail', () => {
    expect(met('whatever-password', 'whatever-password', '').notEmail).toBe(true);
  });

  it('confirmation must match exactly', () => {
    expect(met('abcdefghijkl', 'abcdefghijkl').match).toBe(true);
    expect(met('abcdefghijkl', 'abcdefghijkL').match).toBe(false);
    expect(met('abcdefghijkl', '').match).toBe(false);
  });

  it('allMet', () => {
    expect(allMet(checkPassword('correct horse battery', 'correct horse battery', 'a@b.co'))).toBe(true);
    expect(allMet(checkPassword('short', 'short', 'a@b.co'))).toBe(false);
  });
});
