import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SaveQueue, SkipOp, classifyError, type QueueSnapshot } from '@/pages/trip-edit/saveQueue';

const err = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error('x'), { status, ...extra });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('classifyError', () => {
  it.each([
    [err(401), 'auth'],
    [err(403, { code: 'email_not_verified' }), 'verify'],
    [err(403), 'permanent'],
    [err(404), 'permanent'],
    [err(409), 'permanent'],
    [err(422, { issues: [{ path: 'name', message: 'too long' }] }), 'permanent'],
    [err(400), 'permanent'],
    [err(429), 'transient'],
    [err(500), 'transient'],
    [err(503), 'transient'],
    [new TypeError('Failed to fetch'), 'transient'],
    [null, 'transient'],
  ])('%#', (e, kind) => {
    expect(classifyError(e).kind).toBe(kind);
  });
  it('a 422 carries the field messages', () => {
    expect(classifyError(err(422, { issues: [{ path: 'name', message: 'too long' }] })).message).toContain('too long');
  });
});

describe('SaveQueue', () => {
  it('runs calls one at a time, in order', async () => {
    const q = new SaveQueue();
    const log: string[] = [];
    let release!: () => void;
    q.enqueue({ label: 'a', run: () => new Promise<void>((r) => { log.push('a-start'); release = () => { log.push('a-end'); r(); }; }) });
    q.enqueue({ label: 'b', run: async () => { log.push('b'); } });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['a-start']);
    expect(q.snapshot()).toMatchObject({ status: 'saving', pending: 2 });
    release();
    await q.idle();
    expect(log).toEqual(['a-start', 'a-end', 'b']);
    expect(q.snapshot()).toMatchObject({ status: 'idle', pending: 0 });
    expect(q.snapshot().lastSavedAt).not.toBeNull();
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const q = new SaveQueue();
    const seen: QueueSnapshot['status'][] = [];
    const off = q.subscribe((s) => seen.push(s.status));
    q.enqueue({ label: 'a', run: async () => {} });
    await q.idle();
    expect(seen).toContain('saving');
    expect(seen.at(-1)).toBe('idle');
    off();
    const n = seen.length;
    q.enqueue({ label: 'b', run: async () => {} });
    await q.idle();
    expect(seen).toHaveLength(n);
  });

  it('retries a transient failure by itself with the configured delays, then succeeds', async () => {
    const q = new SaveQueue({ retryDelaysMs: [1000, 2000] });
    let calls = 0;
    q.enqueue({ label: 'a', run: async () => { calls++; if (calls < 3) throw err(500); } });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot()).toMatchObject({ status: 'error', error: { kind: 'transient', willRetry: true } });
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(3);
    expect(q.snapshot()).toMatchObject({ status: 'idle', error: null });
  });

  it('after the automatic retries it waits for the user; Retry resumes', async () => {
    const q = new SaveQueue({ retryDelaysMs: [10] });
    let fail = true;
    let calls = 0;
    q.enqueue({ label: 'a', run: async () => { calls++; if (fail) throw err(503); } });
    q.enqueue({ label: 'b', run: async () => {} });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(2);
    expect(q.snapshot()).toMatchObject({ status: 'error', pending: 2, error: { willRetry: false } });
    fail = false;
    q.retry();
    await q.idle();
    expect(q.snapshot()).toMatchObject({ status: 'idle', pending: 0 });
  });

  it('a permanent failure is dropped, reported once and the queue carries on', async () => {
    const q = new SaveQueue();
    const dropped: string[] = [];
    const ran: string[] = [];
    q.enqueue({ label: 'bad', run: async () => { throw err(422, { issues: [{ path: 'name', message: 'nope' }] }); }, onDrop: (m) => dropped.push(m) });
    q.enqueue({ label: 'good', run: async () => { ran.push('good'); } });
    await q.idle();
    expect(ran).toEqual(['good']);
    expect(dropped).toHaveLength(1);
    const snap = q.snapshot();
    expect(snap.status).toBe('idle');
    expect(snap.issues).toEqual([{ label: 'bad', message: expect.stringContaining('nope') }]);
    q.dismissIssues();
    expect(q.snapshot().issues).toEqual([]);
  });

  it('SkipOp is silent', async () => {
    const q = new SaveQueue();
    q.enqueue({ label: 'gone', run: async () => { throw new SkipOp(); } });
    await q.idle();
    expect(q.snapshot()).toMatchObject({ status: 'idle', issues: [] });
  });

  it('401 and unverified email pause with a message and no automatic retry', async () => {
    for (const [e, kind] of [[err(401), 'auth'], [err(403, { code: 'email_not_verified' }), 'verify']] as const) {
      const q = new SaveQueue({ retryDelaysMs: [10] });
      let calls = 0;
      q.enqueue({ label: 'a', run: async () => { calls++; throw e; } });
      await vi.advanceTimersByTimeAsync(5000);
      expect(calls).toBe(1);
      expect(q.snapshot().error).toMatchObject({ kind, willRetry: false });
    }
  });

  it('offline: waits without burning retries and resumes when the browser is back', async () => {
    let online = false;
    const q = new SaveQueue({ isOnline: () => online });
    const run = vi.fn(async () => {});
    q.enqueue({ label: 'a', run });
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
    expect(q.snapshot().status).toBe('offline');
    online = true;
    q.setOnline(true);
    await q.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(q.snapshot().status).toBe('idle');
  });

  it('a network failure while the browser reports offline goes to offline, not error', async () => {
    let online = true;
    const q = new SaveQueue({ isOnline: () => online });
    let calls = 0;
    q.enqueue({ label: 'a', run: async () => { calls++; if (calls === 1) { online = false; q.setOnline(false); throw new TypeError('Failed to fetch'); } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().status).toBe('offline');
    q.setOnline(true);
    await q.idle();
    expect(calls).toBe(2);
  });

  it('idle() resolves immediately when empty', async () => {
    await expect(new SaveQueue().idle()).resolves.toBeUndefined();
  });

  it('200 queued calls all run exactly once, in order', async () => {
    const q = new SaveQueue();
    const out: number[] = [];
    for (let i = 0; i < 200; i++) q.enqueue({ label: String(i), run: async () => { out.push(i); } });
    await q.idle();
    expect(out).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });
});
