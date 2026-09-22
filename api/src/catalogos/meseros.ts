import { Prisma } from '@prisma/client';

import type { VentaMeseroInterna } from '../ventas/analisis.service';
import { pesos } from '../ventas/agregados-ventas.service';
import { normalizarNombre } from './menu';

/**
 * La parte PURA de la vista Meseros (F2-231): ligar lo vendido con el espejo de meseros, el
 * ranking por sucursal y el promedio de la sucursal contra el que se compara cada ficha. Sin
 * base de datos: la lectura (con el helper de scope) vive en `catalogos.service.ts`, y las
 * cifras de venta salen de `AnalisisService.porMeseroConSegundos` (las mismas de Análisis).
 *
 * Reglas:
 * - Σ venta de `filas` = venta del periodo (`/ventas/resumen`): consolidar sólo SUMA filas,
 *   nunca descarta ni reparte.
 * - Cancelaciones y descuentos van aparte (conteo e importe); la venta no los incluye.
 * - Dinero en Decimal; los promedios de minutos son Σ segundos / Σ cuentas, nunca un promedio
 *   de promedios.
 */

/** Tope de filas del espejo de meseros que se leen. Más = `catalogoTruncado`. */
export const MAX_CATALOGO_MESEROS = 2000;

const CERO = new Prisma.Decimal(0);

/**
 * Cómo quedó ligada una fila de venta con el catálogo:
 * - `catalogo`: un solo mesero del espejo de su sucursal con ese nombre.
 * - `sin-catalogo`: el catálogo de su sucursal está completo y no lo trae.
 * - `ambiguo`: el espejo de su sucursal tiene ese nombre más de una vez; no se liga a ninguno.
 * - `sin-sincronizar`: su sucursal nunca ha mandado una sincronización completa de meseros.
 * - `catalogo-incompleto`: la lectura del espejo se truncó; no se puede afirmar que no está.
 * - `sin-mesero`: la cuenta no trae mesero.
 */
export type CruceMesero =
  | 'catalogo'
  | 'sin-catalogo'
  | 'ambiguo'
  | 'sin-sincronizar'
  | 'catalogo-incompleto'
  | 'sin-mesero';

export interface MeseroCatalogoLeido {
  id: string;
  sucursalId: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  activoPos: boolean | null;
  vistoAt: Date;
}

export interface SucursalLeida {
  id: string;
  nombre: string;
  /** Tiene una sincronización completa del catálogo de meseros. */
  sincronizado: boolean;
}

export interface CatalogoLigado {
  id: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  activoPos: boolean | null;
  vistoAt: string;
}

export interface FilaRendimiento {
  sucursalId: string;
  sucursal: string;
  /** El nombre del catálogo si se ligó; si no, el texto del POS. Null = "Sin mesero". */
  mesero: string | null;
  /** Los textos del POS que se sumaron en esta fila (más de uno si difieren en espacios o mayúsculas). */
  textosPos: string[];
  cruce: CruceMesero;
  catalogo: CatalogoLigado | null;
  venta: string;
  cuentas: number;
  ticketPromedio: string | null;
  comensales: number;
  cuentasConComensales: number;
  propina: string;
  descuentos: { monto: string; cuentas: number };
  cancelados: { cuentas: number; monto: string };
  minutosPromedio: string | null;
  cuentasConDuracion: number;
  /** Posición en el ranking de SU sucursal por venta (empate = misma posición). Null = fuera del ranking. */
  posicion: number | null;
}

export interface PromedioSucursal {
  /** Σ venta de los meseros del ranking / n. */
  ventaPorMesero: string | null;
  /** Σ cuentas de los meseros del ranking / n, 1 decimal. */
  cuentasPorMesero: string | null;
  propinaPorMesero: string | null;
  /** 1 decimal. */
  comensalesPorMesero: string | null;
  /** Venta de la sucursal / TODAS sus cuentas (también las sin mesero). */
  ticketPromedio: string | null;
  /** Σ segundos / Σ cuentas con duración de TODA la sucursal, en minutos con 1 decimal. */
  minutosPromedio: string | null;
}

