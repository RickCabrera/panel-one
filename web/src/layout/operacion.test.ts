import { describe, expect, it } from 'vitest';

import type { MesasSucursal } from '../api/tipos';
import { codificar, decodificar, operacionDe, textoSucursales } from './operacion';

const RESPUESTA = Date.parse('2026-09-21T03:30:00Z');

function fila(id: string, edadRecepcionSegundos: number | null): MesasSucursal {
  return {
    sucursalId: id,
    nombre: `Sucursal ${id}`,
    zonaHoraria: 'America/Mexico_City',
    snapshot:
      edadRecepcionSegundos === null
        ? null
        : {
            capturadoAt: new Date(RESPUESTA - edadRecepcionSegundos * 1000).toISOString(),
            recibidoAt: new Date(RESPUESTA - edadRecepcionSegundos * 1000).toISOString(),
            edadSegundos: edadRecepcionSegundos,
            edadRecepcionSegundos,
            mesas: [],
          },
  };
}

describe('operacionDe', () => {
  it('sin respuesta todavía: consultando; si falló sin responder nunca: sin lectura', () => {
    expect(operacionDe(undefined, 0, RESPUESTA)).toEqual({ estado: 'consultando' });
    expect(operacionDe(undefined, 0, RESPUESTA, true)).toEqual({
      estado: 'sin-lectura',
      total: null,
    });
  });

  it('una empresa sin sucursales lo dice', () => {
    expect(operacionDe([], RESPUESTA, RESPUESTA)).toEqual({ estado: 'sin-sucursales' });
  });

  it('cuenta las que reportan y da la lectura MÁS VIEJA de ellas (regla F1-094)', () => {
    const op = operacionDe([fila('a', 10), fila('b', 40), fila('c', null)], RESPUESTA, RESPUESTA);
    expect(op).toEqual({
      estado: 'en-vivo',
      frescura: 'fresca',
      recibidoAt: RESPUESTA - 40_000,
      reportando: 2,
      total: 3,
    });
  });

  it('una desconectada no cuenta ni mueve la hora', () => {
    const op = operacionDe([fila('a', 10), fila('b', 3600)], RESPUESTA, RESPUESTA);
    expect(op).toMatchObject({ estado: 'en-vivo', reportando: 1, total: 2 });
    expect(op.estado === 'en-vivo' && op.recibidoAt).toBe(RESPUESTA - 10_000);
  });

  it('con demora (60–90 s) sigue en vivo pero lo marca', () => {
    expect(operacionDe([fila('a', 75)], RESPUESTA, RESPUESTA)).toMatchObject({
      estado: 'en-vivo',
      frescura: 'demorada',
    });
  });

  it('ninguna reporta (viejas o sin snapshot): sin lectura reciente, sin hora', () => {
    expect(operacionDe([fila('a', 91), fila('b', null)], RESPUESTA, RESPUESTA)).toEqual({
      estado: 'sin-lectura',
      total: 2,
    });
    expect(operacionDe([fila('a', null)], RESPUESTA, RESPUESTA)).toEqual({
      estado: 'sin-lectura',
      total: 1,
    });
  });

  it('si la API deja de contestar, la lectura envejece sola y se apaga', () => {
    const filas = [fila('a', 30)];
    expect(operacionDe(filas, RESPUESTA, RESPUESTA + 60_000).estado).toBe('en-vivo');
    expect(operacionDe(filas, RESPUESTA, RESPUESTA + 61_000)).toEqual({
      estado: 'sin-lectura',
      total: 1,
    });
  });
});

describe('codificar / textoSucursales', () => {
  it('ida y vuelta sin pérdida, y el mismo estado da el mismo texto', () => {
    const op = operacionDe([fila('a', 10)], RESPUESTA, RESPUESTA);
    expect(decodificar(codificar(op))).toEqual(op);
    expect(codificar(op)).toBe(codificar(operacionDe([fila('a', 10)], RESPUESTA, RESPUESTA)));
  });

  it('singular y plural', () => {
    expect(textoSucursales(1, 1)).toBe('1 de 1 sucursal reportando');
    expect(textoSucursales(0, 1)).toBe('0 de 1 sucursal reportando');
    expect(textoSucursales(2, 3)).toBe('2 de 3 sucursales reportando');
  });
});
