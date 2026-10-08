import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCodeInput, normalizeCode } from '@/modules/codeInput';

function make(onComplete?: (c: string) => void) {
  document.body.innerHTML = '';
  const ci = createCodeInput({
    idPrefix: 'c',
    legend: 'Code',
    digitLabel: (n) => `Digit ${n} of 6`,
    describedBy: 'err',
    onComplete,
  });
  document.body.appendChild(ci.element);
  return ci;
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function paste(input: HTMLInputElement, text: string): Event {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  e.clipboardData = { getData: () => text };
  input.dispatchEvent(e);
  return e;
}

function key(input: HTMLInputElement, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  return e;
}

describe('normalizeCode', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    [' 12 34-56 \n', '123456'],
    ['12345678', '123456'],
    ['abc', ''],
  ])('%j -> %j', (raw, out) => expect(normalizeCode(raw)).toBe(out));
});

describe('code input', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is a labelled fieldset with numeric one-time-code boxes', () => {
    const ci = make();
    expect(ci.element.tagName).toBe('FIELDSET');
    expect(ci.element.querySelector('legend')!.textContent).toBe('Code');
    expect(ci.element.getAttribute('aria-describedby')).toBe('err');
    expect(ci.inputs).toHaveLength(6);
    expect(ci.inputs[0]!.autocomplete).toBe('one-time-code');
    expect(ci.inputs[1]!.autocomplete).toBe('off');
    ci.inputs.forEach((x, i) => {
      expect(x.inputMode).toBe('numeric');
      expect(x.getAttribute('aria-label')).toBe(`Digit ${i + 1} of 6`);
    });
  });

  it('advances focus after each digit and completes once', () => {
    const done = vi.fn();
    const ci = make(done);
    ci.inputs.forEach((x, i) => {
      type(x, String(i + 1));
      if (i < 5) expect(document.activeElement).toBe(ci.inputs[i + 1]);
    });
    expect(ci.value()).toBe('123456');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('123456');
  });

  it('rejects non-digits typed into a box', () => {
    const ci = make();
    type(ci.inputs[0]!, 'a');
    expect(ci.inputs[0]!.value).toBe('');
  });

  it.each(['123456', '123 456', '123-456', ' 123 456\n'])('paste %j fills all boxes', (text) => {
    const done = vi.fn();
    const ci = make(done);
    const e = paste(ci.inputs[3]!, text);
    expect(e.defaultPrevented).toBe(true);
    expect(ci.value()).toBe('123456');
    expect(done).toHaveBeenCalledWith('123456');
  });

  it('a partial paste starts at the focused box', () => {
    const done = vi.fn();
    const ci = make(done);
    paste(ci.inputs[2]!, '12');
    expect(ci.inputs.map((x) => x.value).join('|')).toBe('||1|2||');
    expect(done).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ci.inputs[4]);
  });

  it('a paste without digits changes nothing', () => {
    const ci = make();
    paste(ci.inputs[0]!, 'abc');
    expect(ci.value()).toBe('');
  });

  it('autofill dropping the whole code into one box is spread', () => {
    const done = vi.fn();
    const ci = make(done);
    type(ci.inputs[0]!, '123456');
    expect(ci.value()).toBe('123456');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('Backspace on an empty box clears and focuses the previous one', () => {
    const ci = make();
    type(ci.inputs[0]!, '1');
    ci.inputs[1]!.focus();
    key(ci.inputs[1]!, 'Backspace');
    expect(ci.inputs[0]!.value).toBe('');
    expect(document.activeElement).toBe(ci.inputs[0]);
  });

  it('arrows move between boxes and stop at the ends', () => {
    const ci = make();
    ci.inputs[0]!.focus();
    key(ci.inputs[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(ci.inputs[0]);
    key(ci.inputs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(ci.inputs[1]);
    ci.inputs[5]!.focus();
    key(ci.inputs[5]!, 'ArrowRight');
    expect(document.activeElement).toBe(ci.inputs[5]);
  });

  it('editing a digit of a complete code submits the new code again', () => {
    const done = vi.fn();
    const ci = make(done);
    paste(ci.inputs[0]!, '123456');
    type(ci.inputs[5]!, '7');
    expect(done).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenLastCalledWith('123457');
  });

  it('setValue / clear / disabled / invalid', () => {
    const ci = make();
    ci.setValue('12 34');
    expect(ci.value()).toBe('1234');
    expect(ci.isComplete()).toBe(false);
    ci.focus();
    expect(document.activeElement).toBe(ci.inputs[4]);
    ci.setInvalid(true);
    expect(ci.inputs.every((x) => x.getAttribute('aria-invalid') === 'true')).toBe(true);
    ci.setInvalid(false);
    expect(ci.inputs.some((x) => x.hasAttribute('aria-invalid'))).toBe(false);
    ci.setDisabled(true);
    expect(ci.inputs.every((x) => x.disabled)).toBe(true);
    ci.clear();
    expect(ci.value()).toBe('');
  });

  it('supports other lengths', () => {
    const done = vi.fn();
    document.body.innerHTML = '';
    const ci = createCodeInput({ idPrefix: 'x', legend: 'L', digitLabel: String, length: 4, onComplete: done });
    paste(ci.inputs[0]!, '1-2-3-4-5');
    expect(done).toHaveBeenCalledWith('1234');
  });
});
