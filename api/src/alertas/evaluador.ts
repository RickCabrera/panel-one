import { MotivoCierreAlerta, Prisma, TipoAlerta } from '@prisma/client';

import type { AlertaAbierta, NuevaAlerta } from '../scope/escritura-alertas';
import { CUENTAS_BASE_MINIMAS, definicion, type ReglaEfectiva } from './reglas';

/**
 * El evaluador del centro de alertas (F2-224), PURO: de una observación, las reglas y las
 * alertas abiertas, qué se abre y qué se cierra. No lee nada ni escribe nada.
 *
 * La observación NO depende de las reglas (edades, minutos, ventas): se toma fuera del
 * candado. Las reglas, las abiertas y qué sigue activo se leen DENTRO del candado, y el
 * umbral se aplica aquí. Así una observación tomada antes de un cambio de regla se juzga
 * con la regla nueva.
 */

/** Una cuenta abierta que se puede rastrear: tiene folio único y hora de apertura medible. */
export interface CuentaObservada {
  folio: string;
  mesa: string | null;
  /** Minutos enteros (truncados) que lleva abierta, con la regla `minutosAbierta` del web. */
  minutos: number;
  impreso: boolean | null;
}

/** Venta de HOY (día local de la sucursal) contra el mismo día de la semana pasada a la misma altura. */
export interface VentaObservada {
  /** Día local de hoy, AAAA-MM-DD. */
  dia: string;
  /** Importes como texto decimal con 2 decimales (`pesos()`), nunca float. */
  hoy: string;
  base: string;
  cuentasBase: number;
}

export interface SucursalObservada {
  sucursalId: string;
  /** Segundos desde el último reporte (reloj del servidor); null = nunca ha reportado. */
  edadReporteS: number | null;
  /** El último snapshot de mesas se recibió hace ≤ `SNAPSHOT_VIVO_S`. */
  snapshotVivo: boolean;
  /** Sólo tiene sentido con `snapshotVivo`. */
  cuentas: CuentaObservada[];
  /** Null si no se pudo leer. */
  venta: VentaObservada | null;
}

export interface Observacion {
  empresaId: string;
  sucursales: SucursalObservada[];
}

/** Lo leído DENTRO del candado. */
export interface EstadoBajoCandado {
  empresaActiva: boolean;
  sucursalesActivas: ReadonlySet<string>;
  reglas: readonly ReglaEfectiva[];
  abiertas: readonly AlertaAbierta[];
}

export interface Cambios {
  abrir: NuevaAlerta[];
  cerrar: Array<{ id: string; motivo: MotivoCierreAlerta }>;
}

interface Condicion {
  llave: string;
  detalle: Prisma.InputJsonObject;
}

const cien = new Prisma.Decimal(100);

/**
 * ¿La venta de hoy cayó más del umbral contra la base? Devuelve el % de caída como texto
 * (2 decimales, mitad lejos de cero) o null si no hay caída suficiente. Todo en Decimal.
 */
