import { describe, expect, it } from 'vitest';

import type { Traspasos } from '../../api/tipos';
import {
  avisoExistencia,
  destinosPosibles,
  errorCantidad,
  erroresAlta,
  milesimas,
  vacioTraspasos,
} from './reglas';

// Reglas puras de traspasos (F2-124). Lo esperado, a mano.

const A = { sucursalId: 's1', almacenOrigenSrId: 'GEN' };
const B = { sucursalId: 's1', almacenOrigenSrId: 'BAR' };
const C = { sucursalId: 's2', almacenOrigenSrId: 'GEN' };

const vacia = (p: Partial<Traspasos> = {}): Traspasos => ({
  traspasos: [],
  total: 0,
  umbralAlertaHoras: 48,
  sucursales: [],
  almacenes: [],
  ...p,
});

describe('traspasos · reglas', () => {
  it('cantidad: sin signo, hasta 3 decimales, mayor que 0', () => {
    expect(errorCantidad('2.5')).toBeNull();
    expect(errorCantidad(' 1 ')).toBeNull();
    expect(errorCantidad('')).toBe('Escribe la cantidad.');
    expect(errorCantidad('-1')).toBe('Cantidad sin signo, con hasta 3 decimales.');
    expect(errorCantidad('1.0001')).toBe('Cantidad sin signo, con hasta 3 decimales.');
    expect(errorCantidad('0')).toBe('La cantidad tiene que ser mayor que 0.');
    expect(errorCantidad('0.000')).toBe('La cantidad tiene que ser mayor que 0.');
  });

  it('milésimas sin float', () => {
    expect(milesimas('12.5')).toBe(12500n);
    expect(milesimas('0.001')).toBe(1n);
    expect(milesimas('-3')).toBe(-3000n);
    expect(milesimas('x')).toBeNull();
  });

  it('aviso de existencia: sólo si pasa de la lectura (no bloquea)', () => {
    expect(avisoExistencia('10.001', '10.000')).toBe(
      'Más de lo que dice la última lectura del almacén de origen.',
    );
    expect(avisoExistencia('10', '10.000')).toBeNull();
    expect(avisoExistencia('1', null)).toBeNull();
    expect(avisoExistencia('abc', '1.000')).toBeNull();
    // Una existencia negativa (SR lo permite): cualquier cantidad pasa de ella.
    expect(avisoExistencia('0.5', '-2.000')).not.toBeNull();
  });

  it('errores del alta, en palabras', () => {
    expect(
      erroresAlta({
        origen: A,
        destino: B,
        renglones: [{ insumoOrigenSrId: 'I1', cantidad: '1' }],
      }),
    ).toEqual([]);
    expect(erroresAlta({ origen: A, destino: A, renglones: [] })).toEqual([
      'El destino es el mismo almacén que el origen.',
      'Agrega al menos un artículo.',
    ]);
    expect(
      erroresAlta({
        origen: null,
        destino: null,
        renglones: [
          { insumoOrigenSrId: 'I1', cantidad: '1' },
          { insumoOrigenSrId: 'I1', cantidad: '' },
        ],
      }),
    ).toEqual([
      'Elige el almacén de origen.',
      'Elige el almacén de destino.',
      'Un artículo está repetido: junta sus cantidades en un solo renglón.',
      'Revisa las cantidades marcadas.',
    ]);
  });

  it('el destino nunca es el mismo almacén; otra sucursal con la misma clave sí', () => {
    const almacenes = [A, B, C].map((a) => ({ ...a, almacen: null }));
    expect(destinosPosibles(almacenes, A).map((a) => [a.sucursalId, a.almacenOrigenSrId])).toEqual([
      ['s1', 'BAR'],
      ['s2', 'GEN'],
    ]);
  });

  it('estados vacíos dicen por qué y qué falta', () => {
    expect(vacioTraspasos(vacia())).toMatchObject({
      tipo: 'sin-almacenes',
      porque: 'El panel todavía no conoce ningún almacén de esta empresa.',
    });
    expect(vacioTraspasos(vacia({ almacenes: [{ ...A, almacen: 'General' }] }))).toMatchObject({
      tipo: 'sin-almacenes',
      porque: 'El panel sólo conoce un almacén de esta empresa: no hay a dónde traspasar.',
    });
    const dos = vacia({ almacenes: [A, B].map((a) => ({ ...a, almacen: null })) });
    expect(vacioTraspasos(dos).tipo).toBe('sin-traspasos');
  });
});
