import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('OTP CSPRNG — SEC-01', () => {
  // RED test: reads auth.ts source and asserts Math.random is absent.
  // FAILS before 20-01 (Math.random is at auth.ts:123). PASSES after 20-01.
  it('auth.ts does not call Math.random for OTP generation', () => {
    const source = readFileSync(
      join(__dirname, '../src/routes/auth.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/Math\.random/);
  });

  // Spec tests: verify the replacement formula is correct.
  // These test the math, not auth.ts; they pass before and after 20-01.
  describe('crypto.getRandomValues formula spec', () => {
    beforeEach(() => {
      vi.stubGlobal('crypto', {
        getRandomValues: vi.fn((arr: Uint32Array) => {
          arr[0] = 123_456_789;
          return arr;
        }),
        subtle: {},
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('produces a 6-digit zero-padded string', () => {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      // 123_456_789 % 1_000_000 = 456_789
      const code = String(arr[0]! % 1_000_000).padStart(6, '0');
      expect(code).toBe('456789');
      expect(code).toMatch(/^\d{6}$/);
    });

    it('zero-pads when value is small', () => {
      vi.stubGlobal('crypto', {
        getRandomValues: vi.fn((arr: Uint32Array) => {
          arr[0] = 42;
          return arr;
        }),
        subtle: {},
      });
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      const code = String(arr[0]! % 1_000_000).padStart(6, '0');
      expect(code).toBe('000042');
    });

    it('stays in range at Uint32 boundary', () => {
      vi.stubGlobal('crypto', {
        getRandomValues: vi.fn((arr: Uint32Array) => {
          arr[0] = 4_294_967_295; // Uint32 max
          return arr;
        }),
        subtle: {},
      });
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      const code = String(arr[0]! % 1_000_000).padStart(6, '0');
      expect(code).toMatch(/^\d{6}$/);
      expect(Number(code)).toBeLessThan(1_000_000);
    });
  });
});
