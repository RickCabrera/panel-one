import { describe, expect, it } from 'vitest';

import type { RegimenFiscal } from '../../api/tipos';
import {
  aBase64,
  erroresPerfil,
  estadoVigencia,
  fechaLarga,
  regimenesPara,
  textoDias,
  tipoPersona,
} from './reglas';

// F2-100: la vigencia del CSD y su alerta se calculan AQUÍ, a partir de la metadata.

const HASTA = '2026-10-22T06:00:00.000Z';
const DIA = 24 * 60 * 60 * 1000;
const antes = (ms: number) => new Date(Date.parse(HASTA) - ms);

const REGIMENES: RegimenFiscal[] = [
  { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
  { clave: '612', descripcion: 'Actividades Empresariales', fisica: true, moral: false },
  { clave: '626', descripcion: 'RESICO', fisica: true, moral: true },
];

describe('estadoVigencia', () => {
  it('30 días exactos: sin alerta; un instante menos: alerta', () => {
    expect(estadoVigencia(HASTA, antes(30 * DIA))).toEqual({ tipo: 'vigente', dias: 30 });
    expect(estadoVigencia(HASTA, antes(30 * DIA - 1))).toEqual({ tipo: 'por_vencer', dias: 29 });
    expect(estadoVigencia(HASTA, antes(29 * DIA + 23 * 3600 * 1000))).toEqual({
      tipo: 'por_vencer',
      dias: 29,
    });
  });

  it('el último día: 0 días; al instante de vencer y después: vencido', () => {
    expect(estadoVigencia(HASTA, antes(1))).toEqual({ tipo: 'por_vencer', dias: 0 });
    expect(estadoVigencia(HASTA, antes(0))).toEqual({ tipo: 'vencido' });
    expect(estadoVigencia(HASTA, antes(-DIA))).toEqual({ tipo: 'vencido' });
  });

  it('lejos: vigente con sus días', () => {
    expect(estadoVigencia(HASTA, antes(400 * DIA + 5))).toEqual({ tipo: 'vigente', dias: 400 });
  });

  it('textos', () => {
    expect(textoDias(0)).toBe('vence en menos de un día');
    expect(textoDias(1)).toBe('vence en 1 día');
    expect(textoDias(20)).toBe('vence en 20 días');
    // 06:00Z = medianoche en CDMX: la fecha es la del día local.
    expect(fechaLarga(HASTA)).toBe('22 de octubre de 2026');
    expect(fechaLarga('2026-10-22T05:59:00.000Z')).toBe('21 de octubre de 2026');
  });
});

describe('datos fiscales', () => {
  it('tipo de persona por el formato del RFC (normalizado)', () => {
    expect(tipoPersona(' eku9003173c9 ')).toBe('moral');
    expect(tipoPersona('XOJI740919U48')).toBe('fisica');
    expect(tipoPersona('EKU900317')).toBeNull();
  });

  it('régimen: sólo los que aplican; con RFC incompleto, todos', () => {
    expect(regimenesPara('EKU9003173C9', REGIMENES).map((r) => r.clave)).toEqual(['601', '626']);
    expect(regimenesPara('XOJI740919U48', REGIMENES).map((r) => r.clave)).toEqual(['612', '626']);
    expect(regimenesPara('EKU', REGIMENES)).toHaveLength(3);
  });

  it('errores campo por campo, en español', () => {
    const bueno = {
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '06700',
      serie: 'A',
    };
    expect(erroresPerfil(bueno, REGIMENES)).toEqual({});
    expect(
      erroresPerfil(
        { rfc: 'X', razonSocial: ' ', regimenFiscal: '', cp: '067', serie: 'A-1' },
        REGIMENES,
      ),
    ).toEqual({
      rfc: 'El RFC debe tener 12 caracteres (persona moral) o 13 (persona física).',
      razonSocial: 'Escribe la razón social.',
      regimenFiscal: 'Elige el régimen fiscal.',
      cp: 'El código postal lleva 5 dígitos.',
      serie: 'La serie lleva de 1 a 25 letras o números.',
    });
    expect(erroresPerfil({ ...bueno, regimenFiscal: '612' }, REGIMENES).regimenFiscal).toBe(
      'Ese régimen no aplica a persona moral.',
    );
    expect(erroresPerfil({ ...bueno, rfc: 'XAXX010101000' }, REGIMENES).rfc).toBe(
      'Un RFC genérico no puede ser el emisor.',
    );
  });

  it('base64 de bytes arbitrarios', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(aBase64(bytes.buffer)).toBe('AAEC+v+A');
    expect(aBase64(new ArrayBuffer(0))).toBe('');
  });
});
