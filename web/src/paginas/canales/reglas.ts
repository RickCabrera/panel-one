import type { CanalNegocio, MontoArea, VentaPorArea } from '../../api/tipos';
import { aCentavos, formatearPesos, porcentaje } from '../../dinero/dinero';
import { CANALES, NOMBRE_CANAL, SIN_CANAL, SIN_CLASIFICAR } from '../areas/reglas';
import { delta, type Delta } from '../resumen/delta';

/**
 * Ventas por canal (F2-144), reglas puras: la mezcla por canal de dos periodos (A, el de la
 * cabecera, y B, el de comparación) y sus Δ. Ninguna cifra de venta se calcula aquí: cada canal,
 * "área sin canal" y "sin clasificar" son los de `GET /ventas/por-area` (F2-233), cuya Σ es la
 * venta del periodo. Lo único propio es la mezcla, el ticket promedio y los Δ, todo en `bigint`.
 *
 * La regla de "sin datos" es la de Comparativos: un canal sin cuentas en un periodo no tiene
 * cifras en ese periodo ("—", nunca $0.00 ni 0.0 %), y su Δ tampoco existe.
 */

export type LlaveCanal = CanalNegocio | 'sin-canal' | 'sin-area';

/** Lo de un canal en un periodo. `null` en la fila = sin cuentas en ese periodo. */
export interface LadoCanal {
  venta: string;
  cuentas: number;
  /** `"33.3 %"` de la venta del periodo; `null` si algún importe es ilegible. */
  mezcla: string | null;
  /** `"$86.40"`, redondeado a la mitad hacia arriba; `null` si el importe es ilegible. */
  ticket: string | null;
}

/** Δ de la mezcla en puntos porcentuales, o por qué no la hay. */
export type DeltaPp = { tipo: 'cambio'; texto: string } | { tipo: 'sinBase'; razon: string };

export interface FilaMezcla {
  llave: LlaveCanal;
  nombre: string;
  a: LadoCanal | null;
  b: LadoCanal | null;
  deltaVenta: Delta;
  deltaMezcla: DeltaPp;
}

export const SIN_CUENTAS_A = 'Sin cuentas de este canal en el periodo A.';
export const SIN_CUENTAS_B = 'Sin cuentas de este canal en el periodo B.';
export const SIN_B = 'No hay periodo B que comparar.';
const ILEGIBLE = 'Algún importe no se pudo leer.';

/** El ticket promedio en centavos, redondeando a la mitad hacia arriba (como `/ventas/resumen`). */
function ticket(venta: bigint, cuentas: number): string {
  const n = BigInt(cuentas);
  const c = venta < 0n ? -((-venta * 2n + n) / (2n * n)) : (venta * 2n + n) / (2n * n);
  return formatearPesos(c);
}

function lado(m: MontoArea | undefined, total: bigint | null): LadoCanal | null {
  if (!m || m.cuentas === 0) return null;
  const venta = aCentavos(m.venta);
  return {
    venta: m.venta,
    cuentas: m.cuentas,
    mezcla: venta === null || total === null ? null : porcentaje(venta, total),
    ticket: venta === null ? null : ticket(venta, m.cuentas),
  };
}

/**
 * Δ de mezcla EXACTO: `(a/ta − b/tb)` en décimas de punto, con UN solo redondeo (a la mitad lejos
 * de cero) sobre los cocientes exactos. Restar las dos mezclas ya redondeadas puede fallar por
 * 0.1 pp (33.3 − 16.7 = 16.6, y lo exacto es 16.67 → 16.7).
 */
export function puntosDeMezcla(a: bigint, ta: bigint, b: bigint, tb: bigint): string {
  const num = (a * tb - b * ta) * 1000n;
  const den = ta * tb;
  const negativo = num < 0n;
  const abs = negativo ? -num : num;
  const decimas = (abs * 2n + den) / (den * 2n);
  const signo = decimas === 0n ? '' : negativo ? '-' : '+';
  return `${signo}${decimas / 10n}.${decimas % 10n} pp`;
}

