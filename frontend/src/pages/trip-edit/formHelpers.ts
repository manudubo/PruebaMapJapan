/**
 * Small helpers shared by the trip-editor modals.
 */

export const GENERIC_SAVE_ERROR = 'Could not save. Check your connection and try again.';

interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * User-facing text for a failed save. A 422 from the API carries the
 * offending fields (see backend validation/validator.ts); anything else is
 * treated as a connectivity problem. Duck-typed rather than `instanceof
 * ApiError` so it also works when the API client is mocked.
 */
export function saveErrorMessage(err: unknown): string {
  const e = err as { status?: unknown; issues?: unknown } | null;
  if (e && typeof e === 'object' && e.status === 422) {
    const issues = Array.isArray(e.issues) ? (e.issues as ValidationIssue[]) : [];
    const details = issues
      .map((issue) => issue?.message)
      .filter((m): m is string => typeof m === 'string' && m.length > 0);
    return details.length > 0
      ? `Please check the form: ${details.join('; ')}.`
      : 'Some fields are invalid. Please check the form.';
  }
  return GENERIC_SAVE_ERROR;
}

/**
 * Client-side mirror of the API's null-safe date-order rule (BIZ-06):
 * only compares when both are filled in; equal dates are fine. Values come
 * from <input type="date">, i.e. YYYY-MM-DD, so string order is date order.
 */
export function dateOrderError(start: string, end: string, startLabel: string, endLabel: string): string | null {
  if (start && end && start > end) return `${endLabel} must be on or after ${startLabel}.`;
  return null;
}

/**
 * Keep the native date pickers consistent with each other: the end picker
 * can't go before the start and vice versa. Purely a UX hint — the submit
 * handler still validates, since typed values bypass min/max.
 */
export function linkDateBounds(startInput: HTMLInputElement, endInput: HTMLInputElement): void {
  const sync = (): void => {
    endInput.min = startInput.value;
    startInput.max = endInput.value;
  };
  startInput.addEventListener('input', sync);
  endInput.addEventListener('input', sync);
  sync();
}

/** Re-apply the min/max hints after values were set programmatically. */
export function syncDateBounds(startInput: HTMLInputElement, endInput: HTMLInputElement): void {
  endInput.min = startInput.value;
  startInput.max = endInput.value;
}

/** True for an absolute http(s) URL — what the API accepts for link fields. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * `<div class="form-group form-group--checkbox"><label><input type=checkbox>
 * text</label><p class="form-hint">hint</p></div>`, with the hint wired up
 * through aria-describedby.
 */
export function buildCheckbox(
  id: string,
  name: string,
  labelText: string,
  hint?: string,
): { group: HTMLElement; input: HTMLInputElement } {
  const group = document.createElement('div');
  group.className = 'form-group form-group--checkbox';

  const label = document.createElement('label');
  label.className = 'checkbox-label';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.name = name;
  label.appendChild(input);
  label.appendChild(document.createTextNode(labelText));
  group.appendChild(label);

  if (hint) {
    const hintEl = document.createElement('p');
    hintEl.className = 'form-hint';
    hintEl.id = `${id}-hint`;
    hintEl.textContent = hint;
    input.setAttribute('aria-describedby', hintEl.id);
    group.appendChild(hintEl);
  }

  return { group, input };
}
