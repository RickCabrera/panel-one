import { ErrorTimbrado } from '../adaptadores/timbrado/puerto';
import {
  conflictoDeMotivo,
  efectoEnTicket,
  MAX_ERROR_CANCELACION,
  MENSAJE_01_SIN_SUSTITUTO,
  MENSAJE_01_SUSTITUTO_AJENO,
  MENSAJE_01_SUSTITUTO_CANCELADO,
  MENSAJE_01_SUSTITUTO_EN_EMISION,
  MENSAJE_04_NO_GLOBAL,
  MENSAJE_ANTERIOR_VIGENTE,
  MENSAJE_CON_SUSTITUTO,
  MENSAJE_GLOBAL_SIN_SUSTITUCION,
  NOMBRE_PLANTILLA_CANCELACION,
  plantillaCancelacion,
  resolucionDeConsulta,
  textoErrorPac,
  type CfdiACancelar,
} from './cancelacion';

const SUS = 'A1B2C3D4-0000-4000-8000-000000000001';
const TICKET: CfdiACancelar = { origen: 'ticket', sustituto: null, anterior: null };

describe('cancelación de CFDI: reglas puras (F2-109)', () => {
  describe('conflictoDeMotivo', () => {
    it('un ticket sin sustituto se cancela con 02 y 03; 04 no (sólo globales); 01 pide sustituto', () => {
      expect(conflictoDeMotivo(TICKET, '02', null)).toBeNull();
      expect(conflictoDeMotivo(TICKET, '03', null)).toBeNull();
      expect(conflictoDeMotivo(TICKET, '04', null)).toBe(MENSAJE_04_NO_GLOBAL);
      expect(conflictoDeMotivo(TICKET, '01', SUS)).toBe(MENSAJE_01_SIN_SUSTITUTO);
      expect(conflictoDeMotivo({ ...TICKET, origen: 'manual' }, '04', null)).toBe(
        MENSAJE_04_NO_GLOBAL,
      );
    });

    it('una global: 02, 03 y 04 sí; 01 nunca (no se sustituye)', () => {
      const global: CfdiACancelar = { ...TICKET, origen: 'global' };
      expect(conflictoDeMotivo(global, '02', null)).toBeNull();
      expect(conflictoDeMotivo(global, '03', null)).toBeNull();
      expect(conflictoDeMotivo(global, '04', null)).toBeNull();
      expect(conflictoDeMotivo(global, '01', SUS)).toBe(MENSAJE_GLOBAL_SIN_SUSTITUCION);
    });

    it('motivo 01: sólo con SU sustituto vigente y su UUID exacto', () => {
      const con = (estado: 'timbrando' | 'vigente' | 'cancelado', uuid: string | null) => ({
        ...TICKET,
        sustituto: { estado, uuid },
      });
      expect(conflictoDeMotivo(con('vigente', SUS), '01', SUS)).toBeNull();
      // El UUID del sustituto puede venir en minúsculas de la base del PAC: se compara en mayúsculas.
      expect(conflictoDeMotivo(con('vigente', SUS.toLowerCase()), '01', SUS)).toBeNull();
      expect(conflictoDeMotivo(con('vigente', SUS), '01', SUS.replace('1', '9'))).toBe(
        MENSAJE_01_SUSTITUTO_AJENO,
      );
      expect(conflictoDeMotivo(con('timbrando', null), '01', SUS)).toBe(
        MENSAJE_01_SUSTITUTO_EN_EMISION,
      );
      expect(conflictoDeMotivo(con('cancelado', SUS), '01', SUS)).toBe(
        MENSAJE_01_SUSTITUTO_CANCELADO,
      );
    });

    it('B1: con un sustituto en emisión o vigente, sólo 01; con el sustituto cancelado, 02/03 sí', () => {
      for (const estado of ['timbrando', 'vigente'] as const) {
        const c = { ...TICKET, sustituto: { estado, uuid: estado === 'vigente' ? SUS : null } };
        expect(conflictoDeMotivo(c, '02', null)).toBe(MENSAJE_CON_SUSTITUTO);
        expect(conflictoDeMotivo(c, '03', null)).toBe(MENSAJE_CON_SUSTITUTO);
      }
      const muerto = { ...TICKET, sustituto: { estado: 'cancelado' as const, uuid: SUS } };
      expect(conflictoDeMotivo(muerto, '02', null)).toBeNull();
    });

    it('B1: un sustituto cuyo anterior sigue vigente no se cancela con NINGÚN motivo', () => {
      const sustituto: CfdiACancelar = { ...TICKET, anterior: { estado: 'vigente' } };
      for (const m of ['01', '02', '03'] as const) {
        expect(conflictoDeMotivo(sustituto, m, SUS)).toBe(MENSAJE_ANTERIOR_VIGENTE);
      }
      expect(conflictoDeMotivo({ ...TICKET, anterior: { estado: 'cancelado' } }, '02', null)).toBe(
        null,
      );
    });
  });

  describe('resolucionDeConsulta', () => {
    it('cancelado en el PAC → aceptada, desde cualquier estado abierto', () => {
      expect(resolucionDeConsulta('solicitando', 'cancelado', false)).toBe('aceptada');
      expect(resolucionDeConsulta('en_proceso', 'cancelado', false)).toBe('aceptada');
    });

    it('en_cancelacion → en proceso (sin cambio si ya lo estaba)', () => {
      expect(resolucionDeConsulta('solicitando', 'en_cancelacion', false)).toBe('en_proceso');
      expect(resolucionDeConsulta('en_proceso', 'en_cancelacion', true)).toBe('sin_cambio');
    });

    it('vigente: desde en_proceso = RECHAZADA; desde solicitando vencida = no procedió; reciente = nada', () => {
      expect(resolucionDeConsulta('en_proceso', 'vigente', false)).toBe('rechazada');
      expect(resolucionDeConsulta('solicitando', 'vigente', true)).toBe('no_procedio');
      expect(resolucionDeConsulta('solicitando', 'vigente', false)).toBe('sin_cambio');
    });

    it('no_encontrado nunca resuelve a ciegas', () => {
      expect(resolucionDeConsulta('solicitando', 'no_encontrado', true)).toBe('sin_cambio');
      expect(resolucionDeConsulta('en_proceso', 'no_encontrado', true)).toBe('sin_cambio');
    });
  });

  describe('efectoEnTicket', () => {
    it('02/03 con código lo sueltan; 01 y 04 no; sin código no hay nada que soltar', () => {
      expect(efectoEnTicket('02', 'ticket', true)).toBe('soltar_codigo');
      expect(efectoEnTicket('03', 'ticket', true)).toBe('soltar_codigo');
      expect(efectoEnTicket('01', 'ticket', true)).toBe('nada');
      expect(efectoEnTicket('02', 'ticket', false)).toBe('nada');
      expect(efectoEnTicket('02', 'manual', false)).toBe('nada');
    });

    it('una global cancelada (02/03/04) suelta sus tickets; 01 no aplica', () => {
      expect(efectoEnTicket('02', 'global', false)).toBe('soltar_global');
      expect(efectoEnTicket('03', 'global', false)).toBe('soltar_global');
      expect(efectoEnTicket('04', 'global', false)).toBe('soltar_global');
      expect(efectoEnTicket('01', 'global', false)).toBe('nada');
    });
  });

  it('textoErrorPac: código + mensaje, en una línea y recortado', () => {
    const e = new ErrorTimbrado('PAC_SIN_RESPUESTA', 'no\nhubo   respuesta');
    expect(textoErrorPac(e)).toBe('PAC_SIN_RESPUESTA: no hubo respuesta');
    expect(textoErrorPac(new Error('x'.repeat(1000)))).toHaveLength(MAX_ERROR_CANCELACION);
    expect(textoErrorPac('crudo')).toBe('crudo');
  });

  describe('plantillaCancelacion', () => {
    const datos = {
      sucursal: 'Centro <b>',
      color: '#123456',
      emisor: 'EMISOR & CIA',
      uuid: SUS,
      serieFolio: 'A-12',
      total: '1234.50',
      motivo: '02' as const,
      uuidSustitucion: null,
    };

    it('escapa todo dato y dice motivo, folio y total', () => {
      const p = plantillaCancelacion(datos);
      expect(p.nombre).toBe(NOMBRE_PLANTILLA_CANCELACION);
      expect(p.asunto).toBe('Factura cancelada: A-12 de Centro <b>');
      expect(p.html).toContain('Centro &lt;b&gt;');
      expect(p.html).toContain('EMISOR &amp; CIA');
      expect(p.html).not.toContain('<b>');
      expect(p.html).toContain('#123456');
      expect(p.texto).toContain(`Folio fiscal (UUID): ${SUS}`);
      expect(p.texto).toContain('Motivo: 02 · Comprobante emitido con errores sin relación');
      expect(p.texto).toContain('Total: $1,234.50');
      expect(p.texto).toContain('pídela en el restaurante');
    });

    it('con motivo 01 dice qué factura la sustituye; un color inválido cae al de siempre', () => {
      const p = plantillaCancelacion({
        ...datos,
        motivo: '01',
        uuidSustitucion: 'FFFF0000-0000-4000-8000-000000000002',
        color: 'red;background:url(x)',
      });
      expect(p.texto).toContain('La sustituye la factura con folio fiscal FFFF0000');
      expect(p.html).not.toContain('url(x)');
    });
  });
});
