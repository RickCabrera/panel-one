import { Prisma } from '@prisma/client';

import {
  anioPermitido,
  enrollarPeriodos,
  estadoPeriodo,
  formaPagoGlobal,
  importesGlobal,
  inicioDePeriodo,
  mensajeEnGlobal,
  periodoDe,
  periodoDeClave,
  periodoGuardado,
  receptorPublicoGeneral,
  solicitudGlobal,
} from './global';
import type { FormaPagoEnum } from './cfdi';

// Reglas puras de la factura global (F2-108). Cifras e instantes ESCRITOS A MANO.
// CDMX es UTC−6 todo el año; Tijuana es UTC−7 en septiembre (horario de verano).

const D = (v: string) => new Prisma.Decimal(v);
const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';

describe('periodos de la global', () => {
  it('mensual: el mes local, con InformacionGlobal 04 / mes / año', () => {
    const p = periodoDeClave('2026-09-01', CDMX, 'mensual')!;
    expect(p.desde.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-10-01T06:00:00.000Z');
    expect(p.ultimoDia).toBe('2026-09-30');
    expect(p.informacion).toEqual({ periodicidad: '04', meses: '09', anio: 2026 });
    expect(p.etiqueta).toBe('septiembre de 2026');
  });

  it('diaria: el día local', () => {
    const p = periodoDeClave('2026-09-23', CDMX, 'diaria')!;
    expect(p.desde.toISOString()).toBe('2026-09-23T06:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-09-24T06:00:00.000Z');
    expect(p.informacion).toEqual({ periodicidad: '01', meses: '09', anio: 2026 });
    expect(p.etiqueta).toBe('23 de septiembre de 2026');
  });

  it('semanal: lunes a domingo, CORTADA en el cambio de mes (cada pedazo con su Meses)', () => {
    // El lunes 31 de agosto de 2026 queda solo: el 1 de septiembre (martes) empieza otro periodo.
    expect(inicioDePeriodo('2026-08-31', 'semanal')).toBe('2026-08-31');
    expect(inicioDePeriodo('2026-09-01', 'semanal')).toBe('2026-09-01');
    expect(inicioDePeriodo('2026-09-06', 'semanal')).toBe('2026-09-01');
    expect(inicioDePeriodo('2026-09-10', 'semanal')).toBe('2026-09-07');
    const agosto = periodoDeClave('2026-08-31', CDMX, 'semanal')!;
    expect(agosto.ultimoDia).toBe('2026-08-31');
    expect(agosto.informacion).toEqual({ periodicidad: '02', meses: '08', anio: 2026 });
    expect(agosto.etiqueta).toBe('31 de agosto de 2026');
    const inicio = periodoDeClave('2026-09-01', CDMX, 'semanal')!;
    expect(inicio.ultimoDia).toBe('2026-09-06');
    expect(inicio.hasta.toISOString()).toBe('2026-09-07T06:00:00.000Z');
    expect(inicio.informacion.meses).toBe('09');
    expect(inicio.etiqueta).toBe('del 1 al 6 de septiembre de 2026');
    expect(periodoDeClave('2026-09-07', CDMX, 'semanal')!.etiqueta).toBe(
      'del 7 al 13 de septiembre de 2026',
    );
  });

  it('una clave que no es inicio de periodo (o no es fecha) no es periodo', () => {
    expect(periodoDeClave('2026-09-02', CDMX, 'mensual')).toBeNull();
    expect(periodoDeClave('2026-09-08', CDMX, 'semanal')).toBeNull();
    expect(periodoDeClave('2026-02-30', CDMX, 'diaria')).toBeNull();
    expect(periodoDeClave('2026-9-01', CDMX, 'mensual')).toBeNull();
    expect(periodoDeClave('2026-09-01', 'Zona/Inventada', 'mensual')).toBeNull();
  });

  it('se corta en la zona de la SUCURSAL, no en la del servidor', () => {
    // 2026-09-01 06:30 UTC = 00:30 del 1 de sept en CDMX, pero 23:30 del 31 de agosto en Tijuana.
    const instante = new Date('2026-09-01T06:30:00.000Z');
    expect(periodoDe(instante, CDMX, 'mensual').clave).toBe('2026-09-01');
    expect(periodoDe(instante, TIJUANA, 'mensual').clave).toBe('2026-08-01');
    expect(periodoDe(instante, TIJUANA, 'mensual').hasta.toISOString()).toBe(
      '2026-09-01T07:00:00.000Z',
    );
    // 31 de diciembre 23:30 en CDMX: es del año que termina.
    const finDeAnio = periodoDe(new Date('2027-01-01T05:30:00.000Z'), CDMX, 'diaria');
    expect(finDeAnio.clave).toBe('2026-12-31');
    expect(finDeAnio.informacion).toEqual({ periodicidad: '01', meses: '12', anio: 2026 });
  });

  it('periodoGuardado reconstruye el periodo de una global emitida', () => {
    const p = periodoGuardado(
      { globalPeriodicidad: '04', globalDesde: new Date('2026-08-01T06:00:00.000Z') },
      CDMX,
    )!;
    expect(p.etiqueta).toBe('agosto de 2026');
    expect(periodoGuardado({ globalPeriodicidad: null, globalDesde: null }, CDMX)).toBeNull();
    expect(periodoGuardado({ globalPeriodicidad: '99', globalDesde: new Date() }, CDMX)).toBeNull();
  });

  it('el SAT acepta el año en curso o el anterior (en la zona de la sucursal)', () => {
    const ahora = new Date('2026-09-23T18:00:00.000Z');
    expect(anioPermitido(periodoDeClave('2026-08-01', CDMX, 'mensual')!, ahora, CDMX)).toBe(true);
    expect(anioPermitido(periodoDeClave('2025-01-01', CDMX, 'mensual')!, ahora, CDMX)).toBe(true);
    expect(anioPermitido(periodoDeClave('2024-12-01', CDMX, 'mensual')!, ahora, CDMX)).toBe(false);
    // 1 de enero 00:30 en CDMX ya es 2027: diciembre de 2025 queda fuera.
    const enero = new Date('2027-01-01T06:30:00.000Z');
    expect(anioPermitido(periodoDeClave('2025-12-01', CDMX, 'mensual')!, enero, CDMX)).toBe(false);
    expect(anioPermitido(periodoDeClave('2026-12-01', CDMX, 'mensual')!, enero, CDMX)).toBe(true);
  });

  it('estado del periodo: en curso, esperando, lista, fuera de plazo', () => {
    const agosto = periodoDeClave('2026-08-01', CDMX, 'mensual')!;
    // Un instante antes del fin (exclusivo) sigue en curso.
    const antes = new Date(agosto.hasta.getTime() - 1);
    expect(estadoPeriodo(agosto, { nListos: 5, nVigentes: 0 }, antes, CDMX)).toBe('en_curso');
    expect(estadoPeriodo(agosto, { nListos: 5, nVigentes: 1 }, agosto.hasta, CDMX)).toBe(
      'esperando',
    );
    expect(estadoPeriodo(agosto, { nListos: 5, nVigentes: 0 }, agosto.hasta, CDMX)).toBe('lista');
    const viejo = periodoDeClave('2024-08-01', CDMX, 'mensual')!;
    expect(estadoPeriodo(viejo, { nListos: 5, nVigentes: 0 }, agosto.hasta, CDMX)).toBe(
      'fuera_de_plazo',
    );
  });

  it('enrolla los días en periodos (más reciente primero) y marca la complementaria', () => {
    const ahora = new Date('2026-09-23T18:00:00.000Z');
    const r = enrollarPeriodos(
      [
        {
          dia: '2026-08-31',
          nListos: 2,
          totalListos: D('20.50'),
          nVigentes: 0,
          vigentesHasta: null,
        },
        {
          dia: '2026-09-01',
          nListos: 1,
          totalListos: D('10.00'),
          nVigentes: 0,
          vigentesHasta: null,
        },
        {
          dia: '2026-09-05',
          nListos: 3,
          totalListos: D('30.25'),
          nVigentes: 1,
          vigentesHasta: new Date('2026-10-01T06:00:00.000Z'),
        },
        {
          dia: '2026-09-07',
          nListos: 4,
          totalListos: D('1.00'),
          nVigentes: 0,
          vigentesHasta: null,
        },
      ],
      CDMX,
      'semanal',
      ahora,
      new Map([['2026-08-31', 1]]),
    );
    expect(
      r.map((p) => [
        p.periodo.clave,
        p.estado,
        p.nListos,
        p.totalListos.toFixed(2),
        p.nVigentes,
        p.globalesPrevias,
      ]),
    ).toEqual([
      ['2026-09-07', 'lista', 4, '1.00', 0, 0],
      ['2026-09-01', 'esperando', 4, '40.25', 1, 0],
      ['2026-08-31', 'lista', 2, '20.50', 0, 1],
    ]);
    expect(r[1].vigentesHasta?.toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });
});

describe('importes y solicitud de la global', () => {
  // 116.00 → 100.00 + 16.00; 58.00 → 50.00 + 8.00; 100.01 → 86.22 + 13.79.
  const tickets = [
    { folio: '000101', total: D('116.00') },
    { folio: '000102', total: D('58.00') },
    { folio: '000103', total: D('100.01') },
  ];

  it('suma lo de cada ticket al centavo', () => {
    const i = importesGlobal(tickets);
    expect([i.subtotal.toFixed(2), i.iva.toFixed(2), i.total.toFixed(2)]).toEqual([
      '236.22',
      '37.79',
      '274.01',
    ]);
    expect(() => importesGlobal([])).toThrow();
  });

  it('público en general, un concepto por ticket (01010101, ACT) e InformacionGlobal', () => {
    const s = solicitudGlobal({
      reservaId: 'reserva-1',
      serie: 'A',
      folio: 120,
      fecha: new Date('2026-09-01T08:00:00.000Z'),
      emisor: { rfc: 'EKU9003173C9', razonSocial: 'DEMO SA', regimenFiscal: '601', cp: '06600' },
      sucursal: { zonaHoraria: CDMX },
      informacion: { periodicidad: '04', meses: '08', anio: 2026 },
      tickets,
      formaPago: '01',
    });
    expect(s.referencia).toBe('reserva-1');
    expect(s.receptor).toEqual({
      rfc: 'XAXX010101000',
      nombre: 'PUBLICO EN GENERAL',
      usoCfdi: 'S01',
      regimenFiscal: '616',
      domicilioFiscal: '06600',
    });
    expect(s.lugarExpedicion).toBe('06600');
    expect(s.informacionGlobal).toEqual({ periodicidad: '04', meses: '08', anio: 2026 });
    expect(s.metodoPago).toBe('PUE');
    expect(
      s.conceptos.map((c) => [
        c.claveProdServ,
        c.claveUnidad,
        c.descripcion,
        c.noIdentificacion,
        c.importe.toFixed(2),
        c.iva!.importe.toFixed(2),
      ]),
    ).toEqual([
      ['01010101', 'ACT', 'Venta', '000101', '100.00', '16.00'],
      ['01010101', 'ACT', 'Venta', '000102', '50.00', '8.00'],
      ['01010101', 'ACT', 'Venta', '000103', '86.22', '13.79'],
    ]);
    expect([
      s.subtotal.toFixed(2),
      s.totalImpuestosTrasladados.toFixed(2),
      s.total.toFixed(2),
    ]).toEqual(['236.22', '37.79', '274.01']);
  });

  it('el receptor que se guarda no lleva correo (a nadie se le envía)', () => {
    expect(receptorPublicoGeneral('06600')).toEqual({
      rfc: 'XAXX010101000',
      razonSocial: 'PUBLICO EN GENERAL',
      regimenFiscal: '616',
      cp: '06600',
      usoCfdi: 'S01',
      email: null,
    });
  });
});

describe('forma de pago de la global', () => {
  const catalogo = new Map<string, FormaPagoEnum>([
    ['EFECTIVO', 'efectivo'],
    ['VISA', 'tarjeta'],
    ['SPEI', 'transferencia'],
    ['VALES', 'otro'],
  ]);

  it('la de MAYOR monto sumado entre todos los pagos; `otro` no cuenta', () => {
    expect(
      formaPagoGlobal(
        [
          { formaRaw: 'EFECTIVO', monto: D('100.00') },
          { formaRaw: 'VISA', monto: D('80.00') },
          { formaRaw: 'VISA', monto: D('70.00') },
          { formaRaw: 'VALES', monto: D('500.00') },
        ],
        catalogo,
      ),
    ).toBe('04');
    // Empate: el orden del ENUM (efectivo primero).
    expect(
      formaPagoGlobal(
        [
          { formaRaw: 'SPEI', monto: D('50.00') },
          { formaRaw: 'EFECTIVO', monto: D('50.00') },
        ],
        catalogo,
      ),
    ).toBe('01');
  });

  it('sin ningún pago con clave SAT, null (no se emite)', () => {
    expect(formaPagoGlobal([{ formaRaw: 'VALES', monto: D('10.00') }], catalogo)).toBeNull();
    expect(formaPagoGlobal([{ formaRaw: 'DESCONOCIDA', monto: D('10.00') }], catalogo)).toBeNull();
    expect(formaPagoGlobal([], catalogo)).toBeNull();
  });
});

describe('mensaje público', () => {
  it('dice el periodo', () => {
    expect(mensajeEnGlobal('agosto de 2026')).toBe(
      'Este ticket se incluyó en la factura global del periodo agosto de 2026 y ya no se puede ' +
        'facturar aquí. Si necesitas aclararlo, contacta al restaurante.',
    );
  });
});
