/**
 * Strings for the shared "sign-in service unavailable" UI, in the two languages the
 * app's audience uses (English UI, Spanish-speaking travellers). The language follows
 * the browser; the rendered block carries its own `lang` so screen readers switch voice.
 */

const MESSAGES = {
  en: {
    unavailableTitle: "Can't reach the sign-in service",
    unavailableBody:
      "This page needs you to be signed in, and the sign-in service isn't responding right now. Check your connection and try again.",
    offlineBody: "You appear to be offline. We'll try again automatically when you're back online.",
    stillUnavailable: 'Still no response from the sign-in service.',
    retry: 'Retry',
    retrying: 'Retrying…',
    home: 'Back to home',
    checking: 'Checking sign-in…',
    notice: "Can't reach the sign-in service right now. You can keep browsing the demo.",
    dismiss: 'Dismiss',
  },
  es: {
    unavailableTitle: 'No se puede conectar con el servicio de inicio de sesión',
    unavailableBody:
      'Esta página requiere iniciar sesión y el servicio de inicio de sesión no responde en este momento. Revisa tu conexión e inténtalo de nuevo.',
    offlineBody: 'Parece que no tienes conexión. Volveremos a intentarlo automáticamente cuando vuelvas a estar en línea.',
    stillUnavailable: 'El servicio de inicio de sesión sigue sin responder.',
    retry: 'Reintentar',
    retrying: 'Reintentando…',
    home: 'Volver al inicio',
    checking: 'Comprobando la sesión…',
    notice: 'No se puede conectar con el servicio de inicio de sesión. Puedes seguir viendo la demo.',
    dismiss: 'Cerrar',
  },
} as const;

export type AuthLocale = keyof typeof MESSAGES;
export type AuthMessageKey = keyof (typeof MESSAGES)['en'];

export const AUTH_LOCALES = Object.keys(MESSAGES) as AuthLocale[];

/** First supported browser language, English otherwise. */
export function authLocale(languages: readonly string[] = navigatorLanguages()): AuthLocale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0] as AuthLocale;
    if (base in MESSAGES) return base;
  }
  return 'en';
}

export function authText(key: AuthMessageKey, locale: AuthLocale = authLocale()): string {
  return MESSAGES[locale][key];
}

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
