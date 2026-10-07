import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { SmtpError, buildMessage, isSafeAddress, parseMailbox, sendSmtpMail, type SmtpConfig } from './smtp';
import { selfSignedCert, startSmtpSink, type SmtpSink } from '../test-utils/smtp-sink';

let sink: SmtpSink | undefined;
afterEach(async () => {
  await sink?.close();
  sink = undefined;
});

const ca = () => selfSignedCert().cert;
const MSG = { to: 'traveller@example.org', subject: 'Your TravelMap verification code', text: 'Your verification code is: 123456' };

function cfg(port: number, over: Partial<SmtpConfig> = {}): SmtpConfig {
  return { host: 'localhost', port, security: 'starttls', from: 'TravelMap <owner@gmail.com>', user: 'owner@gmail.com', pass: 'abcd efgh ijkl mnop', tls: { ca: ca() }, timeoutMs: 2000, ...over };
}

function decodeBody(data: string): string {
  const body = data.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, '');
  return Buffer.from(body, 'base64').toString('utf8');
}

describe('SMTP: happy paths against a local sink', () => {
  it('STARTTLS + AUTH PLAIN (Gmail-style, port 587)', async () => {
    sink = await startSmtpSink({ mode: 'starttls', auth: { user: 'owner@gmail.com', pass: 'abcd efgh ijkl mnop' } });
    await sendSmtpMail(cfg(sink.port), MSG);
    expect(sink.messages).toHaveLength(1);
    const m = sink.messages[0]!;
    expect(m.tls).toBe(true);
    expect(m.authUser).toBe('owner@gmail.com');
    expect(m.from).toBe('<owner@gmail.com>');
    expect(m.rcpt).toEqual(['<traveller@example.org>']);
    expect(m.data).toContain('From: "TravelMap" <owner@gmail.com>');
    expect(m.data).toContain('To: <traveller@example.org>');
    expect(decodeBody(m.data)).toBe(MSG.text);
    // AUTH happened only after TLS: the password never crossed in plaintext.
    const starttlsAt = sink.commands.indexOf('STARTTLS');
    const authAt = sink.commands.findIndex((c) => c.startsWith('AUTH'));
    expect(starttlsAt).toBeGreaterThanOrEqual(0);
    expect(authAt).toBeGreaterThan(starttlsAt);
  });

  it('implicit TLS (port 465) + AUTH LOGIN', async () => {
    sink = await startSmtpSink({ mode: 'implicit-tls', auth: { user: 'u@example.com', pass: 'p' }, mechanisms: ['LOGIN'] });
    await sendSmtpMail(cfg(sink.port, { security: 'tls', user: 'u@example.com', pass: 'p' }), MSG);
    expect(sink.messages[0]?.tls).toBe(true);
    expect(sink.messages[0]?.authUser).toBe('u@example.com');
  });

  it('plain (development relay, no auth)', async () => {
    sink = await startSmtpSink({ mode: 'plain' });
    await sendSmtpMail(cfg(sink.port, { security: 'none', user: undefined, pass: undefined }), MSG);
    expect(sink.messages[0]?.tls).toBe(false);
  });

  it('UTF-8 subject/body are encoded, not sent raw', async () => {
    sink = await startSmtpSink({ mode: 'plain' });
    await sendSmtpMail(cfg(sink.port, { security: 'none', user: undefined }), { ...MSG, subject: 'Código 東京', text: 'Hola José — 東京' });
    const d = sink.messages[0]!.data;
    expect(d).toContain('Subject: =?UTF-8?B?');
    expect(decodeBody(d)).toBe('Hola José — 東京');
  });
});

