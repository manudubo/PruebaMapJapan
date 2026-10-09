/**
 * Serial save queue behind the editor's autosave.
 *
 * Every edit is applied locally first and queued here as one API call. Calls
 * run strictly one at a time, in order (a PATCH for a row must come after its
 * POST), and the queue owns the save-status vocabulary the UI shows:
 *
 *   idle      nothing waiting; `lastSavedAt` says when the last call landed
 *   saving    a call is in flight (or queued)
 *   error     the head call failed; transient failures retry by themselves
 *             with growing delays, then wait for the user's Retry
 *   offline   the browser is offline: paused, resumes on its own
 *
 * Permanent failures (422, 404, 409...) cannot succeed by retrying: the call is
 * dropped, recorded in `issues`, and the queue moves on.
 */

import { saveErrorMessage } from './formHelpers';

export type SaveStatus = 'idle' | 'saving' | 'error' | 'offline';
export type ErrorKind = 'transient' | 'auth' | 'verify' | 'permanent';

export interface QueueOp {
  /** Human label, e.g. "Add Kyoto" — used in messages. */
  label: string;
  run: () => Promise<void>;
  /** Called when the server refuses this call for good (it is then dropped). */
  onDrop?: (message: string) => void;
}

/** Thrown by an op whose target no longer exists locally (deleted or never created): skipped silently. */
export class SkipOp extends Error {
  constructor(reason = 'skipped') {
    super(reason);
    this.name = 'SkipOp';
  }
}

export interface SaveIssue {
  label: string;
  message: string;
}

export interface QueueSnapshot {
  status: SaveStatus;
  /** Calls not yet confirmed (including the one in flight). */
  pending: number;
  lastSavedAt: number | null;
  /** Message for status === 'error'. */
  error: { kind: ErrorKind; message: string; willRetry: boolean } | null;
  /** Calls that were dropped because the server refused them for good. */
  issues: SaveIssue[];
}

export interface QueueOptions {
  /** Delays between automatic retries of a transient failure. */
  retryDelaysMs?: number[];
  isOnline?: () => boolean;
  now?: () => number;
}

export function classifyError(err: unknown): { kind: ErrorKind; message: string } {
  const e = err as { status?: unknown; code?: unknown } | null;
  const status = e && typeof e === 'object' && typeof e.status === 'number' ? e.status : null;
  if (status === null) return { kind: 'transient', message: "Can't reach the server." };
  if (status === 401) return { kind: 'auth', message: 'Your session expired. Sign in again to keep saving.' };
  if (status === 403) {
    if (e?.code === 'email_not_verified') return { kind: 'verify', message: 'Verify your email address to save changes.' };
    return { kind: 'permanent', message: "You don't have permission to change this trip." };
  }
  if (status === 404) return { kind: 'permanent', message: 'This was deleted elsewhere. Reload to see the latest.' };
  if (status === 409) return { kind: 'permanent', message: 'This trip changed elsewhere. Reload to see the latest.' };
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: 'transient', message: status === 429 ? 'Too many requests. Waiting a moment.' : "The server couldn't save that." };
  }
  if (status === 422) return { kind: 'permanent', message: saveErrorMessage(err) };
  return { kind: 'permanent', message: 'The server refused this change.' };
}

type Listener = (s: QueueSnapshot) => void;

export class SaveQueue {
  private ops: QueueOp[] = [];
  private running = false;
  private paused = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedAt: number | null = null;
  private error: QueueSnapshot['error'] = null;
  private issues: SaveIssue[] = [];
  private online: boolean;
  private listeners = new Set<Listener>();
  private idleWaiters: Array<() => void> = [];
  private readonly delays: number[];
  private readonly now: () => number;

  constructor(opts: QueueOptions = {}) {
    this.delays = opts.retryDelaysMs ?? [1500, 4000, 10000];
    this.now = opts.now ?? Date.now;
    this.online = (opts.isOnline ?? (() => true))();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  snapshot(): QueueSnapshot {
    let status: SaveStatus = 'idle';
    if (this.error) status = 'error';
    else if (!this.online && this.ops.length > 0) status = 'offline';
    else if (this.ops.length > 0) status = 'saving';
    return {
      status,
      pending: this.ops.length,
      lastSavedAt: this.lastSavedAt,
      error: this.error,
      issues: this.issues.slice(),
    };
  }

  hasPending(): boolean {
    return this.ops.length > 0;
  }

  enqueue(op: QueueOp): void {
    this.ops.push(op);
    this.emit();
    void this.drain();
  }

  /** The user pressed Retry: try the head call again right away. */
  retry(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.error = null;
    this.paused = false;
    this.attempts = 0;
    this.emit();
    void this.drain();
  }

  /** Browser went offline / came back. Coming back resumes immediately. */
  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (online) {
      if (this.error?.kind === 'transient' || this.paused) this.retry();
      else { this.emit(); void this.drain(); }
    } else {
      this.emit();
    }
  }

  dismissIssues(): void {
    this.issues = [];
    this.emit();
  }

  /** Resolves when nothing is queued or running (a paused queue stays unresolved). */
  idle(): Promise<void> {
    if (!this.running && this.ops.length === 0) return Promise.resolve();
    return new Promise((resolve) => { this.idleWaiters.push(resolve); });
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private settleIdle(): void {
    if (this.running || this.ops.length > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private async drain(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    try {
      while (this.ops.length > 0 && !this.paused) {
        if (!this.online) { this.emit(); break; }
        const op = this.ops[0]!;
        try {
          await op.run();
          this.ops.shift();
          this.attempts = 0;
          this.error = null;
          this.lastSavedAt = this.now();
          this.emit();
        } catch (err) {
          if (err instanceof SkipOp) {
            this.ops.shift();
            this.emit();
            continue;
          }
          const { kind, message } = classifyError(err);
          if (kind === 'permanent') {
            this.ops.shift();
            this.attempts = 0;
            this.issues.push({ label: op.label, message });
            op.onDrop?.(message);
            this.emit();
            continue;
          }
          if (kind === 'transient' && !this.online) {
            // Not a server problem: wait for the browser to come back.
            this.emit();
            break;
          }
          const delay = kind === 'transient' ? this.delays[this.attempts] : undefined;
          this.attempts += 1;
          this.paused = true;
          this.error = { kind, message, willRetry: delay !== undefined };
          this.emit();
          if (delay !== undefined) {
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              this.paused = false;
              this.error = null;
              this.emit();
              void this.drain();
            }, delay);
          }
          break;
        }
      }
    } finally {
      this.running = false;
      this.emit();
      this.settleIdle();
    }
  }
}
