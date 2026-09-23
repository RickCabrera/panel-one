import { RELOJ_FIJO, solicitudCfdi } from '../../test/fixtures-cfdi';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import {
  EDAD_MINIMA_MS,
  RECLAMO_MS,
  VENTANA_SIN_CONFIRMAR_MS,
  fechaDeConfirmacion,
  fechaTimbradoDeXml,
  huboCambios,
  resumenVacio,
  tieneEdad,
  trasBusquedaVacia,
  ventanaVencida,
} from './conciliacion';
import { intervaloConciliacionS } from './conciliacion.programador';
import { receptorDeJson } from './conciliacion.service';

const T = (iso: string) => new Date(iso);
const mas = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe('Conciliación con el PAC: reglas puras (F2-110b)', () => {
  const base = T('2026-09-22T12:00:00.000Z');

  it('los plazos provisionales son los del plan (15 min, 15 min, 7 días)', () => {
    expect(EDAD_MINIMA_MS).toBe(15 * 60 * 1000);
    expect(RECLAMO_MS).toBe(15 * 60 * 1000);
    expect(VENTANA_SIN_CONFIRMAR_MS).toBe(7 * 24 * 3600 * 1000);
  });

  it('tieneEdad: 14:59.999 no, 15:00 sí (borde exacto)', () => {
    expect(tieneEdad(base, mas(base, EDAD_MINIMA_MS - 1))).toBe(false);
    expect(tieneEdad(base, mas(base, EDAD_MINIMA_MS))).toBe(true);
  });

  it('trasBusquedaVacia: la primera se ANOTA; la segunda libera sólo pasados 15 min', () => {
    expect(trasBusquedaVacia(null, base)).toBe('anotar');
    expect(trasBusquedaVacia(base, base)).toBe('esperar');
    expect(trasBusquedaVacia(base, mas(base, RECLAMO_MS - 1))).toBe('esperar');
    expect(trasBusquedaVacia(base, mas(base, RECLAMO_MS))).toBe('liberar');
  });

  it('ventanaVencida: a los 7 días exactos sí, un ms antes no', () => {
    expect(ventanaVencida(base, mas(base, VENTANA_SIN_CONFIRMAR_MS - 1))).toBe(false);
    expect(ventanaVencida(base, mas(base, VENTANA_SIN_CONFIRMAR_MS))).toBe(true);
  });

  describe('la fecha con que se confirma', () => {
    it('lee la FechaTimbrado del TFD en la zona de la sucursal (XML del PAC falso)', async () => {
      const cfdi = await new TimbradoFalso(RELOJ_FIJO).emitir(solicitudCfdi());
      expect(fechaTimbradoDeXml(cfdi.xml, 'America/Mexico_City')).toEqual(cfdi.fechaTimbrado);
    });

    it('borde de mes: 23:59:59 LOCAL del 31 de agosto en CDMX es el 1 de septiembre en UTC', () => {
      const xml =
        '<cfdi:Comprobante Fecha="2026-08-31T23:50:00"><cfdi:Complemento>' +
        '<tfd:TimbreFiscalDigital Version="1.1" UUID="X" FechaTimbrado="2026-08-31T23:59:59"/>' +
        '</cfdi:Complemento></cfdi:Comprobante>';
      expect(fechaTimbradoDeXml(xml, 'America/Mexico_City')).toEqual(T('2026-09-01T05:59:59.000Z'));
      // La misma hora en Tijuana (UTC-7 en verano) es otro instante: nunca la zona del servidor.
      expect(fechaTimbradoDeXml(xml, 'America/Tijuana')).toEqual(T('2026-09-01T06:59:59.000Z'));
    });

    it('sin TFD o con una fecha ilegible: null', () => {
      expect(fechaTimbradoDeXml('<cfdi:Comprobante/>', 'America/Mexico_City')).toBeNull();
      expect(
        fechaTimbradoDeXml(
          '<tfd:TimbreFiscalDigital FechaTimbrado="ayer"/>',
          'America/Mexico_City',
        ),
      ).toBeNull();
    });

    it('prioridad: la del PAC → la del XML → la de la reserva', () => {
      const xml = '<tfd:TimbreFiscalDigital FechaTimbrado="2026-09-21T20:20:05"/>';
      const pac = T('2026-09-22T02:00:00.000Z');
      const reserva = T('2026-09-22T01:00:00.000Z');
      expect(fechaDeConfirmacion(pac, xml, 'America/Mexico_City', reserva)).toEqual(pac);
      expect(fechaDeConfirmacion(null, xml, 'America/Mexico_City', reserva)).toEqual(
        T('2026-09-22T02:20:05.000Z'),
      );
      expect(fechaDeConfirmacion(null, null, 'America/Mexico_City', reserva)).toEqual(reserva);
      expect(fechaDeConfirmacion(null, '<x/>', 'America/Mexico_City', reserva)).toEqual(reserva);
    });
  });

  it('receptorDeJson: el receptor guardado en la reserva, o null si no tiene la forma', () => {
    const r = {
      rfc: 'XOJI740919U48',
      razonSocial: 'Cliente',
      regimenFiscal: '612',
      cp: '76028',
      usoCfdi: 'G03',
      email: 'a@ejemplo.test',
    };
    expect(receptorDeJson(r)).toEqual(r);
    expect(receptorDeJson({ ...r, email: undefined })).toEqual({ ...r, email: null });
    expect(receptorDeJson({ ...r, cp: 76028 })).toBeNull();
    expect(receptorDeJson(null)).toBeNull();
    expect(receptorDeJson(['x'])).toBeNull();
  });

  it('huboCambios: una vuelta sin nada que hacer no se loguea; una con fallas sí', () => {
    const r = resumenVacio();
    expect(huboCambios(r)).toBe(false);
    r.reservas.enEspera = 1;
    r.reservas.revisadas = 1;
    expect(huboCambios(r)).toBe(false);
    r.fallidas = 1;
    expect(huboCambios(r)).toBe(true);
  });

  it('intervaloConciliacionS: 900 por defecto, apagado en test, 0 apaga, basura truena', () => {
    expect(intervaloConciliacionS({})).toBe(900);
    expect(intervaloConciliacionS({ NODE_ENV: 'test' })).toBe(0);
    expect(intervaloConciliacionS({ CONCILIACION_INTERVALO_S: '0' })).toBe(0);
    expect(intervaloConciliacionS({ CONCILIACION_INTERVALO_S: '60', NODE_ENV: 'test' })).toBe(60);
    expect(() => intervaloConciliacionS({ CONCILIACION_INTERVALO_S: '-1' })).toThrow(
      'CONCILIACION_INTERVALO_S',
    );
    expect(() => intervaloConciliacionS({ CONCILIACION_INTERVALO_S: '1.5' })).toThrow();
  });
});
