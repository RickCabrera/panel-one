// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * AC4 de F2-211: "ningún color queda escrito a mano fuera de los tokens (regla de
 * lint)". Aquí se prueba que la regla existe, está encendida con la config REAL del
 * repo y marca lo que tiene que marcar. Que el repo esté limpio lo prueba `npm run
 * lint` en el CI.
 */
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd: RAIZ });

async function errores(codigo: string, archivo = 'src/paginas/Ejemplo.tsx'): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: `${RAIZ}${archivo}` });
  return resultado.messages.filter((m) => m.ruleId === 'tema/sin-colores').map((m) => m.message);
}

describe('regla tema/sin-colores', () => {
  it.each([
    ["const a = 'text-slate-500';", 'clase de la paleta de Tailwind'],
    ["const a = 'rounded bg-white p-2';", 'bg-white'],
    ["const a = 'hover:border-red-600/50';", 'con variante y opacidad'],
    ["const a = 'bg-[#fff]';", 'valor arbitrario con hex'],
    ["const a = 'text-[rgb(0,0,0)]';", 'valor arbitrario con rgb'],
    ["const c = '#e2e8f0';", 'hex suelto'],
    ['const c = `border ${x ? "a" : "b"} bg-sky-500`;', 'dentro de una plantilla'],
    ['const x = <path stroke="#fff" />;', 'atributo JSX'],
    ["const v = 'var(--color-slate-50)';", 'variable de la paleta de Tailwind'],
  ])(
    'marca %s (%s)',
    async (codigo) => {
      expect(await errores(codigo)).toHaveLength(1);
    },
    30_000,
  );

  it.each([
    "const a = 'rounded bg-fondo text-tinta border-linea';",
    "const a = 'text-[10px] bg-acento text-sobre-acento';",
    "const a = 'ring-acento-borde/30 border-semaforo-rojo';",
    "const id = '#principal';",
  ])(
    'deja pasar %s',
    async (codigo) => {
      expect(await errores(codigo)).toEqual([]);
    },
    30_000,
  );

  it('paleta.ts, el único lugar de los colores, queda fuera', async () => {
    expect(await errores("const c = '#e2e8f0';", 'src/tema/paleta.ts')).toEqual([]);
  }, 30_000);
});
