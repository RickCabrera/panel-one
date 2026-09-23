import { Prisma } from '@prisma/client';

/**
 * La parte PURA del estado de resultados simple (F2-126): venta neta − costo de lo vendido =
 * utilidad bruta; utilidad bruta − gastos = utilidad de operación. Sin base de datos: el servicio
 * junta las cifras (ventas por el helper de agregados, costo por el consumo teórico de F2-125,
 * gastos del panel) y aquí se decide qué se puede afirmar y qué no.
 *
 * Reglas (esquema-sr §10 "Compras, gastos y utilidad"):
 * - DECISION PROVISIONAL (nocturno): la venta neta es Σ `cheques.subtotal` de las cuentas NO
 *   canceladas, SUPONIENDO que en SR el subtotal es neto de descuento, sin IVA y sin propina
 *   (supuesto NO validado, esquema-sr §2). Se mide sin IVA porque el costo (existencias y
 *   pólizas) es sin IVA. Si el subtotal de SR es ANTES del descuento, la utilidad sale inflada
 *   justo por los descuentos: lo valida F2-193 contra el contador.
 * - El costo es el importe del consumo TEÓRICO (ventas × receta × costo de referencia). Queda
 *   INCOMPLETO si algún insumo con teórico no tiene costo, o si se vendió algo que no se pudo
 *   explotar (sin receta, sin catálogo, nombre ambiguo): entonces la utilidad lleva la marca
 *   `utilidadSobrestimada` (el costo real es mayor o igual; la utilidad real, menor o igual).
 * - Sucursal con ventas que no se puede calcular (sin catálogo de productos o sin recetas) →
 *   costo y utilidades NULOS con su motivo, nunca un 0 inventado. Sin ventas, el costo es 0 aunque
 *   no sea calculable (no hay nada que explotar) y la utilidad de operación es −gastos: los gastos
 *   son reales; la bandera `sinVentas` lo dice.
 * - El total de la empresa es la suma; si alguna sucursal tiene utilidad nula, el total de costo y
 *   utilidades es nulo y dice cuáles faltan (no se suma parcial en silencio).
 * - Las compras NO entran: el costo ya es el consumo; sumarlas sería contar dos veces.
 * - Todo en Decimal; márgenes a 1 decimal y dinero a 2, mitad lejos de cero.
 */

type D = Prisma.Decimal;
const Dec = Prisma.Decimal;
const CERO = new Dec(0);
const CIEN = new Dec(100);

export type MotivoSinCalculo = 'sin_catalogo_productos' | 'sin_recetas';

export interface CifrasSucursal {
  sucursalId: string;
  sucursal: string;
  cuentas: number;
  /** Σ `cheques.total` (con IVA): la venta de Inicio y Comparativos. */
  venta: D;
  /** Σ `cheques.subtotal` (sin IVA, supuesto). */
  ventaNeta: D;
  /** ¿El consumo teórico se pudo calcular? Si no, por qué. */
  calculada: boolean;
  motivo: MotivoSinCalculo | null;
  /** Importes teóricos por insumo CON teórico > 0; `null` = insumo sin costo. */
  importesTeoricos: ReadonlyArray<D | null>;
  /** Productos vendidos que no se pudieron explotar (sin receta, sin catálogo, ambiguo). */
  productosSinCosto: number;
  /** Σ `partidas.total` de esos productos: CON IVA y ANTES del descuento de la cuenta. */
  ventaSinCosto: D;
  gastos: D;
  compras: D;
}

export interface Costo {
  importe: D | null;
  completo: boolean;
  insumosSinCosto: number;
  productosSinCosto: number;
  ventaSinCosto: D;
}

export interface Resultado {
  cuentas: number;
  venta: D;
  ventaNeta: D;
  costo: Costo;
  gastos: D;
  compras: D;
  utilidadBruta: D | null;
  utilidadOperacion: D | null;
  margenBruto: D | null;
  margenOperacion: D | null;
  utilidadSobrestimada: boolean;
  sinVentas: boolean;
}

export interface ResultadoSucursal extends Resultado {
  sucursalId: string;
  sucursal: string;
  motivo: MotivoSinCalculo | null;
}

export interface ResultadoTotal extends Resultado {
  /** Sucursales con ventas cuyo costo no se pudo calcular: por ellas el total es nulo. */
  sucursalesSinCalculo: string[];
}

