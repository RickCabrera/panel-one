import { Prisma } from '@prisma/client';

import { normalizarNombre } from '../catalogos/menu';
import { valorDe } from '../ingesta/existencias';

/**
 * La parte PURA de Recetas y consumo teórico (F2-125). Sin base de datos: la lectura (con el
 * helper de scope) vive en `recetas.service.ts`.
 *
 * - Teórico = Σ (cantidad vendida del producto × cantidad del insumo en su receta), en la MISMA
 *   sucursal. La partida vendida se cruza con el producto POR NOMBRE (el contrato de cheques no
 *   trae id de producto, esquema-sr §6), contra el espejo en cualquier estado, como F2-145.
 * - Real = lo que las pólizas de SR sacaron del inventario por consumo, merma y ajuste.
 * - Lo que no se puede explotar (sin receta, sin catálogo, nombre ambiguo) va APARTE y no detiene
 *   el cálculo del resto.
 *
 * Todo en Decimal: nunca un float.
 */

type D = Prisma.Decimal;
const Dec = Prisma.Decimal;
const CERO = new Dec(0);
const CIEN = new Dec(100);

/** Redondeo del teórico: 3 decimales (NUMERIC(12,3), el de las cantidades), mitad lejos de cero. */
export const cantidad3 = (v: D): D => v.toDecimalPlaces(3, Dec.ROUND_HALF_UP);
/** Costo por unidad: 2 decimales, mitad lejos de cero (la regla de dinero de §13). */
export const costo2 = (v: D): D => v.toDecimalPlaces(2, Dec.ROUND_HALF_UP);

const llave = (sucursalId: string, origen: string) => JSON.stringify([sucursalId, origen]);

// ---------------------------------------------------------------------------
// entradas
// ---------------------------------------------------------------------------

/** Lo vendido en el periodo: una fila por (sucursal, texto del producto en la partida). */
export interface Vendido {
  sucursalId: string;
  producto: string;
  partidas: number;
  cantidad: D;
  importe: D;
}

/** Una fila del espejo de productos (cualquier estado). */
export interface ProductoEspejo {
  sucursalId: string;
  origenSrId: string;
  nombre: string;
}

/** Una receta guardada: renglones vacíos = SR dice que el producto no tiene receta. */
export interface RecetaLeida {
  sucursalId: string;
  productoOrigenSrId: string;
  renglones: ReadonlyArray<{ insumoOrigenSrId: string; cantidad: D }>;
}

/** Σ de las cantidades CON SIGNO de los movimientos no cancelados del rango, por tipo. */
export interface SalidasInsumo {
  consumo: D;
  merma: D;
  ajuste: D;
  /** Σ |importe| y Σ |cantidad| de esos mismos movimientos: el costo del periodo. */
  importeAbs: D;
  cantidadAbs: D;
}

// ---------------------------------------------------------------------------
// cruce de lo vendido
// ---------------------------------------------------------------------------

export type MotivoAparte = 'sin_receta' | 'sin_catalogo' | 'ambiguo';

export interface VendidoAparte {
  sucursalId: string;
  /** El texto vendido (la variante de más importe si hubo varias escrituras). */
  producto: string;
  motivo: MotivoAparte;
  /** El producto del espejo cuando se identificó (sin receta); nulo si no. */
  productoOrigenSrId: string | null;
  partidas: number;
  cantidad: D;
  importe: D;
}

export interface Cruce {
  /** sucursal → insumo → teórico SIN redondear. */
  teorico: Map<string, Map<string, D>>;
  aparte: VendidoAparte[];
  /** Cuántos productos vendidos se explotaron con receta, por sucursal. */
  explotados: Map<string, number>;
}

/**
 * Explota lo vendido en las sucursales `calculables` (las que tienen catálogo de productos y
 * recetas recibidas; las demás no se cruzan: se reportan aparte como estado de la sucursal).
 *
 * El mismo nombre normalizado en MÁS de un producto de la sucursal (aunque uno esté de baja) =
 * `ambiguo`: no se adivina cuál se vendió. Un nombre sin producto = `sin_catalogo`. Un producto
 * sin receta guardada, o con la receta vacía = `sin_receta`.
 */
