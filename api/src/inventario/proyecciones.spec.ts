import { Prisma } from '@prisma/client';

import {
  diaDeSemana,
  diasDeHistorial,
  diasDelHorizonte,
  proyectar,
  sugerido,
  tieneHistorial,
  ventanaDe,
} from './proyecciones';

// Proyecciones (F2-127), la parte pura. Los esperados están calculados A MANO en los comentarios.

const D = (v: string | number) => new Prisma.Decimal(v);
const HOY = '2026-09-16'; // miércoles

describe('ventana y horizonte', () => {
  it('la ventana son las 28 días anteriores a hoy, sin hoy', () => {
    const v = ventanaDe(HOY);
    expect(v.dias).toHaveLength(28);
    expect([v.desde, v.hasta]).toEqual(['2026-08-19', '2026-09-15']);
  });

  it('el horizonte empieza hoy y cruza meses', () => {
    expect(diasDelHorizonte('2026-09-29', 4)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('día de semana: 2026-09-16 es miércoles (3), 2026-09-13 domingo (0)', () => {
    expect([diaDeSemana('2026-09-16'), diaDeSemana('2026-09-13')]).toEqual([3, 0]);
  });
});

describe('historial', () => {
  it('27 días no alcanza; 28 sí; sin movimientos = 0', () => {
    expect(diasDeHistorial('2026-08-20', HOY)).toBe(27);
    expect(tieneHistorial(27)).toBe(false);
    expect(diasDeHistorial('2026-08-19', HOY)).toBe(28);
    expect(tieneHistorial(28)).toBe(true);
    expect(diasDeHistorial(null, HOY)).toBe(0);
    // Un primer movimiento de HOY: 0 días de historial (nunca negativo).
    expect(diasDeHistorial(HOY, HOY)).toBe(0);
    expect(diasDeHistorial('2026-09-20', HOY)).toBe(0);
  });
});

describe('proyectar', () => {
  // Miércoles de la ventana: 09-15 es martes; los miércoles son 09-09 (semana 1, la más
  // reciente), 09-02 (2), 08-26 (3), 08-19 (4). Jueves: 09-10, 09-03, 08-27, 08-20.
  const demanda = new Map([
    ['2026-09-09', D(10)], // mié, semana 1, peso 4
    ['2026-09-02', D(20)], // mié, semana 2, peso 3
    ['2026-08-26', D(30)], // mié, semana 3, peso 2
    ['2026-08-19', D(40)], // mié, semana 4, peso 1
    ['2026-09-10', D('1.5')], // jue, semana 1
    ['2026-09-15', D(7)], // mar, semana 1
    ['2026-09-16', D(999)], // HOY: fuera de la ventana
    ['2026-08-18', D(999)], // hace 29 días: fuera
  ]);

  it('semanas: totales por semana, la más reciente primero', () => {
    const p = proyectar(demanda, HOY, 7);
    // Semana 1 (09-09..09-15): 10 + 1.5 + 7 = 18.5; semana 2: 20; 3: 30; 4: 40.
    expect(p.semanas.map((s) => s.toFixed(3))).toEqual(['18.500', '20.000', '30.000', '40.000']);
  });

  it('H = 1 (sólo hoy, miércoles): (4·10 + 3·20 + 2·30 + 1·40) / 10 = 20', () => {
    expect(proyectar(demanda, HOY, 1).proyeccion.toFixed(3)).toBe('20.000');
  });

  it('H = 2 (mié + jue): 20 + 4·1.5/10 = 20.6', () => {
    expect(proyectar(demanda, HOY, 2).proyeccion.toFixed(3)).toBe('20.600');
  });

  it('H = 7: + martes 4·7/10 = 2.8 → 23.4', () => {
    expect(proyectar(demanda, HOY, 7).proyeccion.toFixed(3)).toBe('23.400');
  });

  it('H = 10 repite mié, jue y vie: 23.4 + 20 + 0.6 = 44', () => {
    expect(proyectar(demanda, HOY, 10).proyeccion.toFixed(3)).toBe('44.000');
  });

  it('se redondea UNA vez al final, no por día', () => {
    // Miércoles y jueves con 0.001 en la semana 2 (peso 3): 0.0003 por día. Por día a 3 decimales
    // daría 0.000 + 0.000; sumado y redondeado al final: 0.0006 → 0.001.
    const m = new Map([
      ['2026-09-02', D('0.001')],
      ['2026-09-03', D('0.001')],
    ]);
    expect(proyectar(m, HOY, 2).proyeccion.toFixed(3)).toBe('0.001');
  });

  it('sin demanda en la ventana: proyección 0 (es un dato, no "sin datos")', () => {
    const p = proyectar(new Map(), HOY, 7);
    expect(p.proyeccion.toFixed(3)).toBe('0.000');
    expect(p.semanas.every((s) => s.isZero())).toBe(true);
  });
});

describe('sugerido', () => {
  it('proyección − existencia + mínimo', () => {
    expect(sugerido(D('23.4'), D(10), D(5))!.toFixed(3)).toBe('18.400');
  });
  it('con existencia de sobra: 0, nunca negativo', () => {
    expect(sugerido(D('23.4'), D(100), D(5))!.toFixed(3)).toBe('0.000');
  });
  it('sin mínimo cuenta 0', () => {
    expect(sugerido(D('23.4'), D(10), null)!.toFixed(3)).toBe('13.400');
  });
  it('existencia negativa sube el sugerido', () => {
    expect(sugerido(D(10), D(-2), D(1))!.toFixed(3)).toBe('13.000');
  });
  it('sin existencia conocida (sin foto): nulo, no 0', () => {
    expect(sugerido(D(10), null, D(1))).toBeNull();
  });
  it('existencia igual al mínimo: el sugerido ES la proyección', () => {
    expect(sugerido(D('23.4'), D(5), D(5))!.toFixed(3)).toBe('23.400');
  });
});
