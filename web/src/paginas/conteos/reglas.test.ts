import { describe, expect, it } from 'vitest';

import type { ConteoDetalle, Conteos } from '../../api/tipos';
import { ErrorCsv } from '../../csv/csv';
import { conteoACsv, ENCABEZADOS_CONTEO, nombreCsvConteo } from './csv';
import { alcanceConteo, almacenesContables, buscar, horaEn, vacioConteos } from './reglas';

// F2-123: reglas puras y CSV de los conteos físicos. Valores escritos a mano.

const conteos = (p: Partial<Conteos> = {}): Conteos => ({
  conteos: [],
  total: 0,
  almacenes: [],
  grupos: [],
  sucursales: [{ sucursalId: 's1', sucursal: 'Centro', zonaHoraria: 'America/Mexico_City' }],
  ...p,
});

describe('reglas', () => {
  it('sin conteos ni almacenes con lectura: dice por qué (no hay teórico) y qué falta', () => {
    const v = vacioConteos(
      conteos({
        almacenes: [
          {
            sucursalId: 's1',
            almacenOrigenSrId: 'A',
            almacen: 'General',
            capturadoAt: null,
            atrasada: false,
          },
        ],
      }),
    );
    expect(v.tipo).toBe('sin-lectura');
    if (v.tipo === 'sin-lectura') {
      expect(v.porque).toContain('Centro todavía no ha mandado existencias');
      expect(v.falta).toContain('F2-241');
    }
  });

  it('con almacén con lectura y sin conteos: invita a crear el primero', () => {
    const r = conteos({
      almacenes: [
        {
          sucursalId: 's1',
          almacenOrigenSrId: 'A',
          almacen: 'General',
          capturadoAt: '2026-09-22T15:00:00.000Z',
          atrasada: false,
        },
        {
          sucursalId: 's1',
          almacenOrigenSrId: 'B',
          almacen: 'Barra',
          capturadoAt: null,
          atrasada: false,
        },
      ],
    });
    expect(vacioConteos(r).tipo).toBe('sin-conteos');
    expect(almacenesContables(r).map((a) => a.almacenOrigenSrId)).toEqual(['A']);
  });

  it('búsqueda por nombre, clave o id, sin acentos ni mayúsculas', () => {
    const p = [
      { insumo: 'Jitomate saladet', clave: 'JIT', insumoOrigenSrId: 'I1' },
      { insumo: null, clave: null, insumoOrigenSrId: 'I99' },
      { insumo: 'Limón', clave: 'LIM', insumoOrigenSrId: 'I2' },
    ];
    expect(buscar(p, 'limon').map((x) => x.insumoOrigenSrId)).toEqual(['I2']);
    expect(buscar(p, 'jit').map((x) => x.insumoOrigenSrId)).toEqual(['I1']);
    expect(buscar(p, 'i99').map((x) => x.insumoOrigenSrId)).toEqual(['I99']);
    expect(buscar(p, '  ')).toHaveLength(3);
  });

  it('alcance y hora en la zona de la sucursal', () => {
    expect(alcanceConteo({ grupoOrigenSrId: null, grupo: null })).toBe('Todos los artículos');
    expect(alcanceConteo({ grupoOrigenSrId: 'G1', grupo: 'Lácteos' })).toBe('Grupo Lácteos');
    expect(alcanceConteo({ grupoOrigenSrId: 'G9', grupo: null })).toBe('Grupo G9 (sin catálogo)');
    // 15:30 UTC = 09:30 en CDMX y 08:30 en Tijuana.
    expect(horaEn('America/Mexico_City', '2026-09-22T15:30:00.000Z')).toBe('22/09/2026 09:30');
    expect(horaEn('America/Tijuana', '2026-09-22T15:30:00.000Z')).toBe('22/09/2026 08:30');
  });
});

