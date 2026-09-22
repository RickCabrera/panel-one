import type { Resumen, VentaSucursal } from '../../api/tipos';
import { aCentavos } from '../../dinero/dinero';
import { delta, type Delta } from '../resumen/delta';

/**
 * La matriz de Comparativos (F2-140): sucursal × métrica, periodo A contra periodo B. Aquí no
 * se calcula ninguna cifra de venta: cada una es la que manda la API (`comparativo-sucursales`
 * por sucursal, `resumen` para el total, los mismos endpoints que Inicio y Reportes). Lo único
 * propio es el Δ (con `delta`, en `bigint`, del Resumen) y el orden del ranking.
 *
 * La regla de "sin datos": una sucursal sin cuentas en un periodo no tiene cifras en ese
 * periodo. Se pinta "—", nunca $0.00 ni 0, y su Δ tampoco existe: "sin datos" no es "cero",
 * así que no se afirma un −100 % ni un +100 %.
 */

export type Metrica = 'venta' | 'cuentas' | 'ticketPromedio' | 'comensales';

export const METRICAS: readonly { metrica: Metrica; nombre: string; dinero: boolean }[] = [
  { metrica: 'venta', nombre: 'Venta', dinero: true },
  { metrica: 'cuentas', nombre: 'Tickets', dinero: false },
  { metrica: 'ticketPromedio', nombre: 'Ticket promedio', dinero: true },
  { metrica: 'comensales', nombre: 'Comensales', dinero: false },
];

/** Las cifras de un periodo, tal como las manda la API. */
export interface Cifras {
  venta: string;
  cuentas: number;
  ticketPromedio: string | null;
  comensales: number;
}

export interface FilaComparada {
  id: string;
  nombre: string;
  /** `null`: la API no trajo la fila en ese periodo (no debería pasar; se trata como sin datos). */
  a: Cifras | null;
  b: Cifras | null;
}

export function cifrasDeResumen(r: Resumen): Cifras {
  return {
    venta: r.venta,
    cuentas: r.cuentas,
    ticketPromedio: r.ticketPromedio,
    comensales: r.comensales.total,
  };
}

function cifrasDeSucursal(f: VentaSucursal): Cifras {
  return {
    venta: f.venta,
    cuentas: f.cuentas,
    ticketPromedio: f.ticketPromedio,
    comensales: f.comensales,
  };
}

/**
 * Una fila por sucursal, en el orden de A (el de la API: por nombre). Una sucursal que sólo
 * trae B (no pasa: la API devuelve todas las del alcance en cualquier periodo) va al final.
 */
export function armarFilas(
  a: readonly VentaSucursal[],
  b: readonly VentaSucursal[],
): FilaComparada[] {
  const deB = new Map(b.map((f) => [f.sucursalId, f]));
  const filas: FilaComparada[] = a.map((f) => {
    const enB = deB.get(f.sucursalId);
    return {
      id: f.sucursalId,
      nombre: f.nombre,
      a: cifrasDeSucursal(f),
      b: enB ? cifrasDeSucursal(enB) : null,
    };
  });
  const enA = new Set(a.map((f) => f.sucursalId));
  for (const f of b) {
    if (!enA.has(f.sucursalId)) {
      filas.push({ id: f.sucursalId, nombre: f.nombre, a: null, b: cifrasDeSucursal(f) });
    }
  }
  return filas;
}

/** ¿Hay cifras en este periodo? Sin cuentas no las hay. */
export function tieneDatos(c: Cifras | null): c is Cifras {
  return c !== null && c.cuentas > 0;
}

/**
 * El valor de una métrica en `bigint` (centavos o enteros). `null` = sin datos en el periodo
 * o importe ilegible: ninguno de los dos entra a un Δ ni al ranking.
 */
