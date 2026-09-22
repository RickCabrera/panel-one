import { Prisma } from '@prisma/client';

import type { SolicitudCfdi } from '../src/adaptadores/timbrado/puerto';

const D = (v: string) => new Prisma.Decimal(v);

/**
 * Solicitud de CFDI SINTÉTICA para los tests de F2-202. El RFC del emisor es el de
 * pruebas que publica el SAT (EKU9003173C9); el receptor es inventado. Nada de un
 * cliente real.
 */
export function solicitudCfdi(cambios: Partial<SolicitudCfdi> = {}): SolicitudCfdi {
  return {
    referencia: 'cheque-00000000-0000-4000-8000-000000000001',
    serie: 'A',
    folio: '1024',
    // 2026-09-21 20:15:30 en CDMX (UTC-6).
    fecha: new Date('2026-09-22T02:15:30.000Z'),
    zonaHoraria: 'America/Mexico_City',
    formaPago: '04',
    metodoPago: 'PUE',
    moneda: 'MXN',
    lugarExpedicion: '06700',
    emisor: { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', regimenFiscal: '601' },
    receptor: {
      rfc: 'XOJI740919U48',
      nombre: 'Cliente "de prueba" & <Hijos>',
      usoCfdi: 'G03',
      regimenFiscal: '612',
      domicilioFiscal: '76028',
    },
    conceptos: [
      {
        claveProdServ: '90101500',
        noIdentificacion: 'P001',
        cantidad: D('2'),
        claveUnidad: 'E48',
        unidad: 'Servicio',
        descripcion: 'Tacos al pastor (orden)',
        valorUnitario: D('86.21'),
        importe: D('172.42'),
        objetoImp: '02',
        iva: { base: D('172.42'), tasa: D('0.16'), importe: D('27.59') },
      },
      {
        claveProdServ: '90101500',
        noIdentificacion: 'P020',
        cantidad: D('1'),
        claveUnidad: 'H87',
        unidad: 'Pieza',
        descripcion: 'Refresco',
        valorUnitario: D('30.17'),
        importe: D('30.17'),
        objetoImp: '02',
        iva: { base: D('30.17'), tasa: D('0.16'), importe: D('4.83') },
      },
    ],
    subtotal: D('202.59'),
    totalImpuestosTrasladados: D('32.42'),
    total: D('235.01'),
    ...cambios,
  };
}

/** Reloj fijo para los adaptadores: 2026-09-22T02:20:00Z. */
export const RELOJ_FIJO = { ahora: () => Date.parse('2026-09-22T02:20:00.000Z') };
