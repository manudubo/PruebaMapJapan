import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password-policy';

const email = 'someone@example.test';

describe('passwordProblem', () => {
  it.each([
    ['a'.repeat(12), null],
    ['a'.repeat(128), null],
    ['a'.repeat(11), 'too_short'],
    ['a'.repeat(129), 'too_long'],
    ['x'.repeat(100_000), 'too_long'],
    ['ok password\u0000x', 'contains_nul'],
    ['            ', 'blank'],
    [email, 'matches_email'],
    ['SOMEONE@EXAMPLE.TEST', 'matches_email'],
    ['someone@example', 'matches_email'],
    ['pre-someone@example.test-post', 'matches_email'],
    ['😀'.repeat(12), null],
    ['😀'.repeat(11), 'too_short'],
  ])('%j -> %s', (pw, expected) => {
    expect(passwordProblem(pw, email)).toBe(expected);
  });
});
