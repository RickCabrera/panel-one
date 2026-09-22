import { Prisma } from '@prisma/client';

import type { VentaMeseroInterna } from '../ventas/analisis.service';
import {
  rendimientoMeseros,
  type MeseroCatalogoLeido,
  type RendimientoMeseros,
  type SucursalLeida,
} from './meseros';

// La parte pura de Meseros (F2-231). Todas las cifras esperadas van escritas a mano.

const S1 = 'suc-1';
const S2 = 'suc-2';
const VISTO = new Date('2026-09-20T12:00:00Z');

function venta(
  sucursalId: string,
  mesero: string | null,
  v: Partial<Omit<VentaMeseroInterna, 'segundos'>> & { segundos?: string } = {},
): VentaMeseroInterna {
  return {
    sucursalId,
    sucursal: sucursalId === S1 ? 'Centro' : 'Norte',
    mesero,
    venta: v.venta ?? '0.00',
    cuentas: v.cuentas ?? 0,
    ticketPromedio: null, // lo recalcula el módulo; no se usa
    comensales: v.comensales ?? 0,
    cuentasConComensales: v.cuentasConComensales ?? 0,
    propina: v.propina ?? '0.00',
    descuentos: v.descuentos ?? { monto: '0.00', cuentas: 0 },
    cancelados: v.cancelados ?? { cuentas: 0, monto: '0.00' },
    minutosPromedio: null,
    cuentasConDuracion: v.cuentasConDuracion ?? 0,
    segundos: new Prisma.Decimal(v.segundos ?? '0'),
  };
}

function cat(
  id: string,
  sucursalId: string,
  nombre: string,
  extra: Partial<MeseroCatalogoLeido> = {},
): MeseroCatalogoLeido {
  return {
    id,
    sucursalId,
    clave: extra.clave ?? id.toUpperCase(),
    nombre,
    activo: extra.activo ?? true,
    activoPos: extra.activoPos === undefined ? true : extra.activoPos,
    vistoAt: VISTO,
  };
}

const SUCS: SucursalLeida[] = [
  { id: S1, nombre: 'Centro', sincronizado: true },
  { id: S2, nombre: 'Norte', sincronizado: true },
];

function correr(
  ventas: VentaMeseroInterna[],
  catalogo: MeseroCatalogoLeido[] = [],
  sucursales: SucursalLeida[] = SUCS,
  catalogoTruncado = false,
): RendimientoMeseros {
  return rendimientoMeseros({ ventas, catalogo, sucursales, catalogoTruncado });
}

const fila = (r: RendimientoMeseros, sucursalId: string, mesero: string | null) =>
  r.filas.find((f) => f.sucursalId === sucursalId && f.mesero === mesero);

