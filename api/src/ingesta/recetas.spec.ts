import { Prisma } from '@prisma/client';

import { decidirReceta, hashReceta, normalizarLoteRecetas, renglonesDelLote } from './recetas';

// La parte pura de la ingesta de recetas (F2-125): validación por receta, orden canónico, hash y
// la decisión frente a lo guardado.

const R1 = {
  productoOrigenSrId: 'P1',
  renglones: [
    { insumoOrigenSrId: 'I2', cantidad: '0.1' },
    { insumoOrigenSrId: 'I1', cantidad: '0.0500' },
  ],
};

describe('normalizarLoteRecetas()', () => {
  it('ordena los renglones por insumo y cantidad (decimal) y numera en ese orden', async () => {
    const { validas, rechazos } = await normalizarLoteRecetas([
      {
        productoOrigenSrId: 'P1',
        renglones: [
          { insumoOrigenSrId: 'I2', cantidad: '0.1' },
          { insumoOrigenSrId: 'I1', cantidad: '0.1' },
          { insumoOrigenSrId: 'I1', cantidad: '0.05' },
        ],
      },
    ]);
    expect(rechazos).toEqual([]);
    expect(
      validas[0].renglones.map((r) => [r.renglon, r.insumoOrigenSrId, r.cantidad.toFixed(4)]),
    ).toEqual([
      [0, 'I1', '0.0500'],
      [1, 'I1', '0.1000'],
      [2, 'I2', '0.1000'],
    ]);
  });

  it('la misma receta en otro orden y con otra escritura de la cantidad da el MISMO hash', async () => {
    const otra = {
      productoOrigenSrId: 'P1',
      renglones: [
        { insumoOrigenSrId: 'I1', cantidad: '0.05' },
        { insumoOrigenSrId: 'I2', cantidad: '0.1000' },
      ],
    };
    const [a, b] = await Promise.all([normalizarLoteRecetas([R1]), normalizarLoteRecetas([otra])]);
    expect(a.validas[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.validas[0].hash).toBe(b.validas[0].hash);
  });

  it('otra cantidad, otro insumo u otro producto cambian el hash', async () => {
    const base = (await normalizarLoteRecetas([R1])).validas[0];
    const variantes = [
      { ...R1, productoOrigenSrId: 'P2' },
      { ...R1, renglones: [R1.renglones[0], { insumoOrigenSrId: 'I1', cantidad: '0.0501' }] },
      { ...R1, renglones: [R1.renglones[0], { insumoOrigenSrId: 'I3', cantidad: '0.05' }] },
      { ...R1, renglones: [R1.renglones[0]] },
    ];
    for (const v of variantes) {
      const x = (await normalizarLoteRecetas([v])).validas[0];
      expect(x.hash).not.toBe(base.hash);
    }
  });

  it('una receta vacía es válida (SR dice que no tiene receta)', async () => {
    const { validas, rechazos } = await normalizarLoteRecetas([
      { productoOrigenSrId: 'P9', renglones: [] },
    ]);
    expect(rechazos).toEqual([]);
    expect(validas[0].renglones).toEqual([]);
  });

  it('un renglón inválido rechaza SU receta entera, con la ruta y SIN el valor', async () => {
    const { validas, rechazos } = await normalizarLoteRecetas([
      R1,
      {
        productoOrigenSrId: 'P2',
        renglones: [
          { insumoOrigenSrId: 'I1', cantidad: '0.5' },
          { insumoOrigenSrId: 'I2', cantidad: '-0.123' },
        ],
      },
      { productoOrigenSrId: 'P3', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '0.12345' }] },
      { productoOrigenSrId: 'P4', renglones: [{ insumoOrigenSrId: '', cantidad: '1' }] },
      { productoOrigenSrId: 'P5', renglones: [{ insumoOrigenSrId: 'I1', cantidad: 1 }] },
    ]);
    expect(validas.map((v) => v.productoOrigenSrId)).toEqual(['P1']);
    expect(rechazos.map((r) => [r.indice, r.productoOrigenSrId, r.reintentable])).toEqual([
      [1, 'P2', false],
      [2, 'P3', false],
      [3, 'P4', false],
      [4, 'P5', false],
    ]);
    expect(rechazos[0].motivo).toContain('recetas.1.renglones.1.cantidad');
    expect(rechazos[0].motivo).not.toContain('-0.123');
    expect(rechazos[1].motivo).not.toContain('0.12345');
  });

  it('un campo de más (tenant incluido) rechaza la receta; sin producto válido, origen nulo', async () => {
    const { validas, rechazos } = await normalizarLoteRecetas([
      { ...R1, sucursalId: '00000000-0000-0000-0000-000000000000' },
      { ...R1, productoOrigenSrId: 'P2', renglones: [{ ...R1.renglones[0], empresaId: 'x' }] },
      { productoOrigenSrId: 'x'.repeat(65), renglones: [] },
      { renglones: [] },
      { productoOrigenSrId: 'P3', renglones: 'no' },
    ]);
    expect(validas).toEqual([]);
    expect(rechazos.map((r) => r.productoOrigenSrId)).toEqual(['P1', 'P2', null, null, 'P3']);
  });

  it('un producto repetido en el lote se rechaza en TODAS sus apariciones', async () => {
    const { validas, rechazos } = await normalizarLoteRecetas([
      R1,
      { productoOrigenSrId: 'P2', renglones: [] },
      { ...R1 },
    ]);
    expect(validas.map((v) => v.productoOrigenSrId)).toEqual(['P2']);
    expect(rechazos.map((r) => [r.indice, r.motivo])).toEqual([
      [0, 'recetas.0.productoOrigenSrId: repetido en el lote'],
      [2, 'recetas.2.productoOrigenSrId: repetido en el lote'],
    ]);
  });

  it('acepta el mismo insumo dos veces (dos renglones) y cantidad 0', async () => {
    const { validas } = await normalizarLoteRecetas([
      {
        productoOrigenSrId: 'P1',
        renglones: [
          { insumoOrigenSrId: 'I1', cantidad: '0' },
          { insumoOrigenSrId: 'I1', cantidad: '12345678.1234' },
        ],
      },
    ]);
    expect(validas[0].renglones.map((r) => r.cantidad.toFixed(4))).toEqual([
      '0.0000',
      '12345678.1234',
    ]);
  });
});

