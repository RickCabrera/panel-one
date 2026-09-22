import { describe, expect, it } from 'vitest';

import type { Existencias, FilaExistencia } from '../../api/tipos';
import {
  filtrarPorEstado,
  horaLectura,
  leerValorAlmacen,
  nombreAlmacen,
  sucursalesSinLectura,
  TEXTO_ESTADO,
  vacio,
  vacioANulo,
  valorAlmacen,
} from './reglas';

const f = (insumoOrigenSrId: string, estado: FilaExistencia['estado']): FilaExistencia => ({
  sucursalId: 's1',
  sucursal: 'Centro',
  almacenOrigenSrId: 'A',
  almacen: null,
  insumoOrigenSrId,
  insumo: null,
  clave: null,
  unidad: null,
  cantidad: '1.000',
  costoPromedio: '1.00',
  valor: '1.00',
  minimo: null,
  maximo: null,
  estado,
});

const base = (p: Partial<Existencias> = {}): Existencias => ({
  kpis: {
    articulos: 0,
    valor: '0.00',
    atencion: 0,
    sinExistencia: 0,
    sobreMaximo: 0,
    sinLectura: 0,
  },
  filas: [],
  almacenes: [],
  sucursales: [
    {
      sucursalId: 's1',
      sucursal: 'Centro',
      zonaHoraria: 'America/Mexico_City',
      almacenesLeidos: 0,
    },
  ],
  ...p,
});

describe('reglas de Existencias (F2-121)', () => {
  it('cada estado tiene texto (el color nunca va solo)', () => {
    for (const t of Object.values(TEXTO_ESTADO)) expect(t.length).toBeGreaterThan(3);
  });

  it('filtrarPorEstado', () => {
    const filas = [f('1', 'bajo_minimo'), f('2', 'ok'), f('3', 'sin_existencia')];
    expect(filtrarPorEstado(filas, 'todos').map((x) => x.insumoOrigenSrId)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(filtrarPorEstado(filas, 'bajo_minimo').map((x) => x.insumoOrigenSrId)).toEqual(['1']);
    expect(filtrarPorEstado(filas, 'sin_lectura')).toEqual([]);
  });

  it('valor del selector de almacén: ida y vuelta; basura = sin filtro', () => {
    const v = valorAlmacen({ sucursalId: 's1', almacenOrigenSrId: 'A"1' });
    expect(leerValorAlmacen(v)).toEqual({ sucursalId: 's1', almacenOrigenSrId: 'A"1' });
    expect(leerValorAlmacen('')).toBeNull();
    expect(leerValorAlmacen('[1,2]')).toBeNull();
  });

  it('nombre del almacén sin catálogo lo dice', () => {
    expect(nombreAlmacen({ almacen: null, almacenOrigenSrId: 'X9' })).toBe(
      'Almacén X9 (sin catálogo)',
    );
  });

  it('hora de lectura en la zona de la sucursal', () => {
    expect(horaLectura('America/Mexico_City', '2026-09-22T15:30:00.000Z')).toBe('22/09/2026 09:30');
    expect(horaLectura('America/Tijuana', '2026-09-22T15:30:00.000Z')).toBe('22/09/2026 08:30');
  });

  it('vacío sólo si NINGUNA sucursal ha mandado; sucursales sin lectura para el aviso', () => {
    expect(vacio(base()).tipo).toBe('sin-lectura');
    const con = base({
      sucursales: [
        {
          sucursalId: 's1',
          sucursal: 'Centro',
          zonaHoraria: 'America/Mexico_City',
          almacenesLeidos: 1,
        },
        {
          sucursalId: 's2',
          sucursal: 'Norte',
          zonaHoraria: 'America/Mexico_City',
          almacenesLeidos: 0,
        },
      ],
    });
    expect(vacio(con).tipo).toBe('con-datos');
    expect(sucursalesSinLectura(con)).toEqual(['Norte']);
  });

  it('vacioANulo', () => {
    expect(vacioANulo('  ')).toBeNull();
    expect(vacioANulo(' 2.5 ')).toBe('2.5');
  });
});