export function cruzarVendidos(
  vendidos: readonly Vendido[],
  productos: readonly ProductoEspejo[],
  recetas: readonly RecetaLeida[],
  calculables: ReadonlySet<string>,
): Cruce {
  const porNombre = new Map<string, string[]>();
  for (const p of productos) {
    if (!calculables.has(p.sucursalId)) continue;
    const k = llave(p.sucursalId, normalizarNombre(p.nombre));
    porNombre.set(k, [...(porNombre.get(k) ?? []), p.origenSrId]);
  }
  const recetaDe = new Map<string, RecetaLeida>();
  for (const r of recetas) recetaDe.set(llave(r.sucursalId, r.productoOrigenSrId), r);

  // Las escrituras del mismo nombre se juntan: la cantidad es de UN producto.
  const grupos = new Map<
    string,
    { sucursalId: string; nombre: string; producto: string; mejor: D } & Omit<
      Vendido,
      'sucursalId' | 'producto'
    >
  >();
  for (const v of vendidos) {
    if (!calculables.has(v.sucursalId)) continue;
    const nombre = normalizarNombre(v.producto);
    const k = llave(v.sucursalId, nombre);
    const g = grupos.get(k);
    if (!g) {
      grupos.set(k, {
        sucursalId: v.sucursalId,
        nombre,
        producto: v.producto,
        mejor: v.importe,
        partidas: v.partidas,
        cantidad: v.cantidad,
        importe: v.importe,
      });
      continue;
    }
    g.partidas += v.partidas;
    g.cantidad = g.cantidad.plus(v.cantidad);
    g.importe = g.importe.plus(v.importe);
    if (v.importe.greaterThan(g.mejor) || (v.importe.equals(g.mejor) && v.producto < g.producto)) {
      g.producto = v.producto;
      g.mejor = v.importe;
    }
  }

  const teorico = new Map<string, Map<string, D>>();
  const explotados = new Map<string, number>();
  const aparte: VendidoAparte[] = [];
  for (const g of grupos.values()) {
    const candidatos = porNombre.get(llave(g.sucursalId, g.nombre)) ?? [];
    const base = {
      sucursalId: g.sucursalId,
      producto: g.producto,
      partidas: g.partidas,
      cantidad: g.cantidad,
      importe: g.importe,
    };
    if (candidatos.length === 0) {
      aparte.push({ ...base, motivo: 'sin_catalogo', productoOrigenSrId: null });
      continue;
    }
    if (candidatos.length > 1) {
      aparte.push({ ...base, motivo: 'ambiguo', productoOrigenSrId: null });
      continue;
    }
    const receta = recetaDe.get(llave(g.sucursalId, candidatos[0]));
    if (!receta || receta.renglones.length === 0) {
      aparte.push({ ...base, motivo: 'sin_receta', productoOrigenSrId: candidatos[0] });
      continue;
    }
    const porInsumo = teorico.get(g.sucursalId) ?? new Map<string, D>();
    teorico.set(g.sucursalId, porInsumo);
    for (const r of receta.renglones) {
      porInsumo.set(
        r.insumoOrigenSrId,
        (porInsumo.get(r.insumoOrigenSrId) ?? CERO).plus(g.cantidad.times(r.cantidad)),
      );
    }
    explotados.set(g.sucursalId, (explotados.get(g.sucursalId) ?? 0) + 1);
  }
  const orden: Record<MotivoAparte, number> = { sin_receta: 0, sin_catalogo: 1, ambiguo: 2 };
  aparte.sort(
    (a, b) =>
      orden[a.motivo] - orden[b.motivo] ||
      b.importe.comparedTo(a.importe) ||
      (a.sucursalId < b.sucursalId ? -1 : a.sucursalId > b.sucursalId ? 1 : 0) ||
      (a.producto < b.producto ? -1 : a.producto > b.producto ? 1 : 0),
  );
  return { teorico, aparte, explotados };
}

// ---------------------------------------------------------------------------
// teórico contra real
// ---------------------------------------------------------------------------

