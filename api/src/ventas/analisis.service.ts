import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { FiltroVentas } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
import { AgregadosVentasService, diasDelRango, pesos } from './agregados-ventas.service';

/**
 * Desgloses de la vista Análisis (F2-221). Mismas reglas que los agregados de F1-032
 * (`agregados-ventas.service.ts`): venta = Σ `cheques.total` sin cancelados, días y horas
 * LOCALES de cada sucursal, dinero en Decimal y string de 2 decimales, divisiones aquí y no en
 * SQL, y empresa o sucursal fuera del scope = 404 (lo resuelve `AgregadosVentasService.consulta`).
 *
 * Cada desglose sale de UNA sola sentencia: su Σ y el total contra el que cuadra se leen del
 * mismo snapshot de la base, aunque la ingesta esté escribiendo a la vez.
 */

export interface VentaMesero {
  sucursalId: string;
  sucursal: string;
  /** Texto del POS; null = la cuenta no trae mesero. */
  mesero: string | null;
  venta: string;
  cuentas: number;
  ticketPromedio: string | null;
  comensales: number;
  cuentasConComensales: number;
  propina: string;
  descuentos: { monto: string; cuentas: number };
  cancelados: { cuentas: number; monto: string };
  /**
   * Minutos promedio de la cuenta (cierre − apertura), 1 decimal; null sin duraciones válidas.
   * Misma regla que `porMesa`: una duración negativa no entra (F2-231).
   */
  minutosPromedio: string | null;
  cuentasConDuracion: number;
}

/**
 * Una fila de `porMesero` con los segundos exactos: sólo para quien necesita volver a promediar
 * (Meseros, F2-231) sin promediar promedios. NO sale en `/ventas/por-mesero`.
 */
export interface VentaMeseroInterna extends VentaMesero {
  segundos: Prisma.Decimal;
}

export interface ProductoAnalisis {
  producto: string;
  importe: string;
  cantidad: string;
}

export interface VentaPorProducto {
  /** Σ `cheques.total` del filtro: la misma cifra de `/ventas/resumen`. */
  venta: string;
  cuentas: number;
  /** TODAS las filas, por importe desc y nombre. */
  productos: ProductoAnalisis[];
  /**
   * `venta − Σ importe`: lo que el total de las cuentas no reparte entre sus partidas
   * (descuentos, impuestos si las partidas no los traen, y otros ajustes del POS).
   */
  diferenciaCuentas: string;
}

export interface CeldaHoraDia {
  /** ISO: 1 = lunes … 7 = domingo, del cierre en la zona de SU sucursal. */
  diaSemana: number;
  hora: number;
  venta: string;
  cuentas: number;
}

export interface VentaHoraDia {
  /** Siempre 168 (7 × 24), lunes a domingo y 0..23, con cero donde no hubo cierres. */
  celdas: CeldaHoraDia[];
  /** Cuántas veces cae cada día de la semana en `desde..hasta` (0 = no está en el periodo). */
  diasEnRango: Array<{ diaSemana: number; dias: number }>;
}

export interface VentaMesa {
  sucursalId: string;
  sucursal: string;
  mesa: string;
  cuentas: number;
  venta: string;
  /** Minutos promedio de la cuenta (cierre − apertura), 1 decimal; null sin duraciones válidas. */
  minutosPromedio: string | null;
  cuentasConDuracion: number;
}

export interface VentaPorMesa {
  filas: VentaMesa[];
  /** Cuentas sin mesa en el POS: no entran a la rotación. */
  sinMesa: { cuentas: number; venta: string };
  global: {
    venta: string;
    cuentas: number;
    minutosPromedio: string | null;
    cuentasConDuracion: number;
    /** Cierre antes que la apertura: no entran al promedio. */
    duracionesInvalidas: number;
    mesas: number;
    cuentasConMesa: number;
    /** cuentasConMesa / mesas, 2 decimales; null sin mesas. */
    rotacion: string | null;
  };
}

const CERO = new Prisma.Decimal(0);