describe('SMTP: failures are loud and specific', () => {
  it('wrong app password → SmtpError at auth with 535, password not in the message', async () => {
    sink = await startSmtpSink({ mode: 'starttls', auth: { user: 'owner@gmail.com', pass: 'right' } });
    const err = await sendSmtpMail(cfg(sink.port, { pass: 'wrong-secret-pw' }), MSG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect((err as SmtpError).stage).toBe('auth');
    expect((err as SmtpError).replyCode).toBe(535);
    expect(String((err as Error).message)).not.toContain('wrong-secret-pw');
    expect(sink.messages).toHaveLength(0);
  });

  it('STARTTLS stripped by a MITM → refuses to authenticate in plaintext', async () => {
    sink = await startSmtpSink({ mode: 'starttls', advertiseStarttls: false });
    const err = await sendSmtpMail(cfg(sink.port), MSG).catch((e: unknown) => e);
    expect((err as SmtpError).stage).toBe('starttls');
    expect(sink.commands.some((c) => c.startsWith('AUTH'))).toBe(false);
  });

  it('untrusted certificate → TLS failure, no fallback', async () => {
    sink = await startSmtpSink({ mode: 'starttls' });
    const err = await sendSmtpMail(cfg(sink.port, { tls: undefined }), MSG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect((err as Error).message).toMatch(/TLS|certificate/i);
    expect(sink.messages).toHaveLength(0);
  });

  it('implicit TLS with an untrusted certificate → rejected too', async () => {
    sink = await startSmtpSink({ mode: 'implicit-tls' });
    const err = await sendSmtpMail(cfg(sink.port, { security: 'tls', tls: undefined }), MSG).catch((e: unknown) => e);
    expect((err as SmtpError).stage).toBe('connect');
    expect(sink.messages).toHaveLength(0);
  });

  it('server down (connection refused) → connect error', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    await new Promise<void>((r) => srv.close(() => r()));
    const err = await sendSmtpMail(cfg(port), MSG).catch((e: unknown) => e);
    expect((err as SmtpError).stage).toBe('connect');
  });

  it('server accepts TCP but never greets → step timeout', async () => {
    sink = await startSmtpSink({ silent: true });
    const t0 = Date.now();
    const err = await sendSmtpMail(cfg(sink.port, { timeoutMs: 300 }), MSG).catch((e: unknown) => e);
    expect((err as SmtpError).stage).toBe('greeting');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('recipient refused → rcpt-to error', async () => {
    sink = await startSmtpSink({ mode: 'plain', rcptCode: 550 });
    const err = await sendSmtpMail(cfg(sink.port, { security: 'none', user: undefined }), MSG).catch((e: unknown) => e);
    expect((err as SmtpError).stage).toBe('rcpt-to');
  });
});

describe('SMTP: header / command injection', () => {
  it.each([
    'victim@example.org\r\nBcc: everyone@example.org',
    'victim@example.org>\r\nRCPT TO:<other@example.org',
    'a@b.co\nX: y',
    'a@b.co, c@d.co',
    '<a@b.co>',
    'a b@c.co',
    '"quoted"@example.org',
    'a@localhost',
    'a@b.co\u0000',
    `${'a'.repeat(250)}@b.co`,
  ])('recipient %j is rejected before connecting', async (to) => {
    sink = await startSmtpSink({ mode: 'plain' });
    const err = await sendSmtpMail(cfg(sink.port, { security: 'none', user: undefined }), { ...MSG, to }).catch((e: unknown) => e);
    expect((err as SmtpError).stage).toBe('compose');
    expect(sink.commands).toEqual([]);
  });

  it.each(['Hi\r\nBcc: x@y.co', 'Hi\nX: 1', 'Hi\u0007'])('subject %j is rejected', (subject) => {
    expect(() => buildMessage({ address: 'a@b.co' }, { ...MSG, subject })).toThrow(SmtpError);
  });

  it('a body line starting with "." cannot end DATA early', async () => {
    sink = await startSmtpSink({ mode: 'plain' });
    await sendSmtpMail(cfg(sink.port, { security: 'none', user: undefined }), { ...MSG, text: 'line\n.\nMAIL FROM:<x@y.co>\n.' });
    expect(sink.messages).toHaveLength(1);
    expect(sink.commands.filter((c) => c.startsWith('MAIL'))).toHaveLength(1);
  });

  it('From parsing', () => {
    expect(parseMailbox('owner@gmail.com')).toEqual({ address: 'owner@gmail.com' });
    expect(parseMailbox('TravelMap <owner@gmail.com>')).toEqual({ name: 'TravelMap', address: 'owner@gmail.com' });
    expect(parseMailbox('"Travel Map" <owner@gmail.com>')).toEqual({ name: 'Travel Map', address: 'owner@gmail.com' });
    expect(parseMailbox('Evil\r\nBcc: x@y.co <owner@gmail.com>')).toBeNull();
    expect(parseMailbox('a"b <owner@gmail.com>')).toBeNull();
    expect(parseMailbox('not-an-address')).toBeNull();
    expect(isSafeAddress('owner+otp@gmail.com')).toBe(true);
  });
});
