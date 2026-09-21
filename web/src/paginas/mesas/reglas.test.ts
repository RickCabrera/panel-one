import { describe, expect, it } from 'vitest';

import type { MesasSucursal } from '../../api/tipos';
import {
  armarMonitor,
  edadEfectiva,
  frescura,
  minutosAbierta,
  semaforo,
  UMBRAL_DESCONEXION_S,
} from './reglas';

const T0 = Date.UTC(2026, 8, 20, 20, 0, 0); // 2026-09-20T20:00:00Z
const min = (n: number) => n * 60_000;

describe('semaforo: < 40 ok · 40–60 alerta · > 60 rojo', () => {
  it.each([
    [0, 'ok'],
    [39, 'ok'],
    [40, 'alerta'],
    [60, 'alerta'],
    [61, 'rojo'],
    [300, 'rojo'],
  ] as const)('%i min → %s', (m, esperado) => {
    expect(semaforo(m)).toBe(esperado);
  });

  it('sin minutos → sin-dato', () => {
    expect(semaforo(null)).toBe('sin-dato');
  });
});

describe('minutosAbierta', () => {
  it('trunca a minutos enteros: 60 min 59 s es 60 (alerta), 61 min es rojo', () => {
    const capturado = T0;
    expect(minutosAbierta(capturado - min(60) - 59_000, capturado, 0)).toBe(60);
    expect(semaforo(minutosAbierta(capturado - min(60) - 59_000, capturado, 0))).toBe('alerta');
    expect(minutosAbierta(capturado - min(61), capturado, 0)).toBe(61);
  });

  it('suma lo que pasó desde la captura (edad efectiva)', () => {
    // 39 min al capturar + 60 s de edad = 40 min: pasa a alerta.
    expect(minutosAbierta(T0 - min(39), T0, 60)).toBe(40);
    // 39 min + 59 s: todavía 39.
    expect(minutosAbierta(T0 - min(39), T0, 59)).toBe(39);
  });

  it('un reloj del POS adelantado 1 h no mueve los minutos (resta con el mismo reloj)', () => {
    const hora = min(60);
    expect(minutosAbierta(T0 - min(45) + hora, T0 + hora, 10)).toBe(45);
    expect(minutosAbierta(T0 - min(45), T0, 10)).toBe(45);
  });

  it('una apertura posterior a la captura es inconsistente: null, no 0', () => {
    expect(minutosAbierta(T0 + 1000, T0, 0)).toBeNull();
    expect(minutosAbierta(null, T0, 0)).toBeNull();
    expect(minutosAbierta(T0, Number.NaN, 0)).toBeNull();
  });
});

describe('edadEfectiva y frescura', () => {
  it('la edad del API más lo que pasó desde la respuesta', () => {
    expect(edadEfectiva(30, T0, T0)).toBe(30);
    expect(edadEfectiva(30, T0, T0 + 61_500)).toBe(91);
    // El reloj de la vista puede ir detrás de la respuesta: nunca resta.
    expect(edadEfectiva(30, T0, T0 - 4_000)).toBe(30);
  });

  it('umbral de desconexión: 3 intervalos de 30 s', () => {
    expect(UMBRAL_DESCONEXION_S).toBe(90);
    expect(frescura(60)).toBe('fresca');
    expect(frescura(61)).toBe('demorada');
    expect(frescura(90)).toBe('demorada');
    expect(frescura(91)).toBe('desconectada');
  });
});

// --- armarMonitor -----------------------------------------------------------------

function fila(
  sucursalId: string,
  nombre: string,
  edadRecepcionSegundos: number | null,
  mesas: Record<string, unknown>[] = [],
): MesasSucursal {
  return {
    sucursalId,
    nombre,
    zonaHoraria: 'America/Mexico_City',
    snapshot:
      edadRecepcionSegundos === null
        ? null
        : {
            capturadoAt: new Date(T0 - edadRecepcionSegundos * 1000).toISOString(),
            recibidoAt: new Date(T0 - edadRecepcionSegundos * 1000).toISOString(),
            edadSegundos: edadRecepcionSegundos,
            edadRecepcionSegundos,
            mesas,
          },
  };
}

/** Una mesa abierta `m` minutos antes de T0 (la captura es T0 − edad). */
function mesa(numero: string, total: unknown, abiertaHaceMin: number, extra = {}) {
  return {
    mesa: numero,
    mesero: 'Mesero',
    folio: `F-${numero}`,
    abiertoAt: new Date(T0 - min(abiertaHaceMin)).toISOString(),
    total,
    impreso: false,
    partidas: [],
    ...extra,
  };
}

