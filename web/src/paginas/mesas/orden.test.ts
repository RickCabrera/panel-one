import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  filtrarMesas,
  guardarPreferencia,
  leerPreferencia,
  ordenarMesas,
  resolverCriterio,
} from './orden';
import type { MesaViva } from './reglas';

const T0 = Date.UTC(2026, 8, 20, 20, 0, 0);

function viva(
  mesa: string,
  apertura: number | null,
  total: bigint | null,
  impreso: boolean | null = false,
): MesaViva {
  return {
    mesa,
    mesero: null,
    folio: `F-${mesa}`,
    abiertoAt: null,
    total,
    comensales: null,
    impreso,
    partidas: [],
    clave: `s:F-${mesa}:0`,
    sucursalId: 's',
    sucursal: 'S',
    apertura,
    firma: mesa,
  };
}

// Llegan en orden de mesa (el de mesasVivas).
const MESAS = [
  viva('1', T0 - 10_000, 5000n),
  viva('2', null, 90000n),
  viva('3', T0 - 90_000, null),
  viva('4', T0 - 90_000, 90000n),
  viva('5', T0 - 50_000, 100n, true),
  viva('6', T0 - 20_000, 300n, null),
];
const numeros = (ms: MesaViva[]) => ms.map((m) => m.mesa);

describe('ordenarMesas', () => {
  it('por mesa: deja el orden de llegada', () => {
    expect(numeros(ordenarMesas(MESAS, 'mesa'))).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('por antigüedad: la más vieja primero; empate por mesa; sin hora al final', () => {
    expect(numeros(ordenarMesas(MESAS, 'antiguedad'))).toEqual(['3', '4', '5', '6', '1', '2']);
  });

  it('por importe: el mayor primero; empate por mesa; sin dato al final', () => {
    expect(numeros(ordenarMesas(MESAS, 'importe'))).toEqual(['2', '4', '1', '6', '5', '3']);
  });

  it('no toca la lista original', () => {
    const copia = [...MESAS];
    ordenarMesas(MESAS, 'importe');
    expect(MESAS).toEqual(copia);
  });
});

describe('filtrarMesas', () => {
  it('atención: sólo las claves que le pasan (las calcula quien tiene el reloj)', () => {
    expect(numeros(filtrarMesas(MESAS, 'atencion', new Set(['s:F-4:0', 's:F-1:0'])))).toEqual([
      '1',
      '4',
    ]);
  });

  it('sin imprimir: impreso === false; null (no se sabe) no entra', () => {
    expect(numeros(filtrarMesas(MESAS, 'sin-imprimir', new Set()))).toEqual(['1', '2', '3', '4']);
  });

  it('todas: todas', () => {
    expect(filtrarMesas(MESAS, 'todas', new Set())).toHaveLength(6);
  });
});

describe('criterio: URL > guardado > default', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const url = (q: string) => new URLSearchParams(q);

  it('la URL válida manda, campo por campo', () => {
    expect(
      resolverCriterio(url('orden=importe&estado=atencion'), {
        orden: 'antiguedad',
        estado: 'sin-imprimir',
      }),
    ).toEqual({ orden: 'importe', estado: 'atencion' });
    expect(
      resolverCriterio(url('orden=importe'), { orden: 'antiguedad', estado: 'sin-imprimir' }),
    ).toEqual({ orden: 'importe', estado: 'sin-imprimir' });
  });

  it('un valor inválido en la URL se ignora; sin nada, el default', () => {
    expect(
      resolverCriterio(url('orden=precio&estado=rojo'), { orden: 'antiguedad', estado: null }),
    ).toEqual({ orden: 'antiguedad', estado: 'todas' });
    expect(resolverCriterio(url(''), { orden: null, estado: null })).toEqual({
      orden: 'mesa',
      estado: 'todas',
    });
  });

  it('guardar y leer por usuario; otro usuario no lo hereda', () => {
    guardarPreferencia('u1', { orden: 'importe', estado: 'atencion' });
    expect(leerPreferencia('u1')).toEqual({ orden: 'importe', estado: 'atencion' });
    expect(leerPreferencia('u2')).toEqual({ orden: null, estado: null });
  });

  it('lo guardado ilegible o fuera de la lista no cuenta', () => {
    window.localStorage.setItem('monitor-mesas:u1', '{roto');
    expect(leerPreferencia('u1')).toEqual({ orden: null, estado: null });
    window.localStorage.setItem('monitor-mesas:u1', JSON.stringify({ orden: 'x', estado: 3 }));
    expect(leerPreferencia('u1')).toEqual({ orden: null, estado: null });
    window.localStorage.setItem('monitor-mesas:u1', JSON.stringify({ orden: 'importe' }));
    expect(leerPreferencia('u1')).toEqual({ orden: 'importe', estado: null });
    window.localStorage.setItem('monitor-mesas:u1', 'null');
    expect(leerPreferencia('u1')).toEqual({ orden: null, estado: null });
  });

  it('un localStorage que lanza no rompe nada', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('lleno');
    });
    expect(() => guardarPreferencia('u1', { orden: 'importe', estado: 'todas' })).not.toThrow();
    expect(leerPreferencia('u1')).toEqual({ orden: null, estado: null });
  });
});
