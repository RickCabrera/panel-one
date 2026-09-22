// @ts-check
/**
 * Regla local `tema/sin-colores` (F2-211): ningún color escrito a mano fuera de los
 * tokens. Todo color vive en `src/tema/paleta.ts`; los componentes usan `bg-fondo`,
 * `text-tinta`, `border-linea`... Marca, en cualquier cadena o plantilla:
 *
 * - clases de la paleta de fábrica de Tailwind: `text-slate-500`, `bg-white`,
 *   `hover:border-red-600/50`, y sus variables `var(--color-slate-500)`;
 * - colores literales, sueltos o en valores arbitrarios: `#e2e8f0`, `bg-[#fff]`,
 *   `rgb(…)`, `hsl(…)`, `oklch(…)`.
 *
 * `text-[10px]` no es color y pasa.
 */

const FAMILIAS =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILIDADES =
  'bg|text|border|border-[trblxyse]|ring|ring-offset|outline|divide|fill|stroke|from|via|to|shadow|placeholder|decoration|accent|caret';

export const COLOR_TAILWIND = new RegExp(
  String.raw`(^|[^\w-])(${UTILIDADES})-((${FAMILIAS})-\d{2,3}|white|black)(?![\w-])|--color-(${FAMILIAS}|white|black)\b`,
);
export const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(/i;

/** @param {string} texto */
export function tieneColor(texto) {
  return COLOR_TAILWIND.test(texto) || COLOR_LITERAL.test(texto);
}

/** @type {import('eslint').Rule.RuleModule} */
const sinColores = {
  meta: {
    type: 'problem',
    docs: { description: 'Prohíbe colores escritos a mano fuera de src/tema/paleta.ts.' },
    messages: {
      color:
        'Color escrito a mano. Usa un token de src/tema/paleta.ts (bg-fondo, text-tinta, border-linea...) o agrega uno ahí (F2-211).',
    },
    schema: [],
  },
  create(contexto) {
    /** @param {import('estree').Node} nodo @param {string} texto */
    const revisar = (nodo, texto) => {
      if (tieneColor(texto)) contexto.report({ node: nodo, messageId: 'color' });
    };
    return {
      Literal(nodo) {
        if (typeof nodo.value === 'string') revisar(nodo, nodo.value);
      },
      TemplateElement(nodo) {
        revisar(nodo, nodo.value.raw);
      },
    };
  },
};

export default { rules: { 'sin-colores': sinColores } };
