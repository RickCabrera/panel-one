import { aCentavos, formatearPesos } from '../../dinero/dinero';

/**
 * El cambio de una cifra contra su base (F2-220). Todo en `bigint` (centavos o enteros):
 * ningún importe pasa por un float.
 *
 * La regla que pide el backlog: sin base no hay Δ. Una base sin cuentas, en cero o ilegible
 * da `sinBase` y la vista pinta "—" con el porqué, nunca un "+100 %" que sólo diría que antes
 * no había dato.
 */
export type Delta =
  | {
      tipo: 'cambio';
      diferencia: bigint;
      /** `"+12.3 %"`, `"-4.0 %"`, `"0.0 %"`. */ porcentaje: string;
    }
  | { tipo: 'sinBase'; razon: string };

/**
 * `(actual − base) / base` en décimas de punto, redondeando a la mitad lejos de cero. `base`
 * tiene que ser positiva (la llama `delta`, que ya lo comprobó).
 */
export function porcentajeDeCambio(actual: bigint, base: bigint): string {
  const diferencia = actual - base;
  const negativo = diferencia < 0n;
  const abs = negativo ? -diferencia : diferencia;
  const decimas = (abs * 1000n * 2n + base) / (base * 2n);
  const signo = decimas === 0n ? '' : negativo ? '-' : '+';
  return `${signo}${decimas / 10n}.${decimas % 10n} %`;
}

/**
 * Δ entre dos cantidades ya en `bigint`. `null` en cualquiera = dato ilegible. Una base
 * negativa (devoluciones que superan la venta) tampoco da porcentaje: no significa nada.
 */
export function delta(actual: bigint | null, base: bigint | null, razonSinBase: string): Delta {
  if (actual === null || base === null) {
    return { tipo: 'sinBase', razon: 'Algún importe no se pudo leer.' };
  }
  if (base <= 0n) return { tipo: 'sinBase', razon: razonSinBase };
  return {
    tipo: 'cambio',
    diferencia: actual - base,
    porcentaje: porcentajeDeCambio(actual, base),
  };
}

/** Δ de dos importes de la API (texto). La base sin cuentas no se compara. */
export function deltaImporte(
  actual: string | null,
  base: string | null,
  cuentasBase: number,
  razonSinBase: string,
): Delta {
  if (cuentasBase === 0) return { tipo: 'sinBase', razon: razonSinBase };
  if (actual === null || base === null) {
    return { tipo: 'sinBase', razon: razonSinBase };
  }
  return delta(aCentavos(actual), aCentavos(base), razonSinBase);
}

/** `+$1,234.50` / `-$20.00` / `$0.00`: la diferencia en pesos con su signo. */
export function diferenciaEnPesos(centavos: bigint): string {
  return centavos > 0n ? `+${formatearPesos(centavos)}` : formatearPesos(centavos);
}
