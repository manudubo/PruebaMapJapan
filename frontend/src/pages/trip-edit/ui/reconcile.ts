/**
 * Keyed list reconciliation: keep the DOM node of every row that still exists
 * (so focus, caret and open <details> survive an autosave or a reorder),
 * create nodes for new rows, drop the rest, and put the survivors in order
 * without touching nodes that are already in the right place.
 */
export function reconcile<T>(
  container: HTMLElement,
  items: readonly T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update?: (el: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children) as HTMLElement[]) {
    const key = child.dataset['key'];
    if (key !== undefined) existing.set(key, child);
  }
  const wanted = new Set(items.map(keyOf));
  for (const [key, el] of existing) if (!wanted.has(key)) { el.remove(); existing.delete(key); }

  let cursor: Element | null = container.firstElementChild;
  for (const item of items) {
    const key = keyOf(item);
    let el = existing.get(key);
    if (!el) {
      el = create(item);
      el.dataset['key'] = key;
    } else {
      update?.(el, item);
    }
    if (el === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      container.insertBefore(el, cursor);
    }
  }
  // Anything that is not keyed (empty-state paragraphs...) after the rows is the caller's business.
}

/** The keyed child of `container` with this key (no selector escaping needed). */
export function byKey(container: HTMLElement, key: string): HTMLElement | null {
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (child.dataset['key'] === key) return child;
  }
  return null;
}
