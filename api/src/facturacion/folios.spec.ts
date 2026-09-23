import {
  asignarFolios,
  avisaVigencia,
  cuboDe,
  estadoSaldo,
  limitesDe,
  plantillaFoliosBajo,
  plantillaFoliosPorVencer,
  saldoFolios,
  vigenciaDeCompra,
  type PaqueteFolios,
} from './folios';

// Reglas PURAS del control de folios (F2-110). Cifras escritas a mano.

const d = (iso: string) => new Date(iso);
const paquete = (id: string, cantidad: number, desde: string, hasta: string): PaqueteFolios => ({
  id,
  cantidad,
  compradoAt: d(desde),
  venceAt: d(hasta),
});

describe('vigenciaDeCompra', () => {
  it('compra al inicio del día en CDMX (UTC−6) y vence al inicio del mismo día un año después', () => {
    expect(vigenciaDeCompra('2026-09-01')).toEqual({
      compradoAt: d('2026-09-01T06:00:00.000Z'),
      venceAt: d('2027-09-01T06:00:00.000Z'),
    });
  });

  it('un 29 de febrero vence el 1 de marzo', () => {
    expect(vigenciaDeCompra('2028-02-29')?.venceAt).toEqual(d('2029-03-01T06:00:00.000Z'));
  });

  it('rechaza fechas que no existen o mal formadas', () => {
    expect(vigenciaDeCompra('2026-02-30')).toBeNull();
    expect(vigenciaDeCompra('2026-13-01')).toBeNull();
    expect(vigenciaDeCompra('26-09-01')).toBeNull();
    expect(vigenciaDeCompra('2026-09-01T00:00')).toBeNull();
  });
});

describe('limitesDe y cuboDe (el width_bucket de Postgres)', () => {
  const a = paquete('a', 10, '2031-01-01T00:00:00Z', '2031-03-01T00:00:00Z');
  const b = paquete('b', 10, '2031-02-01T00:00:00Z', '2031-03-01T00:00:00Z');
  const limites = limitesDe([a, b]);

  it('ordena y no repite', () => {
    expect(limites).toEqual([
      d('2031-01-01T00:00:00Z'),
      d('2031-02-01T00:00:00Z'),
      d('2031-03-01T00:00:00Z'),
    ]);
  });

  it('el límite inferior es del cubo, el superior no', () => {
    expect(cuboDe(d('2030-12-31T23:59:59Z'), limites)).toBe(0);
    expect(cuboDe(d('2031-01-01T00:00:00Z'), limites)).toBe(1);
    expect(cuboDe(d('2031-02-01T00:00:00Z'), limites)).toBe(2);
    expect(cuboDe(d('2031-03-01T00:00:00Z'), limites)).toBe(3);
  });
});

describe('asignarFolios (FIFO por vencimiento)', () => {
  it('usa primero el paquete que vence antes, y lo que no cabe es sobregiro', () => {
    // Cubos: [ene, feb) sólo A; [feb, mar) A y B (B vence después); [mar, abr) sólo B.
    const a = paquete('a', 5, '2031-01-01T00:00:00Z', '2031-03-01T00:00:00Z');
    const b = paquete('b', 4, '2031-02-01T00:00:00Z', '2031-04-01T00:00:00Z');
    const limites = limitesDe([a, b]);
    // 3 en enero (A: 3), 4 en febrero (A: 2 más → 5; B: 2), 3 en marzo (B: 2 más → 4; sobra 1).
    const r = asignarFolios([a, b], limites, [0, 3, 4, 3, 0]);
    expect(Object.fromEntries(r.consumidos)).toEqual({ a: 5, b: 4 });
    expect(r.sobregiro).toBe(1);
  });

  it('lo que queda de un paquete vencido no se usa después', () => {
    const a = paquete('a', 10, '2031-01-01T00:00:00Z', '2031-02-01T00:00:00Z');
    const b = paquete('b', 10, '2031-03-01T00:00:00Z', '2031-04-01T00:00:00Z');
    const limites = limitesDe([a, b]); // 4 límites → 5 cubos; el hueco [feb, mar) es el cubo 2.
    const r = asignarFolios([a, b], limites, [7, 2, 3, 1, 9]);
    // Cubo 0 (antes de todo) y el último: sin paquete. El hueco: sobregiro.
    expect(Object.fromEntries(r.consumidos)).toEqual({ a: 2, b: 1 });
    expect(r.sobregiro).toBe(7 + 3 + 9);
  });
});

