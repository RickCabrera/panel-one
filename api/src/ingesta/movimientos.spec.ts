import {
  decidirPoliza,
  hashPoliza,
  normalizarLote,
  partidasDelLote,
  type PolizaNormalizada,
} from './movimientos';

// La parte pura de la ingesta de movimientos (F2-122). Los importes esperados están escritos a
// mano: si la fórmula cambia, esto falla.

const AHORA = Date.UTC(2026, 8, 22, 18, 0, 0);

const poliza = (extra: Record<string, unknown> = {}) => ({
  origenSrId: 'P1',
  folio: 'POL-1',
  tipo: 'compra',
  almacenOrigenSrId: 'ALM1',
  fecha: '2026-09-22T15:00:00.000Z',
  referencia: 'OC-1',
  cancelada: false,
  partidas: [
    { insumoOrigenSrId: 'I1', cantidad: '2.5', costoUnitario: '10.005' },
    { insumoOrigenSrId: 'I2', cantidad: '-0.125', costoUnitario: '1' },
  ],
  ...extra,
});

describe('normalizarLote() (F2-122)', () => {
  it('calcula el importe de cada partida mitad lejos de cero, con signo', async () => {
    const { validas, rechazos } = await normalizarLote([poliza()], AHORA);
    expect(rechazos).toEqual([]);
    const [p] = validas;
    // 10.005 → 10.01; 2.5 × 10.01 = 25.025 → 25.03. −0.125 × 1.00 = −0.125 → −0.13.
    expect(
      p.partidas.map((x) => [x.renglon, x.costoUnitario.toFixed(2), x.importe.toFixed(2)]),
    ).toEqual([
      [0, '10.01', '25.03'],
      [1, '1.00', '-0.13'],
    ]);
    expect(p.fecha.toISOString()).toBe('2026-09-22T15:00:00.000Z');
    expect(p.tipoSr).toBeNull();
  });

  it('una partida inválida rechaza SU póliza entera, sin repetir el valor', async () => {
    const mala = poliza({
      origenSrId: 'P2',
      partidas: [
        { insumoOrigenSrId: 'I1', cantidad: '1', costoUnitario: '1' },
        { insumoOrigenSrId: 'I2', cantidad: 'doce-y-medio', costoUnitario: '1' },
      ],
    });
    const { validas, rechazos } = await normalizarLote([poliza(), mala], AHORA);
    expect(validas.map((p) => p.origenSrId)).toEqual(['P1']);
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0]).toMatchObject({ indice: 1, origenSrId: 'P2', reintentable: false });
    expect(rechazos[0].motivo).toContain('polizas.1.partidas.1.cantidad');
    expect(rechazos[0].motivo).not.toContain('doce-y-medio');
  });

  it('un campo de más en la póliza o en una partida la rechaza (tenant incluido)', async () => {
    const { validas, rechazos } = await normalizarLote(
      [
        poliza({ origenSrId: 'P1', sucursalId: 'otra' }),
        poliza({
          origenSrId: 'P2',
          partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1', costoUnitario: '1', empresaId: 'x' }],
        }),
      ],
      AHORA,
    );
    expect(validas).toEqual([]);
    expect(rechazos.map((r) => r.origenSrId)).toEqual(['P1', 'P2']);
  });

  it('un origenSrId repetido rechaza TODAS sus apariciones', async () => {
    const { validas, rechazos } = await normalizarLote(
      [poliza(), poliza({ folio: 'otro' }), poliza({ origenSrId: 'P3' })],
      AHORA,
    );
    expect(validas.map((p) => p.origenSrId)).toEqual(['P3']);
    expect(rechazos.map((r) => [r.indice, r.motivo])).toEqual([
      [0, 'polizas.0.origenSrId: repetido en el lote'],
      [1, 'polizas.1.origenSrId: repetido en el lote'],
    ]);
  });

  it('fecha más de 5 min en el futuro, sin zona o imposible: rechazada', async () => {
    const { rechazos } = await normalizarLote(
      [
        poliza({ origenSrId: 'F1', fecha: new Date(AHORA + 6 * 60_000).toISOString() }),
        poliza({ origenSrId: 'F2', fecha: '2026-09-22T15:00:00' }),
        poliza({ origenSrId: 'F3', fecha: '2026-13-45T15:00:00Z' }),
      ],
      AHORA,
    );
    expect(rechazos.map((r) => r.origenSrId)).toEqual(['F1', 'F2', 'F3']);
    // 4 min en el futuro sí entra (reloj del agente un poco adelantado).
    const ok = await normalizarLote(
      [poliza({ fecha: new Date(AHORA + 4 * 60_000).toISOString() })],
      AHORA,
    );
    expect(ok.rechazos).toEqual([]);
  });

  it('un importe que no cabe en NUMERIC(12,2) rechaza la póliza', async () => {
    const { rechazos } = await normalizarLote(
      [
        poliza({
          partidas: [{ insumoOrigenSrId: 'I1', cantidad: '999999999', costoUnitario: '9999999' }],
        }),
      ],
      AHORA,
    );
    expect(rechazos[0].motivo).toBe(
      'polizas.0.partidas.0: cantidad × costoUnitario no cabe en NUMERIC(12,2)',
    );
  });

  it('acepta una póliza sin partidas y una partida en cero (sin "-0")', async () => {
    const { validas, rechazos } = await normalizarLote(
      [
        poliza({ origenSrId: 'V', partidas: [] }),
        poliza({
          origenSrId: 'C',
          partidas: [{ insumoOrigenSrId: 'I1', cantidad: '-0.000', costoUnitario: '5' }],
        }),
      ],
      AHORA,
    );
    expect(rechazos).toEqual([]);
    expect(validas[0].partidas).toEqual([]);
    expect(validas[1].partidas[0].cantidad.toFixed(3)).toBe('0.000');
    expect(validas[1].partidas[0].cantidad.isNegative()).toBe(false);
    expect(validas[1].partidas[0].importe.toFixed(2)).toBe('0.00');
  });

  it('el tipo fuera del enum se rechaza; `otro` y el código crudo de SR entran', async () => {
    const { validas, rechazos } = await normalizarLote(
      [poliza({ origenSrId: 'X', tipo: 'salida' }), poliza({ tipo: 'otro', tipoSr: 'ZZ' })],
      AHORA,
    );
    expect(rechazos.map((r) => r.origenSrId)).toEqual(['X']);
    expect([validas[0].tipo, validas[0].tipoSr]).toEqual(['otro', 'ZZ']);
  });
});

