import { describe, expect, it } from 'vitest';

import {
  MENSAJE_01_SIN_SUSTITUTO,
  MENSAJE_CON_SUSTITUTO,
  cancelacionAbierta,
  motivosPara,
  pedidoCancelacion,
  puedeCancelar,
  textoCancelacion,
} from './cancelacion';

const SUS = 'AAAAAAAA-396D-4725-8521-CDC4BDD20C99';
const TICKET = { origen: 'ticket' as const, sustituidoPor: null, sustitucionPendiente: false };
const abierta = (estado: 'solicitando' | 'en_proceso' | 'rechazada') => ({
  estado,
  motivo: '02',
  solicitadaAt: '2026-09-21T16:00:00.000Z',
  resueltaAt: estado === 'rechazada' ? '2026-09-21T17:00:00.000Z' : null,
});

describe('cancelación (F2-109): reglas del formulario', () => {
  it('motivos por origen: ticket/manual 01–03; global 02–04', () => {
    expect(motivosPara({ origen: 'ticket' })).toEqual(['01', '02', '03']);
    expect(motivosPara({ origen: 'manual' })).toEqual(['01', '02', '03']);
    expect(motivosPara({ origen: 'global' })).toEqual(['02', '03', '04']);
  });

  it('sin motivo no hay pedido; 04 en un ticket no aplica', () => {
    expect(pedidoCancelacion(TICKET, null)).toEqual({ ok: false, razon: null });
    expect(pedidoCancelacion(TICKET, '04')).toMatchObject({ ok: false });
    expect(pedidoCancelacion(TICKET, '02')).toEqual({ ok: true, pedido: { motivo: '02' } });
  });

  it('01 sin sustituto NO deja continuar; con sustituto manda su UUID y bloquea los demás', () => {
    expect(pedidoCancelacion(TICKET, '01')).toEqual({ ok: false, razon: MENSAJE_01_SIN_SUSTITUTO });
    const con = { ...TICKET, sustituidoPor: SUS, sustitucionPendiente: true };
    expect(pedidoCancelacion(con, '01')).toEqual({
      ok: true,
      pedido: { motivo: '01', uuidSustitucion: SUS },
    });
    expect(pedidoCancelacion(con, '02')).toEqual({ ok: false, razon: MENSAJE_CON_SUSTITUTO });
    // Un sustituto que NO está pendiente (p. ej. cancelado) no sirve para el 01.
    expect(pedidoCancelacion({ ...TICKET, sustituidoPor: SUS }, '01')).toMatchObject({ ok: false });
  });

  it('Cancelar vs. Actualizar estado según la solicitud', () => {
    expect(puedeCancelar({ estado: 'vigente', cancelacion: null })).toBe(true);
    expect(puedeCancelar({ estado: 'cancelado', cancelacion: null })).toBe(false);
    expect(puedeCancelar({ estado: 'vigente', cancelacion: abierta('rechazada') })).toBe(true);
    for (const e of ['solicitando', 'en_proceso'] as const) {
      expect(puedeCancelar({ estado: 'vigente', cancelacion: abierta(e) })).toBe(false);
      expect(cancelacionAbierta({ estado: 'vigente', cancelacion: abierta(e) })).toBe(true);
    }
    expect(cancelacionAbierta({ estado: 'vigente', cancelacion: abierta('rechazada') })).toBe(
      false,
    );
  });

  it('el texto de cada estado dice qué pasa', () => {
    expect(textoCancelacion(abierta('en_proceso'))).toMatch(/en proceso.*receptor/);
    expect(textoCancelacion(abierta('solicitando'))).toMatch(/sin confirmar.*consulta/);
    expect(textoCancelacion(abierta('rechazada'))).toMatch(/rechazó/);
  });
});