export function valor(c: Cifras | null, m: Metrica): bigint | null {
  if (!tieneDatos(c)) return null;
  switch (m) {
    case 'venta':
      return aCentavos(c.venta);
    case 'cuentas':
      return BigInt(c.cuentas);
    case 'ticketPromedio':
      return c.ticketPromedio === null ? null : aCentavos(c.ticketPromedio);
    case 'comensales':
      return BigInt(c.comensales);
  }
}

const RAZON_BASE_CERO: Record<Metrica, string> = {
  venta: 'La venta de B es cero o negativa.',
  cuentas: 'Sin tickets en el periodo B.',
  ticketPromedio: 'Sin ticket promedio en el periodo B.',
  comensales: 'Sin comensales registrados en el periodo B.',
};

/** Δ de una métrica de A contra B. Sin datos en cualquiera de los dos: "—" con el porqué. */
export function deltaDe(fila: Pick<FilaComparada, 'a' | 'b'>, m: Metrica): Delta {
  if (!tieneDatos(fila.a)) return { tipo: 'sinBase', razon: 'Sin cuentas en el periodo A.' };
  if (!tieneDatos(fila.b)) return { tipo: 'sinBase', razon: 'Sin cuentas en el periodo B.' };
  return delta(valor(fila.a, m), valor(fila.b, m), RAZON_BASE_CERO[m]);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type Orden = Metrica | 'deltaVenta';

export const ORDENES: readonly { orden: Orden; nombre: string }[] = [
  { orden: 'venta', nombre: 'Venta (A)' },
  { orden: 'cuentas', nombre: 'Tickets (A)' },
  { orden: 'ticketPromedio', nombre: 'Ticket promedio (A)' },
  { orden: 'comensales', nombre: 'Comensales (A)' },
  { orden: 'deltaVenta', nombre: 'Δ % de venta' },
];

export interface FilaOrdenada {
  fila: FilaComparada;
  /** Lugar en el ranking; `null` si la fila no tiene dato para ese criterio (va al final). */
  posicion: number | null;
}

/** Una fracción con denominador POSITIVO: el Δ % de venta sin dividir. */
interface Fraccion {
  num: bigint;
  den: bigint;
}

function claveDelta(fila: FilaComparada): Fraccion | null {
  const a = valor(fila.a, 'venta');
  const b = valor(fila.b, 'venta');
  if (a === null || b === null || b <= 0n) return null;
  return { num: a - b, den: b };
}

function porNombre(x: FilaComparada, y: FilaComparada): number {
  const n = x.nombre.localeCompare(y.nombre, 'es');
  if (n !== 0) return n;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}

/**
 * Ranking de mayor a menor por el criterio elegido. Los criterios de A sólo miran A; el Δ %
 * de venta mira los dos y deja fuera a quien no tiene base positiva en B. Los de fuera van al
 * final, por nombre y sin número. Empates: por nombre y luego por id, el mismo orden siempre.
 *
 * El Δ % se compara en producto cruzado (`(a1−b1)·b2` contra `(a2−b2)·b1`, con b1, b2 > 0):
 * nunca se parsea el texto formateado ni se divide en float.
 */
export function ordenar(filas: readonly FilaComparada[], orden: Orden): FilaOrdenada[] {
  const conClave: { fila: FilaComparada; clave: Fraccion }[] = [];
  const fuera: FilaComparada[] = [];
  for (const fila of filas) {
    const clave =
      orden === 'deltaVenta'
        ? claveDelta(fila)
        : ((v) => (v === null ? null : { num: v, den: 1n }))(valor(fila.a, orden));
    if (clave === null) fuera.push(fila);
    else conClave.push({ fila, clave });
  }
  conClave.sort((x, y) => {
    const izq = x.clave.num * y.clave.den;
    const der = y.clave.num * x.clave.den;
    if (izq !== der) return izq > der ? -1 : 1;
    return porNombre(x.fila, y.fila);
  });
  fuera.sort(porNombre);
  return [
    ...conClave.map(({ fila }, i) => ({ fila, posicion: i + 1 })),
    ...fuera.map((fila) => ({ fila, posicion: null })),
  ];
}
