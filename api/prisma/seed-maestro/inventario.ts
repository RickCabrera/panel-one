import { Prisma } from '@prisma/client';

import { cantidad3, dinero, diaSemana, elegir, hoyEn, prng } from './azar';
import {
  almacenDeInsumo,
  FORZADOS,
  grupoInsumo,
  INSUMOS,
  insumo,
  NOMBRE_ALMACEN,
  unidadEntera,
  type TipoAlmacen,
} from './insumos';
import { DESECHABLES_POR_CANAL, RECETAS } from './recetas';

/**
 * Inventario SINTÉTICO del seed maestro (F2-201): almacenes, pólizas con sus
 * movimientos, compras y existencias. Se SIMULA día por día contra las ventas
 * del propio seed, así que el consumo es el de las recetas (más una merma), no
 * ruido: F2-125 (teórico contra real) y F2-127 (proyección) miden algo.
 *
 * Las existencias NO se inventan aparte: son el saldo que dejan los movimientos
 * (inicial + Σ movimientos) y el costo promedio ponderado que dejan las
 * entradas. El spec lo recalcula desde los movimientos crudos.
 *
 * No es un mapeo de SoftRestaurant (§9 de docs/esquema-sr.md sigue pendiente).
 */

type D = Prisma.Decimal;
const Dec = Prisma.Decimal;
const CERO = new Dec(0);

/** Lo mínimo de una venta que el inventario necesita (evita importar seed-ventas). */
export interface VentaParaConsumo {
  sucursalId: string;
  cerradoAt: Date | null;
  cancelado: boolean;
  canal: string | null;
  partidas: ReadonlyArray<{ productoClave: string; cantidad: D }>;
}

export interface SucursalInventario {
  id: string;
  clave: string;
  zonaHoraria: string;
}

export type TipoPoliza =
  'inicial' | 'compra' | 'consumo' | 'merma' | 'traspaso_salida' | 'traspaso_entrada' | 'ajuste';

export interface AlmacenSeed {
  clave: string;
  sucursalId: string;
  tipo: TipoAlmacen;
  nombre: string;
}

export interface MovimientoSeed {
  insumo: string;
  /** Con signo: + entra, − sale. NUMERIC(12,3). */
  cantidad: D;
  /** Costo por unidad del movimiento, sin IVA. */
  costoUnitario: D;
  /** cantidad × costo, con signo, a 2 decimales. */
  importe: D;
}

export interface PolizaSeed {
  folio: string;
  sucursalId: string;
  almacen: string;
  tipo: TipoPoliza;
  /** Día local `YYYY-MM-DD` de la sucursal. */
  dia: string;
  /** Folio de la compra o del traspaso que la originó. */
  referencia: string | null;
  movimientos: MovimientoSeed[];
}

export interface CompraSeed {
  folio: string;
  sucursalId: string;
  almacen: string;
  dia: string;
  proveedor: string;
  poliza: string;
  partidas: Array<{ insumo: string; cantidad: D; costoUnitario: D; importe: D }>;
  /** Σ importes de sus partidas (sin IVA). */
  total: D;
}

export interface ExistenciaSeed {
  sucursalId: string;
  almacen: string;
  insumo: string;
  cantidad: D;
  costoPromedio: D;
  valor: D;
  minimo: D;
  maximo: D;
}

export interface Inventario {
  almacenes: AlmacenSeed[];
  polizas: PolizaSeed[];
  compras: CompraSeed[];
  existencias: ExistenciaSeed[];
}

/** Redondeo del inventario: piezas enteras hacia arriba; lo demás a medio kg/lt. */
function redondeoArriba(claveInsumo: string, v: D): D {
  if (unidadEntera(claveInsumo)) return Dec.max(1, v.ceil());
  return Dec.max('0.5', v.times(2).ceil().div(2));
}

/** La cantidad que de verdad sale: entera hacia arriba en piezas, 3 decimales si no. */
function cantidadMovible(claveInsumo: string, v: D): D {
  return unidadEntera(claveInsumo) ? v.ceil() : cantidad3(v);
}

