import { describe, expect, it } from 'vitest';

import type { Alerta } from '../api/tipos';
import { describirAlerta, duracion, NOMBRE_TIPO, textoRegla } from './textos';

const base: Alerta = {
  id: 'a',
  sucursalId: 's',
  sucursal: 'Centro',
  tipo: 'mesa_abierta',
  severidad: 'advertencia',
  llave: 'F-1',
  umbral: 60,
  detalle: {},
  abiertaAt: '2026-09-22T19:00:00Z',
  cerradaAt: null,
  motivoCierre: null,
};

describe('describirAlerta', () => {
  it('sin reporte: nunca, y con edad', () => {
    expect(
      describirAlerta({ ...base, tipo: 'sucursal_sin_reporte', detalle: { nunca: true } }),
    ).toBe('Centro: nunca ha reportado.');
    expect(
      describirAlerta({
        ...base,
        tipo: 'sucursal_sin_reporte',
        detalle: { nunca: false, edadSegundos: 7200 },
      }),
    ).toBe('Centro: sin reportar (última lectura hace 2 h al abrir).');
  });

  it('mesa y cuenta, también sin mesa ni minutos (nunca inventa un número)', () => {
    expect(describirAlerta({ ...base, detalle: { folio: 'F-1', mesa: '5', minutos: 61 } })).toBe(
      'Mesa 5 (folio F-1, Centro): abierta 61 min al abrir la alerta.',
    );
    expect(describirAlerta({ ...base, tipo: 'cuenta_sin_imprimir', detalle: { mesa: null } })).toBe(
      'Cuenta sin mesa (folio F-1, Centro): abierta sin imprimir más del umbral al abrir la alerta.',
    );
  });

  it('caída: importes de texto a pesos; un importe ilegible dice "sin dato"', () => {
    expect(
      describirAlerta({
        ...base,
        tipo: 'caida_venta',
        detalle: { ventaHoy: '1234.50', ventaBase: '2000.00', caidaPct: '38.28' },
      }),
    ).toBe(
      'Centro: venta de hoy $1,234.50 contra $2,000.00 el mismo día de la semana pasada a la misma hora (−38.28 %).',
    );
    expect(
      describirAlerta({ ...base, tipo: 'caida_venta', detalle: { ventaHoy: 12.5 } }),
    ).toContain('venta de hoy sin dato contra sin dato');
  });
});

describe('bajo mínimo (F2-121)', () => {
  it('cantidades de texto sin ceros de más; lo que falta dice "sin dato"', () => {
    expect(
      describirAlerta({
        ...base,
        tipo: 'bajo_minimo',
        llave: '["A1-GEN","I040"]',
        detalle: {
          almacen: 'A1-GEN',
          insumo: 'I040',
          nombre: 'Tomate',
          cantidad: '2.500',
          minimo: '6.000',
        },
      }),
    ).toBe(
      'Tomate (almacén A1-GEN, Centro): existencia 2.5 contra un mínimo de 6 al abrir la alerta.',
    );
    expect(describirAlerta({ ...base, tipo: 'bajo_minimo', detalle: { cantidad: 3 } })).toBe(
      'Artículo sin dato (Centro): existencia sin dato contra un mínimo de sin dato al abrir la alerta.',
    );
  });
});

describe('textos auxiliares', () => {
  it('duración', () => {
    const t = Date.parse('2026-09-22T19:00:00Z');
    expect(duracion('2026-09-22T19:00:00Z', t + 59_000)).toBe('0 min');
    expect(duracion('2026-09-22T19:00:00Z', t + 125 * 60_000)).toBe('2 h 5 min');
    expect(duracion('2026-09-22T19:00:00Z', t + 3 * 86_400_000)).toBe('3 días');
  });

  it('cada tipo tiene nombre y texto de regla', () => {
    for (const tipo of Object.keys(NOMBRE_TIPO) as Array<keyof typeof NOMBRE_TIPO>) {
      expect(textoRegla(tipo, 7)).toContain('7');
    }
  });
});
