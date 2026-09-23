import { describe, expect, it } from 'vitest';

import { camposFacturaDelApi, formDeReceptor, receptorParaApi, totalValido } from './reglas';

describe('reglas de la factura sin ticket y la refacturación (F2-107)', () => {
  it('totalValido: hasta 6 enteros y 2 decimales, mayor que cero, sin pasar por número', () => {
    for (const bueno of ['1', '0.01', '1234.5', '999999.99', ' 580.00 ']) {
      expect(totalValido(bueno)).toBe(true);
    }
    for (const malo of ['0', '0.00', '-1', '1.234', '1e3', '1,000', '1000000', '', '.5', 'abc']) {
      expect(totalValido(malo)).toBe(false);
    }
  });

  it('receptorParaApi: RFC en mayúsculas, recortes y correo vacío = null', () => {
    expect(
      receptorParaApi({
        rfc: ' eku9003173c9 ',
        razonSocial: ' ESCUELA ',
        regimenFiscal: '601',
        cp: ' 42501 ',
        usoCfdi: 'G03',
        email: '  ',
      }),
    ).toEqual({
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA',
      regimenFiscal: '601',
      cp: '42501',
      usoCfdi: 'G03',
      email: null,
    });
  });

  it('formDeReceptor: un receptor sin correo precarga el campo vacío', () => {
    expect(
      formDeReceptor({
        rfc: 'EKU9003173C9',
        razonSocial: 'E',
        regimenFiscal: '601',
        cp: '42501',
        usoCfdi: 'G03',
        email: null,
      }).email,
    ).toBe('');
  });

  it('camposFacturaDelApi: toma receptor y total, ignora lo demás', () => {
    expect(
      camposFacturaDelApi({ campos: { total: 'mal', rfc: 'mal rfc', otro: 'x', cp: 3 } }),
    ).toEqual({ total: 'mal', rfc: 'mal rfc' });
    expect(camposFacturaDelApi({ message: 'x' })).toBeNull();
    expect(camposFacturaDelApi(null)).toBeNull();
  });
});
