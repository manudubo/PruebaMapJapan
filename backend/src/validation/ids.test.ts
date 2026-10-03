import { describe, expect, it } from 'vitest';
import { parseId } from './ids';

describe('parseId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['2147483647', 2147483647],
  ])('accepts %s', (raw, want) => {
    expect(parseId(raw)).toBe(want);
  });

  it.each([
    undefined,
    '',
    '0',
    '-1',
    '1.5',
    '1e3',
    '0x10',
    '010',
    ' 7',
    '7 ',
    'Infinity',
    'NaN',
    '2147483648',
    '99999999999',
    '１',
  ])('rejects %j', (raw) => {
    expect(parseId(raw)).toBeNaN();
  });
});
