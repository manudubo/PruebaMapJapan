import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

// BIZ-10 regression guard: the app UI is English. Spanish UI strings left
// over from before the Phase 5 English pass kept resurfacing (tripAdapter
// "Desde"/"Hasta", hotel form "Nombre", legend badge "Opcional"). Demo
// itinerary content in src/data/ is user data (notes in Spanish) and is
// excluded.

const root = resolve(__dirname, '..', 'src');
const SPANISH_UI = /['"`](?:[^'"`]*\b)?(Desde|Hasta|Nombre|Opcional|Guardar|Cancelar|Eliminar|Buscar|Añadir|Agregar|Editar|Fecha|Sin fechas)\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'data' ? [] : walk(p);
    return /\.(ts|css)$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('no Spanish UI strings in src/ (BIZ-10)', () => {
  it.each(walk(root).map((p) => [relative(root, p), p]))('%s', (_rel, path) => {
    const offending = readFileSync(path, 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => SPANISH_UI.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
    expect(offending).toEqual([]);
  });
});
