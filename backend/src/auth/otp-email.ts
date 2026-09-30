import { Resend } from 'resend';
import type { Env } from '../types';
import { isDevelopment } from '../config/environment';

/** Local Mailpit HTTP API (Workers cannot speak raw SMTP). Development only. */
export const MAILPIT_SEND_URL = 'http://localhost:8025/api/v1/send';

/** Thrown when the deployment cannot deliver OTP email at all. */
export class OtpEmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpEmailConfigError';
  }
}

/**
 * SEC-08: which transport to use is decided by the explicit ENVIRONMENT
 * binding, never by whether RESEND_API_KEY happens to be present.
 *  - RESEND_API_KEY set           → Resend (any environment)
 *  - unset + ENVIRONMENT=development → local Mailpit
 *  - unset otherwise (production, missing or misspelled ENVIRONMENT)
 *                                → OtpEmailConfigError, before any code is issued
 */
export function otpEmailTransport(env: Pick<Env, 'RESEND_API_KEY' | 'ENVIRONMENT'>): 'resend' | 'mailpit' {
  if (env.RESEND_API_KEY && env.RESEND_API_KEY.trim() !== '') return 'resend';
  if (isDevelopment(env)) return 'mailpit';
  throw new OtpEmailConfigError(
    'RESEND_API_KEY is not configured and ENVIRONMENT is not "development" — refusing to fall back to local Mailpit',
  );
}

export async function sendOtpEmail(env: Env, toEmail: string, code: string): Promise<void> {
  const subject = 'Your TravelMap verification code';
  const text = `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;

  if (otpEmailTransport(env) === 'resend') {
    const resend = new Resend(env.RESEND_API_KEY);
    // The SDK reports API failures in `error` instead of throwing.
    const { error } = await resend.emails.send({
      from: 'TravelMap <noreply@travelmap.app>',
      to: [toEmail],
      subject,
      text,
    });
    if (error) {
      throw new Error(`Resend rejected OTP email: ${error.name} ${error.message}`);
    }
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
  if (!res.ok) {
    throw new Error(`Mailpit rejected OTP email: HTTP ${res.status}`);
  }
}
