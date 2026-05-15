import { describe, it, expect } from 'vitest';
import { validateAudience } from './keycloak';

describe('validateAudience — SEC-04', () => {
  const valid = ['japan-trip-frontend'];

  it('accepts japan-trip-frontend as a single string', () => {
    expect(validateAudience('japan-trip-frontend', valid)).toBe(true);
  });

  it('accepts japan-trip-frontend in an array', () => {
    expect(validateAudience(['japan-trip-frontend'], valid)).toBe(true);
  });

  it('rejects account audience', () => {
    expect(validateAudience('account', valid)).toBe(false);
  });

  it('rejects japan-trip-api audience', () => {
    expect(validateAudience('japan-trip-api', valid)).toBe(false);
  });

  it('rejects array containing only account', () => {
    expect(validateAudience(['account', 'japan-trip-api'], valid)).toBe(false);
  });

  it('accepts array containing japan-trip-frontend alongside others', () => {
    expect(validateAudience(['some-other', 'japan-trip-frontend'], valid)).toBe(true);
  });

  it('returns false for undefined aud', () => {
    expect(validateAudience(undefined, valid)).toBe(false);
  });
});
