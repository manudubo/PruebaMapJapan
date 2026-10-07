import { Resend } from 'resend';
import type { Env } from '../types';
import { isDevelopment } from '../config/environment';
import { isSafeAddress, parseMailbox, sendSmtpMail, type SmtpConfig, type SmtpSecurity } from '../email/smtp';

/** Local Mailpit HTTP API (Workers cannot speak raw SMTP). Development only. */
export const MAILPIT_SEND_URL = 'http://localhost:8025/api/v1/send';

/** Kept for existing Resend deployments that never set EMAIL_FROM. */
export const DEFAULT_RESEND_FROM = 'TravelMap <noreply@travelmap.app>';

/** Thrown when the deployment cannot deliver OTP email at all. */
export class OtpEmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpEmailConfigError';
  }
}

export type EmailProvider = 'resend' | 'smtp' | 'mailpit';

type EmailEnv = Pick<
  Env,
  | 'RESEND_API_KEY'
  | 'ENVIRONMENT'
  | 'EMAIL_PROVIDER'
  | 'EMAIL_FROM'
  | 'SMTP_FROM'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
  | 'SMTP_PASS'
>;

export type EmailConfig =
  | { provider: 'resend'; apiKey: string; from: string }
  | { provider: 'smtp'; smtp: SmtpConfig }
  | { provider: 'mailpit' };

const set = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * SEC-08: which transport to use is explicit configuration, never a guess.
 *
 *   EMAIL_PROVIDER=resend|smtp   (optional; otherwise inferred:)
 *     RESEND_API_KEY set         → resend
 *     else SMTP_HOST set         → smtp
 *     else ENVIRONMENT=development → local Mailpit
 *     else                       → OtpEmailConfigError (before any code is issued)
 *
 * SMTP (e.g. Gmail + app password — needs no domain of your own):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE=starttls|tls|none (starttls; none
 *   only in development), SMTP_USER + SMTP_PASS (both or neither),
 *   EMAIL_FROM (alias SMTP_FROM) required — Gmail rewrites any other From to
 *   the account address anyway.
 *
 * Every misconfiguration throws OtpEmailConfigError with a message naming the
 * setting; the message never contains a secret value.
 */
export function resolveEmailConfig(env: EmailEnv): EmailConfig {
  const dev = isDevelopment(env);
  const explicit = env.EMAIL_PROVIDER?.trim().toLowerCase();
  let provider: EmailProvider;
  if (explicit) {
    if (explicit !== 'resend' && explicit !== 'smtp') {
      throw new OtpEmailConfigError(`EMAIL_PROVIDER must be "resend" or "smtp" (got ${JSON.stringify(explicit.slice(0, 20))})`);
    }
    provider = explicit;
  } else if (set(env.RESEND_API_KEY)) provider = 'resend';
  else if (set(env.SMTP_HOST)) provider = 'smtp';
  else if (dev) return { provider: 'mailpit' };
  else {
    throw new OtpEmailConfigError(
      'No OTP email provider: set RESEND_API_KEY, or SMTP_HOST/EMAIL_FROM (EMAIL_PROVIDER=smtp); ' +
        'ENVIRONMENT is not "development", so refusing to fall back to local Mailpit',
    );
  }

  const fromRaw = set(env.EMAIL_FROM) ? env.EMAIL_FROM : set(env.SMTP_FROM) ? env.SMTP_FROM : undefined;
  if (fromRaw !== undefined && !parseMailbox(fromRaw)) {
    throw new OtpEmailConfigError('EMAIL_FROM is not a valid address ("addr@example.com" or "Name <addr@example.com>")');
  }

  if (provider === 'resend') {
    if (!set(env.RESEND_API_KEY)) throw new OtpEmailConfigError('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set');
    return { provider, apiKey: env.RESEND_API_KEY.trim(), from: fromRaw ?? DEFAULT_RESEND_FROM };
  }

  if (!set(env.SMTP_HOST)) throw new OtpEmailConfigError('EMAIL_PROVIDER=smtp but SMTP_HOST is not set');
  const host = env.SMTP_HOST.trim();
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new OtpEmailConfigError('SMTP_HOST must be a host name or IPv4 address');
  if (!fromRaw) throw new OtpEmailConfigError('SMTP needs EMAIL_FROM (e.g. "TravelMap <you@gmail.com>")');

  const portRaw = set(env.SMTP_PORT) ? env.SMTP_PORT.trim() : '587';
  const port = /^\d{1,5}$/.test(portRaw) ? Number(portRaw) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new OtpEmailConfigError('SMTP_PORT must be an integer 1-65535');

  const secRaw = set(env.SMTP_SECURE) ? env.SMTP_SECURE.trim().toLowerCase() : 'starttls';
  if (secRaw !== 'starttls' && secRaw !== 'tls' && secRaw !== 'none') {
    throw new OtpEmailConfigError('SMTP_SECURE must be starttls, tls or none');
  }
  const security = secRaw as SmtpSecurity;
  if (security === 'none' && !dev) {
    throw new OtpEmailConfigError('SMTP_SECURE=none is only allowed when ENVIRONMENT=development');
  }

  const hasUser = set(env.SMTP_USER);
  const hasPass = typeof env.SMTP_PASS === 'string' && env.SMTP_PASS !== '';
  if (hasUser !== hasPass) throw new OtpEmailConfigError('SMTP_USER and SMTP_PASS must be set together');

  return {
    provider: 'smtp',
    smtp: {
      host,
      port,
      security,
      from: fromRaw,
      ...(hasUser ? { user: env.SMTP_USER!.trim(), pass: env.SMTP_PASS! } : {}),
    },
  };
}

/** Provider name; throws OtpEmailConfigError when unusable (call before issuing a code). */
export function otpEmailTransport(env: EmailEnv): EmailProvider {
  return resolveEmailConfig(env).provider;
}

/** For a server entry point: fail at startup instead of on the first OTP request. */
export function assertEmailConfig(env: EmailEnv): EmailProvider {
  return otpEmailTransport(env);
}

/** Test hook: lets SMTP tests trust a private CA. */
let smtpTlsCaForTests: string | undefined;
export function __setSmtpTlsCaForTests(ca: string | undefined): void {
  smtpTlsCaForTests = ca;
}

export async function sendOtpEmail(env: Env, toEmail: string, code: string): Promise<void> {
  // The recipient comes from the token; refuse anything that is not a plain
  // address (no CR/LF, commas or display names) whatever the transport.
  if (!isSafeAddress(toEmail)) throw new Error('refusing to send OTP: recipient is not a plain email address');
  const subject = 'Your TravelMap verification code';
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
  const config = resolveEmailConfig(env);

  if (config.provider === 'resend') {
    const resend = new Resend(config.apiKey);
    // The SDK reports API failures in `error` instead of throwing.
    const { error } = await resend.emails.send({ from: config.from, to: [toEmail], subject, text });
    if (error) throw new Error(`Resend rejected OTP email: ${error.name} ${error.message}`);
    return;
  }

  if (config.provider === 'smtp') {
    await sendSmtpMail({ ...config.smtp, ...(smtpTlsCaForTests ? { tls: { ca: smtpTlsCaForTests } } : {}) }, { to: toEmail, subject, text });
    return;
  }

  const res = await fetch(MAILPIT_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: { Name: 'TravelMap', Email: 'noreply@example.com' },
      To: [{ Name: '', Email: toEmail }],
      Subject: subject,
      Text: text,
    }),
  });
  if (!res.ok) throw new Error(`Mailpit rejected OTP email: HTTP ${res.status}`);
}
