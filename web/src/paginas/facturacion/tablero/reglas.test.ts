import { describe, expect, it } from 'vitest';

import type {
  CfdiFila,
  ResumenConciliacion,
  Sucursal,
  TableroFacturacion,
} from '../../../api/tipos';
import { BOM, ErrorCsv } from '../../../csv/csv';
import {
  aDiezmilesimas,
  cfdisACsv,
  ENCABEZADOS_CSV,
  etiquetaMes,
  motivoSinFacturas,
  puntosHora,
  puntosPorcentuales,
  tasaTexto,
  textoConciliacion,
} from './reglas';

// Reglas puras del tablero de facturación (F2-106).

const TABLERO: TableroFacturacion = {
  ventas: { venta: '3406.78', cuentas: 9 },
  facturado: { monto: '2350.00', cfdis: 4 },
  global: { monto: '0.00', cfdis: 0 },
  cancelados: { monto: '250.00', cfdis: 1 },
  tasa: '0.6898',
  porFacturar: { cuentas: 2, monto: '273.45' },
  porSucursal: [],
  porMes: [{ mes: '2026-09', facturado: '2350.00', cfdis: 4 }],
  porHora: Array.from({ length: 24 }, (_, hora) => ({
    hora,
    facturado: hora === 14 ? '1050.00' : '0.00',
    cfdis: hora === 14 ? 2 : 0,
  })),
};

describe('tasa', () => {
  it('diezmilésimas exactas desde el texto del api', () => {
    expect(aDiezmilesimas('0.6898')).toBe(6898n);
    expect(aDiezmilesimas('1.5')).toBe(15000n);
    expect(aDiezmilesimas('-0.0125')).toBe(-125n);
    expect(aDiezmilesimas('0.12345')).toBeNull();
    expect(aDiezmilesimas('abc')).toBeNull();
  });

  it('porcentaje con 2 decimales sin float; nula = null; ilegible lo dice', () => {
    expect(tasaTexto('0.6898')).toBe('68.98 %');
    expect(tasaTexto('0.0001')).toBe('0.01 %');
    expect(tasaTexto('1.2500')).toBe('125.00 %');
    expect(tasaTexto(null)).toBeNull();
    expect(tasaTexto('x')).toBe('Tasa inválida');
    expect(puntosPorcentuales(-125n)).toBe('-1.25');
  });
});

describe('gráficas', () => {
  it('meses legibles y las 24 horas con su texto exacto', () => {
    expect(etiquetaMes('2026-09')).toBe('sep 2026');
    const horas = puntosHora(TABLERO);
    expect(horas).toHaveLength(24);
    expect(horas[14]).toEqual({ etiqueta: '14:00', valor: 1050, texto: '1050.00', cfdis: 2 });
  });
});

describe('motivoSinFacturas', () => {
  it('con CFDI no hay motivo; sin ventas lo dice; con ventas y sin CFDI dice qué falta', () => {
    expect(motivoSinFacturas(TABLERO)).toBeNull();
    const vacio = {
      ...TABLERO,
      facturado: { monto: '0.00', cfdis: 0 },
      cancelados: { monto: '0.00', cfdis: 0 },
    };
    expect(motivoSinFacturas({ ...vacio, ventas: { venta: '0.00', cuentas: 0 } })).toContain(
      'No hay ventas en este periodo',
    );
    expect(motivoSinFacturas(vacio)).toContain('datos fiscales y un CSD vigente');
    // Sólo cancelados también es "hay facturas": no se esconde lo que pasó.
    expect(motivoSinFacturas({ ...vacio, cancelados: { monto: '10.00', cfdis: 1 } })).toBeNull();
    // F2-108: sólo una factura global también es "hay facturas".
    expect(motivoSinFacturas({ ...vacio, global: { monto: '10.00', cfdis: 1 } })).toBeNull();
  });
});