export interface FilaVariacion {
  sucursalId: string;
  insumoOrigenSrId: string;
  /** Redondeado a 3. */
  teorico: D;
  /** Nulos si la sucursal nunca mandó pólizas: no hay real, no es cero. */
  real: D | null;
  consumo: D | null;
  merma: D | null;
  ajuste: D | null;
  /** real − teórico (+ = salió más de lo que explican las ventas). */
  variacion: D | null;
  /** variación / teórico × 100, a 1 decimal; nulo si el teórico es 0 o no hay real. */
  porcentaje: D | null;
  /** El teórico es 0 pero hubo salidas (p. ej. desechables que no cuelgan de un producto). */
  sinTeorico: boolean;
  costo: D | null;
  importeTeorico: D | null;
  importeVariacion: D | null;
}

/**
 * Una fila por (sucursal, insumo) de las sucursales calculables: todo insumo con teórico o con
 * alguna salida en el periodo.
 *
 * DECISION PROVISIONAL (nocturno): real = −(Σ consumo + Σ merma + Σ ajuste) de las pólizas NO
 * canceladas del rango. Un ajuste a favor (el conteo encontró de más) RESTA al real. Compras,
 * traspasos, inicial y `otro` no son consumo. ⚠️ SUPUESTO NO VALIDADO (esquema-sr §10 "Recetas"):
 * si SR genera sus pólizas de consumo explotando SU receta al vender, "consumo" ≈ el teórico de SR
 * y la variación útil vive en merma + ajuste; si SR no deja pólizas de consumo, el real es sólo
 * merma + ajuste. Por eso el desglose viaja por tipo. Decisión abierta para Ricardo en F2-193.
 *
 * Costo de referencia: Σ|importe| / Σ|cantidad| de esas mismas salidas del periodo; si no hubo,
 * el de la última foto de existencias; si tampoco, nulo (sin importe, no un $0 inventado). Se
 * redondea a 2 antes de multiplicar.
 */
export function variaciones(op: {
  calculables: ReadonlySet<string>;
  teorico: ReadonlyMap<string, ReadonlyMap<string, D>>;
  /** sucursal → insumo → salidas del periodo. */
  salidas: ReadonlyMap<string, ReadonlyMap<string, SalidasInsumo>>;
  /** Sucursales que alguna vez mandaron pólizas. */
  conMovimientos: ReadonlySet<string>;
  /** sucursal + insumo (`llaveInsumo`) → costo de la última foto de existencias. */
  costoExistencias: ReadonlyMap<string, D>;
}): FilaVariacion[] {
  const filas: FilaVariacion[] = [];
  for (const sucursalId of op.calculables) {
    const teo = op.teorico.get(sucursalId) ?? new Map<string, D>();
    const sal = op.salidas.get(sucursalId) ?? new Map<string, SalidasInsumo>();
    const hayMovs = op.conMovimientos.has(sucursalId);
    const insumos = new Set([...teo.keys(), ...(hayMovs ? sal.keys() : [])]);
    for (const insumoOrigenSrId of insumos) {
      const teorico = cantidad3(teo.get(insumoOrigenSrId) ?? CERO);
      const s = hayMovs ? sal.get(insumoOrigenSrId) : undefined;
      const consumo = hayMovs ? (s?.consumo ?? CERO).negated() : null;
      const merma = hayMovs ? (s?.merma ?? CERO).negated() : null;
      const ajuste = hayMovs ? (s?.ajuste ?? CERO).negated() : null;
      const real = consumo && merma && ajuste ? consumo.plus(merma).plus(ajuste) : null;
      const variacion = real ? real.minus(teorico) : null;
      const porcentaje =
        variacion && teorico.greaterThan(0)
          ? variacion.div(teorico).times(CIEN).toDecimalPlaces(1, Dec.ROUND_HALF_UP)
          : null;
      const costo =
        s && s.cantidadAbs.greaterThan(0)
          ? costo2(s.importeAbs.div(s.cantidadAbs))
          : (op.costoExistencias.get(llaveInsumo(sucursalId, insumoOrigenSrId)) ?? null);
      filas.push({
        sucursalId,
        insumoOrigenSrId,
        teorico,
        real: real && sinCeroNegativo(real),
        consumo: consumo && sinCeroNegativo(consumo),
        merma: merma && sinCeroNegativo(merma),
        ajuste: ajuste && sinCeroNegativo(ajuste),
        variacion: variacion && sinCeroNegativo(variacion),
        porcentaje: porcentaje && sinCeroNegativo(porcentaje),
        sinTeorico: teorico.isZero() && real !== null && !real.isZero(),
        costo,
        importeTeorico: costo ? valorDe(teorico, costo) : null,
        importeVariacion: costo && variacion ? valorDe(variacion, costo) : null,
      });
    }
  }
  return filas.sort(ordenRanking);
}

