/**
 * Segmented one-time-code input (6 digits by default), shared by the sign-up email
 * verification screen and the account-recovery page.
 *
 * - One <input> per digit inside a <fieldset>/<legend>; each has its own label
 *   ("Digit 2 of 6"), inputmode=numeric, and the first one autocomplete=one-time-code so
 *   iOS/Android can offer the code from the email/SMS.
 * - Typing a digit advances; Backspace on an empty box goes back; arrows move.
 * - Paste (or an autofill that drops the whole code into one box) is spread across the
 *   boxes. Spaces, dashes and other separators are ignored: "123 456", "123-456" work.
 * - onComplete fires when every box holds a digit (the caller guards double submits).
 */

export function normalizeCode(raw: string, length = 6): string {
  return raw.replace(/\D+/g, '').slice(0, length);
}

export interface CodeInputOptions {
  idPrefix: string;
  legend: string;
  digitLabel: (n: number) => string;
  length?: number;
  /** id of a description (e.g. the error line) for aria-describedby on the fieldset. */
  describedBy?: string;
  onComplete?: (code: string) => void;
}

export interface CodeInput {
  element: HTMLFieldSetElement;
  inputs: HTMLInputElement[];
  value(): string;
  isComplete(): boolean;
  setValue(raw: string): void;
  clear(): void;
  /** Let the digits currently in the boxes complete again (e.g. retry after a network error). */
  rearm(): void;
  focus(): void;
  setDisabled(disabled: boolean): void;
  setInvalid(invalid: boolean): void;
}

export function createCodeInput(options: CodeInputOptions): CodeInput {
  const length = options.length ?? 6;
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'code-input';
  if (options.describedBy) fieldset.setAttribute('aria-describedby', options.describedBy);
  const legend = document.createElement('legend');
  legend.className = 'code-input-legend';
  legend.textContent = options.legend;
  fieldset.appendChild(legend);

  const row = document.createElement('div');
  row.className = 'code-input-row';
  fieldset.appendChild(row);

  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < length; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `${options.idPrefix}-${i + 1}`;
    input.className = 'code-input-digit';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.autocomplete = i === 0 ? 'one-time-code' : 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', options.digitLabel(i + 1));
    inputs.push(input);
    row.appendChild(input);
  }

  const value = (): string => inputs.map((x) => x.value).join('');
  const isComplete = (): boolean => inputs.every((x) => /^\d$/.test(x.value));
  let lastCompleted: string | null = null;
  const maybeComplete = (): void => {
    if (!isComplete()) {
      lastCompleted = null;
      return;
    }
    const code = value();
    if (code === lastCompleted) return; // the same code is not submitted twice by events
    lastCompleted = code;
    options.onComplete?.(code);
  };

  /** Write digits starting at box `from`; returns the index of the next empty box. */
  const spread = (digits: string, from: number): number => {
    let i = from;
    for (const d of digits) {
      if (i >= length) break;
      inputs[i]!.value = d;
      i++;
    }
    return i;
  };

  const focusAt = (i: number): void => {
    const target = inputs[Math.min(Math.max(i, 0), length - 1)]!;
    target.focus();
    target.select?.();
  };

  inputs.forEach((input, i) => {
    input.addEventListener('input', () => {
      const digits = normalizeCode(input.value, length);
      if (digits.length <= 1) {
        input.value = digits;
        if (digits) focusAt(i + 1);
      } else {
        // Autofill / IME / paste fallback dropped several characters into one box.
        const start = digits.length === length ? 0 : i;
        const next = spread(digits, start);
        focusAt(next >= length ? length - 1 : next);
      }
      maybeComplete();
    });

    input.addEventListener('paste', (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? '';
      const digits = normalizeCode(text, length);
      e.preventDefault();
      if (!digits) return;
      const start = digits.length === length ? 0 : i;
      if (start === 0) inputs.forEach((x) => { x.value = ''; });
      const next = spread(digits, start);
      focusAt(next >= length ? length - 1 : next);
      maybeComplete();
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && input.value === '' && i > 0) {
        e.preventDefault();
        inputs[i - 1]!.value = '';
        focusAt(i - 1);
        lastCompleted = null;
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        focusAt(i - 1);
      } else if (e.key === 'ArrowRight' && i < length - 1) {
        e.preventDefault();
        focusAt(i + 1);
      }
    });

    input.addEventListener('focus', () => input.select?.());
  });

  return {
    element: fieldset,
    inputs,
    value,
    isComplete,
    setValue(raw: string) {
      inputs.forEach((x) => { x.value = ''; });
      spread(normalizeCode(raw, length), 0);
      lastCompleted = null;
    },
    clear() {
      inputs.forEach((x) => { x.value = ''; });
      lastCompleted = null;
    },
    rearm() {
      lastCompleted = null;
    },
    focus() {
      const firstEmpty = inputs.findIndex((x) => x.value === '');
      focusAt(firstEmpty === -1 ? 0 : firstEmpty);
    },
    setDisabled(disabled: boolean) {
      inputs.forEach((x) => { x.disabled = disabled; });
    },
    setInvalid(invalid: boolean) {
      inputs.forEach((x) => {
        if (invalid) x.setAttribute('aria-invalid', 'true');
        else x.removeAttribute('aria-invalid');
      });
    },
  };
}
