import {
  EstadoSuscripcion,
  MetodoPago,
  PeriodicidadPlan,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { hoyPlataforma, sumarDias, sumarMeses } from '../src/plataforma/membresia';
import { cargarEnvLocal } from '../src/config/cargar-env';
import { SEED_ADMIN_EMAIL, SEED_IDS } from './seed';

/**
 * Seed del panel de plataforma (membresías), de DESARROLLO. Datos sintéticos:
 *
 * - 3 planes: Esencial (1 sucursal), Completo (3) y Cadena (anual, ilimitado).
 * - "Restaurante Demo" (el del seed base) con el plan Completo, `activa`, al corriente, y dos
 *   pagos de ejemplo (uno vigente y uno anulado).
 * - Dos clientes de ejemplo SIN sucursales: "Cafetería Ejemplo" (en prueba) y "Taquería
 *   Ejemplo" (vencida: su vencimiento + gracia ya pasó), para ver los tres estados en la web.
 *
 * Idempotente: upsert por UUID fijo con `update: {}`. Las fechas se calculan desde `hoy` la
 * PRIMERA vez; las corridas siguientes no las mueven (ni pisan lo que se haya cambiado en el
 * panel). Requiere el admin global del seed base (registra los pagos).
 */
export const SEED_PLATAFORMA = {
  planEsencial: '00000000-0000-4000-8000-0000000a0001',
  planCompleto: '00000000-0000-4000-8000-0000000a0002',
  planCadena: '00000000-0000-4000-8000-0000000a0003',
  empresaCafeteria: '00000000-0000-4000-8000-000000000002',
  empresaTaqueria: '00000000-0000-4000-8000-000000000003',
  suscripcionDemo: '00000000-0000-4000-8000-0000000b0001',
  suscripcionCafeteria: '00000000-0000-4000-8000-0000000b0002',
  suscripcionTaqueria: '00000000-0000-4000-8000-0000000b0003',
  pagoDemo: '00000000-0000-4000-8000-0000000c0001',
  pagoDemoAnulado: '00000000-0000-4000-8000-0000000c0002',
} as const;

export async function sembrarPlataforma(
  prisma: Prisma.TransactionClient,
  ahora: Date,
): Promise<void> {
  const admin = await prisma.usuario.findUnique({
    where: { email: SEED_ADMIN_EMAIL.toLowerCase() },
    select: { id: true },
  });
  if (!admin) {
    throw new Error('Falta el admin global del seed: corre primero `npx prisma db seed`.');
  }
  const hoy = hoyPlataforma(ahora.getTime());

  const planes = [
    {
      id: SEED_PLATAFORMA.planEsencial,
      nombre: 'Esencial',
      descripcion: 'Una sucursal: ventas, mesas y alertas.',
      precioMensual: '499.00',
      periodicidad: PeriodicidadPlan.mensual,
      limiteSucursales: 1,
    },
    {
      id: SEED_PLATAFORMA.planCompleto,
      nombre: 'Completo',
      descripcion: 'Hasta 3 sucursales, inventario y facturación.',
      precioMensual: '899.00',
      periodicidad: PeriodicidadPlan.mensual,
      limiteSucursales: 3,
    },
    {
      id: SEED_PLATAFORMA.planCadena,
      nombre: 'Cadena (anual)',
      descripcion: 'Sucursales ilimitadas, pago anual.',
      precioMensual: '749.00',
      periodicidad: PeriodicidadPlan.anual,
      limiteSucursales: null,
    },
  ];
  for (const p of planes) {
    await prisma.plan.upsert({ where: { id: p.id }, create: p, update: {} });
  }

  for (const e of [
    { id: SEED_PLATAFORMA.empresaCafeteria, nombre: 'Cafetería Ejemplo' },
    { id: SEED_PLATAFORMA.empresaTaqueria, nombre: 'Taquería Ejemplo' },
  ]) {
    await prisma.empresa.upsert({
      where: { id: e.id },
      create: {
        ...e,
        contactoNombre: 'Contacto sintético',
        contactoEmail: 'contacto@ejemplo.test',
      },
      update: {},
    });
  }

  const diaCorte = Math.min(hoy.getUTCDate(), 28);
  const corteEsteMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), diaCorte));
  const suscripciones = [
    {
      id: SEED_PLATAFORMA.suscripcionDemo,
      empresaId: SEED_IDS.empresaDemo,
      planId: SEED_PLATAFORMA.planCompleto,
      estado: EstadoSuscripcion.activa,
      inicio: sumarMeses(corteEsteMes, -3),
      // Al corriente: ya pagó la mensualidad de este mes.
      vencimiento: sumarMeses(corteEsteMes, 1),
      diaCorte,
      notas: 'Cliente de ejemplo del seed.',
    },
    {
      id: SEED_PLATAFORMA.suscripcionCafeteria,
      empresaId: SEED_PLATAFORMA.empresaCafeteria,
      planId: SEED_PLATAFORMA.planEsencial,
      estado: EstadoSuscripcion.prueba,
      inicio: hoy,
      vencimiento: sumarDias(hoy, 14),
      diaCorte,
      notas: 'Prueba de 14 días.',
    },
    {
      id: SEED_PLATAFORMA.suscripcionTaqueria,
      empresaId: SEED_PLATAFORMA.empresaTaqueria,
      planId: SEED_PLATAFORMA.planEsencial,
      estado: EstadoSuscripcion.activa,
      inicio: sumarMeses(corteEsteMes, -6),
      // Vencida: un mes atrás, fuera de los 5 días de gracia.
      vencimiento: sumarMeses(corteEsteMes, -1),
      diaCorte,
      notas: null,
    },
  ];
  for (const s of suscripciones) {
    await prisma.suscripcion.upsert({ where: { empresaId: s.empresaId }, create: s, update: {} });
  }

  const demo = await prisma.suscripcion.findUniqueOrThrow({
    where: { empresaId: SEED_IDS.empresaDemo },
    select: { id: true },
  });
  const pagos = [
    {
      id: SEED_PLATAFORMA.pagoDemo,
      fechaPago: corteEsteMes.getTime() > hoy.getTime() ? hoy : corteEsteMes,
      referencia: 'SPEI sintético 0001',
      periodoDesde: corteEsteMes,
      periodoHasta: sumarMeses(corteEsteMes, 1),
      anulado: false,
    },
    {
      id: SEED_PLATAFORMA.pagoDemoAnulado,
      fechaPago: sumarMeses(corteEsteMes, -1),
      referencia: 'Depósito sintético rebotado',
      periodoDesde: sumarMeses(corteEsteMes, -1),
      periodoHasta: corteEsteMes,
      anulado: true,
    },
  ];
  for (const p of pagos) {
    await prisma.pagoSuscripcion.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        empresaId: SEED_IDS.empresaDemo,
        suscripcionId: demo.id,
        monto: '899.00',
        moneda: 'MXN',
        fechaPago: p.fechaPago,
        metodo: MetodoPago.transferencia,
        referencia: p.referencia,
        periodoDesde: p.periodoDesde,
        periodoHasta: p.periodoHasta,
        registradoPorId: admin.id,
        ...(p.anulado
          ? {
              anuladoAt: ahora,
              anuladoPorId: admin.id,
              motivoAnulacion: 'Ejemplo: el pago rebotó.',
            }
          : {}),
      },
      update: {},
    });
  }
}

async function main(): Promise<void> {
  cargarEnvLocal();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'El seed de plataforma es de desarrollo y se niega a correr con NODE_ENV=production.',
    );
  }
  const prisma = new PrismaClient();
  try {
    await sembrarPlataforma(prisma, new Date());
    console.log(
      'Seed de plataforma aplicado: 3 planes, Restaurante Demo (activa, con pagos), ' +
        'Cafetería Ejemplo (prueba) y Taquería Ejemplo (vencida).',
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
