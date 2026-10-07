/**
 * Local SMTP sink for tests: a real TCP server speaking enough ESMTP
 * (EHLO, STARTTLS, implicit TLS, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA, QUIT)
 * to exercise src/email/smtp.ts end to end, with knobs for failure modes.
 * The TLS certificate is a throwaway self-signed one made with openssl.
 */
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SinkMessage {
  from: string;
  rcpt: string[];
  data: string;
  authUser?: string;
  tls: boolean;
}

export interface SinkOptions {
  mode?: 'plain' | 'starttls' | 'implicit-tls';
  /** Advertise STARTTLS in EHLO (default: true in starttls mode). */
  advertiseStarttls?: boolean;
  /** Required credentials; omit to accept any/no AUTH. */
  auth?: { user: string; pass: string };
  mechanisms?: string[];
  /** Never send the greeting (timeout test). */
  silent?: boolean;
  /** Reply code for RCPT TO (default 250). */
  rcptCode?: number;
}

let certCache: { key: string; cert: string } | null = null;

export function selfSignedCert(): { key: string; cert: string } {
  if (certCache) return certCache;
  const dir = mkdtempSync(join(tmpdir(), 'smtp-sink-'));
  try {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    certCache = { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') };
    return certCache;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface SmtpSink {
  port: number;
  messages: SinkMessage[];
  /** Raw command lines received (for injection assertions). */
  commands: string[];
  close(): Promise<void>;
}

export async function startSmtpSink(opts: SinkOptions = {}): Promise<SmtpSink> {
  const mode = opts.mode ?? 'plain';
  const { key, cert } = selfSignedCert();
  const messages: SinkMessage[] = [];
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const mechs = opts.mechanisms ?? ['PLAIN', 'LOGIN'];

  const handle = (initial: net.Socket, isTls: boolean) => {
    let socket: net.Socket = initial;
    sockets.add(socket);
    let buf = '';
    let secure = isTls;
    let inData = false;
    let data = '';
    let from = '';
    let rcpt: string[] = [];
    let authed: string | undefined;
    let loginStep: 0 | 1 | 2 = 0;
    let loginUser = '';
    const send = (l: string) => socket.write(`${l}\r\n`);
    const ehlo = () => {
      const lines = ['sink.local'];
      if (mode === 'starttls' && !secure && (opts.advertiseStarttls ?? true)) lines.push('STARTTLS');
      lines.push(`AUTH ${mechs.join(' ')}`, '8BITMIME');
      lines.forEach((l, i) => send(`250${i === lines.length - 1 ? ' ' : '-'}${l}`));
    };
    const checkAuth = (u: string, p: string) => {
      if (!opts.auth || (u === opts.auth.user && p === opts.auth.pass)) {
        authed = u;
        send('235 2.7.0 Authentication successful');
      } else send('535 5.7.8 Username and Password not accepted');
    };
    const onLine = (line: string) => {
      if (inData) {
        if (line === '.') {
          inData = false;
          messages.push({ from, rcpt, data, authUser: authed, tls: secure });
          data = '';
          send('250 2.0.0 OK queued');
        } else data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }
      commands.push(line);
      if (loginStep === 1) {
        loginUser = Buffer.from(line, 'base64').toString('utf8');
        loginStep = 2;
        send('334 UGFzc3dvcmQ6');
        return;
      }
      if (loginStep === 2) {
        loginStep = 0;
        checkAuth(loginUser, Buffer.from(line, 'base64').toString('utf8'));
        return;
      }
      const verb = line.split(' ')[0]!.toUpperCase();
      if (verb === 'EHLO') ehlo();
      else if (verb === 'STARTTLS' && mode === 'starttls' && !secure) {
        send('220 2.0.0 Ready to start TLS');
        socket.removeAllListeners('data');
        const upgraded = new tls.TLSSocket(socket, { isServer: true, key, cert });
        socket = upgraded;
        sockets.add(upgraded);
        secure = true;
        buf = '';
        upgraded.on('data', onData);
        upgraded.on('error', () => {});
      } else if (verb === 'AUTH') {
        const [, mech, arg] = line.split(' ');
        if (opts.auth && !secure && mode !== 'plain') send('530 5.7.0 Must issue STARTTLS first');
        else if (mech?.toUpperCase() === 'PLAIN' && arg && mechs.includes('PLAIN')) {
          const [, u = '', p = ''] = Buffer.from(arg, 'base64').toString('utf8').split('\u0000');
          checkAuth(u, p);
        } else if (mech?.toUpperCase() === 'LOGIN' && mechs.includes('LOGIN')) {
          loginStep = 1;
          send('334 VXNlcm5hbWU6');
        } else send('504 5.5.4 Unrecognized authentication type');
      } else if (verb === 'MAIL') {
        if (opts.auth && !authed) return send('530 5.7.0 Authentication Required');
        from = line.slice(10);
        rcpt = [];
        send('250 2.1.0 OK');
      } else if (verb === 'RCPT') {
        rcpt.push(line.slice(8));
        send(`${opts.rcptCode ?? 250} 2.1.5 OK`);
      } else if (verb === 'DATA') {
        inData = true;
        send('354 Go ahead');
      } else if (verb === 'QUIT') {
        send('221 2.0.0 closing');
        socket.end();
      } else send('502 5.5.1 Unrecognized command');
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        onLine(line);
      }
    };
    socket.on('data', onData);
    socket.on('error', () => {});
    if (!opts.silent) send('220 sink.local ESMTP ready');
  };

  const server =
    mode === 'implicit-tls'
      ? tls.createServer({ key, cert }, (s) => handle(s, true))
      : net.createServer((s) => handle(s, false));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    messages,
    commands,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
