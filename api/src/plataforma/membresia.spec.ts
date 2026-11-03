import { EstadoSuscripcion, PeriodicidadPlan } from '@prisma/client';

import {
  bloqueaAcceso,
  diaDeTexto,
  esGratuito,
  esDiaValido,
  estadoEfectivo,
  estadoPagoMes,
  fechaLimite,
  hoyPlataforma,
  mensajeBloqueo,
  mensajeLimiteSucursales,
  mesDe,
  mesesPorPeriodo,
  siguienteCorte,
  sumarMeses,
  textoDia,
} from './membresia';

const d = diaDeTexto;
const sus = (estado: EstadoSuscripcion, vencimiento: string, diasGracia = 5, diaCorte = 5) => ({
  estado,
  vencimiento: d(vencimiento),
  diasGracia,
  diaCorte,
});

describe('membresía: reglas puras', () => {
  describe('fechas de calendario', () => {
    it('hoy es el día de CDMX, no el UTC: 05:30 UTC del 3 de nov = 2 de nov en CDMX', () => {
      expect(textoDia(hoyPlataforma(Date.UTC(2026, 10, 3, 5, 30)))).toBe('2026-11-02');
      expect(textoDia(hoyPlataforma(Date.UTC(2026, 10, 3, 6, 30)))).toBe('2026-11-03');
    });

    it('rechaza días que no existen', () => {
      expect(esDiaValido('2026-02-28')).toBe(true);
      expect(esDiaValido('2026-02-29')).toBe(false);
      expect(esDiaValido('2026-13-01')).toBe(false);
      expect(esDiaValido('03/11/2026')).toBe(false);
      expect(() => d('2026-02-30')).toThrow();
    });

    it('sumarMeses conserva el día y, si no existe, usa el último del mes', () => {
      expect(textoDia(sumarMeses(d('2026-11-05'), 1))).toBe('2026-12-05');
      expect(textoDia(sumarMeses(d('2026-12-05'), 1))).toBe('2027-01-05');
      expect(textoDia(sumarMeses(d('2026-01-31'), 1))).toBe('2026-02-28');
      expect(textoDia(sumarMeses(d('2026-11-05'), 12))).toBe('2027-11-05');
    });

    it('un periodo anual son 12 meses', () => {
      expect(mesesPorPeriodo(PeriodicidadPlan.mensual)).toBe(1);
      expect(mesesPorPeriodo(PeriodicidadPlan.anual)).toBe(12);
    });

    it('siguienteCorte es ESTRICTAMENTE después de hoy', () => {
      expect(textoDia(siguienteCorte(d('2026-11-03'), 5))).toBe('2026-11-05');
      expect(textoDia(siguienteCorte(d('2026-11-05'), 5))).toBe('2026-12-05');
      expect(textoDia(siguienteCorte(d('2026-12-20'), 5))).toBe('2027-01-05');
    });

    it('mesDe: primero y último día del mes', () => {
      const { desde, hasta } = mesDe(d('2026-02-14'));
      expect([textoDia(desde), textoDia(hasta)]).toEqual(['2026-02-01', '2026-02-28']);
    });
  });

  describe('estado efectivo (vencida se calcula al leer)', () => {
    it('activa dentro de la gracia sigue activa; un día después del límite, vencida', () => {
      const s = sus('activa', '2026-11-05', 5);
      expect(textoDia(fechaLimite(s))).toBe('2026-11-10');
      expect(estadoEfectivo(s, d('2026-11-05'))).toBe('activa');
      expect(estadoEfectivo(s, d('2026-11-10'))).toBe('activa');
      expect(estadoEfectivo(s, d('2026-11-11'))).toBe('vencida');
    });

    it('un plan de $0 (gratuita) nunca queda vencida y su mensualidad cuenta como pagada', () => {
      const s = { ...sus('activa', '2026-01-05', 0), gratuita: true };
      expect(estadoEfectivo(s, d('2026-11-03'))).toBe('activa');
      expect(estadoPagoMes(s, d('2026-11-03'))).toBe('pagado');
      expect(esGratuito('0.00')).toBe(true);
      expect(esGratuito('0.01')).toBe(false);
      // Suspender a mano sigue valiendo aunque sea gratuita.
      expect(estadoEfectivo({ ...s, estado: 'suspendida' }, d('2026-11-03'))).toBe('suspendida');
    });

    it('una prueba que se acaba sin pago también queda vencida', () => {
      expect(estadoEfectivo(sus('prueba', '2026-11-01', 0), d('2026-11-02'))).toBe('vencida');
    });

    it('suspendida y cancelada son las guardadas, aunque estén al corriente', () => {
      expect(estadoEfectivo(sus('suspendida', '2027-01-01'), d('2026-11-03'))).toBe('suspendida');
      expect(estadoEfectivo(sus('cancelada', '2026-01-01'), d('2026-11-03'))).toBe('cancelada');
    });

    it('sólo suspendida y cancelada bloquean el acceso (vencida NO)', () => {
      expect(bloqueaAcceso(EstadoSuscripcion.suspendida)).toBe(true);
      expect(bloqueaAcceso(EstadoSuscripcion.cancelada)).toBe(true);
      expect(bloqueaAcceso(EstadoSuscripcion.activa)).toBe(false);
      expect(bloqueaAcceso(EstadoSuscripcion.prueba)).toBe(false);
      expect(bloqueaAcceso(null)).toBe(false);
      expect(bloqueaAcceso(undefined)).toBe(false);
    });

    it('el mensaje de bloqueo es el que pidió Ricardo', () => {
      expect(mensajeBloqueo(EstadoSuscripcion.suspendida)).toBe(
        'Tu cuenta está suspendida. Contacta a soporte.',
      );
      expect(mensajeBloqueo(EstadoSuscripcion.cancelada)).toBe(
        'Tu cuenta está cancelada. Contacta a soporte.',
      );
    });
  });

  describe('mensualidad del mes (pantalla de Pagos)', () => {
    it('pendiente: el corte de este mes todavía no se paga y está en plazo', () => {
      expect(estadoPagoMes(sus('activa', '2026-11-05'), d('2026-11-03'))).toBe('pendiente');
      expect(estadoPagoMes(sus('activa', '2026-11-05'), d('2026-11-09'))).toBe('pendiente');
    });

    it('pagado: el vencimiento ya pasó el corte de este mes', () => {
      expect(estadoPagoMes(sus('activa', '2026-12-05'), d('2026-11-03'))).toBe('pagado');
      expect(estadoPagoMes(sus('activa', '2026-12-05'), d('2026-11-28'))).toBe('pagado');
    });

    it('vencido: fuera de la gracia', () => {
      expect(estadoPagoMes(sus('activa', '2026-10-05'), d('2026-11-03'))).toBe('vencido');
      expect(estadoPagoMes(sus('activa', '2026-11-05'), d('2026-11-11'))).toBe('vencido');
    });
  });

  it('el mensaje del límite distingue al admin_global (puede forzar) del dueño', () => {
    expect(mensajeLimiteSucursales(false, 'Básico', 1, 1)).toBe(
      'Tu plan (Básico) permite 1 sucursal activa. Para agregar más, contacta a soporte.',
    );
    expect(mensajeLimiteSucursales(true, 'Básico', 3, 3)).toContain('forzarLimite');
  });
});
