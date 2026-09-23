import { describe, expect, it } from 'vitest';

import type { FilaProyeccion, Proyecciones, SucursalProyeccion } from '../../api/tipos';
import {
  almacenesDe,
  conSugerido,
  filtrar,
  leerHorizonte,
  motivoSucursal,
  ordenDeCompraCsv,
  textoSinHistorial,
  vacio,
  valorAlmacen,
} from './reglas';

// Reglas puras de Proyecciones (F2-127). Esperados escritos a mano.

const suc = (p: Partial<SucursalProyeccion> = {}): SucursalProyeccion => ({
  sucursalId: 's1',
  sucursal: 'Centro',
  zonaHoraria: 'America/Mexico_City',
  calculada: true,
  motivo: null,
  polizasRecibidas: 10,
  almacenesConFoto: 1,
  hoy: '2026-09-16',
  ventanaDesde: '2026-08-19',
  ventanaHasta: '2026-09-15',
  horizonteDesde: '2026-09-16',
  horizonteHasta: '2026-09-22',
  ...p,
});

const fila = (p: Partial<FilaProyeccion> = {}): FilaProyeccion => ({
  sucursalId: 's1',
  sucursal: 'Centro',
  almacenOrigenSrId: 'ALM1',
  almacen: 'General',
  insumoOrigenSrId: 'I1',
  insumo: 'Carne',
  clave: 'C-01',
  unidad: 'Kilogramo',
  estado: 'calculada',
  diasHistorial: 46,
  semanas: ['18.500', '20.000', '30.000', '40.000'],
  proyeccion: '23.400',
  existencia: '10.000',
  minimo: '5.000',
  sugerido: '18.400',
  avisos: [],
  ...p,
});

const datos = (filas: FilaProyeccion[], sucursales = [suc()]): Proyecciones => ({
  horizonte: 7,
  pesos: [4, 3, 2, 1],
  sucursales,
  filas,
  kpis: { filas: filas.length, conSugerido: 0, sinHistorial: 0 },
});

describe('horizonte escrito a mano', () => {
  it('sólo enteros de 1 a 28', () => {
    expect(['7', ' 14 ', '1', '28'].map(leerHorizonte)).toEqual([7, 14, 1, 28]);
    expect(['0', '29', '7.5', 'abc', '', '-3', '1e1'].map(leerHorizonte)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('sin datos', () => {
  it('dice cuántos días lleva, nunca 0', () => {
    expect(textoSinHistorial({ diasHistorial: 10 })).toBe(
      'Sin datos: 10 días de historial; la proyección necesita 28.',
    );
    expect(textoSinHistorial({ diasHistorial: 1 })).toBe(
      'Sin datos: 1 día de historial; la proyección necesita 28.',
    );
    expect(textoSinHistorial({ diasHistorial: 0 })).toBe(
      'Sin datos: sin movimientos todavía; la proyección necesita 28.',
    );
  });

  it('conSugerido: nulo y 0 no son "por comprar"', () => {
    expect([null, '0.000', '0.001', '12'].map((s) => conSugerido({ sugerido: s }))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('filtros locales', () => {
  const filas = [
    fila(),
    fila({ insumoOrigenSrId: 'I2', insumo: 'Tortilla', clave: null, sugerido: '0.000' }),
    fila({
      almacenOrigenSrId: 'ALM2',
      almacen: null,
      insumoOrigenSrId: 'I3',
      insumo: null,
      clave: null,
    }),
  ];

  it('almacén, búsqueda (nombre, clave, id) y sólo con sugerido', () => {
    const alm2 = valorAlmacen({ sucursalId: 's1', almacenOrigenSrId: 'ALM2' });
    expect(filtrar(filas, { almacen: alm2, q: '', soloSugerido: false })).toEqual([filas[2]]);
    expect(filtrar(filas, { almacen: '', q: 'TORT', soloSugerido: false })).toEqual([filas[1]]);
    expect(filtrar(filas, { almacen: '', q: 'c-01', soloSugerido: false })).toEqual([filas[0]]);
    expect(filtrar(filas, { almacen: '', q: 'i3', soloSugerido: false })).toEqual([filas[2]]);
    expect(filtrar(filas, { almacen: '', q: '', soloSugerido: true })).toEqual([
      filas[0],
      filas[2],
    ]);
  });

  it('los almacenes salen de las filas, sin repetir', () => {
    expect(almacenesDe(filas).map((a) => a.almacenOrigenSrId)).toEqual(['ALM1', 'ALM2']);
  });
});

describe('estados vacíos', () => {
  it('ninguna sucursal con pólizas: dice por qué y qué falta', () => {
    const v = vacio(datos([], [suc({ calculada: false, motivo: 'sin_polizas' })]));
    expect(v).toMatchObject({
      tipo: 'sin-datos',
      porque: 'Centro todavía no ha mandado pólizas de inventario.',
    });
  });
  it('con una calculada, hay datos; la otra sale en el aviso', () => {
    const r = datos(
      [],
      [
        suc(),
        suc({ sucursalId: 's2', sucursal: 'Norte', calculada: false, motivo: 'sin_polizas' }),
      ],
    );
    expect(vacio(r)).toEqual({ tipo: 'con-datos' });
    expect(r.sucursales.map(motivoSucursal)[0]).toBeNull();
    expect(r.sucursales.map(motivoSucursal)[1]).toMatch(/^Norte: el agente nunca ha mandado/);
  });
});

describe('orden de compra CSV', () => {
  it('sólo lo que hay que comprar; textos de SR escapados contra fórmulas', () => {
    const csv = ordenDeCompraCsv(datos([]), [
      fila(),
      fila({ insumoOrigenSrId: 'I2', sugerido: '0.000' }),
      fila({ insumoOrigenSrId: 'I3', estado: 'sin_historial', sugerido: null }),
      fila({
        insumoOrigenSrId: 'I4',
        insumo: '=HYPERLINK("x")',
        clave: null,
        unidad: null,
        existencia: '-2.000',
        minimo: null,
        proyeccion: '1.000',
        sugerido: '3.000',
      }),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lineas = csv.slice(1).split('\r\n');
    expect(lineas).toEqual([
      'Sucursal,Almacén,Clave,Insumo,Unidad,Cantidad sugerida,Existencia,Mínimo,Proyección,Horizonte (días),Desde,Hasta',
      'Centro,General,C-01,Carne,Kilogramo,18.400,10.000,5.000,23.400,7,2026-09-16,2026-09-22',
      `Centro,General,I4,"'=HYPERLINK(""x"")",,3.000,-2.000,,1.000,7,2026-09-16,2026-09-22`,
      '',
    ]);
  });
});
