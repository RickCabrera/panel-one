import { Prisma } from '@prisma/client';

import { armarPorArea, type AreaEspejo, type VentaAreaLeida } from './por-area';

// La parte pura de F2-233: el cruce (sucursal, id del POS) EXACTO contra el espejo, el canal
// que sale del mapeo y los dos renglones que nunca se reparten. Cifras escritas a mano.

const D = (v: string) => new Prisma.Decimal(v);
const S1 = { id: 's1', nombre: 'Centro' };
const S2 = { id: 's2', nombre: 'Norte' };

const leida = (
  sucursal: { id: string; nombre: string },
  area: string | null,
  venta: string,
  cuentas = 1,
): VentaAreaLeida => ({
  sucursalId: sucursal.id,
  sucursal: sucursal.nombre,
  areaOrigenSrId: area,
  venta: D(venta),
  cuentas,
});

const espejo = (
  sucursalId: string,
  origenSrId: string,
  nombre: string,
  canal: AreaEspejo['canal'],
  extra: Partial<AreaEspejo> = {},
): AreaEspejo => ({
  id: `${sucursalId}-${origenSrId}`,
  sucursalId,
  origenSrId,
  clave: null,
  nombre,
  activo: true,
  canal,
  ...extra,
});

describe('armarPorArea() (F2-233)', () => {
  it('una clave igual al id de OTRA área no liga: el cruce es por el id del POS', () => {
    const r = armarPorArea(
      [leida(S1, 'X-2', '10.00')],
      [
        espejo('s1', 'X-1', 'Terraza', 'comedor', { clave: 'X-2' }),
        espejo('s1', 'X-2', 'Mostrador', 'mostrador', { clave: 'M' }),
      ],
      [S1],
      new Set(['s1']),
    );
    expect(r.areas[0]).toMatchObject({ nombre: 'Mostrador', clave: 'M', canal: 'mostrador' });
    expect(r.canales).toEqual([{ canal: 'mostrador', venta: '10.00', cuentas: 1 }]);
  });

  it('el mismo id en otra sucursal no liga: es otra área', () => {
    const r = armarPorArea(
      [leida(S2, 'A1', '25.00')],
      [espejo('s1', 'A1', 'Comedor', 'comedor')],
      [S1, S2],
      new Set(['s1', 's2']),
    );
    expect(r.areas[0]).toMatchObject({ areaId: null, nombre: null, cruce: 'sin-catalogo' });
    expect(r.canales).toEqual([]);
    expect(r.sinCanal).toEqual({ venta: '25.00', cuentas: 1 });
  });

  it('sin catálogo sincronizado la fila sale "sin-sincronizar", no "sin-catalogo"', () => {
    const r = armarPorArea([leida(S2, 'A1', '5.00')], [], [S2], new Set());
    expect(r.areas[0].cruce).toBe('sin-sincronizar');
    expect(r.catalogo).toEqual([{ sucursalId: 's2', sucursal: 'Norte', sincronizado: false }]);
  });

  it('un área sin canal asignado va a sinCanal con su nombre; una dada de baja conserva su canal', () => {
    const r = armarPorArea(
      [leida(S1, 'B', '45.00'), leida(S1, 'T', '33.33')],
      [espejo('s1', 'B', 'Barra', null), espejo('s1', 'T', 'Terraza', 'comedor', { activo: false })],
      [S1],
      new Set(['s1']),
    );
    expect(r.areas.find((a) => a.areaOrigenSrId === 'B')).toMatchObject({
      nombre: 'Barra',
      cruce: 'catalogo',
      canal: null,
    });
    expect(r.areas.find((a) => a.areaOrigenSrId === 'T')).toMatchObject({
      activo: false,
      canal: 'comedor',
    });
    expect(r.sinCanal).toEqual({ venta: '45.00', cuentas: 1 });
    expect(r.canales).toEqual([{ canal: 'comedor', venta: '33.33', cuentas: 1 }]);
  });

  it('las invariantes: Σ áreas + sinArea = venta = Σ canales + sinCanal + sinArea, al centavo', () => {
    const r = armarPorArea(
      [
        leida(S1, 'C', '100.00', 2),
        leida(S1, 'M', '0.01'),
        leida(S1, null, '70.00', 3),
        leida(S2, null, '-5.00'),
        leida(S2, 'D', '19.99'),
        leida(S2, 'Z', '1.00'),
      ],
      [
        espejo('s1', 'C', 'Comedor', 'comedor'),
        espejo('s1', 'M', 'Mostrador', 'mostrador'),
        espejo('s2', 'D', 'Domicilio', 'domicilio'),
      ],
      [S1, S2],
      new Set(['s1', 's2']),
    );
    // 100.00 + 0.01 + 70.00 − 5.00 + 19.99 + 1.00 = 186.00, en 2 + 1 + 3 + 1 + 1 + 1 = 9 cuentas.
    expect(r.venta).toBe('186.00');
    expect(r.cuentas).toBe(9);
    expect(r.sinArea).toEqual({ venta: '65.00', cuentas: 4 });
    expect(r.sinCanal).toEqual({ venta: '1.00', cuentas: 1 });
    expect(r.canales).toEqual([
      { canal: 'comedor', venta: '100.00', cuentas: 2 },
      { canal: 'mostrador', venta: '0.01', cuentas: 1 },
      { canal: 'domicilio', venta: '19.99', cuentas: 1 },
    ]);
    const suma = (xs: string[]) => xs.reduce((s, x) => s.plus(D(x)), D('0'));
    expect(suma([...r.areas.map((a) => a.venta), r.sinArea.venta]).toFixed(2)).toBe('186.00');
    expect(
      suma([...r.canales.map((c) => c.venta), r.sinCanal.venta, r.sinArea.venta]).toFixed(2),
    ).toBe('186.00');
  });

  it('orden: venta desc, luego sucursal y id; los canales en su orden fijo', () => {
    const r = armarPorArea(
      [
        leida(S2, 'b', '10.00'),
        leida(S1, 'b', '10.00'),
        leida(S1, 'a', '10.00'),
        leida(S1, 'c', '99.00'),
      ],
      [
        espejo('s1', 'a', 'A', 'plataformas'),
        espejo('s1', 'b', 'B', 'comedor'),
        espejo('s1', 'c', 'C', 'domicilio'),
      ],
      [S1, S2],
      new Set(['s1']),
    );
    expect(r.areas.map((a) => `${a.sucursal}/${a.areaOrigenSrId}`)).toEqual([
      'Centro/c',
      'Centro/a',
      'Centro/b',
      'Norte/b',
    ]);
    expect(r.canales.map((c) => c.canal)).toEqual(['comedor', 'domicilio', 'plataformas']);
  });

  it('periodo sin ventas: todo en cero, sin filas ni canales inventados', () => {
    const r = armarPorArea([], [espejo('s1', 'C', 'Comedor', 'comedor')], [S1], new Set(['s1']));
    expect(r).toEqual({
      venta: '0.00',
      cuentas: 0,
      areas: [],
      sinArea: { venta: '0.00', cuentas: 0 },
      canales: [],
      sinCanal: { venta: '0.00', cuentas: 0 },
      catalogo: [{ sucursalId: 's1', sucursal: 'Centro', sincronizado: true }],
    });
  });
});
