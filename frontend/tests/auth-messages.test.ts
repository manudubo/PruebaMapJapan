// Every auth UI string exists in both languages, and placeholders survive translation.
import { describe, it, expect } from 'vitest';
import { authText, authFormat, AUTH_LOCALES, type AuthMessageKey } from '@/auth/authMessages';

const KEYS = Object.keys(
  (await import('@/auth/authMessages')).__MESSAGES_FOR_TESTS.en,
) as AuthMessageKey[];
const SAME_IN_BOTH = new Set<AuthMessageKey>(['dismiss']);

describe('auth messages', () => {
  it('has the same keys in every locale', () => {
    for (const locale of AUTH_LOCALES) {
      for (const key of KEYS) expect(authText(key, locale), `${locale}.${key}`).toBeTruthy();
    }
  });

  it.each(KEYS)('%s: es is translated and keeps the same placeholders', (key) => {
    const en = authText(key, 'en');
    const es = authText(key, 'es');
    if (!SAME_IN_BOTH.has(key)) expect(es).not.toBe(en);
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    expect(holes(es)).toEqual(holes(en));
  });

  it('authFormat fills placeholders and leaves unknown ones', () => {
    expect(authFormat('resendIn', { s: 42 }, 'en')).toBe('Resend code in 42s');
    expect(authFormat('verifyBody', {}, 'en')).toContain('{email}');
    expect(authFormat('verifyBody', { email: 'a@b.c' }, 'es')).toContain('a@b.c');
  });
});