describe('saldoFolios', () => {
  const a = paquete('a', 100, '2031-01-01T06:00:00Z', '2032-01-01T06:00:00Z');
  const limites = limitesDe([a]);

  it('descuenta los timbres y las reservas en emisión; el umbral es sobre lo vigente', () => {
    const s = saldoFolios({
      control: true,
      umbralPct: 20,
      paquetes: [a],
      limites,
      conteos: [0, 79, 0],
      enEmision: 1,
      ahora: d('2031-06-01T00:00:00Z'),
    });
    expect(s).toMatchObject({ disponible: 20, vigenteTotal: 100, enEmision: 1, estado: 'ok' });
    // 20 de 100 es EXACTAMENTE el 20 %: todavía no es bajo. Con uno más, sí.
    const bajo = saldoFolios({
      ...s,
      paquetes: [a],
      limites,
      conteos: [0, 80, 0],
      ahora: d('2031-06-01T00:00:00Z'),
    });
    expect(bajo).toMatchObject({ disponible: 19, estado: 'bajo' });
    expect(bajo.paquetes[0]).toMatchObject({ consumidos: 81, restantes: 19, estado: 'vigente' });
  });

  it('agotado con 0 disponible; sin control no juzga', () => {
    const base = {
      umbralPct: 20,
      paquetes: [a],
      limites,
      enEmision: 0,
      ahora: d('2031-06-01T00:00:00Z'),
    };
    expect(saldoFolios({ ...base, control: true, conteos: [0, 100, 0] })).toMatchObject({
      disponible: 0,
      estado: 'agotado',
    });
    expect(saldoFolios({ ...base, control: false, conteos: [0, 100, 0] }).estado).toBe(
      'sin_control',
    );
  });

  it('con control y sin paquete vigente, agotado', () => {
    const s = saldoFolios({
      control: true,
      umbralPct: 20,
      paquetes: [a],
      limites,
      conteos: [0, 0, 0],
      enEmision: 0,
      ahora: d('2032-01-01T06:00:00Z'),
    });
    expect(s).toMatchObject({ disponible: 0, vigenteTotal: 0, estado: 'agotado' });
    expect(s.paquetes[0].estado).toBe('vencido');
  });

  it('marca por vencer a 30 días exactos y no a 30 días y un milisegundo', () => {
    const base = {
      control: true,
      umbralPct: 20,
      paquetes: [a],
      limites,
      conteos: [0, 0, 0],
      enEmision: 0,
    };
    const a30 = new Date(a.venceAt.getTime() - 30 * 86_400_000);
    expect(saldoFolios({ ...base, ahora: a30 }).paquetes[0]).toMatchObject({
      estado: 'por_vencer',
      diasParaVencer: 30,
    });
    expect(saldoFolios({ ...base, ahora: new Date(a30.getTime() - 1) }).paquetes[0].estado).toBe(
      'vigente',
    );
  });
});

describe('estadoSaldo y avisaVigencia', () => {
  it('bajo es estrictamente por debajo del umbral', () => {
    expect(estadoSaldo(true, 20, 100, 20)).toBe('ok');
    expect(estadoSaldo(true, 19, 100, 20)).toBe('bajo');
    expect(estadoSaldo(true, 0, 100, 20)).toBe('agotado');
    expect(estadoSaldo(false, 0, 0, 20)).toBe('sin_control');
  });

  it('avisa sólo con restante, vigente y a ≤ 30 días', () => {
    const p = { compradoAt: d('2031-01-01T06:00:00Z'), venceAt: d('2032-01-01T06:00:00Z') };
    const a30 = new Date(p.venceAt.getTime() - 30 * 86_400_000);
    expect(avisaVigencia({ ...p, restantes: 1 }, a30)).toBe(true);
    expect(avisaVigencia({ ...p, restantes: 1 }, new Date(a30.getTime() - 1))).toBe(false);
    expect(avisaVigencia({ ...p, restantes: 0 }, a30)).toBe(false);
    expect(avisaVigencia({ ...p, restantes: 1 }, p.venceAt)).toBe(false);
  });
});

describe('plantillas de aviso', () => {
  it('saldo bajo: cifras de la plataforma, nada de clientes', () => {
    const t = plantillaFoliosBajo({
      estado: 'bajo',
      disponible: 19,
      vigenteTotal: 100,
      umbralPct: 20,
    });
    expect(t.nombre).toBe('folios-bajo');
    expect(t.asunto).toBe('Saldo de folios de timbrado bajo');
    expect(t.texto).toContain('Quedan 19 de 100 folios vigentes: por debajo del 20 % configurado.');
    const agotado = plantillaFoliosBajo({
      estado: 'agotado',
      disponible: 0,
      vigenteTotal: 100,
      umbralPct: 20,
    });
    expect(agotado.asunto).toBe('Folios de timbrado AGOTADOS');
  });

  it('por vencer: el último día útil es el anterior al vencimiento (hora de CDMX)', () => {
    const t = plantillaFoliosPorVencer({
      cantidad: 500,
      restantes: 120,
      compradoAt: d('2031-01-01T06:00:00Z'),
      venceAt: d('2032-01-01T06:00:00Z'),
    });
    expect(t.nombre).toBe('folios-por-vencer');
    expect(t.texto).toContain(
      'El paquete de 500 folios comprado el 2031-01-01 vence al terminar el 2031-12-31 y todavía ' +
        'le quedan 120 folios sin usar.',
    );
    expect(t.html).not.toContain('<script');
  });
});