export interface SucursalRendimiento {
  sucursalId: string;
  sucursal: string;
  catalogoSincronizado: boolean;
  /** n: meseros con nombre y al menos una cuenta en el periodo. */
  meserosEnRanking: number;
  venta: string;
  cuentas: number;
  promedio: PromedioSucursal;
}

export interface MeseroSinVentas extends CatalogoLigado {
  sucursalId: string;
  sucursal: string;
}

export interface RendimientoMeseros {
  /** Σ venta de `filas` = `/ventas/resumen.venta` del mismo filtro. */
  venta: string;
  cuentas: number;
  descuentos: { monto: string; cuentas: number };
  cancelados: { cuentas: number; monto: string };
  /** El espejo se leyó hasta `MAX_CATALOGO_MESEROS`: el cruce y `sinVentas` están incompletos. */
  catalogoTruncado: boolean;
  sucursales: SucursalRendimiento[];
  filas: FilaRendimiento[];
  /** Meseros del espejo sin ninguna cuenta ni cancelación en el periodo. */
  sinVentas: MeseroSinVentas[];
}

function dividir(a: Prisma.Decimal, b: Prisma.Decimal.Value, decimales: number): string | null {
  const divisor = new Prisma.Decimal(b);
  if (divisor.isZero()) return null;
  return a.div(divisor).toFixed(decimales, Prisma.Decimal.ROUND_HALF_UP);
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Acumulado {
  sucursalId: string;
  sucursal: string;
  mesero: string | null;
  textosPos: string[];
  cruce: CruceMesero;
  catalogo: MeseroCatalogoLeido | null;
  venta: Prisma.Decimal;
  cuentas: number;
  comensales: number;
  cuentasConComensales: number;
  propina: Prisma.Decimal;
  descuentos: Prisma.Decimal;
  cuentasConDescuento: number;
  cancelados: number;
  montoCancelado: Prisma.Decimal;
  segundos: Prisma.Decimal;
  cuentasConDuracion: number;
}

const vistaCatalogo = (c: MeseroCatalogoLeido): CatalogoLigado => ({
  id: c.id,
  clave: c.clave,
  nombre: c.nombre,
  activo: c.activo,
  activoPos: c.activoPos,
  vistoAt: c.vistoAt.toISOString(),
});

export function rendimientoMeseros(entrada: {
  ventas: readonly VentaMeseroInterna[];
  catalogo: readonly MeseroCatalogoLeido[];
  sucursales: readonly SucursalLeida[];
  catalogoTruncado: boolean;
}): RendimientoMeseros {
  const sucursales = new Map(entrada.sucursales.map((s) => [s.id, s]));

  // Espejo por (sucursal, nombre normalizado). Más de uno = ambiguo.
  const porNombre = new Map<string, MeseroCatalogoLeido[]>();
  for (const c of entrada.catalogo) {
    const llave = `${c.sucursalId}|${normalizarNombre(c.nombre)}`;
    porNombre.set(llave, [...(porNombre.get(llave) ?? []), c]);
  }

  // DECISION PROVISIONAL (nocturno): el cheque sólo trae el TEXTO del mesero
  // (docs/esquema-sr.md §7), así que se liga con el espejo por (sucursal, nombre normalizado:
  // sin espacios de más ni mayúsculas; los acentos cuentan). Dos textos que ligan con el mismo
  // registro se CONSOLIDAN en una fila (suma exacta): es la misma persona para el POS.
  const acumulados = new Map<string, Acumulado>();
  const nombresVendidos = new Set<string>();
  for (const v of entrada.ventas) {
    const suc = sucursales.get(v.sucursalId);
    let cruce: CruceMesero;
    let catalogo: MeseroCatalogoLeido | null = null;
    if (v.mesero === null) {
      cruce = 'sin-mesero';
    } else {
      const llaveNombre = `${v.sucursalId}|${normalizarNombre(v.mesero)}`;
      nombresVendidos.add(llaveNombre);
      const candidatos = porNombre.get(llaveNombre) ?? [];
      if (candidatos.length === 1) {
        cruce = 'catalogo';
        catalogo = candidatos[0];
      } else if (candidatos.length > 1) {
        cruce = 'ambiguo';
      } else if (entrada.catalogoTruncado) {
        cruce = 'catalogo-incompleto';
      } else if (!suc?.sincronizado) {
        cruce = 'sin-sincronizar';
      } else {
        cruce = 'sin-catalogo';
      }
    }
    const llave =
      catalogo !== null
        ? `c|${catalogo.id}`
        : v.mesero === null
          ? `n|${v.sucursalId}`
          : `t|${v.sucursalId}|${v.mesero}`;
    let a = acumulados.get(llave);
    if (!a) {
      a = {
        sucursalId: v.sucursalId,
        sucursal: v.sucursal,
        mesero: catalogo?.nombre ?? v.mesero,
        textosPos: [],
        cruce,
        catalogo,
        venta: CERO,
        cuentas: 0,
        comensales: 0,
        cuentasConComensales: 0,
        propina: CERO,
        descuentos: CERO,
        cuentasConDescuento: 0,
        cancelados: 0,
        montoCancelado: CERO,
        segundos: CERO,
        cuentasConDuracion: 0,
      };
      acumulados.set(llave, a);
    }
    if (v.mesero !== null) a.textosPos.push(v.mesero);
    a.venta = a.venta.plus(v.venta);
    a.cuentas += v.cuentas;
    a.comensales += v.comensales;
    a.cuentasConComensales += v.cuentasConComensales;
    a.propina = a.propina.plus(v.propina);
    a.descuentos = a.descuentos.plus(v.descuentos.monto);
    a.cuentasConDescuento += v.descuentos.cuentas;
    a.cancelados += v.cancelados.cuentas;
    a.montoCancelado = a.montoCancelado.plus(v.cancelados.monto);
    a.segundos = a.segundos.plus(v.segundos);
    a.cuentasConDuracion += v.cuentasConDuracion;
  }

  // Ranking por sucursal: sólo meseros con nombre y al menos una cuenta.
  const posiciones = new Map<Acumulado, number>();
  const enRanking = new Map<string, Acumulado[]>();
  for (const a of acumulados.values()) {
    if (a.mesero === null || a.cuentas === 0) continue;
    enRanking.set(a.sucursalId, [...(enRanking.get(a.sucursalId) ?? []), a]);
  }
  for (const lista of enRanking.values()) {
    for (const a of lista) {
      posiciones.set(a, 1 + lista.filter((b) => b.venta.greaterThan(a.venta)).length);
    }
  }

  const filas: FilaRendimiento[] = [...acumulados.values()]
    .sort((a, b) => {
      const s = comparar(a.sucursal, b.sucursal) || comparar(a.sucursalId, b.sucursalId);
      if (s !== 0) return s;
      // Ranking primero, luego los que sólo tienen cancelados, y "Sin mesero" al final.
      const grupo = (x: Acumulado) => (x.mesero === null ? 2 : posiciones.has(x) ? 0 : 1);
      const g = grupo(a) - grupo(b);
      if (g !== 0) return g;
      const p = (posiciones.get(a) ?? 0) - (posiciones.get(b) ?? 0);
      if (p !== 0) return p;
      return comparar(a.mesero ?? '', b.mesero ?? '');
    })
    .map((a) => ({
      sucursalId: a.sucursalId,
      sucursal: a.sucursal,
      mesero: a.mesero,
      textosPos: [...new Set(a.textosPos)].sort(comparar),
      cruce: a.cruce,
      catalogo: a.catalogo ? vistaCatalogo(a.catalogo) : null,
      venta: pesos(a.venta),
      cuentas: a.cuentas,
      ticketPromedio: dividir(a.venta, a.cuentas, 2),
      comensales: a.comensales,
      cuentasConComensales: a.cuentasConComensales,
      propina: pesos(a.propina),
      descuentos: { monto: pesos(a.descuentos), cuentas: a.cuentasConDescuento },
      cancelados: { cuentas: a.cancelados, monto: pesos(a.montoCancelado) },
      minutosPromedio: dividir(a.segundos, a.cuentasConDuracion * 60, 1),
      cuentasConDuracion: a.cuentasConDuracion,
      posicion: posiciones.get(a) ?? null,
    }));

  const todos = [...acumulados.values()];
  const suma = (xs: Acumulado[], f: (a: Acumulado) => Prisma.Decimal.Value) =>
    xs.reduce((s, a) => s.plus(f(a)), CERO);

  const resumenSucursales: SucursalRendimiento[] = [...entrada.sucursales]
    .sort((a, b) => comparar(a.nombre, b.nombre) || comparar(a.id, b.id))
    .map((s) => {
      const propias = todos.filter((a) => a.sucursalId === s.id);
      const ranking = enRanking.get(s.id) ?? [];
      const n = ranking.length;
      const venta = suma(propias, (a) => a.venta);
      const cuentas = propias.reduce((t, a) => t + a.cuentas, 0);
      return {
        sucursalId: s.id,
        sucursal: s.nombre,
        catalogoSincronizado: s.sincronizado,
        meserosEnRanking: n,
        venta: pesos(venta),
        cuentas,
        promedio: {
          ventaPorMesero: dividir(
            suma(ranking, (a) => a.venta),
            n,
            2,
          ),
          cuentasPorMesero: dividir(
            suma(ranking, (a) => a.cuentas),
            n,
            1,
          ),
          propinaPorMesero: dividir(
            suma(ranking, (a) => a.propina),
            n,
            2,
          ),
          comensalesPorMesero: dividir(
            suma(ranking, (a) => a.comensales),
            n,
            1,
          ),
          ticketPromedio: dividir(venta, cuentas, 2),
          minutosPromedio: dividir(
            suma(propias, (a) => a.segundos),
            propias.reduce((t, a) => t + a.cuentasConDuracion, 0) * 60,
            1,
          ),
        },
      };
    });

  // Del espejo, los que no tienen NINGÚN texto vendido con su nombre (así un ambiguo con
  // ventas no sale como "sin ventas").
  const ligados = new Set(todos.flatMap((a) => (a.catalogo ? [a.catalogo.id] : [])));
  const sinVentas: MeseroSinVentas[] = entrada.catalogo
    .filter(
      (c) =>
        !ligados.has(c.id) && !nombresVendidos.has(`${c.sucursalId}|${normalizarNombre(c.nombre)}`),
    )
    .map((c) => ({
      ...vistaCatalogo(c),
      sucursalId: c.sucursalId,
      sucursal: sucursales.get(c.sucursalId)?.nombre ?? '',
    }))
    .sort(
      (a, b) =>
        comparar(a.sucursal, b.sucursal) ||
        comparar(a.sucursalId, b.sucursalId) ||
        comparar(a.nombre, b.nombre) ||
        comparar(a.id, b.id),
    );

  return {
    venta: pesos(suma(todos, (a) => a.venta)),
    cuentas: todos.reduce((t, a) => t + a.cuentas, 0),
    descuentos: {
      monto: pesos(suma(todos, (a) => a.descuentos)),
      cuentas: todos.reduce((t, a) => t + a.cuentasConDescuento, 0),
    },
    cancelados: {
      cuentas: todos.reduce((t, a) => t + a.cancelados, 0),
      monto: pesos(suma(todos, (a) => a.montoCancelado)),
    },
    catalogoTruncado: entrada.catalogoTruncado,
    sucursales: resumenSucursales,
    filas,
    sinVentas,
  };
}
