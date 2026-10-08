/** Labelled form fields with inline, accessible validation messages. */

import { h, uid, type Child } from './h';

export interface Field<E extends HTMLElement> {
  el: HTMLElement;
  control: E;
  /** Show (or clear with null) an inline error; wires aria-invalid / aria-describedby. */
  setError(message: string | null): void;
}

export function field<E extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  label: string,
  control: E,
  opts: { hint?: string; className?: string; labelExtra?: Child } = {},
): Field<E> {
  if (!control.id) control.id = uid('f');
  const errId = `${control.id}-error`;
  const hintId = `${control.id}-hint`;
  const err = h('p', { class: 'field-error', id: errId, hidden: true, attrs: { role: 'alert' } });
  const hint = opts.hint ? h('p', { class: 'form-hint', id: hintId, text: opts.hint }) : null;
  const describedBy = [hint ? hintId : '', errId].filter(Boolean).join(' ');
  control.setAttribute('aria-describedby', describedBy);
  const el = h('div', { class: `form-group te-field${opts.className ? ` ${opts.className}` : ''}` },
    h('label', { htmlFor: control.id }, label, opts.labelExtra ?? null),
    control,
    hint,
    err,
  );
  return {
    el,
    control,
    setError(message) {
      err.textContent = message ?? '';
      err.hidden = !message;
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

export function checkbox(id: string, label: string, hint?: string): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'checkbox', id });
  const hintEl = hint ? h('p', { class: 'form-hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  const el = h('div', { class: 'form-group form-group--checkbox te-check' },
    h('label', { class: 'checkbox-label' }, input, label),
    hintEl,
  );
  return { el, input };
}
