import { createHash } from 'node:crypto';

import {
  MotivoCierreAlerta,
  Prisma,
  PrismaClient,
  SeveridadAlerta,
  TipoAlerta,
} from '@prisma/client';

import { cargarEnvLocal } from '../src/config/cargar-env';
import { SEED_IDS } from './seed';

/**
 * Seed del HISTORIAL del centro de alertas (F2-224), SINTÉTICO. Deja ver el panel de alertas
 * con 14 días de historia sin esperar dos semanas de operación.
 *
 * - Sólo alertas CERRADAS (con sus dos marcas). Las ABIERTAS no se siembran: las abre la
 *   evaluación del API al arrancar (primer tick), a partir del seed de mesas (cuentas de más de
 *   60 min, una sucursal desconectada) y del de ventas. Sembrar abiertas a mano sería mentir
 *   sobre el estado actual.
 * - `generarAlertasSeed()` es PURA y se ancla al día UTC de `ahora`: el mismo `ahora` da
 *   exactamente las mismas filas. Con el ids deterministas por (sucursal, día, índice),
 *   `sembrarAlertas()` hace upsert: N corridas dejan los mismos datos. Correrlo OTRO día mueve
 *   las mismas filas a las fechas nuevas (la historia siempre son "los últimos 14 días"): no es
 *   una falla de idempotencia, es el ancla.
 */

export const DIAS_HISTORIA = 14;
const MS_MIN = 60_000;
const MS_DIA = 86_400_000;

export interface OpcionesAlertas {
  empresaId: string;
  sucursales: readonly string[];
  ahora: Date;
}

export interface AlertaSeed {
  id: string;
  empresaId: string;
  sucursalId: string;
  tipo: TipoAlerta;
  severidad: SeveridadAlerta;
  llave: string;
  umbral: number;
  detalle: Prisma.InputJsonObject;
  abiertaAt: Date;
  cerradaAt: Date;
  motivoCierre: MotivoCierreAlerta;
}

/** UUID determinista (forma v4) a partir de un texto. */
export function uuidDe(texto: string): string {
  const h = createHash('sha256').update(texto).digest('hex');
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const TIPOS: readonly TipoAlerta[] = [
  TipoAlerta.mesa_abierta,
  TipoAlerta.cuenta_sin_imprimir,
  TipoAlerta.sucursal_sin_reporte,
  TipoAlerta.caida_venta,
];

function dia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function detalleDe(
  tipo: TipoAlerta,
  d: number,
  i: number,
  abierta: number,
): Prisma.InputJsonObject {
  const folio = `H${String(d).padStart(2, '0')}${i}`;
  switch (tipo) {
    case TipoAlerta.mesa_abierta:
      return { folio, mesa: String(1 + ((d * 3 + i) % 20)), minutos: 61 + ((d * 7 + i * 11) % 50) };
    case TipoAlerta.cuenta_sin_imprimir:
      return { folio, mesa: String(1 + ((d + i) % 20)), minutos: 31 + ((d * 5 + i) % 25) };
    case TipoAlerta.sucursal_sin_reporte:
      return { nunca: false, edadSegundos: 660 + d * 60 };
    case TipoAlerta.caida_venta: {
      // Texto decimal, nunca float: base y hoy en centavos enteros.
      const base = 800_000 + d * 12_345;
      const hoy = Math.floor((base * (60 - (d % 10))) / 100);
      const pct = new Prisma.Decimal(base - hoy)
        .mul(100)
        .div(base)
        .toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
      return {
        dia: dia(abierta),
        ventaHoy: new Prisma.Decimal(hoy).div(100).toFixed(2),
        ventaBase: new Prisma.Decimal(base).div(100).toFixed(2),
        cuentasBase: 20 + (d % 7),
        caidaPct: pct,
      };
    }
  }
}

function llaveDe(tipo: TipoAlerta, detalle: Prisma.InputJsonObject): string {
  if (tipo === TipoAlerta.sucursal_sin_reporte) return '';
  if (tipo === TipoAlerta.caida_venta) return String(detalle.dia);
  return String(detalle.folio);
}

const UMBRAL: Record<TipoAlerta, number> = {
  sucursal_sin_reporte: 10,
  mesa_abierta: 60,
  cuenta_sin_imprimir: 30,
  caida_venta: 30,
};

export function generarAlertasSeed(op: OpcionesAlertas): AlertaSeed[] {
  const ahora = op.ahora.getTime();
  if (Number.isNaN(ahora)) throw new Error('ahora inválido');
  const hoy = Math.floor(ahora / MS_DIA) * MS_DIA;
  const filas: AlertaSeed[] = [];
  op.sucursales.forEach((sucursalId, s) => {
    for (let d = 1; d <= DIAS_HISTORIA; d++) {
      const inicioDia = hoy - d * MS_DIA;
      const cuantas = 1 + ((d + s) % 3);
      for (let i = 0; i < cuantas; i++) {
        const tipo = TIPOS[(d + i + s) % TIPOS.length];
        // Entre las 16:00 y las 23:xx UTC (mediodía y noche en México).
        const abierta = inicioDia + (16 * 60 + ((d * 37 + i * 101 + s * 53) % 420)) * MS_MIN;
        const detalle = detalleDe(tipo, d, i, abierta);
        const dura = (tipo === TipoAlerta.caida_venta ? 90 : 12) + ((d * 13 + i * 7) % 40);
        filas.push({
          id: uuidDe(`alerta-seed:${op.empresaId}:${sucursalId}:${d}:${i}`),
          empresaId: op.empresaId,
          sucursalId,
          tipo,
          severidad:
            tipo === TipoAlerta.sucursal_sin_reporte
              ? SeveridadAlerta.critica
              : SeveridadAlerta.advertencia,
          llave: llaveDe(tipo, detalle),
          umbral: UMBRAL[tipo],
          detalle,
          abiertaAt: new Date(abierta),
          cerradaAt: new Date(abierta + dura * MS_MIN),
          motivoCierre: MotivoCierreAlerta.condicion,
        });
      }
    }
  });
  return filas;
}

export async function sembrarAlertas(prisma: PrismaClient, op: OpcionesAlertas): Promise<number> {
  const filas = generarAlertasSeed(op);
  await prisma.$transaction(async (tx) => {
    for (const f of filas) {
      const datos = { ...f, llaveAbierta: null };
      await tx.alerta.upsert({ where: { id: f.id }, create: datos, update: datos });
    }
  });
  return filas.length;
}

async function main(): Promise<void> {
  cargarEnvLocal();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'El seed de alertas es de desarrollo y se niega a correr con NODE_ENV=production.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const sucursales = [SEED_IDS.sucursalCentro, SEED_IDS.sucursalNorte] as const;
    const guardadas = await prisma.sucursal.count({
      where: { id: { in: [...sucursales] }, empresaId: SEED_IDS.empresaDemo },
    });
    if (guardadas !== sucursales.length) {
      throw new Error('Faltan las sucursales demo: corre primero `npx prisma db seed`.');
    }
    const n = await sembrarAlertas(prisma, {
      empresaId: SEED_IDS.empresaDemo,
      sucursales,
      ahora: new Date(),
    });
    console.log(
      `Seed de alertas aplicado: ${n} alertas cerradas de los últimos ${DIAS_HISTORIA} días. ` +
        'Las abiertas las abre el API al arrancar.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
