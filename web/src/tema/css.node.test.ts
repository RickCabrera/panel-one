// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TOKENS, TOKENS_ACENTO } from './paleta';

// Se lee del disco y no con `?raw`: el plugin de Tailwind procesaría el CSS antes.
// Si el archivo se mueve, la lectura truena y este test FALLA (no se salta).
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

/** Las líneas `--color-x: var(--x);` del bloque `@theme inline`. */
function mapeo(texto: string): Map<string, string> {
  const bloque = /@theme inline\s*\{([^}]*)\}/.exec(texto);
  if (!bloque) throw new Error('index.css no trae el bloque @theme inline');
  return new Map(
    [...bloque[1].matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

/** Las partes de una lista de selectores, sin cortar las comas de dentro de `:where(...)`. */
function separarSelectores(lista: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let actual = '';
  for (const c of lista) {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) {
      partes.push(actual);
      actual = '';
    } else actual += c;
  }
  return [...partes, actual];
}

// ESLint no lee CSS: esta es la guardia de "ningún color a mano" para index.css.
describe('index.css (F2-211)', () => {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('expone a Tailwind exactamente los tokens de paleta.ts, cada uno con su variable', () => {
    const m = mapeo(sinComentarios);
    expect([...m.keys()].sort()).toEqual([...TOKENS, ...TOKENS_ACENTO].sort());
    for (const [token, valor] of m) expect(valor).toBe(`var(--${token})`);
  });

  it('no escribe ningún color: ni hex, ni rgb/hsl, ni la paleta de fábrica de Tailwind', () => {
    expect(sinComentarios).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sinComentarios).not.toMatch(/\b(rgba?|hsla?|oklch|oklab)\(/);
    expect(sinComentarios).not.toMatch(
      /--color-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|sky|blue|white|black)\b/,
    );
  });

  it('apaga la paleta de fábrica de Tailwind', () => {
    expect(sinComentarios).toMatch(/@theme\s*\{\s*--color-\*:\s*initial;\s*\}/);
  });

  it('los placeholders usan la tinta tenue, opaca (la de fábrica queda bajo 4.5:1)', () => {
    const regla = /::placeholder\s*\{([^}]*)\}/.exec(sinComentarios)?.[1] ?? '';
    expect(regla).toMatch(/(^|[\s;])color:\s*var\(--tinta-tenue\);/);
    expect(regla).toMatch(/opacity:\s*1;/);
  });

  it('el texto sin clase hereda la tinta del tema, sobre el fondo del tema', () => {
    const body = /body\s*\{([^}]*)\}/.exec(sinComentarios)?.[1] ?? '';
    expect(body).toMatch(/(^|[\s;])color:\s*var\(--tinta\);/);
    expect(body).toMatch(/background-color:\s*var\(--fondo\);/);
  });

  // UI-06: el vidrio de «Noche» no puede ganarle a una utilidad semántica (la tarjeta roja de
  // «Atención requerida» en Mesas: `bg-peligro-fondo/40`, `border-peligro-borde`). Sus reglas van
  // con `:where([data-estilo='noche'])` y sólo cambian variables, nunca el color de fondo o de
  // borde directamente.
  it('las reglas del vidrio y del resplandor usan :where() y no pisan fondo ni borde', () => {
    const reglas = [...sinComentarios.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
      .map(([, selector, cuerpo]) => ({ selector: selector.trim(), cuerpo }))
      .filter(({ selector }) => /\.(vidrio|resplandor)/.test(selector));
    expect(reglas.length).toBeGreaterThan(5);
    for (const { selector, cuerpo } of reglas) {
      for (const parte of separarSelectores(selector)) {
        expect(parte.trim()).toMatch(/^:where\(\[data-estilo='noche'\]\)\s/);
      }
      expect(cuerpo).not.toMatch(/(^|[\s;])(background-color|border-color|background|border)\s*:/);
    }
    expect(sinComentarios).not.toMatch(/(^|[^(])\[data-estilo='noche'\]\s*\./);
  });
});
