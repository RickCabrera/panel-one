import { Prisma } from '@prisma/client';

/**
 * Meseros en tiempo real (MVP): lo puro, sin base. Junta lo COBRADO del día (cuentas cerradas,
 * las mismas cifras de `/ventas/por-mesero`) con lo que está EN CURSO en las mesas abiertas del
 * último snapshot de cada sucursal.
 */

const CERO = new Prisma.Decimal(0);

/** Un total de mesa del snapshot: `"350.50"` o un número. Cualquier otra cosa = sin dato. */
const IMPORTE = /^-?\d{1,10}(\.\d{1,4})?$/;

export function totalDeMesa(valor: unknown): Prisma.Decimal | null {
  if (typeof valor === 'string' && IMPORTE.test(valor.trim())) {
    return new Prisma.Decimal(valor.trim());
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return new Prisma.Decimal(valor);
  }
  return null;
}

/** El nombre del mesero tal como sirve para juntar cheques y mesas: recortado; vacío = sin mesero. */
export function nombreMesero(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

export interface CobradoMesero {
  sucursalId: string;
  sucursal: string;
  mesero: string | null;
  venta: Prisma.Decimal;
  cuentas: number;
  comensales: number;
}

export interface MesasDeSucursal {
  sucursalId: string;
  sucursal: string;
  mesas: ReadonlyArray<Record<string, unknown>>;
}

export interface FilaMeseroEnVivo {
  /** Lugar dentro de SU sucursal por total (cobrado + en curso); null = sin mesero. */
  posicion: number | null;
  sucursalId: string;
  sucursal: string;
  mesero: string | null;
  cobrado: Prisma.Decimal;
  cuentas: number;
  comensales: number;
  mesasAbiertas: number;
  /** Σ de los totales legibles de sus mesas abiertas. */
  enCurso: Prisma.Decimal;
  /** Mesas abiertas suyas cuyo total no se pudo leer (no entran en `enCurso`). */
  mesasSinTotal: number;
  comensalesEnMesa: number;
}

function llave(sucursalId: string, mesero: string | null): string {
  return `${sucursalId}\u0000${mesero ?? ''}`;
}

const compararTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Une cobrado y en curso por (sucursal, mesero). El mismo nombre en dos sucursales son dos filas
 * (no se sabe si es la misma persona, esquema-sr.md §7). Orden: total desc, cobrado desc,
 * sucursal y mesero (code points; sin mesero al final). La posición es dentro de SU sucursal y
 * las cuentas sin mesero no entran al ranking.
 */
export function unirMeseros(
  cobrado: readonly CobradoMesero[],
  mesas: readonly MesasDeSucursal[],
): FilaMeseroEnVivo[] {
  const filas = new Map<string, FilaMeseroEnVivo>();
  const fila = (sucursalId: string, sucursal: string, mesero: string | null) => {
    const k = llave(sucursalId, mesero);
    let f = filas.get(k);
    if (!f) {
      f = {
        posicion: null,
        sucursalId,
        sucursal,
        mesero,
        cobrado: CERO,
        cuentas: 0,
        comensales: 0,
        mesasAbiertas: 0,
        enCurso: CERO,
        mesasSinTotal: 0,
        comensalesEnMesa: 0,
      };
      filas.set(k, f);
    }
    return f;
  };

  for (const c of cobrado) {
    // Un mesero con sólo cancelados viene con 0 cuentas: no tiene nada cobrado ni en curso.
    if (c.cuentas === 0 && c.venta.isZero()) continue;
    const f = fila(c.sucursalId, c.sucursal, nombreMesero(c.mesero));
    f.cobrado = f.cobrado.plus(c.venta);
    f.cuentas += c.cuentas;
    f.comensales += c.comensales;
  }
  for (const s of mesas) {
    for (const m of s.mesas) {
      const f = fila(s.sucursalId, s.sucursal, nombreMesero(m.mesero));
      f.mesasAbiertas += 1;
      const total = totalDeMesa(m.total);
      if (total === null) f.mesasSinTotal += 1;
      else f.enCurso = f.enCurso.plus(total);
      if (typeof m.comensales === 'number' && Number.isInteger(m.comensales) && m.comensales > 0) {
        f.comensalesEnMesa += m.comensales;
      }
    }
  }

  const ordenadas = [...filas.values()].sort(
    (a, b) =>
      b.cobrado.plus(b.enCurso).comparedTo(a.cobrado.plus(a.enCurso)) ||
      b.cobrado.comparedTo(a.cobrado) ||
      compararTexto(a.sucursal, b.sucursal) ||
      compararTexto(a.sucursalId, b.sucursalId) ||
      (a.mesero === null ? 1 : 0) - (b.mesero === null ? 1 : 0) ||
      compararTexto(a.mesero ?? '', b.mesero ?? ''),
  );
  const lugares = new Map<string, number>();
  for (const f of ordenadas) {
    if (f.mesero === null) continue;
    const lugar = (lugares.get(f.sucursalId) ?? 0) + 1;
    lugares.set(f.sucursalId, lugar);
    f.posicion = lugar;
  }
  return ordenadas;
}