const sinCeroNegativo = (v: D): D => (v.isZero() ? new Dec(0) : v);

export const llaveInsumo = llave;

/**
 * El ranking de variaciones: primero lo que más dinero falta (importe de variación desc), sin
 * importe al final; luego el % más grande en valor absoluto; luego sucursal e insumo (estable).
 */
export function ordenRanking(a: FilaVariacion, b: FilaVariacion): number {
  const nulosAlFinal = <T>(x: T | null, y: T | null, cmp: (x: T, y: T) => number) =>
    x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : cmp(x, y);
  return (
    nulosAlFinal(a.importeVariacion, b.importeVariacion, (x, y) => y.comparedTo(x)) ||
    nulosAlFinal(a.porcentaje, b.porcentaje, (x, y) => y.abs().comparedTo(x.abs())) ||
    nulosAlFinal(a.variacion, b.variacion, (x, y) => y.comparedTo(x)) ||
    (a.sucursalId < b.sucursalId ? -1 : a.sucursalId > b.sucursalId ? 1 : 0) ||
    (a.insumoOrigenSrId < b.insumoOrigenSrId ? -1 : a.insumoOrigenSrId > b.insumoOrigenSrId ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// costo de referencia desde existencias
// ---------------------------------------------------------------------------

/**
 * DECISION PROVISIONAL (nocturno): el costo de un insumo en una sucursal, desde la última foto de
 * existencias = Σ valor / Σ cantidad de sus almacenes con cantidad > 0 (promedio ponderado por lo
 * que hay), redondeado a 2. Sin existencia positiva = sin costo (nulo, no cero).
 */
export function costosDeExistencias(
  filas: ReadonlyArray<{ sucursalId: string; insumoOrigenSrId: string; cantidad: D; valor: D }>,
): Map<string, D> {
  const acum = new Map<string, { cantidad: D; valor: D }>();
  for (const f of filas) {
    if (!f.cantidad.greaterThan(0)) continue;
    const k = llave(f.sucursalId, f.insumoOrigenSrId);
    const a = acum.get(k) ?? { cantidad: CERO, valor: CERO };
    acum.set(k, { cantidad: a.cantidad.plus(f.cantidad), valor: a.valor.plus(f.valor) });
  }
  return new Map([...acum].map(([k, a]) => [k, costo2(a.valor.div(a.cantidad))]));
}

/**
 * El costo de UNA receta: Σ de los importes de sus renglones, cada uno `round(cantidad × costo,
 * 2)`. Un renglón sin costo deja el total como `incompleto` (se suma lo que sí tiene costo).
 */
export function costoReceta(renglones: ReadonlyArray<{ importe: D | null }>): {
  costo: D;
  incompleto: boolean;
} {
  let costo = CERO;
  let incompleto = false;
  for (const r of renglones) {
    if (r.importe === null) incompleto = true;
    else costo = costo.plus(r.importe);
  }
  return { costo, incompleto };
}

/** El costo como % del precio, a 1 decimal; nulo sin precio positivo o con costo incompleto. */
export function porcentajeDelPrecio(costo: D, incompleto: boolean, precio: D | null): D | null {
  if (incompleto || precio === null || !precio.greaterThan(0)) return null;
  return costo.div(precio).times(CIEN).toDecimalPlaces(1, Dec.ROUND_HALF_UP);
}
