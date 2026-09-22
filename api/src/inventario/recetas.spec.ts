import { Prisma } from '@prisma/client';

import {
  costoReceta,
  costosDeExistencias,
  cruzarVendidos,
  llaveInsumo,
  ordenRanking,
  porcentajeDelPrecio,
  variaciones,
  type SalidasInsumo,
} from './recetas';

// La parte pura de Recetas y consumo teórico (F2-125): el cruce de lo vendido con la receta, el
// teórico contra el real y el costo. Literales escritos a mano.

const d = (v: string | number) => new Prisma.Decimal(v);
const S1 = 's1';
const S2 = 's2';

const vendido = (producto: string, cantidad: string, importe = '100', sucursalId = S1) => ({
  sucursalId,
  producto,
  partidas: 1,
  cantidad: d(cantidad),
  importe: d(importe),
});

const PRODUCTOS = [
  { sucursalId: S1, origenSrId: 'P1', nombre: 'Taco al pastor' },
  { sucursalId: S1, origenSrId: 'P2', nombre: 'Refresco' },
  { sucursalId: S1, origenSrId: 'P3', nombre: 'Agua' },
  { sucursalId: S1, origenSrId: 'P4', nombre: 'Café' },
  { sucursalId: S1, origenSrId: 'P5', nombre: 'café ' }, // mismo nombre normalizado que P4
  { sucursalId: S1, origenSrId: 'P6', nombre: 'Arrachera' },
  { sucursalId: S2, origenSrId: 'P1', nombre: 'Taco al pastor' },
];
const RECETAS = [
  {
    sucursalId: S1,
    productoOrigenSrId: 'P1',
    renglones: [
      { insumoOrigenSrId: 'I1', cantidad: d('0.1500') },
      { insumoOrigenSrId: 'I2', cantidad: d('0.0333') },
    ],
  },
  { sucursalId: S1, productoOrigenSrId: 'P3', renglones: [] },
  {
    sucursalId: S1,
    productoOrigenSrId: 'P6',
    renglones: [
      { insumoOrigenSrId: 'I1', cantidad: d('1.05') },
      { insumoOrigenSrId: 'I1', cantidad: d('0.01') },
    ],
  },
  {
    sucursalId: S2,
    productoOrigenSrId: 'P1',
    renglones: [{ insumoOrigenSrId: 'I1', cantidad: d(9) }],
  },
];

describe('cruzarVendidos()', () => {
  it('explota por nombre normalizado, suma escrituras, y deja aparte lo que no se puede', () => {
    const c = cruzarVendidos(
      [
        vendido('Taco al pastor', '10', '300'),
        vendido('taco  al pastor', '2', '60'), // otra escritura del mismo
        vendido('Refresco', '4', '80'), // sin cabecera de receta
        vendido('Agua', '3', '45'), // receta vacía
        vendido('Café', '5', '100'), // ambiguo
        vendido('Pozole', '1', '120'), // sin catálogo
        vendido('Arrachera', '1.250', '400'), // se vende por kg; I1 dos veces
      ],
      PRODUCTOS,
      RECETAS,
      new Set([S1]),
    );
    const teo = c.teorico.get(S1)!;
    // I1: 12 × 0.15 + 1.25 × 1.05 + 1.25 × 0.01 = 1.8 + 1.3125 + 0.0125 = 3.125
    expect(teo.get('I1')!.toString()).toBe('3.125');
    // I2: 12 × 0.0333 = 0.3996
    expect(teo.get('I2')!.toString()).toBe('0.3996');
    expect(c.explotados.get(S1)).toBe(2);
    expect(
      c.aparte.map((a) => [a.motivo, a.producto, a.productoOrigenSrId, a.cantidad.toString()]),
    ).toEqual([
      ['sin_receta', 'Refresco', 'P2', '4'],
      ['sin_receta', 'Agua', 'P3', '3'],
      ['sin_catalogo', 'Pozole', null, '1'],
      ['ambiguo', 'Café', null, '5'],
    ]);
  });

  it('el texto que se muestra es la escritura de más importe', () => {
    const c = cruzarVendidos(
      [vendido('Pozole', '1', '10'), vendido('POZOLE', '1', '90')],
      PRODUCTOS,
      RECETAS,
      new Set([S1]),
    );
    expect(c.aparte).toHaveLength(1);
    expect(c.aparte[0]).toMatchObject({ producto: 'POZOLE', partidas: 2 });
    expect(c.aparte[0].importe.toString()).toBe('100');
  });

  it('no cruza sucursales que no son calculables ni mezcla sucursales', () => {
    const c = cruzarVendidos(
      [vendido('Taco al pastor', '1', '10', S1), vendido('Taco al pastor', '2', '20', S2)],
      PRODUCTOS,
      RECETAS,
      new Set([S2]),
    );
    expect(c.teorico.has(S1)).toBe(false);
    expect(c.teorico.get(S2)!.get('I1')!.toString()).toBe('18');
    expect(c.aparte).toEqual([]);
  });

  it('sin ventas: nada que explotar y nada que truene', () => {
    const c = cruzarVendidos([], PRODUCTOS, RECETAS, new Set([S1]));
    expect(c.teorico.size).toBe(0);
    expect(c.aparte).toEqual([]);
  });
});

