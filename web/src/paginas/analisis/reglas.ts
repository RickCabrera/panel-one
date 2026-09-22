import type {
  CeldaHoraDia,
  ProductoTop,
  VentaHoraDia,
  VentaMesa,
  VentaMesero,
} from '../../api/tipos';
import { aCentavos, sumar } from '../../dinero/dinero';
import { delta, type Delta } from '../resumen/delta';

/**
 * Lógica pura de la vista Análisis (F2-221). Ninguna cifra de venta se calcula aquí: todas
 * vienen de la API. Lo propio es ordenar, paginar, clasificar las celdas del mapa y el Δ de
 * productos contra el periodo comparable (en `bigint`, como todo el dinero del panel).
 */

// ---------------------------------------------------------------------------
// Paginación
// ---------------------------------------------------------------------------

export const POR_PAGINA = 50;

export interface Pagina<T> {
  filas: T[];
  /** 1..paginas, ya acotada. */
  pagina: number;
  paginas: number;
  total: number;
}

/** La página `pagina` (se acota a 1..paginas). Sin filas hay una sola página, vacía. */
export function paginar<T>(filas: readonly T[], pagina: number, porPagina = POR_PAGINA): Pagina<T> {
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const actual = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas);
  const inicio = (actual - 1) * porPagina;
  return {
    filas: filas.slice(inicio, inicio + porPagina),
    pagina: actual,
    paginas,
    total: filas.length,
  };
}

// ---------------------------------------------------------------------------
// Sumas (el AC: todo desglose cuadra con la venta)
// ---------------------------------------------------------------------------

/** Σ de importes de la API; null si alguno es ilegible (no se inventa un total). */
export function sumaImportes(importes: readonly string[]): bigint | null {
  const centavos = importes.map(aCentavos);
  if (centavos.some((c) => c === null)) return null;
  return sumar(centavos as bigint[]);
}

// ---------------------------------------------------------------------------
// Meseros
// ---------------------------------------------------------------------------

export type OrdenMesero = 'venta' | 'cuentas' | 'ticketPromedio' | 'propina' | 'cancelados';

export const ORDENES_MESERO: readonly { orden: OrdenMesero; nombre: string }[] = [
  { orden: 'venta', nombre: 'Venta' },
  { orden: 'cuentas', nombre: 'Cuentas' },
  { orden: 'ticketPromedio', nombre: 'Ticket promedio' },
  { orden: 'propina', nombre: 'Propina' },
  { orden: 'cancelados', nombre: 'Cancelaciones' },
];

export const SIN_MESERO = 'Sin mesero';

export const nombreMesero = (f: Pick<VentaMesero, 'mesero'>) => f.mesero ?? SIN_MESERO;

function valorMesero(f: VentaMesero, orden: OrdenMesero): bigint | null {
  switch (orden) {
    case 'venta':
      return aCentavos(f.venta);
    case 'cuentas':
      return BigInt(f.cuentas);
    case 'ticketPromedio':
      return f.ticketPromedio === null ? null : aCentavos(f.ticketPromedio);
    case 'propina':
      return aCentavos(f.propina);
    case 'cancelados':
      return BigInt(f.cancelados.cuentas);
  }
}

export interface MeseroOrdenado {
  fila: VentaMesero;
  /** Posición en el ranking; null si no tiene dato en ese criterio (va al final). */
  posicion: number | null;
}

/**
 * Ranking por el criterio elegido, de mayor a menor. Sin dato (ticket sin cuentas) va al final
 * sin número. Empate: sucursal y nombre, para que el orden no dependa de la API.
 */
export function ordenarMeseros(
  filas: readonly VentaMesero[],
  orden: OrdenMesero,
): MeseroOrdenado[] {
  const clave = (f: VentaMesero) => `${f.sucursal}\u0000${nombreMesero(f)}\u0000${f.sucursalId}`;
  const conValor = filas.map((fila) => ({ fila, valor: valorMesero(fila, orden) }));
  conValor.sort((a, b) => {
    if (a.valor === null || b.valor === null) {
      if (a.valor === b.valor) return clave(a.fila) < clave(b.fila) ? -1 : 1;
      return a.valor === null ? 1 : -1;
    }
    if (a.valor !== b.valor) return a.valor > b.valor ? -1 : 1;
    return clave(a.fila) < clave(b.fila) ? -1 : 1;
  });
  return conValor.map(({ fila, valor }, i) => ({ fila, posicion: valor === null ? null : i + 1 }));
}

