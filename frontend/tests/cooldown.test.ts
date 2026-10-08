import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createCooldown, MAX_COOLDOWN_SECONDS } from '@/modules/cooldown';

describe('cooldown', () => {
  let t = 1_000_000;
  const now = () => t;
  beforeEach(() => {
    t = 1_000_000;
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('counts down whole seconds, rounding up', () => {
    const c = createCooldown('a', now);
    expect(c.remaining()).toBe(0);
    c.start(30);
    expect(c.remaining()).toBe(30);
    t += 1500;
    expect(c.remaining()).toBe(29);
    t += 28_500;
    expect(c.remaining()).toBe(0);
  });

  it('survives a reload and is shared between tabs (new instance, same storage)', () => {
    createCooldown('a', now).start(45);
    t += 5000;
    expect(createCooldown('a', now).remaining()).toBe(40);
  });

  it('names do not collide', () => {
    createCooldown('a', now).start(45);
    expect(createCooldown('b', now).remaining()).toBe(0);
  });

  it('clear() frees it everywhere', () => {
    const c = createCooldown('a', now);
    c.start(45);
    c.clear();
    expect(c.remaining()).toBe(0);
    expect(createCooldown('a', now).remaining()).toBe(0);
  });

  it('clamps absurd, negative and non-finite values', () => {
    const c = createCooldown('a', now);
    c.start(10 ** 9);
    expect(c.remaining()).toBe(MAX_COOLDOWN_SECONDS);
    c.start(-5);
    expect(c.remaining()).toBe(0);
    c.start(Number.NaN);
    expect(c.remaining()).toBe(0);
  });

  it('ignores a tampered stored value far in the future', () => {
    window.localStorage.setItem('travelmap.cooldown.a', String(t + 10 ** 12));
    expect(createCooldown('a', now).remaining()).toBe(0);
  });

  it('ignores garbage in storage', () => {
    window.localStorage.setItem('travelmap.cooldown.a', 'not-a-number');
    expect(createCooldown('a', now).remaining()).toBe(0);
  });

  it('falls back to memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const c = createCooldown('a', now);
    c.start(20);
    expect(c.remaining()).toBe(20);
    c.clear();
    expect(c.remaining()).toBe(0);
  });
});
