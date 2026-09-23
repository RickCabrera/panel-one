import type {
  EstadoResultados,
  EstadoResultadosBase,
  Resumen,
  VentaSucursal,
} from '../../api/tipos';
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
 *
 * Utilidad (F2-126): la utilidad de OPERACIÓN que manda `GET /finanzas/estado-resultados` (venta
 * neta − costo teórico − gastos), por sucursal y el `total` para la fila de total (nunca se suma
 * aquí: el API la deja nula si falta una sucursal). Nula = "—" con su porqué (sin costo de lo
 * vendido, periodo B cortado a la misma altura, o no se pudo leer), nunca $0.00.
 */

export type Metrica = 'venta' | 'cuentas' | 'ticketPromedio' | 'comensales' | 'utilidad';

export const METRICAS: readonly { metrica: Metrica; nombre: string; dinero: boolean }[] = [
  { metrica: 'venta', nombre: 'Venta', dinero: true },
  { metrica: 'cuentas', nombre: 'Tickets', dinero: false },
  { metrica: 'ticketPromedio', nombre: 'Ticket promedio', dinero: true },
  { metrica: 'comensales', nombre: 'Comensales', dinero: false },
  { metrica: 'utilidad', nombre: 'Utilidad', dinero: true },
];

/** La utilidad de operación de un periodo, o por qué no la hay. */
export interface Utilidad {
  /** `null` = no se puede afirmar; `razon` dice por qué. */
  importe: string | null;
  razon: string | null;
  /** Costo de lo vendido incompleto: la utilidad real es menor o igual. */
  sobrestimada: boolean;
}

export const UTILIDAD_SIN_COSTO =
  'Sin costo de lo vendido (sin recetas o sin catálogo de productos): no hay utilidad.';
export const UTILIDAD_SIN_LECTURA = 'La utilidad no se pudo leer.';
export const UTILIDAD_CORTADA =
  'El periodo B se corta a la misma altura y la utilidad sólo se calcula por días completos.';
export const UTILIDAD_SOBRESTIMADA =
  'Costo de lo vendido incompleto: la utilidad real es menor o igual.';

/** Sin estado de resultados: la utilidad no se afirma, con el porqué que se pase. */
export const sinUtilidad = (razon: string): Utilidad => ({
  importe: null,
  razon,
  sobrestimada: false,
});

/** La utilidad de una fila del estado de resultados (sucursal o total). */
export function utilidadDe(r: EstadoResultadosBase): Utilidad {
  if (r.utilidadOperacion === null) return sinUtilidad(UTILIDAD_SIN_COSTO);
  return { importe: r.utilidadOperacion, razon: null, sobrestimada: r.utilidadSobrestimada };
}

/** Las utilidades de un periodo: por sucursal y la del total, tal como las manda el API. */
export interface UtilidadesPeriodo {
  deSucursal: (sucursalId: string) => Utilidad;
  total: Utilidad;
}

/**
 * `estado` ausente (no se pidió o falló) = todas nulas con `razon`. Una sucursal que el estado no
 * trae (no debería pasar) también es nula, nunca cero.
 */
export function utilidadesDe(
  estado: EstadoResultados | undefined,
  razon: string,
): UtilidadesPeriodo {
  if (!estado) return { deSucursal: () => sinUtilidad(razon), total: sinUtilidad(razon) };
  const porId = new Map(estado.sucursales.map((s) => [s.sucursalId, utilidadDe(s)]));
  return {
    deSucursal: (id) => porId.get(id) ?? sinUtilidad(UTILIDAD_SIN_LECTURA),
    total: utilidadDe(estado.total),
  };
}

const SIN_ESTADO: UtilidadesPeriodo = utilidadesDe(undefined, UTILIDAD_SIN_LECTURA);

/** Las cifras de un periodo, tal como las manda la API. */
export interface Cifras {
  venta: string;
  cuentas: number;
  ticketPromedio: string | null;
  comensales: number;
  utilidad: Utilidad;
}

export interface FilaComparada {
  id: string;
  nombre: string;
  /** `null`: la API no trajo la fila en ese periodo (no debería pasar; se trata como sin datos). */
  a: Cifras | null;
  b: Cifras | null;
}

export function cifrasDeResumen(
  r: Resumen,
  utilidad: Utilidad = sinUtilidad(UTILIDAD_SIN_LECTURA),
): Cifras {
  return {
    venta: r.venta,
    cuentas: r.cuentas,
    ticketPromedio: r.ticketPromedio,
    comensales: r.comensales.total,
    utilidad,
  };
}

function cifrasDeSucursal(f: VentaSucursal, u: UtilidadesPeriodo): Cifras {
  return {
    venta: f.venta,
    cuentas: f.cuentas,
    ticketPromedio: f.ticketPromedio,
    comensales: f.comensales,
    utilidad: u.deSucursal(f.sucursalId),
  };
}

/**
 * Una fila por sucursal, en el orden de A (el de la API: por nombre). Una sucursal que sólo
 * trae B (no pasa: la API devuelve todas las del alcance en cualquier periodo) va al final.
 */
export function armarFilas(
  a: readonly VentaSucursal[],
  b: readonly VentaSucursal[],
  ua: UtilidadesPeriodo = SIN_ESTADO,
  ub: UtilidadesPeriodo = SIN_ESTADO,
): FilaComparada[] {
  const deB = new Map(b.map((f) => [f.sucursalId, f]));
  const filas: FilaComparada[] = a.map((f) => {
    const enB = deB.get(f.sucursalId);
    return {
      id: f.sucursalId,
      nombre: f.nombre,
      a: cifrasDeSucursal(f, ua),
      b: enB ? cifrasDeSucursal(enB, ub) : null,
    };
  });
  const enA = new Set(a.map((f) => f.sucursalId));
  for (const f of b) {
    if (!enA.has(f.sucursalId)) {
      filas.push({ id: f.sucursalId, nombre: f.nombre, a: null, b: cifrasDeSucursal(f, ub) });
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
    case 'utilidad':
      return c.utilidad.importe === null ? null : aCentavos(c.utilidad.importe);
  }
}

const RAZON_BASE_CERO: Record<Metrica, string> = {
  venta: 'La venta de B es cero o negativa.',
  cuentas: 'Sin tickets en el periodo B.',
  ticketPromedio: 'Sin ticket promedio en el periodo B.',
  comensales: 'Sin comensales registrados en el periodo B.',
  utilidad: 'La utilidad de B es cero o negativa: no hay Δ %.',
};

/** Δ de una métrica de A contra B. Sin datos en cualquiera de los dos: "—" con el porqué. */
export function deltaDe(fila: Pick<FilaComparada, 'a' | 'b'>, m: Metrica): Delta {
  if (!tieneDatos(fila.a)) return { tipo: 'sinBase', razon: 'Sin cuentas en el periodo A.' };
  if (!tieneDatos(fila.b)) return { tipo: 'sinBase', razon: 'Sin cuentas en el periodo B.' };
  if (m === 'utilidad') {
    // Sin utilidad en un lado no hay Δ, y el porqué es el de ese lado (no "importe ilegible").
    if (fila.a.utilidad.importe === null) {
      return {
        tipo: 'sinBase',
        razon: `Periodo A: ${fila.a.utilidad.razon ?? UTILIDAD_SIN_LECTURA}`,
      };
    }
    if (fila.b.utilidad.importe === null) {
      return {
        tipo: 'sinBase',
        razon: `Periodo B: ${fila.b.utilidad.razon ?? UTILIDAD_SIN_LECTURA}`,
      };
    }
  }
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
  { orden: 'utilidad', nombre: 'Utilidad (A)' },
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