/** Consumo teórico (recetas × ventas + desechables) por sucursal, día e insumo. */
export function consumoTeorico(
  ventas: readonly VentaParaConsumo[],
  sucursales: readonly SucursalInventario[],
): Map<string, Map<string, Map<string, D>>> {
  const zona = new Map(sucursales.map((s) => [s.id, s.zonaHoraria]));
  const out = new Map<string, Map<string, Map<string, D>>>();
  for (const v of ventas) {
    if (v.cancelado || !v.cerradoAt || !zona.has(v.sucursalId)) continue;
    const dia = hoyEn(zona.get(v.sucursalId)!, v.cerradoAt);
    const porSuc = out.get(v.sucursalId) ?? new Map<string, Map<string, D>>();
    out.set(v.sucursalId, porSuc);
    const porDia = porSuc.get(dia) ?? new Map<string, D>();
    porSuc.set(dia, porDia);
    const sumar = (clave: string, q: D) => porDia.set(clave, (porDia.get(clave) ?? CERO).plus(q));
    for (const p of v.partidas) {
      for (const [clave, q] of RECETAS[p.productoClave] ?? []) sumar(clave, p.cantidad.times(q));
    }
    for (const [clave, q] of DESECHABLES_POR_CANAL[v.canal ?? 'comedor'] ?? []) {
      sumar(clave, new Dec(q));
    }
  }
  return out;
}

interface Estado {
  saldo: D;
  cp: D;
  minimo: D;
  maximo: D;
}

