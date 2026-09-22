import { describe, expect, it } from 'vitest';

import { SIN_FILTROS } from '../../filtros/tickets';
import { activos, errorDe } from './reglasFiltros';

describe('errorDe (validación del formulario de filtros)', () => {
  it('importes mal escritos y rango al revés no se aplican', () => {
    expect(errorDe({ ...SIN_FILTROS, importeMin: '1,000' })).toMatch(/importe mínimo/);
    expect(errorDe({ ...SIN_FILTROS, importeMax: '9.999' })).toMatch(/importe máximo/);
    expect(errorDe({ ...SIN_FILTROS, importeMin: '100.01', importeMax: '100' })).toBe(
      'El importe mínimo no puede ser mayor que el máximo.',
    );
  });

  it('vacíos, blancos y un rango de un solo valor son válidos', () => {
    expect(errorDe(SIN_FILTROS)).toBeNull();
    expect(errorDe({ ...SIN_FILTROS, importeMin: '  ' })).toBeNull();
    expect(errorDe({ ...SIN_FILTROS, importeMin: ' 100 ', importeMax: '100.00' })).toBeNull();
  });
});

describe('activos', () => {
  it('uno por filtro aplicado, en el orden del formulario; el default de canceladas no cuenta', () => {
    expect(activos(SIN_FILTROS)).toEqual([]);
    expect(
      activos({ ...SIN_FILTROS, producto: 'taco', forma: 'otro', canceladas: 'solo' }).map(
        (a) => a.texto,
      ),
    ).toEqual(['Pago: Otro', 'Sólo canceladas', 'Producto: taco']);
  });
});