function deltaMezcla(
  ma: MontoArea | undefined,
  ta: bigint | null,
  mb: MontoArea | undefined,
  tb: bigint | null,
): DeltaPp {
  if (!ma || ma.cuentas === 0) return { tipo: 'sinBase', razon: SIN_CUENTAS_A };
  if (!mb || mb.cuentas === 0) return { tipo: 'sinBase', razon: SIN_CUENTAS_B };
  const a = aCentavos(ma.venta);
  const b = aCentavos(mb.venta);
  if (a === null || b === null || ta === null || tb === null) {
    return { tipo: 'sinBase', razon: ILEGIBLE };
  }
  // Un total en cero o negativo (devoluciones) no da mezcla que comparar.
  if (ta <= 0n || tb <= 0n) return { tipo: 'sinBase', razon: 'Sin venta que repartir en algún periodo.' };
  return { tipo: 'cambio', texto: puntosDeMezcla(a, ta, b, tb) };
}

function deltaVenta(ma: MontoArea | undefined, mb: MontoArea | undefined): Delta {
  if (!ma || ma.cuentas === 0) return { tipo: 'sinBase', razon: SIN_CUENTAS_A };
  if (!mb || mb.cuentas === 0) return { tipo: 'sinBase', razon: SIN_CUENTAS_B };
  return delta(aCentavos(ma.venta), aCentavos(mb.venta), SIN_CUENTAS_B);
}

/** Los montos de un periodo por llave: cada canal con cuentas y los dos renglones aparte. */
function montos(r: VentaPorArea): Map<LlaveCanal, MontoArea> {
  const m = new Map<LlaveCanal, MontoArea>(r.canales.map((c) => [c.canal, c]));
  if (r.sinCanal.cuentas > 0) m.set('sin-canal', r.sinCanal);
  if (r.sinArea.cuentas > 0) m.set('sin-area', r.sinArea);
  return m;
}

const ORDEN: readonly LlaveCanal[] = [...CANALES, 'sin-canal', 'sin-area'];

export function nombreLlave(llave: LlaveCanal): string {
  if (llave === 'sin-canal') return SIN_CANAL;
  if (llave === 'sin-area') return SIN_CLASIFICAR;
  return NOMBRE_CANAL[llave];
}

/**
 * Una fila por canal con cuentas en A o en B (en el orden del enum), y después "área sin canal"
 * y "sin clasificar" si tienen cuentas en alguno. `b` nulo = no hay periodo B (inválido): sus
 * columnas son "—" con `SIN_B`.
 */
export function filasMezcla(a: VentaPorArea, b: VentaPorArea | null): FilaMezcla[] {
  const ma = montos(a);
  const mb = b === null ? new Map<LlaveCanal, MontoArea>() : montos(b);
  const ta = aCentavos(a.venta);
  const tb = b === null ? null : aCentavos(b.venta);
  return ORDEN.filter((l) => ma.has(l) || mb.has(l)).map((llave) => {
    const x = ma.get(llave);
    const y = mb.get(llave);
    return {
      llave,
      nombre: nombreLlave(llave),
      a: lado(x, ta),
      b: lado(y, tb),
      deltaVenta: b === null ? { tipo: 'sinBase', razon: SIN_B } : deltaVenta(x, y),
      deltaMezcla: b === null ? { tipo: 'sinBase', razon: SIN_B } : deltaMezcla(x, ta, y, tb),
    };
  });
}

/** La fila de total: la venta del periodo (100 % de la mezcla). `null` = sin cuentas. */
export function ladoTotal(r: VentaPorArea | null): LadoCanal | null {
  if (r === null || r.cuentas === 0) return null;
  const venta = aCentavos(r.venta);
  return {
    venta: r.venta,
    cuentas: r.cuentas,
    mezcla: venta === null || venta <= 0n ? null : '100.0 %',
    ticket: venta === null ? null : ticket(venta, r.cuentas),
  };
}

export function deltaTotal(a: VentaPorArea, b: VentaPorArea | null): Delta {
  if (b === null) return { tipo: 'sinBase', razon: SIN_B };
  if (a.cuentas === 0) return { tipo: 'sinBase', razon: 'Sin cuentas en el periodo A.' };
  if (b.cuentas === 0) return { tipo: 'sinBase', razon: 'Sin cuentas en el periodo B.' };
  return delta(aCentavos(a.venta), aCentavos(b.venta), 'Sin venta en el periodo B.');
}

/** Décimas de la mezcla (`"33.3 %"` → 333), SÓLO para el ancho de la barra. */
export function decimasParaBarra(mezcla: string | null): number {
  if (mezcla === null) return 0;
  const m = /^(\d+)\.(\d) %$/.exec(mezcla);
  return m ? Math.min(1000, Number(m[1]) * 10 + Number(m[2])) : 0;
}
