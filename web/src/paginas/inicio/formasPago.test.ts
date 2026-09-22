import { describe, expect, it } from 'vitest';

import type { FormaPago } from '../../api/tipos';
import { etiquetaForma, NOMBRE_FORMA } from './formasPago';

const FORMAS = Object.keys(NOMBRE_FORMA) as FormaPago[];

describe('etiquetaForma', () => {
  it('cubre las cuatro formas del contrato', () => {
    expect(FORMAS.sort()).toEqual(['efectivo', 'otro', 'tarjeta', 'transferencia']);
  });

  it('dos formas distintas nunca comparten etiqueta, ni ignorando mayúsculas', () => {
    for (const a of FORMAS) {
      for (const b of FORMAS) {
        if (a === b) continue;
        expect(etiquetaForma(a).toLowerCase()).not.toBe(etiquetaForma(b).toLowerCase());
      }
    }
  });

  it('ninguna etiqueta es una abreviatura (una letra, o terminada en punto)', () => {
    for (const f of FORMAS) {
      expect(etiquetaForma(f).length).toBeGreaterThan(1);
      expect(etiquetaForma(f)).not.toMatch(/\.$/);
    }
  });
});
