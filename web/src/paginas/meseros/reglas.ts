import type {
  FilaRendimientoMesero,
  MeseroLigado,
  RendimientoMeseros,
  SucursalRendimiento,
} from '../../api/tipos';
import { aCentavos } from '../../dinero/dinero';
import { sumaImportes } from '../analisis/reglas';

/**
 * Lógica pura de Meseros (F2-231). Ninguna cifra de venta se calcula aquí: vienen de la API.
 * Lo propio es decir en palabras el estado de cada mesero, compararlo contra el promedio de
 * SU sucursal y verificar que la suma cuadra (en `bigint`, como todo el dinero del panel).
 */

export const SIN_MESERO = 'Sin mesero';

export const nombreFila = (f: Pick<FilaRendimientoMesero, 'mesero'>) => f.mesero ?? SIN_MESERO;

/** El estado del mesero en el catálogo del POS, en palabras. Nunca "Activo" sin dato. */
export function estadoCatalogo(m: Pick<MeseroLigado, 'activo' | 'activoPos'>): string {
  if (!m.activo) return 'Ya no aparece en el POS';
  if (m.activoPos === false) return 'Dado de baja en el POS';
  if (m.activoPos === null) return 'En el POS (sin dato de baja)';
  return 'Activo en el POS';
}

/** El estado de una fila de venta: el del catálogo si se ligó, o por qué no se ligó. */
export function estadoFila(f: Pick<FilaRendimientoMesero, 'cruce' | 'catalogo'>): string {
  switch (f.cruce) {
    case 'catalogo':
      return f.catalogo ? estadoCatalogo(f.catalogo) : 'En el catálogo';
    case 'sin-catalogo':
      return 'No está en el catálogo';
    case 'ambiguo':
      return 'Nombre repetido en el catálogo';
    case 'sin-sincronizar':
      return 'Catálogo sin sincronizar';
    case 'catalogo-incompleto':
      return 'Catálogo incompleto';
    case 'sin-mesero':
      return 'Cuentas sin mesero';
  }
}

/** "3 de 5", o null si está fuera del ranking. */
export function posicionTexto(posicion: number | null, deCuantos: number): string | null {
  return posicion === null ? null : `${posicion} de ${deCuantos}`;
}

export interface Comparacion {
  /** Diferencia en %, con signo y 1 decimal ("+12.5 %"); null si no hay contra qué comparar. */
  texto: string | null;
  /** Para leerla sin color. */
  sentido: 'arriba' | 'abajo' | 'igual' | null;
}

/** Un decimal de la API (importe, cuentas o minutos, hasta 3 decimales) en milésimas enteras. */
function milesimas(texto: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(texto.trim());
  if (!m) return null;
  const n = BigInt(m[2]) * 1000n + BigInt((m[3] ?? '').padEnd(3, '0'));
  return m[1] === '-' ? -n : n;
}

/**
 * El valor del mesero contra el promedio de su sucursal, sin flotantes: (a − b) / b en décimas
 * de punto porcentual, redondeado a la mitad hacia afuera.
 */
export function comparar(valor: string | null, promedio: string | null): Comparacion {
  const a = valor === null ? null : milesimas(valor);
  const b = promedio === null ? null : milesimas(promedio);
  if (a === null || b === null || b <= 0n) return { texto: null, sentido: null };
  const num = (a - b) * 1000n;
  const abs = num < 0n ? -num : num;
  const decimas = (abs + b / 2n) / b;
  if (decimas === 0n) return { texto: '0.0 %', sentido: 'igual' };
  const signo = num < 0n ? '−' : '+';
  return {
    texto: `${signo}${decimas / 10n}.${decimas % 10n} %`,
    sentido: num < 0n ? 'abajo' : 'arriba',
  };
}

/** ¿Cuadra Σ venta de las filas con la venta del periodo? null si algún importe es ilegible. */
export function cuadra(r: Pick<RendimientoMeseros, 'venta' | 'filas'>): boolean | null {
  const suma = sumaImportes(r.filas.map((f) => f.venta));
  const total = aCentavos(r.venta);
  if (suma === null || total === null) return null;
  return suma === total;
}

export function sucursalDe(
  r: Pick<RendimientoMeseros, 'sucursales'>,
  sucursalId: string,
): SucursalRendimiento | undefined {
  return r.sucursales.find((s) => s.sucursalId === sucursalId);
}

/** Llave estable de una fila: el id del catálogo si se ligó; si no, sucursal + texto. */
export function llaveFila(f: FilaRendimientoMesero): string {
  if (f.catalogo) return `c|${f.catalogo.id}`;
  return `t|${f.sucursalId}|${f.mesero === null ? '\u0000' : f.mesero}`;
}