describe('armarMonitor', () => {
  it('KPIs de una sucursal conectada (cifras a mano)', () => {
    const m = armarMonitor(
      [
        fila('c', 'Centro', 30, [
          mesa('1', '0.10', 10),
          mesa('2', '0.20', 45, { impreso: true }),
          mesa('3', '1200.00', 61),
          mesa('4', 99.9, 130),
        ]),
      ],
      T0,
      T0,
    );
    expect(m.kpis.mesas).toBe(4);
    // 0.10 + 0.20 + 1200.00 + 99.90 = 1300.20
    expect(m.kpis.enCurso).toBe(130020n);
    expect(m.kpis.sinImprimir).toBe(3);
    expect(m.kpis.atencion).toBe(2);
    expect(m.kpis.sinHora).toBe(0);
    expect(m.kpis.excluidas).toEqual([]);
    expect(m.mesas.map((x) => [x.mesa, x.minutos, x.semaforo])).toEqual([
      ['1', 10, 'ok'],
      ['2', 45, 'alerta'],
      ['3', 61, 'rojo'],
      ['4', 130, 'rojo'],
    ]);
  });

  it('la desconectada no pinta mesas ni entra en las cifras', () => {
    const m = armarMonitor(
      [
        fila('c', 'Centro', 30, [mesa('1', '100.00', 10)]),
        fila('n', 'Norte', 7200, [mesa('9', '5000.00', 150)]),
      ],
      T0,
      T0,
    );
    expect(m.sucursales.map((s) => [s.nombre, s.estado])).toEqual([
      ['Centro', 'conectada'],
      ['Norte', 'desconectada'],
    ]);
    expect(m.mesas.map((x) => x.mesa)).toEqual(['1']);
    expect(m.kpis.enCurso).toBe(10000n);
    expect(m.kpis.atencion).toBe(0);
    expect(m.kpis.excluidas).toEqual(['Norte']);
    // La última lectura es la más vieja de las que SE SUMAN (F1-094): la de Centro.
    // Norte ya sale en `excluidas` y en su banner.
    expect(m.kpis.ultimaLectura).toEqual({
      recibidoAt: T0 - 30_000,
      edadSegundos: 30,
      frescura: 'fresca',
    });
  });

  it('"Última lectura": la más vieja de las conectadas; sin conectadas, null', () => {
    const dos = armarMonitor(
      [fila('c', 'Centro', 10, []), fila('n', 'Norte', 80, []), fila('s', 'Sur', 95, [])],
      T0,
      T0,
    );
    expect(dos.kpis.ultimaLectura?.edadSegundos).toBe(80);
    expect(dos.kpis.ultimaLectura?.frescura).toBe('demorada');
    const ninguna = armarMonitor([fila('n', 'Norte', 7200, [])], T0, T0);
    expect(ninguna.kpis.ultimaLectura).toBeNull();
  });

  it('90 s es conectada; 91 s ya no', () => {
    const noventa = armarMonitor([fila('c', 'Centro', 90, [mesa('1', '1.00', 5)])], T0, T0);
    expect(noventa.sucursales[0].estado).toBe('conectada');
    expect(noventa.mesas).toHaveLength(1);
    const noventaYUno = armarMonitor([fila('c', 'Centro', 91, [mesa('1', '1.00', 5)])], T0, T0);
    expect(noventaYUno.sucursales[0].estado).toBe('desconectada');
    expect(noventaYUno.mesas).toHaveLength(0);
  });

  it('si el API deja de contestar, la última respuesta envejece sola', () => {
    const filas = [fila('c', 'Centro', 10, [mesa('1', '1.00', 5)])];
    expect(armarMonitor(filas, T0, T0 + 80_000).sucursales[0].estado).toBe('conectada');
    const tarde = armarMonitor(filas, T0, T0 + 81_000);
    expect(tarde.sucursales[0].estado).toBe('desconectada');
    expect(tarde.mesas).toHaveLength(0);
  });

  it('los minutos avanzan entre consultas con la hora de la vista', () => {
    const filas = [fila('c', 'Centro', 0, [mesa('1', '1.00', 39)])];
    expect(armarMonitor(filas, T0, T0).mesas[0].minutos).toBe(39);
    expect(armarMonitor(filas, T0, T0 + 60_000).mesas[0].minutos).toBe(40);
  });

  it('la que nunca reportó queda fuera y dicha', () => {
    const m = armarMonitor([fila('c', 'Centro', 5, []), fila('t', 'Tijuana', null)], T0, T0);
    expect(m.sucursales[1]).toEqual({
      sucursalId: 't',
      nombre: 'Tijuana',
      estado: 'sin-reporte',
      edadSegundos: null,
      recibidoAt: null,
    });
    expect(m.kpis.excluidas).toEqual(['Tijuana']);
    expect(m.kpis.ultimaLectura?.edadSegundos).toBe(5);
  });

  it('un total ilegible anula la suma; un impreso ausente anula el conteo', () => {
    const m = armarMonitor(
      [
        fila('c', 'Centro', 5, [
          mesa('1', '10.00', 5),
          mesa('2', 'diez', 5, { impreso: undefined }),
        ]),
      ],
      T0,
      T0,
    );
    expect(m.kpis.enCurso).toBeNull();
    expect(m.kpis.sinImprimir).toBeNull();
  });

  it('una mesa sin hora de apertura no cuenta como atendida a tiempo: se reporta aparte', () => {
    const m = armarMonitor(
      [fila('c', 'Centro', 5, [mesa('1', '1.00', 70), mesa('2', '1.00', 0, { abiertoAt: null })])],
      T0,
      T0,
    );
    expect(m.kpis.atencion).toBe(1);
    expect(m.kpis.sinHora).toBe(1);
    expect(m.mesas[1].semaforo).toBe('sin-dato');
  });

  it('orden natural por número de mesa, estable; sin número al final', () => {
    const m = armarMonitor(
      [
        fila('c', 'Centro', 5, [
          mesa('10', '1.00', 1),
          mesa('', '1.00', 1),
          mesa('2', '1.00', 1),
          mesa('Barra', '1.00', 1),
          mesa('1', '1.00', 1),
        ]),
      ],
      T0,
      T0,
    );
    expect(m.mesas.map((x) => x.mesa)).toEqual(['1', '2', '10', 'Barra', null]);
  });
});
