import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast, installGlobalErrorHandler } from '@/modules/toast';

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates #toast-container on first call', () => {
    showToast('hello', 'error');
    expect(document.getElementById('toast-container')).not.toBeNull();
  });

  it('reuses existing container on subsequent calls', () => {
    showToast('a', 'error');
    showToast('b', 'error');
    expect(document.querySelectorAll('#toast-container').length).toBe(1);
  });

  it('appends toast with correct type class', () => {
    showToast('msg', 'error');
    expect(document.querySelector('.toast--error')).not.toBeNull();
    document.body.innerHTML = '';
    showToast('msg', 'success');
    expect(document.querySelector('.toast--success')).not.toBeNull();
    document.body.innerHTML = '';
    showToast('msg', 'info');
    expect(document.querySelector('.toast--info')).not.toBeNull();
  });

  it('newest toast is first child (prepend order)', () => {
    showToast('first', 'error');
    showToast('second', 'success');
    const container = document.getElementById('toast-container')!;
    expect(container.firstElementChild?.querySelector('.toast-msg')?.textContent).toBe('second');
  });

  it('adds .toast--exiting after 4000ms', () => {
    showToast('msg', 'error');
    const card = document.querySelector('.toast')!;
    vi.advanceTimersByTime(4000);
    expect(card.classList.contains('toast--exiting')).toBe(true);
  });

  it('removes card from DOM after 4200ms', () => {
    showToast('msg', 'error');
    const card = document.querySelector('.toast')!;
    vi.advanceTimersByTime(4200);
    expect(document.body.contains(card)).toBe(false);
  });

  it('close button adds .toast--exiting and removes after 200ms', () => {
    showToast('msg', 'error');
    const btn = document.querySelector('.toast-close') as HTMLButtonElement;
    btn.click();
    const card = document.querySelector('.toast')!;
    expect(card.classList.contains('toast--exiting')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(document.body.contains(card)).toBe(false);
  });

  it('toast-msg span contains the message text', () => {
    showToast('Test message', 'info');
    expect(document.querySelector('.toast-msg')?.textContent).toBe('Test message');
  });

  it('close button has aria-label="Dismiss"', () => {
    showToast('msg', 'error');
    expect(document.querySelector('.toast-close')?.getAttribute('aria-label')).toBe('Dismiss');
  });
});

describe('installGlobalErrorHandler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows error toast on unhandledrejection', () => {
    installGlobalErrorHandler();
    const handled = Promise.reject(new Error('test'));
    handled.catch(() => {});
    const event = new PromiseRejectionEvent('unhandledrejection', {
      promise: handled,
      reason: new Error('test'),
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(document.querySelector('.toast--error')).not.toBeNull();
    expect(document.querySelector('.toast-msg')?.textContent).toBe('An unexpected error occurred');
  });

  it('calls event.preventDefault() to suppress console output', () => {
    installGlobalErrorHandler();
    const handled = Promise.reject(new Error('test'));
    handled.catch(() => {});
    const event = new PromiseRejectionEvent('unhandledrejection', {
      promise: handled,
      reason: new Error('test'),
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
