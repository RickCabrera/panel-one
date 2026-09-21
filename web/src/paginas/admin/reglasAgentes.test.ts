import { describe, expect, it } from 'vitest';

import type { EstadoAgenteSucursal } from '../../api/tipos';
import { edadAhora, estadoAgente, sinReportar, UMBRAL_ALERTA_S } from './reglasAgentes';

function fila(sucursalId: string, edadContactoSegundos: number | null): EstadoAgenteSucursal {
  return {
    sucursalId,
    nombre: sucursalId,
    zonaHoraria: 'America/Mexico_City',
    ultimoContactoAt: edadContactoSegundos === null ? null : '2026-09-21T18:00:00Z',
    edadContactoSegundos,
    ultimaLecturaAt: null,
    edadLecturaSegundos: null,
    versionAgente: null,
    versionSr: null,
    tamanoCola: null,
    latenciaQueryMs: null,
    ultimoError: null,
  };
}

describe('estadoAgente (F1-061)', () => {
  it.each([
    [0, 'conectado'],
    [90, 'conectado'],
    [91, 'desconectado'],
    [3600, 'desconectado'],
    [null, 'sin-reporte'],
  ] as const)('contacto de hace %s s → %s', (edad, esperado) => {
    expect(estadoAgente(edad)).toBe(esperado);
  });
});

describe('edadAhora', () => {
  it('suma lo que lleva la respuesta en el navegador: la edad sigue creciendo sin API', () => {
    expect(edadAhora(80, 1_000_000, 1_000_000)).toBe(80);
    expect(edadAhora(80, 1_000_000, 1_011_000)).toBe(91);
  });

  it('un reloj del navegador detrás de la respuesta no resta edad', () => {
    expect(edadAhora(80, 1_000_000, 995_000)).toBe(80);
  });

  it('null sigue siendo null (nunca reportó), nunca 0', () => {
    expect(edadAhora(null, 1_000_000, 2_000_000)).toBeNull();
  });
});

describe('sinReportar (badge del sidebar)', () => {
  it('el umbral es 10 min', () => {
    expect(UMBRAL_ALERTA_S).toBe(600);
  });

  it('cuenta sólo las de MÁS de 600 s; las que nunca reportaron no prenden el badge', () => {
    const filas = [fila('a', 600), fila('b', 601), fila('c', null), fila('d', 10)];
    expect(sinReportar(filas, 0, 0).map((f) => f.sucursalId)).toEqual(['b']);
  });

  it('envejece con el reloj del navegador: 590 s + 11 s sin respuesta nueva → alerta', () => {
    const filas = [fila('a', 590)];
    expect(sinReportar(filas, 1_000_000, 1_010_000)).toHaveLength(0);
    expect(sinReportar(filas, 1_000_000, 1_011_000)).toHaveLength(1);
  });
});