function dec(valor: unknown): Prisma.Decimal {
  if (valor === null || valor === undefined) {
    return CERO;
  }
  return new Prisma.Decimal(valor as Prisma.Decimal.Value);
}

function dividir(a: Prisma.Decimal, b: Prisma.Decimal.Value, decimales: number): string | null {
  const divisor = new Prisma.Decimal(b);
  if (divisor.isZero()) {
    return null;
  }
  return a.div(divisor).toFixed(decimales, Prisma.Decimal.ROUND_HALF_UP);
}

/** Día de la semana ISO (1 = lunes) de una fecha de calendario `YYYY-MM-DD`. */
export function diaSemanaIso(dia: string): number {
  const d = new Date(`${dia}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

@Injectable()
export class AnalisisService {
  constructor(private readonly agregados: AgregadosVentasService) {}

  /**
   * Una fila por (sucursal, mesero) con ventas o cancelados en el rango. Mismo nombre en dos
   * sucursales = dos filas: no se sabe si es la misma persona (docs/esquema-sr.md §7).
   * Σ venta = `resumen.venta`; los cancelados no suman y se cuentan aparte.
   */
  async porMesero(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaMesero[]> {
    const filas = await this.porMeseroConSegundos(scope, filtro);
    // Sin `segundos`: no es parte del contrato de /ventas/por-mesero.
    return filas.map(({ segundos: _segundos, ...f }) => {
      void _segundos;
      return f;
    });
  }

  /** `porMesero` con los segundos exactos de cada fila (ver `VentaMeseroInterna`). */
  async porMeseroConSegundos(
    scope: EmpresaScope,
    filtro: FiltroVentas,
  ): Promise<VentaMeseroInterna[]> {
    const q = await this.agregados.consulta(scope, filtro);
    const filas = await q.consultar<{
      sucursal_id: string;
      sucursal: string;
      mesero: string | null;
      cuentas: number;
      venta: unknown;
      comensales: number;
      cuentas_con_comensales: number;
      propina: unknown;
      descuentos: unknown;
      cuentas_con_descuento: number;
      cancelados: number;
      monto_cancelado: unknown;
      segundos: unknown;
      con_duracion: number;
    }>(Prisma.sql`SELECT u.sucursal_id, s.nombre AS sucursal, u.mesero,
        sum(u.cuenta)::int AS cuentas,
        COALESCE(sum(u.venta), 0) AS venta,
        COALESCE(sum(u.comensales), 0)::int AS comensales,
        count(u.comensales)::int AS cuentas_con_comensales,
        COALESCE(sum(u.propina), 0) AS propina,
        COALESCE(sum(u.descuentos), 0) AS descuentos,
        (count(*) FILTER (WHERE u.cuenta = 1 AND u.descuentos <> 0))::int AS cuentas_con_descuento,
        sum(u.cancelada)::int AS cancelados,
        COALESCE(sum(u.monto_cancelado), 0) AS monto_cancelado,
        COALESCE(sum(u.segundos_abierta) FILTER (WHERE u.segundos_abierta >= 0), 0)::numeric AS segundos,
        (count(*) FILTER (WHERE u.segundos_abierta >= 0))::int AS con_duracion
      FROM (
        SELECT sucursal_id, mesero, 1 AS cuenta, total AS venta, comensales, propina, descuentos,
               0 AS cancelada, 0::numeric AS monto_cancelado, segundos_abierta
        FROM ventas
        UNION ALL
        SELECT sucursal_id, mesero, 0, 0::numeric, NULL::int, 0::numeric, 0::numeric, 1, total,
               NULL::int
        FROM cancelados
      ) u
      JOIN sucursales_alcance s ON s.id = u.sucursal_id
      GROUP BY u.sucursal_id, s.nombre, u.mesero
      ORDER BY venta DESC, s.nombre COLLATE ucs_basic ASC, u.sucursal_id ASC,
        u.mesero COLLATE ucs_basic ASC NULLS LAST`);
    return filas.map((f) => {
      const venta = dec(f.venta);
      const segundos = dec(f.segundos);
      return {
        sucursalId: f.sucursal_id,
        sucursal: f.sucursal,
        mesero: f.mesero,
        venta: pesos(venta),
        cuentas: f.cuentas,
        ticketPromedio: dividir(venta, f.cuentas, 2),
        comensales: f.comensales,
        cuentasConComensales: f.cuentas_con_comensales,
        propina: pesos(dec(f.propina)),
        descuentos: { monto: pesos(dec(f.descuentos)), cuentas: f.cuentas_con_descuento },
        cancelados: {
          cuentas: f.cancelados,
          // DECISION PROVISIONAL (nocturno): el monto de un cancelado es su `total` tal como
          // llegó; se supone que SR conserva el importe original y no lo pone en 0
          // (docs/esquema-sr.md §2).
          monto: pesos(dec(f.monto_cancelado)),
        },
        minutosPromedio: dividir(segundos, f.con_duracion * 60, 1),
        cuentasConDuracion: f.con_duracion,
        segundos,
      };
    });
  }

  /**
   * Todos los productos vendidos (por nombre, como el top de F1-032) y la diferencia contra la
   * venta, para que el desglose cuadre con ella sin inventar un reparto.
   */
  async porProducto(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaPorProducto> {
    const q = await this.agregados.consulta(scope, filtro);
    const filas = await q.consultar<{
      venta: unknown;
      cuentas: number;
      producto: string | null;
      importe: unknown;
      cantidad: unknown;
    }>(Prisma.sql`SELECT t.venta, t.cuentas, p.producto, p.importe, p.cantidad
      FROM (SELECT COALESCE(sum(total), 0) AS venta, count(*)::int AS cuentas FROM ventas) t
      LEFT JOIN (
        SELECT producto, COALESCE(sum(total), 0) AS importe, COALESCE(sum(cantidad), 0) AS cantidad
        FROM partidas_ventas
        GROUP BY producto
      ) p ON true
      ORDER BY p.importe DESC, p.producto COLLATE ucs_basic ASC`);
    const venta = dec(filas[0]?.venta);
    const productos = filas
      .filter((f) => f.producto !== null)
      .map((f) => ({
        producto: f.producto!,
        importe: dec(f.importe),
        cantidad: dec(f.cantidad),
      }));
    const suma = productos.reduce((s, p) => s.plus(p.importe), CERO);
    return {
      venta: pesos(venta),
      cuentas: filas[0]?.cuentas ?? 0,
      productos: productos.map((p) => ({
        producto: p.producto,
        importe: pesos(p.importe),
        cantidad: p.cantidad.toFixed(3),
      })),
      // DECISION PROVISIONAL (nocturno): lo que no es de ningún producto va en UN renglón de
      // diferencia, no se prorratea entre las partidas. No se sabe si `partidas.total` trae el
      // IVA ni cómo reparte SR el descuento de la cuenta (docs/esquema-sr.md §6, decisión
      // abierta para Ricardo).
      diferenciaCuentas: pesos(venta.minus(suma)),
    };
  }

  /** Mapa de calor: día de la semana × hora local del cierre. Σ = `resumen`. */
  async horaDia(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaHoraDia> {
    const q = await this.agregados.consulta(scope, filtro);
    const filas = await q.consultar<{
      dia_semana: number;
      hora: number;
      venta: unknown;
      cuentas: number;
    }>(Prisma.sql`SELECT dia_semana_local AS dia_semana, hora_local AS hora,
        COALESCE(sum(total), 0) AS venta, count(*)::int AS cuentas
      FROM ventas
      GROUP BY dia_semana_local, hora_local`);
    if (filas.some((f) => f.dia_semana < 1 || f.dia_semana > 7 || f.hora < 0 || f.hora > 23)) {
      // No debería pasar nunca: `isodow` va de 1 a 7 y la hora de 0 a 23.
      throw new Error('Celda del mapa de calor fuera de 7 × 24.');
    }
    const porCelda = new Map(filas.map((f) => [`${f.dia_semana}-${f.hora}`, f]));
    const celdas: CeldaHoraDia[] = [];
    for (let diaSemana = 1; diaSemana <= 7; diaSemana++) {
      for (let hora = 0; hora < 24; hora++) {
        const f = porCelda.get(`${diaSemana}-${hora}`);
        celdas.push({ diaSemana, hora, venta: pesos(dec(f?.venta)), cuentas: f?.cuentas ?? 0 });
      }
    }
    const conteo = new Map<number, number>();
    for (const dia of diasDelRango(filtro.desde, filtro.hasta)) {
      const d = diaSemanaIso(dia);
      conteo.set(d, (conteo.get(d) ?? 0) + 1);
    }
    return {
      celdas,
      diasEnRango: [1, 2, 3, 4, 5, 6, 7].map((diaSemana) => ({
        diaSemana,
        dias: conteo.get(diaSemana) ?? 0,
      })),
    };
  }

  /**
   * Tiempo de mesa y rotación. La mesa es (sucursal, texto del POS): la "5" de una sucursal no
   * es la "5" de otra. Σ venta de filas + sinMesa = `resumen.venta`.
   */
  async porMesa(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaPorMesa> {
    const q = await this.agregados.consulta(scope, filtro);
    const filas = await q.consultar<{
      sucursal_id: string;
      sucursal: string;
      mesa: string | null;
      cuentas: number;
      venta: unknown;
      segundos: unknown;
      con_duracion: number;
      invalidas: number;
    }>(Prisma.sql`SELECT v.sucursal_id, s.nombre AS sucursal, v.mesa,
        count(*)::int AS cuentas,
        COALESCE(sum(v.total), 0) AS venta,
        COALESCE(sum(v.segundos_abierta) FILTER (WHERE v.segundos_abierta >= 0), 0)::numeric AS segundos,
        (count(*) FILTER (WHERE v.segundos_abierta >= 0))::int AS con_duracion,
        (count(*) FILTER (WHERE v.segundos_abierta < 0))::int AS invalidas
      FROM ventas v
      JOIN sucursales_alcance s ON s.id = v.sucursal_id
      GROUP BY v.sucursal_id, s.nombre, v.mesa
      ORDER BY s.nombre COLLATE ucs_basic ASC, v.sucursal_id ASC, v.mesa COLLATE ucs_basic ASC NULLS LAST`);

    const minutos = (segundos: Prisma.Decimal, n: number) => dividir(segundos, n * 60, 1);
    let venta = CERO;
    let cuentas = 0;
    let segundos = CERO;
    let conDuracion = 0;
    let invalidas = 0;
    let sinMesa = { cuentas: 0, venta: CERO };
    const conMesa: VentaMesa[] = [];
    for (const f of filas) {
      const v = dec(f.venta);
      const s = dec(f.segundos);
      venta = venta.plus(v);
      cuentas += f.cuentas;
      segundos = segundos.plus(s);
      conDuracion += f.con_duracion;
      invalidas += f.invalidas;
      if (f.mesa === null) {
        sinMesa = { cuentas: sinMesa.cuentas + f.cuentas, venta: sinMesa.venta.plus(v) };
        continue;
      }
      conMesa.push({
        sucursalId: f.sucursal_id,
        sucursal: f.sucursal,
        mesa: f.mesa,
        cuentas: f.cuentas,
        venta: pesos(v),
        minutosPromedio: minutos(s, f.con_duracion),
        cuentasConDuracion: f.con_duracion,
      });
    }
    const cuentasConMesa = conMesa.reduce((n, m) => n + m.cuentas, 0);
    return {
      filas: conMesa,
      sinMesa: { cuentas: sinMesa.cuentas, venta: pesos(sinMesa.venta) },
      global: {
        venta: pesos(venta),
        cuentas,
        minutosPromedio: minutos(segundos, conDuracion),
        cuentasConDuracion: conDuracion,
        duracionesInvalidas: invalidas,
        mesas: conMesa.length,
        cuentasConMesa,
        rotacion: dividir(new Prisma.Decimal(cuentasConMesa), conMesa.length, 2),
      },
    };
  }
}