/** Σ de cancelados de todos los meseros: se muestra aparte, nunca dentro de la venta. */
export function canceladosDe(filas: readonly VentaMesero[]): {
  cuentas: number;
  monto: bigint | null;
} {
  return {
    cuentas: filas.reduce((n, f) => n + f.cancelados.cuentas, 0),
    monto: sumaImportes(filas.map((f) => f.cancelados.monto)),
  };
}

// ---------------------------------------------------------------------------
// Productos: Δ contra el periodo comparable
// ---------------------------------------------------------------------------

export interface Movimiento {
  producto: string;
  /** null = no se vendió en ese periodo. */
  actual: bigint | null;
  base: bigint | null;
  /** actual − base, tomando "no se vendió" como 0 para ordenar. */
  diferencia: bigint;
  delta: Delta;
}

export const NUEVO = 'Sin venta en el periodo de comparación: es nuevo o volvió.';
export const DEJO = 'Sin venta en este periodo: dejó de venderse.';

/**
 * Cruce por nombre (el mismo agrupado de la API). Un producto con importe ilegible se omite: no
 * se ordena lo que no se puede leer.
 */
export function movimientos(
  actual: readonly ProductoTop[],
  base: readonly ProductoTop[],
): Movimiento[] {
  const mapa = new Map<string, { actual: bigint | null; base: bigint | null }>();
  for (const p of actual) mapa.set(p.producto, { actual: aCentavos(p.importe), base: null });
  const ilegibles = new Set(
    actual.filter((p) => aCentavos(p.importe) === null).map((p) => p.producto),
  );
  for (const p of base) {
    const c = aCentavos(p.importe);
    if (c === null) ilegibles.add(p.producto);
    mapa.set(p.producto, { actual: mapa.get(p.producto)?.actual ?? null, base: c });
  }
  const salida: Movimiento[] = [];
  for (const [producto, { actual: a, base: b }] of mapa) {
    if (ilegibles.has(producto)) continue;
    const d =
      b === null
        ? { tipo: 'sinBase' as const, razon: NUEVO }
        : a === null
          ? { tipo: 'sinBase' as const, razon: DEJO }
          : delta(a, b, NUEVO);
    salida.push({ producto, actual: a, base: b, diferencia: (a ?? 0n) - (b ?? 0n), delta: d });
  }
  return salida;
}

const porNombre = (a: Movimiento, b: Movimiento) => (a.producto < b.producto ? -1 : 1);

/** Los `n` que más subieron (diferencia > 0) y los `n` que más cayeron (diferencia < 0). */
export function extremos(
  ms: readonly Movimiento[],
  n = 5,
): { subieron: Movimiento[]; cayeron: Movimiento[] } {
  const subieron = ms
    .filter((m) => m.diferencia > 0n)
    .sort((a, b) =>
      a.diferencia === b.diferencia ? porNombre(a, b) : a.diferencia > b.diferencia ? -1 : 1,
    )
    .slice(0, n);
  const cayeron = ms
    .filter((m) => m.diferencia < 0n)
    .sort((a, b) =>
      a.diferencia === b.diferencia ? porNombre(a, b) : a.diferencia < b.diferencia ? -1 : 1,
    )
    .slice(0, n);
  return { subieron, cayeron };
}

// ---------------------------------------------------------------------------
// Mapa de calor
// ---------------------------------------------------------------------------

export const DIAS_SEMANA: readonly { dia: number; corto: string; nombre: string }[] = [
  { dia: 1, corto: 'Lun', nombre: 'lunes' },
  { dia: 2, corto: 'Mar', nombre: 'martes' },
  { dia: 3, corto: 'Mié', nombre: 'miércoles' },
  { dia: 4, corto: 'Jue', nombre: 'jueves' },
  { dia: 5, corto: 'Vie', nombre: 'viernes' },
  { dia: 6, corto: 'Sáb', nombre: 'sábado' },
  { dia: 7, corto: 'Dom', nombre: 'domingo' },
];

/**
 * Qué es cada celda. Lo que la distingue NO es sólo el color (regla de F2-211):
 * - `fueraDePeriodo`: ese día de la semana no cae en el periodo. Se pinta "—".
 * - `sinVentas`: el día sí está, pero a esa hora no cerró ninguna cuenta. Celda vacía, borde
 *   punteado.
 * - `ceroPesos`: cerraron cuentas y su venta suma exactamente $0.00. Se pinta "0".
 * - `negativa`: cerraron cuentas y suman menos de cero (devoluciones). Se pinta "−".
 * - `venta`: con nivel 1..5 (quintil del máximo del mapa) para la intensidad del relleno.
 */
export type TipoCelda =
  | { tipo: 'fueraDePeriodo' }
  | { tipo: 'sinVentas' }
  | { tipo: 'ceroPesos'; cuentas: number }
  | { tipo: 'negativa'; cuentas: number; centavos: bigint }
  | { tipo: 'venta'; cuentas: number; centavos: bigint; nivel: 1 | 2 | 3 | 4 | 5 }
  | { tipo: 'ilegible' };