describe('hashPoliza() (F2-122)', () => {
  it('"10.5" y "10.500", o la fecha en otro offset, son la MISMA póliza', async () => {
    const a = await normalizarLote([poliza()], AHORA);
    const b = await normalizarLote(
      [
        poliza({
          fecha: '2026-09-22T09:00:00.000-06:00',
          partidas: [
            { insumoOrigenSrId: 'I1', cantidad: '2.500', costoUnitario: '10.0050' },
            { insumoOrigenSrId: 'I2', cantidad: '-0.1250', costoUnitario: '1.00' },
          ],
        }),
      ],
      AHORA,
    );
    // -0.1250 no es CANTIDAD válida (4 decimales): la regla es la del contrato, no se redondea.
    expect(b.rechazos).toHaveLength(1);
    const c = await normalizarLote(
      [
        poliza({
          fecha: '2026-09-22T09:00:00.000-06:00',
          partidas: [
            { insumoOrigenSrId: 'I1', cantidad: '2.500', costoUnitario: '10.0050' },
            { insumoOrigenSrId: 'I2', cantidad: '-0.125', costoUnitario: '1.00' },
          ],
        }),
      ],
      AHORA,
    );
    expect(c.validas[0].hash).toBe(a.validas[0].hash);
  });

  it('cambiar el orden de las partidas, cancelarla o cambiar una cantidad es otra póliza', async () => {
    const [base] = (await normalizarLote([poliza()], AHORA)).validas;
    const otra = (extra: Record<string, unknown>) =>
      normalizarLote([poliza(extra)], AHORA).then((r) => r.validas[0].hash);
    const p = poliza();
    expect(await otra({ partidas: [...p.partidas].reverse() })).not.toBe(base.hash);
    expect(await otra({ cancelada: true })).not.toBe(base.hash);
    expect(
      await otra({
        partidas: [
          p.partidas[0],
          { insumoOrigenSrId: 'I2', cantidad: '-0.126', costoUnitario: '1' },
        ],
      }),
    ).not.toBe(base.hash);
    expect(hashPoliza(base)).toBe(base.hash);
  });
});

describe('decidirPoliza() (F2-122)', () => {
  const T0 = new Date('2026-09-22T10:00:00.000Z');
  const T1 = new Date('2026-09-22T11:00:00.000Z');
  const nueva = { origenSrId: 'P1', hash: 'h-nuevo' } as PolizaNormalizada;
  const guardada = (hash: string, leidaAt: Date) => ({
    id: 'id-1',
    origenSrId: 'P1',
    hash,
    leidaAt,
  });

  it('sin guardada crea; con la misma lectura y el mismo hash no hace nada', () => {
    expect(decidirPoliza(undefined, nueva, T0)).toEqual({ accion: 'crear', p: nueva });
    expect(decidirPoliza(guardada('h-nuevo', T0), nueva, T0)).toEqual({ accion: 'sin_cambios' });
  });

  it('un lote leído ANTES que lo guardado es obsoleto, aunque traiga otro contenido', () => {
    expect(decidirPoliza(guardada('h-viejo', T1), nueva, T0)).toEqual({ accion: 'obsoleta' });
  });

  it('mismo contenido leído después: sólo avanza la lectura', () => {
    expect(decidirPoliza(guardada('h-nuevo', T0), nueva, T1)).toEqual({
      accion: 'avanzar_lectura',
      id: 'id-1',
    });
  });

  it('otro contenido con la misma lectura o una más nueva: reemplaza', () => {
    for (const t of [T0, T1]) {
      expect(decidirPoliza(guardada('h-viejo', T0), nueva, t)).toEqual({
        accion: 'reemplazar',
        id: 'id-1',
        p: nueva,
      });
    }
  });
});

describe('partidasDelLote() (F2-122)', () => {
  it('cuenta las partidas de todo el lote; lo que no es arreglo cuenta 0', () => {
    expect(
      partidasDelLote([
        { partidas: [1, 2, 3] },
        { partidas: 'no' },
        null,
        { partidas: new Array(4999).fill({}) },
      ]),
    ).toBe(5002);
    expect(partidasDelLote([])).toBe(0);
  });
});
