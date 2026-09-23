import type { PrismaClient } from '@prisma/client';

import { diaFolios, vigenciaDeCompra, ZONA_FOLIOS } from '../src/facturacion/folios';

/**
 * Los paquetes de folios del seed (F2-110), para que Facturación → Folios tenga qué mostrar: un
 * paquete VENCIDO (con consumo histórico), uno POR VENCER (le quedan folios y vence en ≤ 30 días:
 * dispara el aviso de vigencia en demo) y uno ACTUAL grande (la emisión en desarrollo sigue
 * funcionando). Todo relativo al `ahora` del seed, con ids FIJOS: correrlo dos veces deja lo mismo.
 *
 * El seed PRENDE el control de folios (`control_activo`) a propósito: con paquetes y el control
 * apagado la demo mentiría ("sin control") y no se vería el saldo. El umbral no se toca (es
 * configuración del administrador).
 *
 * El saldo es de la PLATAFORMA: estos paquetes cubren todos los CFDI de la base (los del seed y los
 * que se emitan en desarrollo), no sólo los de la empresa demo.
 */

export const IDS_PAQUETES_SEED = {
  vencido: '5eed0110-0000-4000-8000-000000000001',
  porVencer: '5eed0110-0000-4000-8000-000000000002',
  actual: '5eed0110-0000-4000-8000-000000000003',
} as const;

/** Días antes de "hoy" (en la zona de los folios) en que se compró cada paquete, y su tamaño. */
export const PAQUETES_SEED = [
  { id: IDS_PAQUETES_SEED.vencido, diasAtras: 395, cantidad: 300, nota: 'Paquete anterior (demo)' },
  // Vence en ~20 días. Tiene que ser mayor que los CFDI del seed que le tocan por FIFO (~255 en 90
  // días) para que le quede restante y dispare el aviso.
  {
    id: IDS_PAQUETES_SEED.porVencer,
    diasAtras: 345,
    cantidad: 400,
    nota: 'Paquete por vencer (demo)',
  },
  { id: IDS_PAQUETES_SEED.actual, diasAtras: 75, cantidad: 5000, nota: 'Paquete vigente (demo)' },
] as const;

export interface PaqueteSeed {
  id: string;
  cantidad: number;
  compradoAt: Date;
  venceAt: Date;
  nota: string;
}

/** PURO y determinista: los paquetes del seed para un `ahora` dado. */
export function generarPaquetesSeed(ahora: Date): PaqueteSeed[] {
  const hoy = diaFolios(ahora);
  return PAQUETES_SEED.map((p) => {
    const [a, m, d] = hoy.split('-').map(Number);
    const dia = new Date(Date.UTC(a, m - 1, d - p.diasAtras)).toISOString().slice(0, 10);
    const vigencia = vigenciaDeCompra(dia);
    if (!vigencia) throw new Error(`Fecha de compra inválida en el seed de folios: ${dia}`);
    return { id: p.id, cantidad: p.cantidad, nota: p.nota, ...vigencia };
  });
}

export async function sembrarFolios(
  prisma: PrismaClient,
  op: { ahora: Date },
): Promise<{ paquetes: number; zona: string }> {
  const paquetes = generarPaquetesSeed(op.ahora);
  for (const p of paquetes) {
    const datos = {
      cantidad: p.cantidad,
      compradoAt: p.compradoAt,
      venceAt: p.venceAt,
      nota: p.nota,
      avisoVigenciaAt: null,
    };
    await prisma.paqueteFolios.upsert({
      where: { id: p.id },
      create: { id: p.id, ...datos, createdAt: op.ahora },
      update: datos,
    });
  }
  await prisma.configuracionFolios.upsert({
    where: { id: 1 },
    create: { id: 1, controlActivo: true, updatedAt: op.ahora },
    update: { controlActivo: true },
  });
  return { paquetes: paquetes.length, zona: ZONA_FOLIOS };
}
