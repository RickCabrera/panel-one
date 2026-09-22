import { Prisma, type CanalNegocio } from '@prisma/client';

import { pesos } from './agregados-ventas.service';

/**
 * Venta por área y por canal de negocio (F2-233), parte pura: cruza lo que dice el SQL (venta y
 * cuentas por (sucursal, área del POS)) con el espejo de áreas y su mapeo área → canal, que es
 * NUESTRO y se aplica al leer.
 *
 * Invariantes (sin repartir nada a ojo):
 * - Σ `areas` + `sinArea` = `venta`.
 * - Σ `canales` + `sinCanal` + `sinArea` = `venta`.
 *
 * El cruce es por (sucursal, `origen_sr_id`) EXACTO, contra el espejo en CUALQUIER estado: un
 * área dada de baja en el POS sigue saliendo en sus periodos pasados, con su nombre y su canal.
 * DECISION PROVISIONAL (nocturno): que el cheque trae el mismo id que el catálogo de áreas no se
 * ha visto en una instalación real (docs/esquema-sr.md §2 y §8).
 */

/** El orden fijo en que salen los canales (el del enum). */
export const ORDEN_CANALES: readonly CanalNegocio[] = [
  'comedor',
  'mostrador',
  'domicilio',
  'plataformas',
];

/** Una fila del SQL: lo vendido en el periodo en una (sucursal, área del POS). */
export interface VentaAreaLeida {
  sucursalId: string;
  sucursal: string;
  /** null = la cuenta no trae área. */
  areaOrigenSrId: string | null;
  venta: Prisma.Decimal;
  cuentas: number;
}

/** Un área del espejo con su canal asignado (null = sin asignar). */
export interface AreaEspejo {
  id: string;
  sucursalId: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  canal: CanalNegocio | null;
}

/**
 * - `catalogo`: el área está en el espejo de su sucursal.
 * - `sin-catalogo`: la sucursal sincronizó su catálogo de áreas y esa área no está.
 * - `sin-sincronizar`: la sucursal nunca cerró su catálogo de áreas: no se sabe si falta.
 */
export type CruceArea = 'catalogo' | 'sin-catalogo' | 'sin-sincronizar';

export interface FilaVentaArea {
  sucursalId: string;
  sucursal: string;
  areaOrigenSrId: string;
  /** El id del área en el espejo; null si no está (ver `cruce`). */
  areaId: string | null;
  clave: string | null;
  nombre: string | null;
  cruce: CruceArea;
  /** Estado del espejo (false = el POS ya no la reporta); null si no está en el espejo. */
  activo: boolean | null;
  /** El canal asignado; null = sin asignar (o el área no está en el espejo). */
  canal: CanalNegocio | null;
  venta: string;
  cuentas: number;
}

export interface VentaCanal {
  canal: CanalNegocio;
  venta: string;
  cuentas: number;
}

export interface Monto {
  venta: string;
  cuentas: number;
}

export interface CatalogoAreasSucursal {
  sucursalId: string;
  sucursal: string;
  /** La sucursal cerró al menos una sincronización completa de su catálogo de áreas. */
  sincronizado: boolean;
}

export interface VentaPorArea {
  /** Σ `cheques.total` sin cancelados del filtro: la misma cifra de `/ventas/resumen`. */
  venta: string;
  cuentas: number;
  /** Una fila por (sucursal, área del POS) con cuentas en el periodo; venta desc. */
  areas: FilaVentaArea[];
  /** "Sin clasificar": cuentas que no traen área. Nunca se reparten. */
  sinArea: Monto;
  /** Sólo los canales con cuentas, en `ORDEN_CANALES`. */
  canales: VentaCanal[];
  /** Cuentas de un área sin canal asignado, o de un área que no está en el espejo. */
  sinCanal: Monto;
  catalogo: CatalogoAreasSucursal[];
}

const CERO = new Prisma.Decimal(0);
const llave = (sucursalId: string, origenSrId: string) => `${sucursalId}|${origenSrId}`;

const porNombre = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function armarPorArea(
  leidas: readonly VentaAreaLeida[],
  espejo: readonly AreaEspejo[],
  sucursales: ReadonlyArray<{ id: string; nombre: string }>,
  sincronizadas: ReadonlySet<string>,
): VentaPorArea {
  const deEspejo = new Map(espejo.map((a) => [llave(a.sucursalId, a.origenSrId), a]));
  let venta = CERO;
  let cuentas = 0;
  let sinArea = { venta: CERO, cuentas: 0 };
  let sinCanal = { venta: CERO, cuentas: 0 };
  const porCanal = new Map<CanalNegocio, { venta: Prisma.Decimal; cuentas: number }>();
  const filas: Array<FilaVentaArea & { ventaExacta: Prisma.Decimal }> = [];

  for (const f of leidas) {
    venta = venta.plus(f.venta);
    cuentas += f.cuentas;
    if (f.areaOrigenSrId === null) {
      sinArea = { venta: sinArea.venta.plus(f.venta), cuentas: sinArea.cuentas + f.cuentas };
      continue;
    }
    const a = deEspejo.get(llave(f.sucursalId, f.areaOrigenSrId)) ?? null;
    const canal = a?.canal ?? null;
    if (canal === null) {
      sinCanal = { venta: sinCanal.venta.plus(f.venta), cuentas: sinCanal.cuentas + f.cuentas };
    } else {
      const c = porCanal.get(canal) ?? { venta: CERO, cuentas: 0 };
      porCanal.set(canal, { venta: c.venta.plus(f.venta), cuentas: c.cuentas + f.cuentas });
    }
    filas.push({
      sucursalId: f.sucursalId,
      sucursal: f.sucursal,
      areaOrigenSrId: f.areaOrigenSrId,
      areaId: a?.id ?? null,
      clave: a?.clave ?? null,
      nombre: a?.nombre ?? null,
      cruce: a ? 'catalogo' : sincronizadas.has(f.sucursalId) ? 'sin-catalogo' : 'sin-sincronizar',
      activo: a?.activo ?? null,
      canal,
      venta: pesos(f.venta),
      cuentas: f.cuentas,
      ventaExacta: f.venta,
    });
  }

  filas.sort(
    (x, y) =>
      y.ventaExacta.comparedTo(x.ventaExacta) ||
      porNombre(x.sucursal, y.sucursal) ||
      porNombre(x.sucursalId, y.sucursalId) ||
      porNombre(x.areaOrigenSrId, y.areaOrigenSrId),
  );

  return {
    venta: pesos(venta),
    cuentas,
    areas: filas.map(({ ventaExacta: _v, ...f }) => {
      void _v;
      return f;
    }),
    sinArea: { venta: pesos(sinArea.venta), cuentas: sinArea.cuentas },
    canales: ORDEN_CANALES.filter((c) => porCanal.has(c)).map((c) => ({
      canal: c,
      venta: pesos(porCanal.get(c)!.venta),
      cuentas: porCanal.get(c)!.cuentas,
    })),
    sinCanal: { venta: pesos(sinCanal.venta), cuentas: sinCanal.cuentas },
    catalogo: sucursales.map((s) => ({
      sucursalId: s.id,
      sucursal: s.nombre,
      sincronizado: sincronizadas.has(s.id),
    })),
  };
}