const dinero = (v: D): D => v.toDecimalPlaces(2, Dec.ROUND_HALF_UP);

/** `utilidad / venta neta × 100` a 1 decimal; nulo sin venta neta o sin utilidad. */
export function margen(utilidad: D | null, ventaNeta: D): D | null {
  if (utilidad === null || ventaNeta.isZero()) return null;
  const m = utilidad.div(ventaNeta).times(CIEN).toDecimalPlaces(1, Dec.ROUND_HALF_UP);
  return m.isZero() ? CERO : m;
}

function conUtilidades(
  base: Omit<
    Resultado,
    | 'utilidadBruta'
    | 'utilidadOperacion'
    | 'margenBruto'
    | 'margenOperacion'
    | 'utilidadSobrestimada'
  >,
): Resultado {
  const utilidadBruta =
    base.costo.importe === null ? null : dinero(base.ventaNeta.minus(base.costo.importe));
  const utilidadOperacion =
    utilidadBruta === null ? null : dinero(utilidadBruta.minus(base.gastos));
  return {
    ...base,
    utilidadBruta,
    utilidadOperacion,
    margenBruto: margen(utilidadBruta, base.ventaNeta),
    margenOperacion: margen(utilidadOperacion, base.ventaNeta),
    utilidadSobrestimada: utilidadBruta !== null && !base.costo.completo,
  };
}

export function resultadoSucursal(c: CifrasSucursal): ResultadoSucursal {
  const sinVentas = c.cuentas === 0;
  let costo: Costo;
  let motivo: MotivoSinCalculo | null = null;
  if (sinVentas) {
    costo = {
      importe: CERO,
      completo: true,
      insumosSinCosto: 0,
      productosSinCosto: 0,
      ventaSinCosto: CERO,
    };
  } else if (!c.calculada) {
    motivo = c.motivo ?? 'sin_recetas';
    costo = {
      importe: null,
      completo: false,
      insumosSinCosto: 0,
      productosSinCosto: 0,
      ventaSinCosto: CERO,
    };
  } else {
    const insumosSinCosto = c.importesTeoricos.filter((i) => i === null).length;
    const importe = c.importesTeoricos.reduce<D>(
      (acc, i) => (i === null ? acc : acc.plus(i)),
      CERO,
    );
    costo = {
      importe: dinero(importe),
      completo: insumosSinCosto === 0 && c.productosSinCosto === 0,
      insumosSinCosto,
      productosSinCosto: c.productosSinCosto,
      ventaSinCosto: dinero(c.ventaSinCosto),
    };
  }
  return {
    sucursalId: c.sucursalId,
    sucursal: c.sucursal,
    motivo,
    ...conUtilidades({
      cuentas: c.cuentas,
      venta: dinero(c.venta),
      ventaNeta: dinero(c.ventaNeta),
      costo,
      gastos: dinero(c.gastos),
      compras: dinero(c.compras),
      sinVentas,
    }),
  };
}

/** El total de la empresa: suma de las sucursales, y nulo (con la lista) si falta alguna. */
export function resultadoTotal(sucursales: readonly ResultadoSucursal[]): ResultadoTotal {
  const suma = (f: (r: ResultadoSucursal) => D) =>
    sucursales.reduce<D>((acc, r) => acc.plus(f(r)), CERO);
  const sinCalculo = sucursales.filter((r) => r.costo.importe === null).map((r) => r.sucursal);
  const cuentas = sucursales.reduce((n, r) => n + r.cuentas, 0);
  const costo: Costo = {
    importe: sinCalculo.length > 0 ? null : dinero(suma((r) => r.costo.importe!)),
    completo: sucursales.every((r) => r.costo.completo),
    insumosSinCosto: sucursales.reduce((n, r) => n + r.costo.insumosSinCosto, 0),
    productosSinCosto: sucursales.reduce((n, r) => n + r.costo.productosSinCosto, 0),
    ventaSinCosto: dinero(suma((r) => r.costo.ventaSinCosto)),
  };
  return {
    sucursalesSinCalculo: sinCalculo,
    ...conUtilidades({
      cuentas,
      venta: dinero(suma((r) => r.venta)),
      ventaNeta: dinero(suma((r) => r.ventaNeta)),
      costo,
      gastos: dinero(suma((r) => r.gastos)),
      compras: dinero(suma((r) => r.compras)),
      sinVentas: cuentas === 0,
    }),
  };
}