export function generarInventario(op: {
  sucursales: readonly SucursalInventario[];
  dias: readonly string[];
  ventas: readonly VentaParaConsumo[];
  semilla?: number;
}): Inventario {
  const r = prng(op.semilla ?? 20260921);
  const teorico = consumoTeorico(op.ventas, op.sucursales);
  const tipos: TipoAlmacen[] = ['GEN', 'BAR'];

  const almacenes: AlmacenSeed[] = op.sucursales.flatMap((s) =>
    tipos.map((tipo) => ({
      clave: `${s.clave}-${tipo}`,
      sucursalId: s.id,
      tipo,
      nombre: NOMBRE_ALMACEN[tipo],
    })),
  );
  const insumosDe = (tipo: TipoAlmacen) => INSUMOS.filter((i) => almacenDeInsumo(i.clave) === tipo);

  // Estado por almacén e insumo. Mínimo = 2 días de consumo promedio; máximo = 7.
  const estado = new Map<string, Map<string, Estado>>();
  for (const s of op.sucursales) {
    const porDia = teorico.get(s.id) ?? new Map<string, Map<string, D>>();
    for (const tipo of tipos) {
      const m = new Map<string, Estado>();
      for (const i of insumosDe(tipo)) {
        const total = op.dias.reduce(
          (acc, d) => acc.plus(porDia.get(d)?.get(i.clave) ?? CERO),
          CERO,
        );
        const promedio = total.div(op.dias.length);
        const minimo = total.isZero()
          ? redondeoArriba(i.clave, new Dec(2))
          : redondeoArriba(i.clave, promedio.times(2));
        const maximo = total.isZero()
          ? redondeoArriba(i.clave, new Dec(10))
          : redondeoArriba(i.clave, promedio.times(7));
        m.set(i.clave, { saldo: CERO, cp: new Dec(i.costo), minimo, maximo });
      }
      estado.set(`${s.clave}-${tipo}`, m);
    }
  }

  const polizas: PolizaSeed[] = [];
  const compras: CompraSeed[] = [];
  const folioPol = new Map<string, number>();
  const folioCompra = new Map<string, number>();
  let folioTraspaso = 0;
  const siguiente = (m: Map<string, number>, k: string) => {
    const n = (m.get(k) ?? 0) + 1;
    m.set(k, n);
    return n;
  };

  /** Aplica un movimiento al estado y lo devuelve. Entradas recalculan el promedio. */
  function mover(e: Estado, clave: string, cantidad: D, costo?: D): MovimientoSeed {
    const costoUnitario = costo ?? e.cp;
    if (cantidad.greaterThan(0)) {
      const nuevo = e.saldo.plus(cantidad);
      e.cp = e.saldo.lessThanOrEqualTo(0)
        ? costoUnitario
        : dinero(e.saldo.times(e.cp).plus(cantidad.times(costoUnitario)).div(nuevo));
      e.saldo = nuevo;
    } else {
      e.saldo = e.saldo.plus(cantidad);
    }
    return {
      insumo: clave,
      cantidad,
      costoUnitario,
      importe: dinero(cantidad.times(costoUnitario)),
    };
  }

  function poliza(
    s: SucursalInventario,
    tipo: TipoAlmacen,
    tipoPoliza: TipoPoliza,
    dia: string,
    movimientos: MovimientoSeed[],
    referencia: string | null = null,
  ): PolizaSeed | null {
    if (movimientos.length === 0) return null;
    const n = siguiente(folioPol, s.clave);
    const p: PolizaSeed = {
      folio: `${s.clave}-POL-${String(n).padStart(5, '0')}`,
      sucursalId: s.id,
      almacen: `${s.clave}-${tipo}`,
      tipo: tipoPoliza,
      dia,
      referencia,
      movimientos,
    };
    polizas.push(p);
    return p;
  }

  op.dias.forEach((dia, iDia) => {
    const ultimo = iDia === op.dias.length - 1;
    for (const s of op.sucursales) {
      for (const tipo of tipos) {
        const est = estado.get(`${s.clave}-${tipo}`)!;

        // 1. Inventario inicial: el primer día, todo al máximo y a costo base.
        if (iDia === 0) {
          poliza(
            s,
            tipo,
            'inicial',
            dia,
            [...est].map(([clave, e]) => mover(e, clave, e.maximo, new Dec(insumo(clave).costo))),
          );
        } else {
          // 2. Compras: lunes y jueves se surte lo que baje del punto medio; cualquier
          //    otro día, sólo lo que ya quedó bajo el mínimo. Una compra por proveedor.
          const surtido = [1, 4].includes(diaSemana(dia));
          const porProveedor = new Map<string, string[]>();
          for (const [clave, e] of est) {
            const punto = surtido ? e.minimo.plus(e.maximo).div(2) : e.minimo;
            if (!e.saldo.lessThan(punto)) continue;
            // El agotado forzado deja de surtirse la última semana (proveedor sin
            // existencia): así llega a cero por consumo y el ajuste final lo confirma.
            if (clave === FORZADOS[tipo].agotado && iDia >= op.dias.length - 7) continue;
            const prov = grupoInsumo(insumo(clave).grupo).proveedor;
            porProveedor.set(prov, [...(porProveedor.get(prov) ?? []), clave]);
          }
          for (const [proveedor, claves] of porProveedor) {
            const n = siguiente(folioCompra, s.clave);
            const folio = `${s.clave}-OC-${String(n).padStart(4, '0')}`;
            const movs = claves.map((clave) => {
              const e = est.get(clave)!;
              // Variación ±5 % sacada del PRNG y redondeada a centavos: sirve para un seed
              // sintético, NO es el patrón para importes reales (ahí, sólo Decimal).
              const costo = dinero(new Dec(insumo(clave).costo).times(0.95 + r() * 0.1));
              return mover(e, clave, cantidadMovible(clave, e.maximo.minus(e.saldo)), costo);
            });
            const p = poliza(s, tipo, 'compra', dia, movs, folio)!;
            compras.push({
              folio,
              sucursalId: s.id,
              almacen: p.almacen,
              dia,
              proveedor,
              poliza: p.folio,
              partidas: movs.map((m) => ({ ...m })),
              total: movs.reduce((acc, m) => acc.plus(m.importe), CERO),
            });
          }
        }

        // 3. Consumo del día: recetas × ventas, más 0–4 % de merma operativa.
        //    Nunca sale más de lo que hay: el kardex no pasa por negativo.
        const delDia = teorico.get(s.id)?.get(dia);
        const consumos: MovimientoSeed[] = [];
        for (const [clave, e] of est) {
          const q = delDia?.get(clave);
          if (!q || q.isZero()) continue;
          const real = Dec.min(e.saldo, cantidadMovible(clave, q.times(1 + r() * 0.04)));
          if (real.greaterThan(0)) consumos.push(mover(e, clave, real.negated()));
        }
        poliza(s, tipo, 'consumo', dia, consumos);

        // 4. Merma ocasional (caducidad, rotura): 3 % del máximo de un insumo.
        if (r() < 0.12) {
          const conSaldo = [...est].filter(([, e]) => e.saldo.greaterThan(0));
          if (conSaldo.length > 0) {
            const [clave, e] = elegir(r, conSaldo);
            const q = Dec.min(
              e.saldo,
              unidadEntera(clave)
                ? Dec.max(1, e.maximo.times('0.03').floor())
                : cantidad3(e.maximo.times('0.03')),
            );
            if (q.greaterThan(0)) poliza(s, tipo, 'merma', dia, [mover(e, clave, q.negated())]);
          }
        }
      }
    }

    // 5. Traspaso quincenal del almacén general de la primera sucursal a la segunda.
    if (op.sucursales.length >= 2 && iDia % 15 === 7) {
      const [origen, destino] = op.sucursales;
      const eo = estado.get(`${origen.clave}-GEN`)!;
      const ed = estado.get(`${destino.clave}-GEN`)!;
      const candidatos = [...eo].filter(
        ([clave, e]) => e.saldo.greaterThan(1) && clave !== FORZADOS.GEN.agotado,
      );
      if (candidatos.length > 0) {
        const [clave, e] = elegir(r, candidatos);
        const q = unidadEntera(clave)
          ? e.saldo.times('0.2').floor()
          : cantidad3(e.saldo.times('0.2'));
        if (q.greaterThan(0)) {
          const folio = `TR-${String(++folioTraspaso).padStart(4, '0')}`;
          const costo = e.cp;
          poliza(origen, 'GEN', 'traspaso_salida', dia, [mover(e, clave, q.negated())], folio);
          poliza(
            destino,
            'GEN',
            'traspaso_entrada',
            dia,
            [mover(ed.get(clave)!, clave, q, costo)],
            folio,
          );
        }
      }
    }

    // 6. Último día: conteo físico. El agotado forzado queda en cero y el de bajo
    //    mínimo en 40 % de su mínimo; la diferencia es un ajuste, no un saldo inventado.
    if (ultimo) {
      for (const s of op.sucursales) {
        for (const tipo of tipos) {
          const est = estado.get(`${s.clave}-${tipo}`)!;
          const movs: MovimientoSeed[] = [];
          const ag = est.get(FORZADOS[tipo].agotado)!;
          if (ag.saldo.greaterThan(0))
            movs.push(mover(ag, FORZADOS[tipo].agotado, ag.saldo.negated()));
          const bm = est.get(FORZADOS[tipo].bajoMinimo)!;
          const meta = cantidad3(bm.minimo.times('0.4'));
          const dif = meta.minus(bm.saldo);
          if (!dif.isZero()) movs.push(mover(bm, FORZADOS[tipo].bajoMinimo, dif));
          poliza(s, tipo, 'ajuste', dia, movs, 'CONTEO FISICO');
        }
      }
    }
  });

  const existencias: ExistenciaSeed[] = almacenes.flatMap((a) =>
    [...estado.get(a.clave)!].map(([clave, e]) => ({
      sucursalId: a.sucursalId,
      almacen: a.clave,
      insumo: clave,
      cantidad: e.saldo,
      costoPromedio: e.cp,
      valor: dinero(e.saldo.times(e.cp)),
      minimo: e.minimo,
      maximo: e.maximo,
    })),
  );

  return { almacenes, polizas, compras, existencias };
}
