import { describe, expect, it } from 'vitest';

import type { RegimenFiscal, UsoCfdi } from '../../api/tipos';
import {
  camposDelApi,
  erroresReceptor,
  esCodigoValido,
  estadoDelApi,
  iniciales,
  normalizarCodigo,
  QUE_HACER,
  regimenesPara,
  textoSobre,
  tipoPersona,
  ultimoDia,
  usosPara,
} from './reglas';

// Reglas puras del portal de autofactura (F2-103). Los textos de error son los MISMOS del api
// (`api/src/facturacion/portal.spec.ts` prueba los mismos casos del lado del servidor).

const REGIMENES: RegimenFiscal[] = [
  { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
  { clave: '612', descripcion: 'Actividades Empresariales', fisica: true, moral: false },
  { clave: '626', descripcion: 'Régimen Simplificado de Confianza', fisica: true, moral: true },
];
const USOS: UsoCfdi[] = [
  {
    clave: 'G03',
    descripcion: 'Gastos en general',
    fisica: true,
    moral: true,
    regimenes: ['601', '612', '626'],
  },
  {
    clave: 'D01',
    descripcion: 'Honorarios médicos',
    fisica: true,
    moral: false,
    regimenes: ['612'],
  },
  {
    clave: 'S01',
    descripcion: 'Sin efectos fiscales',
    fisica: true,
    moral: true,
    regimenes: ['601', '612', '626'],
  },
];
const BUENO = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'facturas@ejemplo.test',
};

describe('portal: código y RFC', () => {
  it('el código se normaliza (espacios, minúsculas) y valida el alfabeto sin O, 0, I, 1', () => {
    expect(normalizarCodigo(' 7jq recp3u ')).toBe('7JQRECP3U');
    expect(esCodigoValido('7JQRECP3U')).toBe(true);
    expect(esCodigoValido('7JQRECP3O')).toBe(false);
    expect(esCodigoValido('7JQRECP3')).toBe(false);
  });

  it('tipo de persona sólo con la forma completa del SAT', () => {
    expect(tipoPersona('eku9003173c9')).toBe('moral');
    expect(tipoPersona('XIQB891116QE4')).toBe('fisica');
    expect(tipoPersona('EKU9013173C9')).toBeNull(); // mes 13
    expect(tipoPersona('EKU90031')).toBeNull();
  });

  it('régimen filtrado por el tipo de persona; uso filtrado por régimen y tipo', () => {
    expect(regimenesPara('EKU9003173C9', REGIMENES).map((r) => r.clave)).toEqual(['601', '626']);
    expect(regimenesPara('XIQB891116QE4', REGIMENES).map((r) => r.clave)).toEqual(['612', '626']);
    expect(regimenesPara('EKU', REGIMENES)).toHaveLength(3);
    expect(usosPara('XIQB891116QE4', '612', USOS).map((u) => u.clave)).toEqual([
      'G03',
      'D01',
      'S01',
    ]);
    expect(usosPara('EKU9003173C9', '601', USOS).map((u) => u.clave)).toEqual(['G03', 'S01']);
    expect(usosPara('EKU9003173C9', '', USOS)).toEqual([]);
  });
});

describe('portal: erroresReceptor', () => {
  it('datos correctos: sin errores', () => {
    expect(erroresReceptor(BUENO, REGIMENES, USOS)).toEqual({});
  });

  it('todo vacío: un error por campo, a la vez', () => {
    const e = erroresReceptor(
      { rfc: '', razonSocial: '', regimenFiscal: '', cp: '', usoCfdi: '', email: '' },
      REGIMENES,
      USOS,
    );
    expect(Object.keys(e).sort()).toEqual(
      ['cp', 'email', 'razonSocial', 'regimenFiscal', 'rfc', 'usoCfdi'].sort(),
    );
  });

  it('los mismos textos que el api', () => {
    expect(erroresReceptor({ ...BUENO, rfc: 'XAXX010101000' }, REGIMENES, USOS).rfc).toBe(
      'Ese es el RFC genérico de público en general: una factura a tu nombre necesita tu RFC.',
    );
    expect(erroresReceptor({ ...BUENO, regimenFiscal: '612' }, REGIMENES, USOS)).toEqual({
      regimenFiscal: 'Ese régimen es de persona física y tu RFC es de empresa (persona moral).',
    });
    expect(erroresReceptor({ ...BUENO, usoCfdi: 'D01' }, REGIMENES, USOS)).toEqual({
      usoCfdi: 'Ese uso no aplica a tu régimen fiscal. Elige otro de la lista.',
    });
    expect(erroresReceptor({ ...BUENO, cp: '123' }, REGIMENES, USOS).cp).toBe(
      'El código postal de tu domicilio fiscal tiene 5 dígitos.',
    );
    expect(erroresReceptor({ ...BUENO, email: 'x@y' }, REGIMENES, USOS).email).toBe(
      'El correo no tiene la forma correcta (p. ej. nombre@dominio.com).',
    );
  });
});

describe('portal: lo que llega del api', () => {
  it('campos de un 400: sólo los conocidos y sólo si son texto', () => {
    expect(camposDelApi({ campos: { rfc: 'mal', otro: 'x', cp: 5 } })).toEqual({ rfc: 'mal' });
    expect(camposDelApi({ message: ['x'] })).toBeNull();
    expect(camposDelApi(undefined)).toBeNull();
  });

  it('estado de un 409: sólo uno de los estados públicos', () => {
    expect(estadoDelApi({ estado: 'facturado' })).toBe('facturado');
    // F2-104: la emisión en curso (o que el PAC no confirmó).
    expect(estadoDelApi({ estado: 'en_proceso' })).toBe('en_proceso');
    expect(estadoDelApi({ estado: 'inventado' })).toBeNull();
    expect(estadoDelApi({ estado: 'constructor' })).toBeNull();
    expect(estadoDelApi(null)).toBeNull();
  });
});

describe('portal: qué hacer con cada estado (F2-104)', () => {
  it('en_proceso dice que NO la vuelva a pedir y a quién acudir si no llega', () => {
    expect(QUE_HACER.en_proceso).toMatch(/no la vuelvas a solicitar/);
    expect(QUE_HACER.en_proceso).toMatch(/restaurante/);
  });
});

describe('portal: marca y fechas', () => {
  it('texto negro o blanco según el color de la marca', () => {
    expect(textoSobre('#0f766e')).toBe('#ffffff');
    expect(textoSobre('#fde047')).toBe('#000000');
    expect(textoSobre('no-es-color')).toBe('#ffffff');
  });

  it('iniciales sin "Sucursal" ni artículos', () => {
    expect(iniciales('Sucursal Centro')).toBe('C');
    expect(iniciales('La Casa del Taco')).toBe('CT');
    expect(iniciales('Sucursal')).toBe('S');
  });

  it('el último día para facturar es el anterior al instante exclusivo, en la zona de la sucursal', () => {
    // 1-oct 00:00 CDMX exclusivo → último día 30 de septiembre.
    expect(ultimoDia('2026-10-01T06:00:00.000Z', 'America/Mexico_City')).toBe(
      '30 de septiembre de 2026',
    );
  });
});
