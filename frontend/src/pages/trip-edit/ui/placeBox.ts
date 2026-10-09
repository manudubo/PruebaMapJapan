/**
 * The place-search box: an ARIA combobox over a PlaceSearch. Used to add a
 * destination, a place to a day, a hotel, or to move a place's pin.
 *
 * Choosing an option calls the matching callback; the owner decides what a
 * place *means* (new city, new activity, new location of an existing one).
 */

import { PlaceSearch, type SearchState } from '../placeSearch';
import type { Place } from '../model';
import { h, icon, uid, clear } from './h';

export interface PlaceBoxOptions {
  label: string;
  placeholder: string;
  hint?: string;
  /** Hide the visible label (still announced). */
  labelHidden?: boolean;
  search?: PlaceSearch;
  onPlace: (place: Place) => void;
  /** A pasted Google Maps link with coordinates. */
  onLink?: (point: { lat: number; lng: number }, url: string) => void;
  /** "Add “text” without a map location" — omit to hide that option. */
  onFreeText?: (text: string) => void;
  freeTextLabel?: (text: string) => string;
  /** Clear the box after a choice (default true). */
  clearOnPick?: boolean;
  inputId?: string;
}

export interface PlaceBox {
  el: HTMLElement;
  input: HTMLInputElement;
  focus(): void;
  clear(): void;
}

interface Option {
  id: string;
  node: HTMLElement;
  run: () => void;
}

export function splitLabel(label: string): { main: string; rest: string } {
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  return { main: parts[0] ?? label, rest: parts.slice(1).join(', ') };
}

export function createPlaceBox(opts: PlaceBoxOptions): PlaceBox {
  const search = opts.search ?? new PlaceSearch();
  const inputId = opts.inputId ?? uid('place');
  const listId = `${inputId}-list`;
  const statusId = `${inputId}-status`;
  let options: Option[] = [];
  let active = -1;
  let open = false;

  const input = h('input', {
    id: inputId,
    type: 'text',
    class: 'place-input',
    autocomplete: 'off',
    spellcheck: false,
    maxLength: 300,
    placeholder: opts.placeholder,
    attrs: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': listId,
      'aria-describedby': statusId,
      enterkeyhint: 'search',
    },
  });
  const clearBtn = h('button', { type: 'button', class: 'place-clear', hidden: true, title: 'Clear', attrs: { 'aria-label': 'Clear search' } }, icon('close', 16));
  const list = h('ul', { id: listId, class: 'place-results', hidden: true, attrs: { role: 'listbox', 'aria-label': `${opts.label} suggestions` } });
  const status = h('p', { id: statusId, class: 'place-status', attrs: { role: 'status' } });
  const label = h('label', { class: opts.labelHidden ? 'sr-only' : 'place-label', htmlFor: inputId, text: opts.label });
  const hint = opts.hint ? h('p', { class: 'form-hint', text: opts.hint }) : null;
  const root = h('div', { class: 'place-box' },
    label,
    h('div', { class: 'place-input-wrap' }, icon('search', 18), input, clearBtn),
    hint,
    list,
    status,
  );

  const setOpen = (v: boolean): void => {
    open = v;
    list.hidden = !v || options.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (list.hidden) input.removeAttribute('aria-activedescendant');
  };

  const setActive = (i: number): void => {
    active = i;
    options.forEach((o, idx) => {
      o.node.classList.toggle('is-active', idx === i);
      o.node.setAttribute('aria-selected', String(idx === i));
    });
    if (i >= 0 && options[i]) {
      input.setAttribute('aria-activedescendant', options[i]!.id);
      options[i]!.node.scrollIntoView?.({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const finish = (): void => {
    if (opts.clearOnPick !== false) {
      input.value = '';
      clearBtn.hidden = true;
    }
    search.reset();
    options = [];
    status.textContent = '';
    setOpen(false);
  };

  const addOption = (node: HTMLElement, run: () => void): void => {
    const id = `${inputId}-opt-${options.length}`;
    node.id = id;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', 'false');
    node.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    node.addEventListener('click', () => { run(); });
    options.push({ id, node, run });
    list.appendChild(node);
  };

  const render = (s: SearchState): void => {
    clear(list);
    options = [];
    active = -1;
    let message = '';
    const text = input.value.trim();

    if (s.status === 'results') {
      for (const place of s.places) {
        const { main, rest } = splitLabel(place.label);
        addOption(
          h('li', { class: 'place-option' }, icon('pin', 16), h('span', { class: 'place-option-text' }, h('strong', { text: main }), rest ? h('small', { text: rest }) : null)),
          () => { opts.onPlace(place); finish(); },
        );
      }
      message = `${s.places.length} result${s.places.length === 1 ? '' : 's'}`;
    } else if (s.status === 'link' && opts.onLink) {
      const { lat, lng, query } = s;
      addOption(
        h('li', { class: 'place-option' }, icon('pin', 16), h('span', { class: 'place-option-text' },
          h('strong', { text: 'Use the location from this link' }), h('small', { text: `${lat.toFixed(4)}, ${lng.toFixed(4)}` }))),
        () => { opts.onLink!({ lat, lng }, query); finish(); },
      );
      message = 'Location found in the link';
    } else if (s.status === 'link' || s.status === 'badlink') {
      message = s.status === 'badlink'
        ? "That link has no coordinates. Open the place in Google Maps and copy the link from the address bar."
        : 'Pasted links are not supported here. Search by name.';
    } else if (s.status === 'loading') {
      message = 'Searching…';
    } else if (s.status === 'empty') {
      message = 'No places found. Try another spelling, or paste a Google Maps link.';
    } else if (s.status === 'error') {
      message = s.message;
    } else if (s.status === 'short' && text.length > 0) {
      message = 'Keep typing, or press Enter to search.';
    }

    if (opts.onFreeText && text.length >= 1 && s.status !== 'idle' && s.status !== 'loading' && s.status !== 'link' && s.status !== 'badlink') {
      const labelFn = opts.freeTextLabel ?? ((t: string) => `Add “${t}” without a map location`);
      addOption(
        h('li', { class: 'place-option place-option--free' }, icon('plus', 16), h('span', { class: 'place-option-text' }, h('strong', { text: labelFn(text) }))),
        () => { opts.onFreeText!(text); finish(); },
      );
    }

    list.setAttribute('aria-busy', String(s.status === 'loading'));
    status.textContent = message;
    status.classList.toggle('is-error', s.status === 'error' || s.status === 'badlink');
    setOpen(options.length > 0);
  };

  search.subscribe(render);

  input.addEventListener('input', () => {
    clearBtn.hidden = input.value === '';
    search.input(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      if (!options.length) return;
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((active + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setActive(active <= 0 ? options.length - 1 : active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && options[active]) options[active]!.run();
      else void search.submit(input.value);
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    }
  });
  root.addEventListener('focusout', (e) => {
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (!next || !root.contains(next)) setOpen(false);
  });
  input.addEventListener('focus', () => { if (options.length) setOpen(true); });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; search.reset(); input.focus(); });

  return {
    el: root,
    input,
    focus: () => input.focus(),
    clear: () => { input.value = ''; clearBtn.hidden = true; search.reset(); },
  };
}