export function caidaDeVenta(hoy: string, base: string, umbralPct: number): string | null {
  const h = new Prisma.Decimal(hoy);
  const b = new Prisma.Decimal(base);
  if (b.lte(0)) {
    return null;
  }
  const limite = b.mul(cien.minus(umbralPct)).div(cien);
  if (!h.lt(limite)) {
    return null;
  }
  return b.minus(h).mul(cien).div(b).toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Las condiciones que se cumplen para una sucursal y un tipo, o `null` si ese tipo NO se
 * puede evaluar ahora (se deja como está: ni se abre ni se cierra nada de él).
 */
function condiciones(
  tipo: TipoAlerta,
  umbral: number,
  s: SucursalObservada,
  umbralSinReporteMin: number,
): Condicion[] | null {
  switch (tipo) {
    case TipoAlerta.sucursal_sin_reporte:
      if (s.edadReporteS === null) {
        // DECISION PROVISIONAL (nocturno): una sucursal que nunca ha reportado también es
        // alerta (crítica). Es un dato verdadero —no hay nada que mostrar de ella— y era lo
        // que ya decía el Resumen de F2-220. Una sucursal recién dada de alta nace alertada.
        return [{ llave: '', detalle: { nunca: true } }];
      }
      return s.edadReporteS > umbral * 60
        ? [{ llave: '', detalle: { nunca: false, edadSegundos: s.edadReporteS } }]
        : [];

    case TipoAlerta.mesa_abierta:
      if (!s.snapshotVivo) return null;
      return s.cuentas
        .filter((c) => c.minutos > umbral)
        .map((c) => ({
          llave: c.folio,
          detalle: { folio: c.folio, mesa: c.mesa, minutos: c.minutos },
        }));

    case TipoAlerta.cuenta_sin_imprimir:
      if (!s.snapshotVivo) return null;
      return s.cuentas
        .filter((c) => c.impreso === false && c.minutos > umbral)
        .map((c) => ({
          llave: c.folio,
          detalle: { folio: c.folio, mesa: c.mesa, minutos: c.minutos },
        }));

    case TipoAlerta.caida_venta: {
      // Sin reporte reciente la venta de hoy está incompleta: no se juzga.
      if (
        s.venta === null ||
        s.edadReporteS === null ||
        s.edadReporteS > umbralSinReporteMin * 60
      ) {
        return null;
      }
      if (s.venta.cuentasBase < CUENTAS_BASE_MINIMAS) return null;
      const caida = caidaDeVenta(s.venta.hoy, s.venta.base, umbral);
      return caida === null
        ? []
        : [
            {
              llave: s.venta.dia,
              detalle: {
                dia: s.venta.dia,
                ventaHoy: s.venta.hoy,
                ventaBase: s.venta.base,
                cuentasBase: s.venta.cuentasBase,
                caidaPct: caida,
              },
            },
          ];
    }
  }
}

export function evaluar(obs: Observacion, estado: EstadoBajoCandado): Cambios {
  const cambios: Cambios = { abrir: [], cerrar: [] };
  const cerradas = new Set<string>();
  const cerrar = (a: AlertaAbierta, motivo: MotivoCierreAlerta) => {
    if (cerradas.has(a.id)) return;
    cerradas.add(a.id);
    cambios.cerrar.push({ id: a.id, motivo });
  };

  if (!estado.empresaActiva) {
    estado.abiertas.forEach((a) => cerrar(a, MotivoCierreAlerta.empresa_inactiva));
    return cambios;
  }
  for (const a of estado.abiertas) {
    if (!estado.sucursalesActivas.has(a.sucursalId))
      cerrar(a, MotivoCierreAlerta.sucursal_inactiva);
  }
  for (const r of estado.reglas) {
    if (!r.activa) {
      estado.abiertas
        .filter((a) => a.tipo === r.tipo)
        .forEach((a) => cerrar(a, MotivoCierreAlerta.regla_apagada));
    }
  }

  const umbralSinReporte =
    estado.reglas.find((r) => r.tipo === TipoAlerta.sucursal_sin_reporte)?.umbral ??
    definicion(TipoAlerta.sucursal_sin_reporte).porDefecto;

  for (const s of obs.sucursales) {
    // Una sucursal que se dio de baja entre la observación y el candado no se evalúa.
    if (!estado.sucursalesActivas.has(s.sucursalId)) continue;
    for (const r of estado.reglas) {
      if (!r.activa) continue;
      const abiertas = estado.abiertas.filter(
        (a) => a.sucursalId === s.sucursalId && a.tipo === r.tipo && !cerradas.has(a.id),
      );
      // Una caída de OTRO día ya no es la de hoy: se cierra aunque hoy no se pueda juzgar.
      if (r.tipo === TipoAlerta.caida_venta && s.venta !== null) {
        abiertas
          .filter((a) => a.llave !== s.venta!.dia)
          .forEach((a) => cerrar(a, MotivoCierreAlerta.condicion));
      }
      const conds = condiciones(r.tipo, r.umbral, s, umbralSinReporte);
      if (conds === null) continue;
      const llaves = new Set(conds.map((c) => c.llave));
      for (const a of abiertas) {
        if (!llaves.has(a.llave)) cerrar(a, MotivoCierreAlerta.condicion);
      }
      const yaAbiertas = new Set(abiertas.filter((a) => !cerradas.has(a.id)).map((a) => a.llave));
      for (const c of conds) {
        if (yaAbiertas.has(c.llave)) continue;
        cambios.abrir.push({
          sucursalId: s.sucursalId,
          tipo: r.tipo,
          severidad: definicion(r.tipo).severidad,
          llave: c.llave,
          umbral: r.umbral,
          detalle: c.detalle,
        });
      }
    }
  }
  return cambios;
}
