/** Wording for "drop a pin" that matches how the person is pointing (evaluated when shown, not at load). */
export function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

export function pickHintText(coarse: boolean = isCoarsePointer()): string {
  return coarse
    ? 'Tap the map to drop the pin. Tap Cancel to stop.'
    : 'Click the map to drop a pin. Press Esc to cancel.';
}