describe('renglonesDelLote()', () => {
  it('cuenta los renglones de todas las recetas; lo que no es arreglo cuenta 0', () => {
    expect(renglonesDelLote([R1, { renglones: [1, 2, 3] }, { renglones: 'x' }, null, 7])).toBe(5);
  });
});

describe('decidirReceta()', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 1, h));
  const receta = {
    indice: 0,
    productoOrigenSrId: 'P1',
    renglones: [{ renglon: 0, insumoOrigenSrId: 'I1', cantidad: new Prisma.Decimal('1') }],
    hash: '',
  };
  receta.hash = hashReceta(receta);
  const guardada = { id: 'g', productoOrigenSrId: 'P1', hash: receta.hash, leidaAt: t(5) };

  it('sin guardada → crear', () => {
    expect(decidirReceta(undefined, receta, t(1)).accion).toBe('crear');
  });
  it('guardada leída después → obsoleta, aunque cambie', () => {
    expect(decidirReceta({ ...guardada, hash: 'x' }, receta, t(4))).toEqual({ accion: 'obsoleta' });
  });
  it('mismo hash: misma lectura → sin cambios; lectura más nueva → avanza la lectura', () => {
    expect(decidirReceta(guardada, receta, t(5))).toEqual({ accion: 'sin_cambios' });
    expect(decidirReceta(guardada, receta, t(6))).toEqual({ accion: 'avanzar_lectura', id: 'g' });
  });
  it('hash distinto con la misma lectura o más nueva → reemplazar', () => {
    expect(decidirReceta({ ...guardada, hash: 'x' }, receta, t(5)).accion).toBe('reemplazar');
    expect(decidirReceta({ ...guardada, hash: 'x' }, receta, t(6)).accion).toBe('reemplazar');
  });
});
