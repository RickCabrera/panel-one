/**
 * Dinero EXACTO en el panel. La API manda los importes como texto con 2 decimales
 * (`"1234.50"`); aquí se convierten a centavos en `bigint` para sumar y comparar.
 * Nunca pasan por `number`: 0.1 + 0.2 no es 0.3 en float, y un total del día que
 * "casi" cuadra no cuadra.
 *
 * La única excepción es la gráfica, que necesita un `number` para dibujar: ése sale
 * de `paraGrafica()` y sólo sirve para la posición del punto, nunca para un texto.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** `"1234.5"` → `123450n`. Lo que no sea un decimal de hasta 2 cifras → `null`. */
export function aCentavos(texto: string): bigint | null {
  const partes = DECIMAL.exec(texto.trim());
  if (!partes) return null;
  const [, signo, enteros, decimales = ''] = partes;
  const centavos = BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, '0'));
  return signo === '-' ? -centavos : centavos;
}

export function sumar(montos: readonly bigint[]): bigint {
  return montos.reduce((total, monto) => total + monto, 0n);
}

/** `123450n` → `"$1,234.50"`. Los miles se agrupan sobre el `bigint`, sin float. */
export function formatearPesos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = negativo ? -centavos : centavos;
  const enteros = (absoluto / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimales = (absoluto % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}$${enteros}.${decimales}`;
}

/** Formatea el texto de la API. Si no es un importe válido, lo dice en vez de inventar. */
export function pesos(texto: string): string {
  const centavos = aCentavos(texto);
  return centavos === null ? 'Importe inválido' : formatearPesos(centavos);
}

/**
 * `parte / total` como porcentaje con un decimal (`"33.3 %"`). La división se hace
 * en `bigint` (en décimas de punto, redondeando a la mitad hacia arriba) y sólo el
 * resultado se vuelve texto. Con total 0 no hay porcentaje: `null`.
 */
export function porcentaje(parte: bigint, total: bigint): string | null {
  if (total <= 0n) return null;
  const decimas = (parte * 1000n * 2n + total) / (total * 2n);
  return `${decimas / 10n}.${decimas % 10n} %`;
}

/** Sólo para dibujar (Recharts pide `number`). Nunca para mostrar un importe. */
export function paraGrafica(centavos: bigint): number {
  return Number(centavos) / 100;
}

const COMPACTO = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });

/** Cantidad compacta para ejes de gráfica (`12500` → `"12.5 k"`). No es un importe. */
export function compacto(valor: number): string {
  return COMPACTO.format(valor);
}

/**
 * Pesos compactos para ejes de gráfica (`-12500` → `"-$12.5 k"`), con el signo
 * ANTES del `$` como `formatearPesos`. Recibe el `number` de `paraGrafica()`: sólo
 * rotula el eje, nunca muestra un importe exacto.
 */
export function pesosCompactos(valor: number): string {
  return `${valor < 0 ? '-' : ''}$${COMPACTO.format(Math.abs(valor))}`;
}
