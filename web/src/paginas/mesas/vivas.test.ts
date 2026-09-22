import { describe, expect, it } from 'vitest';

import type { MesasSucursal } from '../../api/tipos';
import {
  aperturaEnNavegador,
  armarMonitor,
  estabilizarAperturas,
  estadosSucursales,
  firmaDe,
  mesasVivas,
  minutosDesde,
  requiereAtencion,
  TOLERANCIA_APERTURA_MS,
  type MesaViva,
} from './reglas';

// F2-223: el modelo del Monitor que NO depende del reloj.

const T0 = Date.UTC(2026, 8, 20, 20, 0, 0); // 2026-09-20T20:00:00Z
const min = (n: number) => n * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Una sucursal con captura en `capturadoAt` y la edad de recepción dada. */
function fila(
  id: string,
  mesas: Record<string, unknown>[],
  { capturadoAt = T0, edad = 10 }: { capturadoAt?: number; edad?: number } = {},
): MesasSucursal {
  return {
    sucursalId: id,
    nombre: `Sucursal ${id}`,
    zonaHoraria: 'America/Mexico_City',
    snapshot: {
      capturadoAt: iso(capturadoAt),
      recibidoAt: iso(T0),
      edadSegundos: edad,
      edadRecepcionSegundos: edad,
      mesas,
    },
  };
}

const mesa = (numero: string, abiertaHaceMin: number, extra: Record<string, unknown> = {}) => ({
  mesa: numero,
  folio: `F-${numero}`,
  abiertoAt: iso(T0 - min(abiertaHaceMin)),
  total: '100.00',
  impreso: false,
  partidas: [],
  ...extra,
});

describe('aperturaEnNavegador y minutosDesde', () => {
  it('apertura = respuestaAt − edad de recepción − (captura − apertura en el POS)', () => {
    // Respondió 30 s después de T0 con 10 s de edad; abierta 45 min antes de capturar.
    expect(aperturaEnNavegador(T0 - min(45), T0, 10, T0 + 30_000)).toBe(
      T0 + 30_000 - 10_000 - min(45),
    );
  });

  it('un reloj del POS adelantado 1 h no mueve la apertura', () => {
    const hora = min(60);
    expect(aperturaEnNavegador(T0 - min(45) + hora, T0 + hora, 10, T0)).toBe(
      aperturaEnNavegador(T0 - min(45), T0, 10, T0),
    );
  });

  it('sin hora, con captura ilegible o apertura posterior a la captura: null', () => {
    expect(aperturaEnNavegador(null, T0, 0, T0)).toBeNull();
    expect(aperturaEnNavegador(T0, Number.NaN, 0, T0)).toBeNull();
    expect(aperturaEnNavegador(T0 + 1, T0, 0, T0)).toBeNull();
    expect(minutosDesde(null, T0)).toBeNull();
  });

  it('trunca a minutos enteros y nunca da negativo', () => {
    expect(minutosDesde(T0 - min(60) - 59_000, T0)).toBe(60);
    expect(minutosDesde(T0 - min(61), T0)).toBe(61);
    expect(minutosDesde(T0 + 5_000, T0)).toBe(0);
  });

  it('con edades en segundos enteros da los MISMOS minutos que armarMonitor', () => {
    const filas = [
      fila('a', [mesa('1', 10), mesa('2', 39), mesa('3', 60), mesa('4', 61), mesa('5', 150)], {
        edad: 25,
      }),
    ];
    const respuestaAt = T0 + 25_000;
    const vivas = mesasVivas(filas, respuestaAt, new Set(['a'])).mesas;
    // Hasta 65 s: con 25 s de edad, más de 90 s ya sería desconectada (armarMonitor la saca).
    for (const ahora of [respuestaAt, respuestaAt + 35_000, respuestaAt + 65_000]) {
      const viejo = armarMonitor(filas, respuestaAt, ahora).mesas.map((m) => m.minutos);
      expect(vivas.map((m) => minutosDesde(m.apertura, ahora))).toEqual(viejo);
    }
  });

  it('requiereAtencion: rojo (> 60 min) sí; sin hora, no', () => {
    expect(requiereAtencion({ apertura: T0 - min(61) }, T0)).toBe(true);
    expect(requiereAtencion({ apertura: T0 - min(60) }, T0)).toBe(false);
    expect(requiereAtencion({ apertura: null }, T0)).toBe(false);
  });
});

describe('estadosSucursales', () => {
  it('conectada, desconectada (> 90 s) y sin reporte, y la edad sigue creciendo', () => {
    const filas: MesasSucursal[] = [
      fila('a', [], { edad: 30 }),
      fila('b', [], { edad: 91 }),
      { sucursalId: 'c', nombre: 'C', zonaHoraria: 'America/Mexico_City', snapshot: null },
    ];
    expect(estadosSucursales(filas, T0, T0).map((s) => s.estado)).toEqual([
      'conectada',
      'desconectada',
      'sin-reporte',
    ]);
    // 61 s después la primera también pasó el umbral.
    expect(estadosSucursales(filas, T0, T0 + 61_000)[0].estado).toBe('desconectada');
  });
});