const detalle = (p: Partial<ConteoDetalle> = {}): ConteoDetalle => ({
  conteo: {
    id: 'c1',
    folio: 7,
    sucursalId: 's1',
    sucursal: 'Plaza Ñuñoa',
    almacenOrigenSrId: 'A1-GEN',
    almacen: 'General',
    grupoOrigenSrId: null,
    grupo: null,
    nota: null,
    estado: 'cerrado',
    teoricoCapturadoAt: '2026-09-22T15:00:00.000Z',
    teoricoAtrasado: false,
    creadoAt: '2026-09-22T15:05:00.000Z',
    cerradoAt: '2026-09-22T16:00:00.000Z',
    canceladoAt: null,
    articulos: 3,
    contados: 2,
  },
  zonaHoraria: 'America/Mexico_City',
  partidas: [
    {
      insumoOrigenSrId: '000123',
      insumo: '=Leche',
      clave: 'LEC',
      unidad: 'L',
      grupo: null,
      teorico: '12.500',
      costoPromedio: '30.00',
      contado: '10.000',
      estado: 'con_diferencia',
      diferencia: '-2.500',
      importe: '-75.00',
      capturadoAt: null,
    },
    {
      insumoOrigenSrId: 'I2',
      insumo: 'Tomate',
      clave: null,
      unidad: 'kg',
      grupo: null,
      teorico: '3.000',
      costoPromedio: '19.99',
      contado: null,
      estado: 'sin_contar',
      diferencia: null,
      importe: null,
      capturadoAt: null,
    },
    {
      insumoOrigenSrId: 'I9',
      insumo: null,
      clave: null,
      unidad: null,
      grupo: null,
      teorico: null,
      costoPromedio: null,
      contado: '3.000',
      estado: 'sin_teorico',
      diferencia: null,
      importe: null,
      capturadoAt: null,
    },
  ],
  totales: {
    articulos: 3,
    contados: 2,
    sinContar: 1,
    sinTeorico: 1,
    conDiferencia: 1,
    sinValuar: 0,
    faltante: '-75.00',
    sobrante: '0.00',
    neto: '-75.00',
  },
  ...p,
});

describe('CSV del conteo', () => {
  const lineas = (csv: string) => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    return csv.slice(1).split('\r\n').slice(0, -1);
  };

  it('una fila por artículo; sin contar / sin teórico con celdas VACÍAS (nunca 0); anti-inyección', () => {
    const l = lineas(conteoACsv(detalle()));
    expect(l[0]).toBe(ENCABEZADOS_CONTEO.join(','));
    expect(l[1]).toBe(
      `7,Plaza Ñuñoa,General,'=Leche,LEC,"=""000123""",L,12.500,10.000,-2.500,30.00,-75.00,Con diferencia`,
    );
    expect(l[2]).toBe('7,Plaza Ñuñoa,General,Tomate,,"=""I2""",kg,3.000,,,19.99,,Sin contar');
    expect(l[3]).toBe(
      '7,Plaza Ñuñoa,General,,,"=""I9""",,,3.000,,,,Sin teórico (no venía en la lectura)',
    );
    expect(l).toHaveLength(4);
  });

  it('Σ de la columna Importe = neto del reporte', () => {
    const l = lineas(conteoACsv(detalle())).slice(1);
    const centavos = l
      .map((x) => x.split(','))
      .map((c) => c[11])
      .filter((v) => v !== '')
      .reduce((s, v) => s + Math.round(Number(v) * 100), 0);
    expect(centavos).toBe(-7500);
  });

  it('un importe ilegible detiene el archivo (nunca se escribe 0)', () => {
    const d = detalle();
    d.partidas[0] = { ...d.partidas[0], importe: 'abc' };
    expect(() => conteoACsv(d)).toThrow(ErrorCsv);
  });

  it('nombre del archivo', () => {
    expect(nombreCsvConteo(detalle())).toBe('conteo_plaza-nunoa_7.csv');
  });
});
