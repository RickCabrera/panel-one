import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MesasService } from '../mesas/mesas.service';
import type { EmpresaScope } from '../scope/empresa-scope';
import { pesos } from './agregados-ventas.service';
import { AnalisisService } from './analisis.service';
import { unirMeseros } from './meseros-en-vivo';

export interface MeseroEnVivo {
  posicion: number | null;
  sucursalId: string;
  sucursal: string;
  mesero: string | null;
  cobrado: string;
  cuentas: number;
  comensales: number;
  ticketPromedio: string | null;
  mesasAbiertas: number;
  enCurso: string;
  mesasSinTotal: number;
  comensalesEnMesa: number;
  /** cobrado + enCurso. */
  total: string;
}

export interface SucursalEnVivo {
  sucursalId: string;
  nombre: string;
  zonaHoraria: string;
  /** El último snapshot de mesas de la sucursal, o null si nunca ha llegado uno. */
  snapshot: { capturadoAt: string; recibidoAt: string; edadRecepcionSegundos: number } | null;
}

export interface MeserosEnVivo {
  dia: string;
  sucursales: SucursalEnVivo[];
  meseros: MeseroEnVivo[];
  totales: {
    cobrado: string;
    cuentas: number;
    enCurso: string;
    mesasAbiertas: number;
    mesasSinTotal: number;
    total: string;
  };
}

const CERO = new Prisma.Decimal(0);

/**
 * Cuánto vende cada mesero HOY, en vivo (MVP). Cobrado = las cuentas cerradas del día local
 * (exactamente `/ventas/por-mesero` con `desde = hasta = dia`: mismas reglas, mismo scope).
 * En curso = las mesas abiertas del ÚLTIMO snapshot de cada sucursal (`/mesas/abiertas`).
 *
 * El API no decide si una sucursal está desconectada (lo decide el panel con la edad del
 * snapshot, F1-050): devuelve la edad y suma lo que trae el último snapshot. Sin cache.
 */
@Injectable()
export class MeserosEnVivoService {
  constructor(
    private readonly analisis: AnalisisService,
    private readonly mesas: MesasService,
  ) {}

  async meseros(
    scope: EmpresaScope,
    filtro: { empresaId: string; sucursalId?: string; dia: string },
  ): Promise<MeserosEnVivo> {
    // `porMesero` valida el filtro (400) y el alcance (404) antes de leer nada.
    const cobrado = await this.analisis.porMesero(scope, {
      empresaId: filtro.empresaId,
      sucursalId: filtro.sucursalId,
      desde: filtro.dia,
      hasta: filtro.dia,
    });
    const abiertas = await this.mesas.abiertas(scope, filtro.empresaId, filtro.sucursalId);
    const filas = unirMeseros(
      cobrado.map((c) => ({
        sucursalId: c.sucursalId,
        sucursal: c.sucursal,
        mesero: c.mesero,
        venta: new Prisma.Decimal(c.venta),
        cuentas: c.cuentas,
        comensales: c.comensales,
      })),
      abiertas.map((s) => ({
        sucursalId: s.sucursalId,
        sucursal: s.nombre,
        mesas: s.snapshot?.mesas ?? [],
      })),
    );

    let totalCobrado = CERO;
    let totalEnCurso = CERO;
    let cuentas = 0;
    let mesasAbiertas = 0;
    let mesasSinTotal = 0;
    for (const f of filas) {
      totalCobrado = totalCobrado.plus(f.cobrado);
      totalEnCurso = totalEnCurso.plus(f.enCurso);
      cuentas += f.cuentas;
      mesasAbiertas += f.mesasAbiertas;
      mesasSinTotal += f.mesasSinTotal;
    }

    return {
      dia: filtro.dia,
      sucursales: abiertas.map((s) => ({
        sucursalId: s.sucursalId,
        nombre: s.nombre,
        zonaHoraria: s.zonaHoraria,
        snapshot:
          s.snapshot === null
            ? null
            : {
                capturadoAt: s.snapshot.capturadoAt,
                recibidoAt: s.snapshot.recibidoAt,
                edadRecepcionSegundos: s.snapshot.edadRecepcionSegundos,
              },
      })),
      meseros: filas.map((f) => ({
        posicion: f.posicion,
        sucursalId: f.sucursalId,
        sucursal: f.sucursal,
        mesero: f.mesero,
        cobrado: pesos(f.cobrado),
        cuentas: f.cuentas,
        comensales: f.comensales,
        ticketPromedio: f.cuentas === 0 ? null : pesos(f.cobrado.div(f.cuentas)),
        mesasAbiertas: f.mesasAbiertas,
        enCurso: pesos(f.enCurso),
        mesasSinTotal: f.mesasSinTotal,
        comensalesEnMesa: f.comensalesEnMesa,
        total: pesos(f.cobrado.plus(f.enCurso)),
      })),
      totales: {
        cobrado: pesos(totalCobrado),
        cuentas,
        enCurso: pesos(totalEnCurso),
        mesasAbiertas,
        mesasSinTotal,
        total: pesos(totalCobrado.plus(totalEnCurso)),
      },
    };
  }
}
