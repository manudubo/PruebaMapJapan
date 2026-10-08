/**
 * Strings for the shared auth UI (sign-in status, sign-up, email verification, passkey
 * onboarding, account recovery), in the two languages the
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
    // Sign-up return notices (src/auth/registration.ts)
    signupIncomplete:
      "Sign-up wasn't completed. If the sign-up page showed an error, new accounts may be closed right now. Try again later, or sign in if you already have an account.",
    signupCancelled: 'Sign-up was cancelled. You can try again whenever you like.',
    signupUnavailable: "Sign-up isn't available right now. Please try again later.",
    // Email verification at sign-up (src/auth/verifyEmail.ts)
    verifyTitle: 'Verify your email',
    verifyBody: 'We sent a 6-digit code to {email}. Enter it below to finish creating your account.',
    verifyBodyNoEmail: 'We sent a 6-digit code to your email address. Enter it below to finish creating your account.',
    codeLegend: 'Verification code',
    codeDigit: 'Digit {n} of 6',
    verifySubmit: 'Verify',
    verifying: 'Verifying…',
    resendCode: 'Resend code',
    resendIn: 'Resend code in {s}s',
    codeSent: 'We sent you a new code.',
    codeWrong: "That code isn't right. Check it and try again.",
    codeWrongAttempts: "That code isn't right. Attempts left: {n}.",
    codeExpired: 'That code has expired. Request a new one.',
    codeLocked: 'Too many attempts. Request a new code.',
    rateLimited: 'Too many requests. Try again in {s}s.',
    networkError: "Couldn't reach the server. Check your connection and try again.",
    codeIncomplete: 'Enter all 6 digits of the code.',
    spamHint: "Didn't get it? Check your spam folder, or resend the code.",
    otherAccount: 'Use a different account',
    verified: 'Email verified. Welcome aboard!',
    // New-user passkey onboarding (src/modules/passkeyCampaign.ts)
    onboardTitle: 'Welcome! Sign in faster with a passkey',
    onboardBody:
      "A passkey lets you sign in with your fingerprint, face or screen lock, so there's no password to remember or leak.",
    onboardCreate: 'Create a passkey',
    onboardLater: 'Not now',
    onboardNever: "Don't ask again",
    onboardStartFailed: "Couldn't open passkey setup. Please try again.",
    passkeyNotCreated: 'No passkey was created. You can add one anytime from your profile.',
    passkeyCreated: 'Passkey created. Use it next time you sign in.',
    // Account recovery (recover.html, src/pages/recover.ts)
    recoverTitle: "Can't use your passkey?",
    recoverIntro: 'Get a code by email and set a password, so you can sign in on this device.',
    emailLabel: 'Email address',
    sendCode: 'Send code',
    sending: 'Sending…',
    recoverSent:
      'If an account exists for {email}, we sent a 6-digit code to it. Enter it below with your new password.',
    differentEmail: 'Use a different email',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    show: 'Show',
    hide: 'Hide',
    rulesHeading: 'Password requirements',
    ruleLength: 'At least 12 characters',
    ruleNotEmail: 'Not your email address',
    ruleMatch: 'Both passwords match',
    ruleMet: 'met',
    ruleUnmet: 'not met',
    setPassword: 'Set new password',
    saving: 'Saving…',
    recoverDoneTitle: 'Your password is set',
    recoverDoneBody: 'You can now sign in with your email address and your new password.',
    signIn: 'Sign in',
    invalidEmail: 'Enter a valid email address.',
    passwordUnmet: "Your password doesn't meet the requirements yet.",
    recoverCodeInvalid: "That code isn't valid or has expired. Check it, or request a new one.",
    passwordRejected: "That password can't be used. Choose a different one.",
    // Password backup campaign (profile.html)
    pwBackupTitle: 'Add a password as a backup',
    pwBackupBody: 'If you ever sign in on a device without passkey support, a password still lets you in.',
    pwBackupAction: 'Add a password',
    pwBackupLater: 'Not now',
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
    signupIncomplete:
      'El registro no se completó. Si la página de registro mostró un error, puede que no se estén aceptando cuentas nuevas ahora. Inténtalo más tarde, o inicia sesión si ya tienes una cuenta.',
    signupCancelled: 'Se interrumpió el registro. Puedes intentarlo de nuevo cuando quieras.',
    signupUnavailable: 'El registro no está disponible en este momento. Inténtalo más tarde.',
    verifyTitle: 'Verifica tu correo',
    verifyBody: 'Enviamos un código de 6 dígitos a {email}. Escríbelo abajo para terminar de crear tu cuenta.',
    verifyBodyNoEmail: 'Enviamos un código de 6 dígitos a tu correo. Escríbelo abajo para terminar de crear tu cuenta.',
    codeLegend: 'Código de verificación',
    codeDigit: 'Dígito {n} de 6',
    verifySubmit: 'Verificar',
    verifying: 'Verificando…',
    resendCode: 'Reenviar código',
    resendIn: 'Reenviar código en {s} s',
    codeSent: 'Te enviamos un código nuevo.',
    codeWrong: 'Ese código no es correcto. Revísalo e inténtalo de nuevo.',
    codeWrongAttempts: 'Ese código no es correcto. Intentos restantes: {n}.',
    codeExpired: 'Ese código venció. Pide uno nuevo.',
    codeLocked: 'Demasiados intentos. Pide un código nuevo.',
    rateLimited: 'Demasiadas solicitudes. Inténtalo de nuevo en {s} s.',
    networkError: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    codeIncomplete: 'Escribe los 6 dígitos del código.',
    spamHint: '¿No te llegó? Revisa la carpeta de spam o reenvía el código.',
    otherAccount: 'Usar otra cuenta',
    verified: 'Correo verificado. ¡Bienvenido!',
    onboardTitle: '¡Bienvenido! Inicia sesión más rápido con una passkey',
    onboardBody:
      'Una passkey te permite iniciar sesión con tu huella, tu rostro o el bloqueo de pantalla, sin contraseñas que recordar ni filtrar.',
    onboardCreate: 'Crear una passkey',
    onboardLater: 'Ahora no',
    onboardNever: 'No volver a preguntar',
    onboardStartFailed: 'No se pudo abrir la configuración de la passkey. Inténtalo de nuevo.',
    passkeyNotCreated: 'No se creó ninguna passkey. Puedes crear una cuando quieras desde tu perfil.',
    passkeyCreated: 'Passkey creada. Úsala la próxima vez que inicies sesión.',
    recoverTitle: '¿No puedes usar tu passkey?',
    recoverIntro: 'Recibe un código por correo y crea una contraseña para iniciar sesión en este dispositivo.',
    emailLabel: 'Correo electrónico',
    sendCode: 'Enviar código',
    sending: 'Enviando…',
    recoverSent:
      'Si existe una cuenta para {email}, le enviamos un código de 6 dígitos. Escríbelo abajo junto con tu nueva contraseña.',
    differentEmail: 'Usar otro correo',
    newPassword: 'Nueva contraseña',
    confirmPassword: 'Confirma la nueva contraseña',
    showPassword: 'Mostrar contraseña',
    hidePassword: 'Ocultar contraseña',
    show: 'Mostrar',
    hide: 'Ocultar',
    rulesHeading: 'Requisitos de la contraseña',
    ruleLength: 'Al menos 12 caracteres',
    ruleNotEmail: 'Distinta de tu correo',
    ruleMatch: 'Las dos contraseñas coinciden',
    ruleMet: 'cumplido',
    ruleUnmet: 'pendiente',
    setPassword: 'Establecer contraseña',
    saving: 'Guardando…',
    recoverDoneTitle: 'Tu contraseña está lista',
    recoverDoneBody: 'Ya puedes iniciar sesión con tu correo y tu nueva contraseña.',
    signIn: 'Iniciar sesión',
    invalidEmail: 'Escribe un correo válido.',
    passwordUnmet: 'Tu contraseña todavía no cumple los requisitos.',
    recoverCodeInvalid: 'Ese código no es válido o venció. Revísalo o pide uno nuevo.',
    passwordRejected: 'Esa contraseña no se puede usar. Elige otra.',
    pwBackupTitle: 'Crea una contraseña de respaldo',
    pwBackupBody: 'Si alguna vez inicias sesión en un dispositivo sin passkeys, una contraseña te permitirá entrar.',
    pwBackupAction: 'Crear una contraseña',
    pwBackupLater: 'Ahora no',
  },
} as const;

export type AuthLocale = keyof typeof MESSAGES;
export type AuthMessageKey = keyof (typeof MESSAGES)['en'];

export const AUTH_LOCALES = Object.keys(MESSAGES) as AuthLocale[];

/** Test-only: the raw table (tests/auth-messages.test.ts checks key parity). */
export const __MESSAGES_FOR_TESTS = MESSAGES;

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

/** authText with `{name}` placeholders filled in. */
export function authFormat(
  key: AuthMessageKey,
  vars: Record<string, string | number>,
  locale: AuthLocale = authLocale(),
): string {
  return authText(key, locale).replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
