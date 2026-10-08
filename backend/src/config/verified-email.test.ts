import { describe, expect, it } from 'vitest';
import { isValidVerifiedEmailSetting, verifiedEmailRequired } from './verified-email';
import { isEmailVerified } from '../middleware/verified-email';

describe('verifiedEmailRequired', () => {
  it.each([
    [{ ENVIRONMENT: 'production' }, true],
    [{}, true], // missing ENVIRONMENT is production (fail-closed)
    [{ ENVIRONMENT: 'development' }, false],
    [{ ENVIRONMENT: ' Development ' }, false],
    [{ ENVIRONMENT: 'production', REQUIRE_VERIFIED_EMAIL: 'false' }, false],
    [{ ENVIRONMENT: 'production', REQUIRE_VERIFIED_EMAIL: ' FALSE ' }, false],
    [{ ENVIRONMENT: 'development', REQUIRE_VERIFIED_EMAIL: 'true' }, true],
    [{ ENVIRONMENT: 'development', REQUIRE_VERIFIED_EMAIL: '' }, false],
    [{ ENVIRONMENT: 'development', REQUIRE_VERIFIED_EMAIL: 'flase' }, true], // typo -> stricter
    [{ ENVIRONMENT: 'development', REQUIRE_VERIFIED_EMAIL: '0' }, true],
  ])('%j → %s', (env, expected) => {
    expect(verifiedEmailRequired(env)).toBe(expected);
  });

  it('null / undefined env are production', () => {
    expect(verifiedEmailRequired(undefined)).toBe(true);
    expect(verifiedEmailRequired(null)).toBe(true);
  });

  it('boot validation accepts only unset, empty, true, false', () => {
    for (const ok of [undefined, '', 'true', 'false', ' TRUE ']) expect(isValidVerifiedEmailSetting(ok)).toBe(true);
    for (const bad of ['0', 'yes', 'flase', 'on']) expect(isValidVerifiedEmailSetting(bad)).toBe(false);
  });
});

describe('isEmailVerified', () => {
  it('the token claim must be the boolean true', () => {
    expect(isEmailVerified(true, null)).toBe(true);
    for (const claim of [false, 'true', 1, null, undefined, {}, []]) expect(isEmailVerified(claim, null)).toBe(false);
  });

  it('a stored timestamp verifies regardless of the claim', () => {
    expect(isEmailVerified(false, new Date())).toBe(true);
    expect(isEmailVerified(undefined, new Date())).toBe(true);
    expect(isEmailVerified(undefined, undefined)).toBe(false);
  });
});
