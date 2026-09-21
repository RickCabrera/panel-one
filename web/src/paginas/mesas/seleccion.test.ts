import { describe, expect, it } from 'vitest';

import type { MesaMonitor } from './reglas';
import { buscarSeleccion, seleccionDe } from './seleccion';

const R1 = 1_000;
const R2 = 21_000;

function mesa(
  i: number,
  folio: string | null,
  extra: Partial<MesaMonitor> = {},
  sucursalId = 's1',
): MesaMonitor {
  return {
    mesa: String(i),
    mesero: null,
    folio,
    abiertoAt: 1_000_000 + i,
    total: null,
    comensales: null,
    impreso: null,
    partidas: [],
    clave: `${sucursalId}:${folio ?? ''}:${i}`,
    sucursalId,
    sucursal: 'Centro',
    minutos: null,
    semaforo: 'sin-dato',
    ...extra,
  };
}

describe('buscarSeleccion: qué cuenta muestra el modal tras cada poll', () => {
  it('sin selección no hay mesa', () => {
    expect(buscarSeleccion([mesa(0, 'A')], R1, null)).toBeNull();
  });

  it('en la misma respuesta la encuentra por clave, aun sin folio ni hora', () => {
    const m = mesa(0, null, { abiertoAt: null });
    expect(buscarSeleccion([m], R1, seleccionDe(m, R1, 'Mesa 0'))).toBe(m);
  });

  it('con folio: la encuentra en la respuesta nueva aunque cambie de posición', () => {
    const sel = seleccionDe(mesa(1, 'B'), R1, 'Mesa 1');
    const nueva = mesa(0, 'B', { clave: 's1:B:0', total: 500n });
    expect(buscarSeleccion([mesa(5, 'Z'), nueva], R2, sel)).toBe(nueva);
  });

  it('con folio: si ya no está, o está en otra sucursal, null', () => {
    const sel = seleccionDe(mesa(1, 'B'), R1, 'Mesa 1');
    expect(buscarSeleccion([mesa(0, 'A')], R2, sel)).toBeNull();
    expect(buscarSeleccion([mesa(1, 'B', {}, 's2')], R2, sel)).toBeNull();
  });

  it('un folio repetido es ambiguo: null, no la primera que aparezca', () => {
    const sel = seleccionDe(mesa(1, 'B'), R1, 'Mesa 1');
    expect(buscarSeleccion([mesa(1, 'B'), mesa(2, 'B')], R2, sel)).toBeNull();
  });

  it('sin folio: misma posición, mesa y hora de apertura → la misma cuenta', () => {
    const antes = mesa(1, null);
    const sel = seleccionDe(antes, R1, 'Mesa 1');
    const despues = { ...antes, total: 999n };
    expect(buscarSeleccion([mesa(0, null), despues], R2, sel)).toBe(despues);
  });

  it('sin folio: si el índice se corrió, null — nunca OTRA cuenta bajo el mismo título', () => {
    const sel = seleccionDe(mesa(1, null), R1, 'Mesa 1');
    // Se cerró la cuenta de la posición 0: la de la clave ":1" ahora es otra.
    const otra = mesa(2, null, { clave: 's1::1' });
    expect(buscarSeleccion([otra], R2, sel)).toBeNull();
  });

  it('sin folio ni hora de apertura, en una respuesta nueva no se puede confirmar: null', () => {
    const m = mesa(3, null, { abiertoAt: null, mesa: '3' });
    const sel = seleccionDe(m, R1, 'Mesa 3');
    // Misma clave, misma mesa, también sin hora: podría ser otra cuenta de la mesa 3.
    expect(buscarSeleccion([{ ...m }], R2, sel)).toBeNull();
  });
});
