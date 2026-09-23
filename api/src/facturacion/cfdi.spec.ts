import { Prisma } from '@prisma/client';

import { RFC_CON_ERROR } from '../adaptadores/timbrado/timbrado-falso';
import {
  CONCEPTO_CONSUMO,
  formaDominante,
  formaPagoSat,
  importesDeTotal,
  solicitudDeConsumo,
  solicitudDesdeCheque,
  totalManual,
  type FormaPagoEnum,
} from './cfdi';
import { esRfcValidoSat, RFC_GENERICOS } from './sat';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('importesDeTotal() (F2-104)', () => {
  it('315.50 → subtotal 271.98 + IVA 43.52', () => {
    const { subtotal, iva, total } = importesDeTotal(D('315.50'));
    expect([subtotal.toFixed(2), iva.toFixed(2), total.toFixed(2)]).toEqual([
      '271.98',
      '43.52',
      '315.50',
    ]);
  });

  it('un total en cero o negativo no se factura', () => {
    expect(() => importesDeTotal(D(0))).toThrow();
    expect(() => importesDeTotal(D('-1'))).toThrow();
  });

  /**
   * El SAT valida el traslado contra la base, no contra el total (Anexo 20, CFDI 4.0):
   *   inferior = (Base − 0.005) × Tasa truncado a 2 decimales
   *   superior = (Base + 0.005 − 10⁻¹²) × Tasa redondeado hacia arriba a 2 decimales
   * Se calcula aquí en CENTAVOS ENTEROS (BigInt), sin la fórmula que se prueba: todo total de
   * $0.01 a $2,000.00 cuadra al centavo Y cae dentro de los límites.
   */
  it('todos los centavos de 0.01 a 2000.00: suman el total y el IVA cae en los límites del SAT', () => {
    const fuera: string[] = [];
    for (let c = 1; c <= 200_000; c++) {
      const { subtotal, iva, total } = importesDeTotal(D(c).div(100));
      const base = BigInt(subtotal.mul(100).toFixed(0));
      const imp = BigInt(iva.mul(100).toFixed(0));
      if (base + imp !== BigInt(c) || total.mul(100).toFixed(0) !== String(c)) {
        fuera.push(`${c}: no suma`);
        continue;
      }
      // En unidades de 10⁻⁶ de peso: (base·10⁴ − 5000)·16 / 100 … con la tasa 0.16 = 16/100.
      const baseMicro = base * 10_000n; // centavos → 10⁻⁶
      const infMicro = ((baseMicro - 5_000n) * 16n) / 100n;
      const supMicro = ((baseMicro + 5_000n) * 16n) / 100n; // el −10⁻¹² sólo importa en empates
      const inf = infMicro / 10_000n; // truncado a centavos
      const sup = (supMicro + 9_999n) / 10_000n; // hacia arriba a centavos
      if (imp < inf || imp > sup) fuera.push(`${c}: iva ${imp} fuera de [${inf}, ${sup}]`);
    }
    expect(fuera).toEqual([]);
  });
});

describe('forma de pago (F2-104)', () => {
  const catalogo = new Map<string, FormaPagoEnum>([
    ['EFECTIVO', 'efectivo'],
    ['TARJETA DE CREDITO', 'tarjeta'],
    ['SPEI', 'transferencia'],
  ]);
  const pago = (formaRaw: string, monto: string) => ({ formaRaw, monto: D(monto) });

  it('la dominante es la de mayor monto SUMADO por forma', () => {
    expect(
      formaDominante(
        [
          pago('EFECTIVO', '100'),
          pago('TARJETA DE CREDITO', '80'),
          pago('TARJETA DE CREDITO', '30'),
        ],
        catalogo,
      ),
    ).toBe('tarjeta');
  });

  it('empate: gana el orden del ENUM (efectivo > tarjeta > transferencia)', () => {
    expect(formaDominante([pago('SPEI', '50'), pago('TARJETA DE CREDITO', '50')], catalogo)).toBe(
      'tarjeta',
    );
    expect(
      formaDominante([pago('TARJETA DE CREDITO', '50'), pago('EFECTIVO', '50')], catalogo),
    ).toBe('efectivo');
  });

  it('claves del SAT: efectivo 01, tarjeta 04, transferencia 03', () => {
    expect(formaPagoSat([pago('EFECTIVO', '1')], catalogo)).toBe('01');
    expect(formaPagoSat([pago('TARJETA DE CREDITO', '1')], catalogo)).toBe('04');
    expect(formaPagoSat([pago('SPEI', '1')], catalogo)).toBe('03');
  });

  it('texto sin catálogo cuenta como `otro`, y `otro` dominante NO se factura en línea', () => {
    expect(formaDominante([pago('VALES DESPENSA', '100')], catalogo)).toBe('otro');
    expect(
      formaPagoSat([pago('VALES DESPENSA', '100'), pago('EFECTIVO', '20')], catalogo),
    ).toBeNull();
  });

  it('pero un `otro` menor no estorba: manda la dominante', () => {
    expect(formaPagoSat([pago('VALES DESPENSA', '20'), pago('EFECTIVO', '100')], catalogo)).toBe(
      '01',
    );
  });

  it('sin pagos, o sólo en cero: no se factura en línea', () => {
    expect(formaPagoSat([], catalogo)).toBeNull();
    expect(formaPagoSat([pago('EFECTIVO', '0')], catalogo)).toBeNull();
  });
});

