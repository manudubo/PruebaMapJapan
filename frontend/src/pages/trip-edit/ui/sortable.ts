/**
 * Reorder a list by pointer drag (mouse, touch, pen) or keyboard.
 *
 * Pointer: press the handle, move; the row under the pointer shows a drop
 * line; release to commit. Keyboard: with the handle focused, ArrowUp /
 * ArrowDown move the row one place (Home / End to the ends) — the same call
 * the visible up/down buttons make. Nothing here knows about data: it reports
 * `onMove(fromIndex, toIndex)` and the owner re-renders.
 */

/**
 * Index the dragged row should land on, given the vertical midpoints of the
 * rows (in order, including the dragged one) and the pointer's Y.
 * Pure: unit-tested.
 */
export function dropIndex(midpoints: number[], pointerY: number, fromIndex: number): number {
  let to = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (i === fromIndex) continue;
    if (midpoints[i]! < pointerY) to += 1;
  }
  return to;
}

export interface SortableOptions {
  /** Selector (relative to a row) of the drag handle. */
  handle: string;
  onMove: (fromIndex: number, toIndex: number) => void;
}

const ROW_SELECTOR = ':scope > [data-key]';

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

export function makeSortable(container: HTMLElement, opts: SortableOptions): () => void {
  let drag: { row: HTMLElement; from: number; to: number; pointerId: number } | null = null;

  const clearMarks = (): void => {
    for (const r of rows(container)) r.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging');
  };

  const mark = (): void => {
    if (!drag) return;
    const list = rows(container);
    for (const r of list) r.classList.remove('is-drop-before', 'is-drop-after');
    const others = list.filter((r) => r !== drag!.row);
    if (others.length === 0) return;
    if (drag.to >= others.length) others[others.length - 1]!.classList.add('is-drop-after');
    else others[drag.to]!.classList.add('is-drop-before');
  };

  const onPointerDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>(opts.handle);
    if (!handle || !container.contains(handle) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = handle.closest<HTMLElement>('[data-key]');
    if (!row || row.parentElement !== container) return;
    const from = rows(container).indexOf(row);
    drag = { row, from, to: from, pointerId: e.pointerId };
    row.classList.add('is-dragging');
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const mids = rows(container).map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    drag.to = dropIndex(mids, e.clientY, drag.from);
    mark();
  };

  const finish = (e: PointerEvent, commit: boolean): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { from, to } = drag;
    drag = null;
    clearMarks();
    if (commit && from !== to) opts.onMove(from, to);
  };

  const onPointerUp = (e: PointerEvent): void => finish(e, true);
  const onPointerCancel = (e: PointerEvent): void => finish(e, false);

  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>(opts.handle);
    if (!handle || !container.contains(handle)) return;
    const row = handle.closest<HTMLElement>('[data-key]');
    if (!row || row.parentElement !== container) return;
    const list = rows(container);
    const i = list.indexOf(row);
    let to = i;
    if (e.key === 'ArrowUp') to = i - 1;
    else if (e.key === 'ArrowDown') to = i + 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    else return;
    e.preventDefault();
    if (to < 0 || to >= list.length || to === i) return;
    opts.onMove(i, to);
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('keydown', onKeyDown);
  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    container.removeEventListener('keydown', onKeyDown);
  };
}