describe('rendimientoMeseros (F2-231)', () => {
  describe('cruce con el espejo', () => {
    it('liga por nombre exacto, sin mayúsculas ni espacios de más; los acentos cuentan', () => {
      const r = correr(
        [
          venta(S1, 'Ana López', { venta: '100.00', cuentas: 1 }),
          venta(S1, 'CARLOS  ramírez ', { venta: '50.00', cuentas: 1 }),
          venta(S1, 'Lucia Hernandez', { venta: '20.00', cuentas: 1 }),
        ],
        [
          cat('m01', S1, 'Ana López'),
          cat('m02', S1, 'Carlos Ramírez'),
          cat('m03', S1, 'Lucía Hernández'),
        ],
      );
      expect(fila(r, S1, 'Ana López')?.catalogo?.id).toBe('m01');
      // El nombre mostrado es el del espejo; el texto del POS queda en textosPos.
      const carlos = fila(r, S1, 'Carlos Ramírez');
      expect(carlos?.cruce).toBe('catalogo');
      expect(carlos?.textosPos).toEqual(['CARLOS  ramírez ']);
      const lucia = fila(r, S1, 'Lucia Hernandez');
      expect(lucia?.cruce).toBe('sin-catalogo');
      expect(lucia?.catalogo).toBeNull();
      // Y la Lucía del espejo sale como "sin ventas" (no hubo texto que ligara con ella).
      expect(r.sinVentas.map((m) => m.id)).toEqual(['m03']);
    });

    it('no liga con el mesero de OTRA sucursal', () => {
      const r = correr(
        [venta(S2, 'Ana López', { venta: '10.00', cuentas: 1 })],
        [cat('m01', S1, 'Ana López')],
      );
      expect(fila(r, S2, 'Ana López')?.cruce).toBe('sin-catalogo');
      expect(r.sinVentas.map((m) => m.id)).toEqual(['m01']);
    });

    it('nombre repetido en el espejo = ambiguo: no se liga a ninguno ni sale como sin ventas', () => {
      const r = correr(
        [venta(S1, 'Ana López', { venta: '10.00', cuentas: 1 })],
        [cat('m01', S1, 'Ana López'), cat('m07', S1, 'ana lópez', { activo: false })],
      );
      const f = fila(r, S1, 'Ana López');
      expect(f?.cruce).toBe('ambiguo');
      expect(f?.catalogo).toBeNull();
      expect(r.sinVentas).toEqual([]);
    });

    it('dos textos que ligan con el MISMO mesero se consolidan en una fila, con suma exacta', () => {
      const r = correr(
        [
          venta(S1, 'Ana López', {
            venta: '100.10',
            cuentas: 2,
            comensales: 5,
            cuentasConComensales: 2,
            propina: '10.05',
            descuentos: { monto: '3.33', cuentas: 1 },
            cancelados: { cuentas: 1, monto: '40.00' },
            segundos: '6000',
            cuentasConDuracion: 2,
          }),
          venta(S1, 'ANA LÓPEZ ', {
            venta: '0.20',
            cuentas: 1,
            comensales: 1,
            cuentasConComensales: 1,
            propina: '0.10',
            descuentos: { monto: '0.01', cuentas: 1 },
            cancelados: { cuentas: 2, monto: '0.02' },
            segundos: '600',
            cuentasConDuracion: 1,
          }),
          venta(S1, 'Carlos Ramírez', { venta: '100.30', cuentas: 1 }),
        ],
        [cat('m01', S1, 'Ana López'), cat('m02', S1, 'Carlos Ramírez')],
      );
      const ana = r.filas.filter((f) => f.catalogo?.id === 'm01');
      expect(ana).toHaveLength(1);
      expect(ana[0]).toMatchObject({
        mesero: 'Ana López',
        textosPos: ['ANA LÓPEZ ', 'Ana López'],
        venta: '100.30',
        cuentas: 3,
        ticketPromedio: '33.43',
        comensales: 6,
        cuentasConComensales: 3,
        propina: '10.15',
        descuentos: { monto: '3.34', cuentas: 2 },
        cancelados: { cuentas: 3, monto: '40.02' },
        // 6600 s / 3 cuentas = 2200 s = 36.666… min
        minutosPromedio: '36.7',
        cuentasConDuracion: 3,
        // Empata con Carlos (100.30): misma posición.
        posicion: 1,
      });
      // n del promedio = 2 personas, no 3 filas de venta.
      expect(r.sucursales.find((s) => s.sucursalId === S1)?.meserosEnRanking).toBe(2);
    });

    it('sin sincronizar y catálogo truncado no afirman "no está en el catálogo"', () => {
      const sinSync = correr(
        [venta(S1, 'Ana López', { venta: '1.00', cuentas: 1 })],
        [],
        [{ id: S1, nombre: 'Centro', sincronizado: false }],
      );
      expect(sinSync.filas[0].cruce).toBe('sin-sincronizar');
      const truncado = correr(
        [venta(S1, 'Ana López', { venta: '1.00', cuentas: 1 })],
        [],
        SUCS,
        true,
      );
      expect(truncado.filas[0].cruce).toBe('catalogo-incompleto');
      expect(truncado.catalogoTruncado).toBe(true);
    });

    it('el estado del espejo viaja tal cual: baja en el POS, desaparecido y sin dato', () => {
      const r = correr(
        [
          venta(S1, 'Pedro', { venta: '1.00', cuentas: 1 }),
          venta(S1, 'Rita', { venta: '1.00', cuentas: 1 }),
          venta(S1, 'Olga', { venta: '1.00', cuentas: 1 }),
        ],
        [
          cat('p', S1, 'Pedro', { activoPos: false }),
          cat('r', S1, 'Rita', { activo: false }),
          cat('o', S1, 'Olga', { activoPos: null }),
        ],
      );
      expect(fila(r, S1, 'Pedro')?.catalogo).toMatchObject({ activo: true, activoPos: false });
      expect(fila(r, S1, 'Rita')?.catalogo).toMatchObject({ activo: false, activoPos: true });
      expect(fila(r, S1, 'Olga')?.catalogo).toMatchObject({ activoPos: null });
      expect(fila(r, S1, 'Olga')?.catalogo?.vistoAt).toBe(VISTO.toISOString());
    });
  });

  describe('ranking y promedio de la sucursal', () => {
    const r = correr([
      venta(S1, 'A', {
        venta: '300.00',
        cuentas: 3,
        propina: '30.00',
        comensales: 7,
        segundos: '10800',
        cuentasConDuracion: 3,
      }),
      venta(S1, 'B', { venta: '200.00', cuentas: 2, propina: '0.00', comensales: 4 }),
      venta(S1, 'C', {
        venta: '200.00',
        cuentas: 1,
        propina: '5.01',
        comensales: 0,
        segundos: '60',
        cuentasConDuracion: 1,
      }),
      venta(S1, 'D', { venta: '100.00', cuentas: 1 }),
      venta(S1, 'Solo cancela', { cancelados: { cuentas: 2, monto: '80.00' } }),
      venta(S1, null, { venta: '50.00', cuentas: 2, segundos: '-0', cuentasConDuracion: 0 }),
      venta(S2, 'Z', { venta: '10.00', cuentas: 1 }),
    ]);

    it('posición por venta en SU sucursal; empate = misma posición (1, 2, 2, 4)', () => {
      expect(r.filas.filter((f) => f.sucursalId === S1).map((f) => [f.mesero, f.posicion])).toEqual(
        [
          ['A', 1],
          ['B', 2],
          ['C', 2],
          ['D', 4],
          ['Solo cancela', null],
          [null, null],
        ],
      );
      expect(fila(r, S2, 'Z')?.posicion).toBe(1);
    });

    it('promedio: por mesero sobre los n del ranking; ticket y minutos sobre toda la sucursal', () => {
      const s1 = r.sucursales.find((s) => s.sucursalId === S1)!;
      expect(s1).toMatchObject({ meserosEnRanking: 4, venta: '850.00', cuentas: 9 });
      expect(s1.promedio).toEqual({
        ventaPorMesero: '200.00', // 800 / 4 (sin "Sin mesero")
        cuentasPorMesero: '1.8', // 7 / 4 = 1.75 → 1.8
        propinaPorMesero: '8.75', // 35.01 / 4 = 8.7525
        comensalesPorMesero: '2.8', // 11 / 4 = 2.75
        ticketPromedio: '94.44', // 850 / 9 (con las sin mesero)
        // (10800 + 60) s / 4 cuentas = 2715 s = 45.25 min: Σ/Σ, no el promedio de 60.0 y 1.0.
        minutosPromedio: '45.3',
      });
    });

    it('sucursal sin ventas: promedios nulos, nunca ceros inventados', () => {
      const vacia = correr([], [], [{ id: S1, nombre: 'Centro', sincronizado: true }]);
      expect(vacia.sucursales[0]).toMatchObject({ meserosEnRanking: 0, venta: '0.00', cuentas: 0 });
      expect(Object.values(vacia.sucursales[0].promedio).every((v) => v === null)).toBe(true);
      expect(vacia.filas).toEqual([]);
    });
  });

  describe('totales', () => {
    it('Σ venta de filas = venta; cancelaciones y descuentos aparte, con conteo e importe', () => {
      const r = correr(
        [
          venta(S1, 'A', {
            venta: '0.10',
            cuentas: 1,
            descuentos: { monto: '1.11', cuentas: 1 },
            cancelados: { cuentas: 1, monto: '9.99' },
          }),
          venta(S1, 'a', { venta: '0.20', cuentas: 1 }),
          venta(S1, null, { venta: '0.05', cuentas: 1, descuentos: { monto: '0.50', cuentas: 1 } }),
          venta(S2, 'B', { cancelados: { cuentas: 1, monto: '5.00' } }),
        ],
        [cat('a', S1, 'A')],
      );
      expect(r.venta).toBe('0.35');
      const suma = r.filas.reduce((s, f) => s.plus(f.venta), new Prisma.Decimal(0));
      expect(suma.toFixed(2)).toBe(r.venta);
      expect(r.cuentas).toBe(3);
      expect(r.descuentos).toEqual({ monto: '1.61', cuentas: 2 });
      expect(r.cancelados).toEqual({ cuentas: 2, monto: '14.99' });
    });
  });
});