describe('solicitudDesdeCheque() (F2-104)', () => {
  const solicitud = solicitudDesdeCheque({
    reservaId: '00000000-0000-4000-8000-0000000000c1',
    serie: 'A',
    folio: 7,
    fecha: new Date('2026-09-22T02:15:30.000Z'),
    emisor: {
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '06700',
    },
    sucursal: { zonaHoraria: 'America/Mexico_City' },
    cheque: { folio: 'T-1024', total: D('315.50') },
    receptor: {
      rfc: 'XOJI740919U48',
      razonSocial: 'CLIENTE SINTETICO',
      regimenFiscal: '612',
      cp: '76028',
      usoCfdi: 'G03',
    },
    formaPago: '01',
  });

  it('un solo concepto de consumo: 90101500, E48, cantidad 1, por el subtotal, IVA 16 %', () => {
    expect(solicitud.conceptos).toHaveLength(1);
    const [c] = solicitud.conceptos;
    expect(c).toMatchObject({ ...CONCEPTO_CONSUMO, noIdentificacion: 'T-1024', objetoImp: '02' });
    expect(c.cantidad.toString()).toBe('1');
    expect(c.valorUnitario.toFixed(2)).toBe('271.98');
    expect(c.importe.toFixed(2)).toBe('271.98');
    expect(c.iva!.base.toFixed(2)).toBe('271.98');
    expect(c.iva!.tasa.toFixed(2)).toBe('0.16');
    expect(c.iva!.importe.toFixed(2)).toBe('43.52');
  });

  it('PUE, MXN, lugar de expedición = CP del emisor, serie y folio, referencia = la reserva', () => {
    expect(solicitud).toMatchObject({
      referencia: '00000000-0000-4000-8000-0000000000c1',
      serie: 'A',
      folio: '7',
      metodoPago: 'PUE',
      moneda: 'MXN',
      formaPago: '01',
      lugarExpedicion: '06700',
      zonaHoraria: 'America/Mexico_City',
      emisor: { rfc: 'EKU9003173C9', nombre: 'ESCUELA KEMPER URGATE', regimenFiscal: '601' },
      receptor: {
        rfc: 'XOJI740919U48',
        nombre: 'CLIENTE SINTETICO',
        regimenFiscal: '612',
        domicilioFiscal: '76028',
        usoCfdi: 'G03',
      },
    });
    expect(solicitud.subtotal.add(solicitud.totalImpuestosTrasladados).toFixed(2)).toBe('315.50');
    expect(solicitud.total.toFixed(2)).toBe('315.50');
  });
});

describe('RFC reservados del PAC falso que llegan desde el portal (F2-104)', () => {
  it.each(['XFAL010101NI0', 'XFAL010101NO0', 'XFAL010101CP0', 'XFAL010101RF0'])(
    '%s tiene la forma del SAT y no es genérico (el portal lo deja pasar)',
    (rfc) => {
      expect(RFC_CON_ERROR[rfc]).toBeDefined();
      expect(esRfcValidoSat(rfc)).toBe(true);
      expect(RFC_GENERICOS).not.toContain(rfc);
    },
  );
});

describe('factura sin ticket y sustituto (F2-107)', () => {
  it('totalManual: texto con hasta 2 decimales, > 0 y < 1,000,000; nunca number', () => {
    expect(totalManual('1234.5')?.toFixed(2)).toBe('1234.50');
    expect(totalManual(' 0.01 ')?.toFixed(2)).toBe('0.01');
    expect(totalManual('999999.99')?.toFixed(2)).toBe('999999.99');
    for (const malo of [
      '0',
      '0.00',
      '-5',
      '1.234',
      '1e3',
      '1,000.00',
      '1000000',
      '',
      'abc',
      '.5',
    ]) {
      expect(totalManual(malo)).toBeNull();
    }
  });

  it('solicitudDeConsumo: sin ticket no lleva noIdentificacion; con relacionados, relación 04', () => {
    const base = {
      reservaId: 'r-1',
      serie: 'A',
      folio: 7,
      fecha: new Date('2026-09-21T20:00:00Z'),
      emisor: { rfc: 'EKU9003173C9', razonSocial: 'EKU', regimenFiscal: '601', cp: '06700' },
      sucursal: { zonaHoraria: 'America/Mexico_City' },
      total: new Prisma.Decimal('116.00'),
      receptor: {
        rfc: 'XIA190128J61',
        razonSocial: 'XENON INDUSTRIAL ARTICLES',
        regimenFiscal: '601',
        cp: '76343',
        usoCfdi: 'G03',
      },
      formaPago: '01',
    };
    const manual = solicitudDeConsumo(base);
    expect(manual.conceptos[0]).not.toHaveProperty('noIdentificacion');
    expect(manual.relacionados).toBeUndefined();
    expect(manual.subtotal.toFixed(2)).toBe('100.00');
    expect(manual.totalImpuestosTrasladados.toFixed(2)).toBe('16.00');
    const sustituto = solicitudDeConsumo({
      ...base,
      noIdentificacion: 'T-9',
      relacionados: { tipoRelacion: '04', uuids: ['AAAA'] },
    });
    expect(sustituto.conceptos[0].noIdentificacion).toBe('T-9');
    expect(sustituto.relacionados).toEqual({ tipoRelacion: '04', uuids: ['AAAA'] });
  });
});