const salidas = (o: Partial<Record<keyof SalidasInsumo, string>>): SalidasInsumo => ({
  consumo: d(o.consumo ?? 0),
  merma: d(o.merma ?? 0),
  ajuste: d(o.ajuste ?? 0),
  importeAbs: d(o.importeAbs ?? 0),
  cantidadAbs: d(o.cantidadAbs ?? 0),
});

describe('variaciones()', () => {
  const base = {
    calculables: new Set([S1]),
    teorico: new Map([
      [
        S1,
        new Map([
          ['I1', d('3.1255')], // se redondea a 3.126 (mitad lejos de cero)
          ['I2', d('10')],
          ['I3', d('2')],
        ]),
      ],
    ]),
    salidas: new Map([
      [
        S1,
        new Map([
          [
            'I1',
            salidas({
              consumo: '-3.000',
              merma: '-0.500',
              ajuste: '0.100',
              importeAbs: '350',
              cantidadAbs: '3.5',
            }),
          ],
          ['I2', salidas({ consumo: '-9.5' })], // sin importe: costo de existencias
          ['I9', salidas({ consumo: '-4', importeAbs: '8', cantidadAbs: '4' })], // sin teórico
        ]),
      ],
    ]),
    conMovimientos: new Set([S1]),
    costoExistencias: new Map([[llaveInsumo(S1, 'I2'), d('20.00')]]),
  };

  it('real = consumo + merma + ajuste (ajuste a favor resta), variación, % e importes', () => {
    const f = variaciones(base);
    const i1 = f.find((x) => x.insumoOrigenSrId === 'I1')!;
    expect(i1.teorico.toFixed(3)).toBe('3.126');
    expect(i1.consumo!.toString()).toBe('3');
    expect(i1.merma!.toString()).toBe('0.5');
    expect(i1.ajuste!.toString()).toBe('-0.1');
    expect(i1.real!.toString()).toBe('3.4');
    // 3.4 − 3.126 = 0.274; 0.274 / 3.126 × 100 = 8.765… → 8.8
    expect(i1.variacion!.toString()).toBe('0.274');
    expect(i1.porcentaje!.toString()).toBe('8.8');
    // costo = 350 / 3.5 = 100.00; importes a centavos
    expect(i1.costo!.toFixed(2)).toBe('100.00');
    expect(i1.importeVariacion!.toFixed(2)).toBe('27.40');
    expect(i1.importeTeorico!.toFixed(2)).toBe('312.60');

    const i2 = f.find((x) => x.insumoOrigenSrId === 'I2')!;
    // Sin salidas con importe: el costo sale de la foto de existencias.
    expect(i2.costo!.toFixed(2)).toBe('20.00');
    expect(i2.variacion!.toString()).toBe('-0.5');
    expect(i2.porcentaje!.toString()).toBe('-5');
    expect(i2.importeVariacion!.toFixed(2)).toBe('-10.00');

    const i3 = f.find((x) => x.insumoOrigenSrId === 'I3')!;
    // Con teórico y sin ninguna salida: real 0 (la sucursal SÍ manda pólizas), sin costo.
    expect(i3.real!.toString()).toBe('0');
    expect(i3.variacion!.toString()).toBe('-2');
    expect(i3.costo).toBeNull();
    expect(i3.importeVariacion).toBeNull();

    const i9 = f.find((x) => x.insumoOrigenSrId === 'I9')!;
    expect(i9.sinTeorico).toBe(true);
    expect(i9.porcentaje).toBeNull();
    expect(i9.importeVariacion!.toFixed(2)).toBe('8.00');
  });

  it('ranking: importe de variación desc, sin importe al final', () => {
    expect(variaciones(base).map((x) => x.insumoOrigenSrId)).toEqual(['I1', 'I9', 'I2', 'I3']);
  });

  it('sucursal que nunca mandó pólizas: real, desglose y variación NULOS (no cero)', () => {
    const f = variaciones({ ...base, conMovimientos: new Set() });
    expect(f.map((x) => x.insumoOrigenSrId).sort()).toEqual(['I1', 'I2', 'I3']);
    for (const x of f) {
      expect([x.real, x.consumo, x.merma, x.ajuste, x.variacion, x.porcentaje]).toEqual([
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
      expect(x.sinTeorico).toBe(false);
    }
  });

  it('una sucursal no calculable no produce filas', () => {
    expect(variaciones({ ...base, calculables: new Set([S2]) })).toEqual([]);
  });

  it('el desempate del ranking es estable (|%|, sucursal, insumo)', () => {
    const fila = (insumo: string, pct: string | null) => ({
      sucursalId: S1,
      insumoOrigenSrId: insumo,
      teorico: d(1),
      real: null,
      consumo: null,
      merma: null,
      ajuste: null,
      variacion: null,
      porcentaje: pct === null ? null : d(pct),
      sinTeorico: false,
      costo: null,
      importeTeorico: null,
      importeVariacion: null,
    });
    const filas = [fila('B', null), fila('A', '-3'), fila('C', '2'), fila('A2', null)];
    expect(filas.sort(ordenRanking).map((f) => f.insumoOrigenSrId)).toEqual(['A', 'C', 'A2', 'B']);
  });
});

describe('costos', () => {
  it('costo de existencias = Σ valor / Σ cantidad de almacenes con cantidad > 0, a 2', () => {
    const c = costosDeExistencias([
      { sucursalId: S1, insumoOrigenSrId: 'I1', cantidad: d(2), valor: d('20.00') },
      { sucursalId: S1, insumoOrigenSrId: 'I1', cantidad: d(1), valor: d('11.00') },
      { sucursalId: S1, insumoOrigenSrId: 'I1', cantidad: d(-5), valor: d('-50.00') },
      { sucursalId: S1, insumoOrigenSrId: 'I2', cantidad: d(0), valor: d('0') },
    ]);
    expect(c.get(llaveInsumo(S1, 'I1'))!.toFixed(2)).toBe('10.33');
    expect(c.has(llaveInsumo(S1, 'I2'))).toBe(false);
  });

  it('costo de receta = Σ importes; un renglón sin costo lo deja incompleto', () => {
    expect(costoReceta([{ importe: d('1.10') }, { importe: d('2.25') }])).toEqual({
      costo: d('3.35'),
      incompleto: false,
    });
    const r = costoReceta([{ importe: d('1.10') }, { importe: null }]);
    expect(r.costo.toString()).toBe('1.1');
    expect(r.incompleto).toBe(true);
  });

  it('% del precio a 1 decimal; nulo sin precio positivo o con costo incompleto', () => {
    expect(porcentajeDelPrecio(d('30'), false, d('89'))!.toString()).toBe('33.7');
    expect(porcentajeDelPrecio(d('30'), true, d('89'))).toBeNull();
    expect(porcentajeDelPrecio(d('30'), false, null)).toBeNull();
    expect(porcentajeDelPrecio(d('30'), false, d('0'))).toBeNull();
  });
});
