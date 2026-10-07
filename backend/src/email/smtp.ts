/**
 * Minimal SMTP submission client (RFC 5321 + STARTTLS RFC 3207 + AUTH
 * PLAIN/LOGIN RFC 4954) for the self-hosted Node backend — e.g. Gmail with an
 * app password, which needs no domain of your own.
 *
 * Why not nodemailer: we send exactly one kind of message (a short UTF-8 text
 * OTP email), and ~250 lines with no dependency are easier to audit than a
 * large library in the auth path.
 *
 * Security properties:
 *  - `starttls` mode REQUIRES the server to offer STARTTLS and upgrades before
 *    AUTH; there is no silent fallback to plaintext (a stripped STARTTLS
 *    capability is an error, not a downgrade).
 *  - TLS certificates are verified against the system CA store with SNI =
 *    host (tests inject a private CA through `tls.ca`; nothing in env can turn
 *    verification off).
 *  - Every address and the subject are validated: CR, LF and other control
 *    characters are rejected, so no header or SMTP command injection.
 *  - Every step has a timeout and the whole exchange has a deadline.
 *  - Errors never contain the password; server replies are truncated.
 *
 * Node-only (node:net / node:tls are loaded lazily); on Workers use Resend.
 */

export type SmtpSecurity = 'starttls' | 'tls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user?: string;
  pass?: string;
  /** Envelope + header sender: "addr@x" or "Name <addr@x>". */
  from: string;
  /** Per-step timeout (default 10 s). */
  timeoutMs?: number;
  /** Whole-exchange deadline (default 30 s). */
  deadlineMs?: number;
  /** EHLO name (default "localhost"). */
  heloName?: string;
  /** Test hook only: extra trusted CA (PEM). */
  tls?: { ca?: string };
}

