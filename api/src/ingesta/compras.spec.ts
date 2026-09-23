import {
  decidirCompra,
  normalizarLoteCompras,
  origenCompra,
  partidasDeCompras,
  type CompraGuardada,
} from './compras';

// Parte PURA de la ingesta de compras (F2-126): validación por compra, importes, total, hash y la
// decisión frente a lo guardado. Sin base.

const AHORA = Date.UTC(2026, 8, 22, 20, 0, 0);
const base = {
  origenSrId: 'C1',
  folio: 'OC-1',
  proveedorOrigenSrId: 'PR1',
  almacenOrigenSrId: 'ALM1',
  fecha: '2026-09-22T10:00:00-06:00',
  cancelada: false,
  partidas: [
    { insumoOrigenSrId: 'I1', cantidad: '10.5', costoUnitario: '20.005' },
    { insumoOrigenSrId: 'I2', cantidad: '1', costoUnitario: '0' },
  ],
};

async function una(c: unknown) {
  const r = await normalizarLoteCompras([c], AHORA);
  return r;
}

describe('normalizarLoteCompras', () => {
  it('calcula importes (costo a 2, mitad lejos de cero) y el total, sin IVA', async () => {
    const { validas, rechazos } = await una(base);
    expect(rechazos).toEqual([]);
    const c = validas[0];
    // 20.005 → 20.01; 10.5 × 20.01 = 210.105 → 210.11.
    expect(
      c.partidas.map((p) => [
        p.cantidad.toFixed(3),
        p.costoUnitario.toFixed(2),
        p.importe.toFixed(2),
      ]),
    ).toEqual([
      ['10.500', '20.01', '210.11'],
      ['1.000', '0.00', '0.00'],
    ]);
    expect(c.total.toFixed(2)).toBe('210.11');
    expect(c.fecha.toISOString()).toBe('2026-09-22T16:00:00.000Z');
  });

  it('proveedor y almacén ausentes quedan nulos', async () => {
    const { validas } = await una({
      ...base,
      proveedorOrigenSrId: undefined,
      almacenOrigenSrId: null,
    });
    expect([validas[0].proveedorOrigenSrId, validas[0].almacenOrigenSrId]).toEqual([null, null]);
  });

  it('el hash no cambia por la forma del número ni por la zona de la fecha', async () => {
    const a = (await una(base)).validas[0];
    const b = (
      await una({
        ...base,
        fecha: '2026-09-22T16:00:00.000Z',
        partidas: [
          { insumoOrigenSrId: 'I1', cantidad: '10.500', costoUnitario: '20.01' },
          { insumoOrigenSrId: 'I2', cantidad: '1.0', costoUnitario: '-0' },
        ],
      })
    ).validas[0];
    expect(b.hash).toBe(a.hash);
    const c = (await una({ ...base, cancelada: true })).validas[0];
    expect(c.hash).not.toBe(a.hash);
  });

  it.each([
    ['cantidad 0', { cantidad: '0', costoUnitario: '1' }, 'debe ser mayor que 0'],
    ['cantidad negativa', { cantidad: '-1', costoUnitario: '1' }, 'debe ser mayor que 0'],
    ['costo negativo', { cantidad: '1', costoUnitario: '-0.01' }, 'no puede ser negativo'],
  ])('rechaza la compra entera por una partida con %s', async (_n, partida, motivo) => {
    const { validas, rechazos } = await una({
      ...base,
      partidas: [base.partidas[0], { insumoOrigenSrId: 'I9', ...partida }],
    });
    expect(validas).toEqual([]);
    expect(rechazos[0]).toMatchObject({ indice: 0, origenSrId: 'C1', reintentable: false });
    expect(rechazos[0].motivo).toContain(motivo);
  });

  it('rechaza fecha futura (> 5 min) y un campo de más, sin repetir el valor', async () => {
    const futura = await una({ ...base, fecha: '2026-09-22T20:06:00Z' });
    expect(futura.rechazos[0].motivo).toContain('futuro');
    const tenant = await una({ ...base, empresaId: 'secreto' });
    expect(tenant.rechazos).toHaveLength(1);
    expect(tenant.rechazos[0].motivo).not.toContain('secreto');
  });

  it('un origenSrId repetido rechaza TODAS sus apariciones', async () => {
    const r = await normalizarLoteCompras(
      [base, { ...base, folio: 'OC-X' }, { ...base, origenSrId: 'C2' }],
      AHORA,
    );
    expect(r.validas.map((c) => c.origenSrId)).toEqual(['C2']);
    expect(r.rechazos.map((x) => x.indice)).toEqual([0, 1]);
  });

  it('cuenta las partidas del lote y lee el origen aunque el resto sea inválido', () => {
    expect(partidasDeCompras([base, { partidas: 'x' }, null, { partidas: [1, 2, 3] }])).toBe(5);
    expect(origenCompra({ origenSrId: 'C9', folio: 3 })).toBe('C9');
    expect(origenCompra({ origenSrId: '' })).toBeNull();
  });
});

describe('decidirCompra', () => {
  const leido = new Date('2026-09-22T10:00:00Z');
  const guardada = (hash: string, leidaAt: Date): CompraGuardada => ({
    id: 'g1',
    origenSrId: 'C1',
    hash,
    leidaAt,
  });

  it('crea, reemplaza, avanza lectura, deja igual u omite la obsoleta', async () => {
    const c = (await una(base)).validas[0];
    expect(decidirCompra(undefined, c, leido).accion).toBe('crear');
    expect(decidirCompra(guardada('otro', leido), c, leido)).toMatchObject({
      accion: 'reemplazar',
      id: 'g1',
    });
    expect(decidirCompra(guardada(c.hash, new Date('2026-09-22T09:00:00Z')), c, leido)).toEqual({
      accion: 'avanzar_lectura',
      id: 'g1',
    });
    expect(decidirCompra(guardada(c.hash, leido), c, leido)).toEqual({ accion: 'sin_cambios' });
    expect(decidirCompra(guardada('otro', new Date('2026-09-22T11:00:00Z')), c, leido)).toEqual({
      accion: 'obsoleta',
    });
  });
});