export interface MapaCalor {
  /** [día 1..7][hora 0..23]. */
  filas: {
    dia: (typeof DIAS_SEMANA)[number];
    enPeriodo: boolean;
    celdas: { hora: number; tipo: TipoCelda }[];
  }[];
  /** Venta máxima de una celda, para la leyenda; null si no hubo ninguna positiva. */
  maximo: bigint | null;
  /** Hubo al menos una cuenta en el periodo. */
  conVentas: boolean;
}

export function armarMapa(datos: VentaHoraDia): MapaCalor {
  const porCelda = new Map<string, CeldaHoraDia>(
    datos.celdas.map((c) => [`${c.diaSemana}-${c.hora}`, c]),
  );
  const dias = new Map(datos.diasEnRango.map((d) => [d.diaSemana, d.dias]));
  let maximo: bigint | null = null;
  for (const c of datos.celdas) {
    const centavos = aCentavos(c.venta);
    if (
      c.cuentas > 0 &&
      centavos !== null &&
      centavos > 0n &&
      (maximo === null || centavos > maximo)
    ) {
      maximo = centavos;
    }
  }
  const conVentas = datos.celdas.some((c) => c.cuentas > 0);
  return {
    maximo,
    conVentas,
    filas: DIAS_SEMANA.map((dia) => {
      const enPeriodo = (dias.get(dia.dia) ?? 0) > 0;
      return {
        dia,
        enPeriodo,
        celdas: Array.from({ length: 24 }, (_, hora) => ({
          hora,
          tipo: clasificar(porCelda.get(`${dia.dia}-${hora}`), enPeriodo, maximo),
        })),
      };
    }),
  };
}

function clasificar(
  c: CeldaHoraDia | undefined,
  enPeriodo: boolean,
  maximo: bigint | null,
): TipoCelda {
  if (!c || c.cuentas === 0) return enPeriodo ? { tipo: 'sinVentas' } : { tipo: 'fueraDePeriodo' };
  const centavos = aCentavos(c.venta);
  if (centavos === null) return { tipo: 'ilegible' };
  if (centavos === 0n) return { tipo: 'ceroPesos', cuentas: c.cuentas };
  if (centavos < 0n) return { tipo: 'negativa', cuentas: c.cuentas, centavos };
  // `maximo` existe: esta celda es positiva. Quintil hacia arriba: la más chica con venta es 1.
  const nivel = Number((centavos * 5n + maximo! - 1n) / maximo!) as 1 | 2 | 3 | 4 | 5;
  return { tipo: 'venta', cuentas: c.cuentas, centavos, nivel };
}

// ---------------------------------------------------------------------------
// Mesas
// ---------------------------------------------------------------------------

export type OrdenMesa = 'cuentas' | 'venta' | 'minutos' | 'mesa';

export const ORDENES_MESA: readonly { orden: OrdenMesa; nombre: string }[] = [
  { orden: 'cuentas', nombre: 'Cuentas (rotación)' },
  { orden: 'venta', nombre: 'Venta' },
  { orden: 'minutos', nombre: 'Minutos promedio' },
  { orden: 'mesa', nombre: 'Sucursal y mesa' },
];

/** Décimas de minuto de `"52.5"`; null si no hay dato o es ilegible. */
function decimas(texto: string | null): bigint | null {
  if (texto === null || !/^\d+\.\d$/.test(texto)) return null;
  return BigInt(texto.replace('.', ''));
}

const compararTexto = new Intl.Collator('es-MX', { numeric: true, sensitivity: 'base' }).compare;

export function ordenarMesas(filas: readonly VentaMesa[], orden: OrdenMesa): VentaMesa[] {
  const porMesa = (a: VentaMesa, b: VentaMesa) =>
    compararTexto(a.sucursal, b.sucursal) ||
    compararTexto(a.mesa, b.mesa) ||
    (a.sucursalId < b.sucursalId ? -1 : 1);
  const valor = (m: VentaMesa): bigint | null =>
    orden === 'cuentas'
      ? BigInt(m.cuentas)
      : orden === 'venta'
        ? aCentavos(m.venta)
        : decimas(m.minutosPromedio);
  return [...filas].sort((a, b) => {
    if (orden === 'mesa') return porMesa(a, b);
    const va = valor(a);
    const vb = valor(b);
    if (va === null || vb === null) return va === vb ? porMesa(a, b) : va === null ? 1 : -1;
    return va === vb ? porMesa(a, b) : va > vb ? -1 : 1;
  });
}