export interface SmtpMessage {
  to: string;
  subject: string;
  text: string;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly stage: string,
    readonly replyCode?: number,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Conservative addr-spec: dot-atom local part, LDH domain with a TLD. */
const ADDR_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function isSafeAddress(addr: string): boolean {
  return addr.length <= 254 && !CONTROL_RE.test(addr) && ADDR_RE.test(addr);
}

/** Parse "addr" or "Display Name <addr>"; null when unsafe. */
export function parseMailbox(value: string): { name?: string; address: string } | null {
  const v = value.trim();
  if (CONTROL_RE.test(v)) return null;
  const m = /^(.*?)\s*<([^<>]+)>$/.exec(v);
  if (m) {
    const name = m[1]!.trim().replace(/^"(.*)"$/, '$1');
    if (/["\\<>]/.test(name)) return null;
    return isSafeAddress(m[2]!) ? { name: name || undefined, address: m[2]! } : null;
  }
  return isSafeAddress(v) ? { address: v } : null;
}

/** UTF-8 to base64 without Node's global (keeps this file Workers-typecheckable). */
function b64(value: string): string {
  let bin = '';
  for (const byte of new TextEncoder().encode(value)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function encodeHeaderWord(value: string): string {
  // RFC 2047 only when needed; ASCII printable stays readable.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

function formatMailbox(m: { name?: string; address: string }): string {
  return m.name ? `"${encodeHeaderWord(m.name)}" <${m.address}>` : `<${m.address}>`;
}

/** Full RFC 5322 message with a base64 body (no line-length/8-bit/dot issues). */
export function buildMessage(from: { name?: string; address: string }, msg: SmtpMessage, now = new Date()): string {
  if (!isSafeAddress(msg.to)) throw new SmtpError('invalid recipient address', 'compose');
  if (CONTROL_RE.test(msg.subject) || msg.subject.length > 200) throw new SmtpError('invalid subject', 'compose');
  const domain = from.address.split('@')[1]!;
  const id = `${crypto.randomUUID()}@${domain}`;
  const body = b64(msg.text.replace(/\r?\n/g, '\r\n'))
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${formatMailbox(from)}`,
    `To: <${msg.to}>`,
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    body,
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

interface Reply {
  code: number;
  lines: string[];
}

type NodeSocket = import('node:net').Socket;

class SmtpConnection {
  private buffer = '';
  private waiters: Array<() => void> = [];
  private closedError: Error | null = null;

  constructor(
    private socket: NodeSocket,
    private readonly timeoutMs: number,
  ) {
    this.attach(socket);
  }

  private attach(socket: NodeSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 64 * 1024) {
        this.fail(new SmtpError('server reply too large', 'read'));
        return;
      }
      this.wake();
    });
    socket.on('error', (err) => this.fail(new SmtpError(`connection error: ${err.message}`, 'socket')));
    socket.on('close', () => this.fail(new SmtpError('connection closed by server', 'socket')));
  }

  private fail(err: Error) {
    this.closedError ??= err;
    this.wake();
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  /** Read one complete (possibly multi-line) reply. */
  async read(stage: string): Promise<Reply> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const reply = this.tryParse();
      if (reply) return reply;
      if (this.closedError) throw new SmtpError(`${stage}: ${this.closedError.message}`, stage);
      const left = deadline - Date.now();
      if (left <= 0) throw new SmtpError(`${stage}: timed out waiting for the server`, stage);
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t);
          this.waiters = this.waiters.filter((w) => w !== done);
          resolve();
        };
        const t = setTimeout(done, left);
        this.waiters.push(done);
      });
    }
  }

  private tryParse(): Reply | null {
    const lines: string[] = [];
    let offset = 0;
    for (;;) {
      const end = this.buffer.indexOf('\r\n', offset);
      if (end === -1) return null;
      const line = this.buffer.slice(offset, end);
      offset = end + 2;
      const m = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!m) {
        this.buffer = this.buffer.slice(offset);
        throw new SmtpError('malformed server reply', 'read');
      }
      lines.push(m[3]!);
      if (m[2] === ' ') {
        this.buffer = this.buffer.slice(offset);
        return { code: Number(m[1]), lines };
      }
    }
  }

  write(data: string) {
    this.socket.write(data);
  }

  async command(line: string, expect: number[], stage: string): Promise<Reply> {
    this.write(`${line}\r\n`);
    return this.expect(expect, stage);
  }

  async expect(codes: number[], stage: string): Promise<Reply> {
    const reply = await this.read(stage);
    if (!codes.includes(reply.code)) {
      const text = reply.lines.join(' ').slice(0, 200);
      throw new SmtpError(`${stage} rejected: ${reply.code} ${text}`, stage, reply.code);
    }
    return reply;
  }

  /** Replace the plaintext socket by a TLS one after STARTTLS. */
  async upgrade(host: string, ca: string | undefined): Promise<void> {
    const tls = await import('node:tls');
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    const secure = await new Promise<NodeSocket>((resolve, reject) => {
      const s = tls.connect({ socket: plain, servername: host, ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
      const t = setTimeout(() => reject(new SmtpError('STARTTLS handshake timed out', 'starttls')), this.timeoutMs);
      s.once('secureConnect', () => {
        clearTimeout(t);
        resolve(s);
      });
      s.once('error', (err) => {
        clearTimeout(t);
        reject(new SmtpError(`TLS handshake failed: ${err.message}`, 'starttls'));
      });
    });
    this.socket = secure;
    this.buffer = '';
    this.attach(secure);
  }

  close() {
    this.socket.destroy();
  }
}

async function openSocket(cfg: SmtpConfig, timeoutMs: number): Promise<NodeSocket> {
  const ca = cfg.tls?.ca;
  if (cfg.security === 'tls') {
    const tls = await import('node:tls');
    return new Promise((resolve, reject) => {
      const s = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
      const t = setTimeout(() => {
        s.destroy();
        reject(new SmtpError('connect timed out', 'connect'));
      }, timeoutMs);
      s.once('secureConnect', () => {
        clearTimeout(t);
        resolve(s);
      });
      s.once('error', (err) => {
        clearTimeout(t);
        reject(new SmtpError(`connect failed: ${err.message}`, 'connect'));
      });
    });
  }
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: cfg.host, port: cfg.port });
    const t = setTimeout(() => {
      s.destroy();
      reject(new SmtpError('connect timed out', 'connect'));
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.once('error', (err) => {
      clearTimeout(t);
      reject(new SmtpError(`connect failed: ${err.message}`, 'connect'));
    });
  });
}

function extensions(reply: Reply): Set<string> {
  return new Set(reply.lines.slice(1).map((l) => l.trim().toUpperCase()));
}

export async function sendSmtpMail(cfg: SmtpConfig, msg: SmtpMessage): Promise<void> {
  const from = parseMailbox(cfg.from);
  if (!from) throw new SmtpError('invalid From address', 'compose');
  const data = buildMessage(from, msg); // validates recipient + subject before connecting
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  const deadlineMs = cfg.deadlineMs ?? 30_000;
  const helo = cfg.heloName ?? 'localhost';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(helo)) throw new SmtpError('invalid EHLO name', 'compose');

  const socket = await openSocket(cfg, timeoutMs);
  const conn = new SmtpConnection(socket, timeoutMs);
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      conn.close();
      reject(new SmtpError('SMTP exchange exceeded its deadline', 'deadline'));
    }, deadlineMs);
  });
  try {
    await Promise.race([deadline, exchange(conn, cfg, from.address, msg.to, data, helo)]);
  } finally {
    clearTimeout(deadlineTimer);
    conn.close();
  }
}

async function exchange(conn: SmtpConnection, cfg: SmtpConfig, fromAddr: string, to: string, data: string, helo: string) {
  await conn.expect([220], 'greeting');
  let ehlo = await conn.command(`EHLO ${helo}`, [250], 'ehlo');
  let exts = extensions(ehlo);

  if (cfg.security === 'starttls') {
    if (!exts.has('STARTTLS')) {
      throw new SmtpError('server does not offer STARTTLS; refusing to continue in plaintext', 'starttls');
    }
    await conn.command('STARTTLS', [220], 'starttls');
    await conn.upgrade(cfg.host, cfg.tls?.ca);
    ehlo = await conn.command(`EHLO ${helo}`, [250], 'ehlo');
    exts = extensions(ehlo);
  }

  if (cfg.user) {
    const pass = cfg.pass ?? '';
    const auth = [...exts].find((e) => e.startsWith('AUTH ') || e.startsWith('AUTH='));
    const mechs = new Set((auth ?? '').slice(5).split(/\s+/));
    if (mechs.has('PLAIN')) {
      const token = b64(`\u0000${cfg.user}\u0000${pass}`);
      await conn.command(`AUTH PLAIN ${token}`, [235], 'auth');
    } else if (mechs.has('LOGIN')) {
      await conn.command('AUTH LOGIN', [334], 'auth');
      await conn.command(b64(cfg.user), [334], 'auth');
      await conn.command(b64(pass), [235], 'auth');
    } else {
      throw new SmtpError('server offers no supported AUTH mechanism (PLAIN/LOGIN)', 'auth');
    }
  }

  await conn.command(`MAIL FROM:<${fromAddr}>`, [250], 'mail-from');
  await conn.command(`RCPT TO:<${to}>`, [250, 251], 'rcpt-to');
  await conn.command('DATA', [354], 'data');
  // Dot-stuffing (RFC 5321 4.5.2); base64 lines never start with "." but the headers could.
  const stuffed = data.replace(/(^|\r\n)\./g, '$1..');
  conn.write(`${stuffed}\r\n.\r\n`);
  await conn.expect([250], 'data-end');
  try {
    await conn.command('QUIT', [221], 'quit');
  } catch {
    // The message is accepted; a sloppy QUIT is not a delivery failure.
  }
}