describe('mesasVivas', () => {
  it('sólo las de sucursales conectadas, en orden de mesa, sin nada que dependa del reloj', () => {
    const filas = [fila('a', [mesa('10', 5), mesa('2', 5)]), fila('b', [mesa('1', 5)])];
    const { mesas } = mesasVivas(filas, T0, new Set(['a']));
    expect(mesas.map((m) => m.mesa)).toEqual(['2', '10']);
    expect(mesas.every((m) => m.sucursalId === 'a')).toBe(true);
    expect(mesas[0]).not.toHaveProperty('minutos');
  });

  it('la misma respuesta, recalculada, da la misma firma', () => {
    const filas = [fila('a', [mesa('1', 5)])];
    const a = mesasVivas(filas, T0, new Set(['a'])).mesas[0];
    const b = mesasVivas(filas, T0, new Set(['a'])).mesas[0];
    expect(a.firma).toBe(b.firma);
  });

  it('la firma cambia si cambia cualquier cosa que pinta la tarjeta', () => {
    const base = mesasVivas([fila('a', [mesa('1', 5)])], T0, new Set(['a'])).mesas[0];
    const sinFirma: Omit<MesaViva, 'firma'> = { ...base };
    const cambios: Array<Partial<MesaViva>> = [
      { total: 1n },
      { mesero: 'Otro' },
      { comensales: 7 },
      { impreso: true },
      { mesa: '99' },
      { sucursal: 'Otra' },
      { apertura: base.apertura! - 10_000 },
      { partidas: [] },
      {
        partidas: [
          {
            producto: 'x',
            cantidad: '1',
            categoria: null,
            precioUnit: null,
            total: null,
            modificadores: [],
            comandaImpresa: false,
          },
        ],
      },
    ];
    const firmas = new Set([firmaDe(sinFirma)]);
    for (const c of cambios) firmas.add(firmaDe({ ...sinFirma, ...c }));
    // `partidas: []` es igual al original (la mesa no trae partidas): una menos.
    expect(firmas.size).toBe(cambios.length);
  });
});

describe('estabilizarAperturas', () => {
  const viva = (folio: string | null, apertura: number | null, sucursalId = 'a') => ({
    ...mesasVivas([fila('a', [mesa('1', 5)])], T0, new Set(['a'])).mesas[0],
    folio,
    apertura,
    sucursalId,
  });

  it('dentro de la tolerancia conserva la apertura anterior; el error no se acumula', () => {
    const primera = estabilizarAperturas([viva('F1', T0)], new Map());
    expect(primera.mesas[0].apertura).toBe(T0);

    // Poll siguiente: 900 ms de ruido → se queda la anterior (mismo objeto).
    const segunda = estabilizarAperturas([viva('F1', T0 + 900)], primera.aperturas);
    expect(segunda.mesas[0].apertura).toBe(T0);

    // Otro poll a +1.9 s de la GUARDADA: se queda; a +2 s ya es otra apertura.
    expect(
      estabilizarAperturas([viva('F1', T0 + 1_900)], segunda.aperturas).mesas[0].apertura,
    ).toBe(T0);
    expect(
      estabilizarAperturas([viva('F1', T0 + TOLERANCIA_APERTURA_MS)], segunda.aperturas).mesas[0]
        .apertura,
    ).toBe(T0 + TOLERANCIA_APERTURA_MS);
  });

  it('sin folio, con folio repetido o sin apertura: no se estabiliza', () => {
    const previas = new Map([
      ['a␟F1', T0],
      ['a␟F2', T0],
    ]);
    const { mesas, aperturas } = estabilizarAperturas(
      [viva(null, T0 + 500), viva('F1', T0 + 500), viva('F1', T0 + 700), viva('F2', null)],
      previas,
    );
    expect(mesas.map((m) => m.apertura)).toEqual([T0 + 500, T0 + 500, T0 + 700, null]);
    expect(aperturas.size).toBe(0);
  });

  it('la llave lleva la sucursal: el mismo folio en otra sucursal es otra cuenta', () => {
    const previas = new Map([['a␟F1', T0]]);
    const { mesas } = estabilizarAperturas([viva('F1', T0 + 500, 'b')], previas);
    expect(mesas[0].apertura).toBe(T0 + 500);
  });

  it('mesasVivas estabiliza contra las previas y las devuelve para el siguiente poll', () => {
    const filas = [fila('a', [mesa('1', 5)], { edad: 10 })];
    const uno = mesasVivas(filas, T0, new Set(['a']));
    // 20 s después, la edad llegó en segundos enteros: 400 ms de diferencia.
    const filas2 = [fila('a', [mesa('1', 5)], { edad: 29 })];
    const dos = mesasVivas(filas2, T0 + 19_400, new Set(['a']), uno.aperturas);
    expect(dos.mesas[0].apertura).toBe(uno.mesas[0].apertura);
    expect(dos.mesas[0].firma).toBe(uno.mesas[0].firma);
  });
});