describe('cfdisACsv', () => {
  const CDMX: Sucursal = {
    id: 's1',
    empresaId: 'e1',
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    activo: true,
  };
  const cfdi = (c: Partial<CfdiFila> = {}): CfdiFila => ({
    id: 'c1',
    uuid: '5FB2822E-396D-4725-8521-CDC4BDD20CCF',
    serieFolio: 'A-105',
    sucursalId: 's1',
    sucursal: 'Centro',
    receptorRfc: 'EKU9003173C9',
    receptorNombre: 'ESCUELA KEMPER URGATE',
    total: '500.00',
    estado: 'vigente',
    // 30/09 20:00 en CDMX: en UTC ya es octubre; el CSV va en la zona de la sucursal.
    emitidoAt: '2026-10-01T02:00:00.000Z',
    folioTicket: '000123',
    xml: true,
    pdf: true,
    origen: 'ticket',
    receptor: {
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '42501',
      usoCfdi: 'G03',
      email: 'kemper@ejemplo.test',
    },
    sustituyeA: null,
    sustituidoPor: null,
    sustitucionPendiente: false,
    motivoCancelacion: null,
    cancelacion: null,
    ...c,
  });

  it('BOM, encabezado, fecha y hora LOCALES, folios como texto, receptor anti-fórmula', () => {
    const csv = cfdisACsv(
      [cfdi(), cfdi({ estado: 'cancelado', receptorNombre: '=HYPERLINK("x")', folioTicket: null })],
      new Map([['s1', CDMX]]),
    );
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(BOM.length).split('\r\n')).toEqual([
      ENCABEZADOS_CSV.join(','),
      '5FB2822E-396D-4725-8521-CDC4BDD20CCF,"=""A-105""",Centro,2026-09-30,20:00,EKU9003173C9,ESCUELA KEMPER URGATE,500.00,Vigente,"=""000123"""',
      '5FB2822E-396D-4725-8521-CDC4BDD20CCF,"=""A-105""",Centro,2026-09-30,20:00,EKU9003173C9,"\'=HYPERLINK(""x"")",500.00,Cancelada,',
      '',
    ]);
  });

  it('sin la sucursal (sin zona) o con un total ilegible, no hay archivo', () => {
    expect(() => cfdisACsv([cfdi()], new Map())).toThrow(ErrorCsv);
    expect(() => cfdisACsv([cfdi({ total: 'abc' })], new Map([['s1', CDMX]]))).toThrow(
      /total inválido/,
    );
  });
});

describe('textoConciliacion (F2-110b)', () => {
  const vacio: ResumenConciliacion = {
    reservas: { revisadas: 0, confirmadas: 0, liberadas: 0, enEspera: 0 },
    cancelaciones: { revisadas: 0, canceladas: 0, descartadas: 0 },
    sustituciones: { revisadas: 0, cerradas: 0 },
    archivos: { revisados: 0, recuperados: 0 },
    fallidas: 0,
    requierenRevision: [],
  };

  it('sin nada pendiente lo dice, no una lista de ceros', () => {
    expect(textoConciliacion(vacio)).toEqual([
      expect.stringMatching(/^No había nada pendiente con el PAC/),
    ]);
  });

  it('una frase por cada cosa que pasó, en singular y plural', () => {
    const frases = textoConciliacion({
      reservas: { revisadas: 4, confirmadas: 1, liberadas: 2, enEspera: 1 },
      cancelaciones: { revisadas: 2, canceladas: 2, descartadas: 0 },
      sustituciones: { revisadas: 1, cerradas: 1 },
      archivos: { revisados: 1, recuperados: 1 },
      fallidas: 3,
      requierenRevision: ['A-1', 'A-7'],
    });
    expect(frases).toEqual([
      '1 factura que el PAC sí timbró quedó confirmada y se entregó.',
      '2 emisiones que el PAC nunca timbró se liberaron: sus tickets se pueden volver a facturar.',
      '1 emisión no aparece en el PAC todavía: se vuelve a buscar en 15 minutos antes de liberarla.',
      '2 cancelaciones que el PAC registró tarde quedaron anotadas.',
      '1 refacturación terminó: la factura anterior quedó cancelada con motivo 01.',
      '1 factura recuperó su XML y PDF del PAC.',
      '3 casos no se pudieron resolver (el PAC falló o no dio una respuesta clara): se reintentan solos.',
      'Revisar a mano en el PAC: A-1, A-7 (confirmadas, pero el PAC ya las reporta canceladas).',
    ]);
  });

  it('revisar casos que siguen igual NO es "nada pendiente": dice que siguen pendientes', () => {
    const r = structuredClone(vacio);
    r.cancelaciones.revisadas = 3;
    expect(textoConciliacion(r)).toEqual([
      'Se revisaron 3 casos con el PAC y todavía no cambia nada: se vuelve a revisar solo.',
    ]);
    r.cancelaciones.revisadas = 1;
    expect(textoConciliacion(r)[0]).toMatch(/^Se revisó 1 caso con el PAC/);
  });
});
