/** Largest value a Postgres `serial` / int4 column can hold. */
const MAX_INT4 = 2_147_483_647;

/**
 * Parse a numeric path id (`:tripId`, `:destId`, ...).
 *
 * Only a canonical positive decimal that fits in int4 is an id; anything else
 * returns NaN so the existing `isNaN` guards answer 400. `Number()` alone let
 * "1.5", "Infinity" and "99999999999" through to Postgres (500) and made
 * "0x10", "1e1" and "010" alias real rows.
 */
export function parseId(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9][0-9]{0,9}$/.test(raw)) return NaN;
  const id = Number(raw);
  return id <= MAX_INT4 ? id : NaN;
}
