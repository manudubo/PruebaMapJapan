/**
 * Structured JSON logging with PII scrubbing.
 *
 * One JSON object per line ({"level","ts","event",...fields}) so `docker logs`,
 * journald or `wrangler tail` can be filtered with jq. Everything that reaches
 * a log line goes through `scrub`:
 *
 *  - fields whose NAME looks sensitive (email, token, authorization, password,
 *    secret, otp, code_hash, cookie, params, query, detail, ...) are replaced
 *    by "[redacted]";
 *  - string VALUES are scrubbed of email addresses, JWTs, bearer credentials,
 *    44-char base64 HMACs (OTP hashes) and bare 6-digit codes;
 *  - Error objects are reduced to name, scrubbed message, SQLSTATE and stack
 *    frames. Drizzle's DrizzleQueryError message embeds the SQL *and its bound
 *    parameters* ("params: kc-id,alice@example.com,..."), and node-postgres
 *    puts row values in `detail` ("Key (email)=(alice@...)"), so neither the
 *    params tail nor `detail`/`query`/`params` properties are ever printed.
 *
 * Works on Workers and Node (console only, no fs).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY =
  /(e-?mail|token|authorization|password|passwd|secret|otp|code_?hash|cookie|api_?key|params|parameters|^query$|^detail$|^code_?value$|smtp_pass|credential)/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const HMAC_B64_RE = /\b[A-Za-z0-9+/]{43}=/g;
const SIX_DIGITS_RE = /(?<![\w.-])\d{6}(?![\w.-])/g;
/** Drizzle appends "\nparams: <values>" to the message of a failed query. */
const DRIZZLE_PARAMS_RE = /\n?params:[\s\S]*$/;

const MAX_STRING = 2000;
const MAX_DEPTH = 6;

export function scrubString(value: string): string {
  // Truncate first: the patterns below are linear-ish only on bounded input
  // (the e-mail pattern is quadratic on a long run of word characters).
  const clipped = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  let s = clipped.replace(DRIZZLE_PARAMS_RE, '\nparams: [redacted]');
  s = s
    .replace(JWT_RE, '[jwt]')
    .replace(BEARER_RE, '$1 [redacted]')
    .replace(EMAIL_RE, '[email]')
    .replace(HMAC_B64_RE, '[hash]')
    .replace(SIX_DIGITS_RE, '[digits]');
  return s;
}

function errorToFields(err: Error, depth: number): LogFields {
  const out: LogFields = { name: err.name, message: scrubString(err.message) };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) out['sqlstate'] = code;
  if (err.stack) {
    // Frames only: the first line repeats the (unscrubbed) message.
    const frames = err.stack
      .split('\n')
      .filter((l) => /^\s+at /.test(l))
      .slice(0, 8)
      .map((l) => scrubString(l.trim()));
    if (frames.length > 0) out['stack'] = frames;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && depth < MAX_DEPTH) out['cause'] = scrub(cause, depth + 1);
  return out;
}

/** Deep copy with sensitive keys redacted and strings scrubbed. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth]';
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  if (value instanceof Error) return errorToFields(value, depth);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: LogFields = {};
    // Plain objects that look like errors (e.g. a pg error copied around).
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

type Sink = (level: LogLevel, line: string) => void;

const consoleSink: Sink = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

let sink: Sink = consoleSink;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: LogLevel = 'info';

/** Lowest level that is written (default info). Unknown values are ignored. */
export function setMinLogLevel(level: string | undefined): void {
  const l = level?.trim().toLowerCase();
  if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error') minLevel = l;
}

/** Test hook: capture formatted lines. Returns a restore function. */
export function __setLogSinkForTests(next: Sink): () => void {
  const prev = sink;
  sink = next;
  return () => {
    sink = prev;
  };
}

export function formatLogLine(level: LogLevel, event: string, fields: LogFields = {}): string {
  const scrubbed = scrub(fields) as LogFields;
  return JSON.stringify({ level, ts: new Date().toISOString(), event: scrubString(event), ...scrubbed });
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  try {
    sink(level, formatLogLine(level, event, fields));
  } catch {
    // Logging must never break a request.
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
