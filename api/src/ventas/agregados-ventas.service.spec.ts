import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FormaPago, Prisma, PrismaClient } from '@prisma/client';

import {
  CATALOGO_SEED,
  FORMA_SIN_CATALOGO,
  generarVentas,
  sembrarVentas,
  type ChequeSeed,
  type OpcionesVentas,
} from '../../prisma/seed-ventas';
import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import type { PrismaService } from '../prisma/prisma.service';
import type { FiltroVentas } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService, FORMAS } from './agregados-ventas.service';

// Los agregados de F1-032 contra Postgres real, con el seed de 500 cheques.
//
// Dos referencias independientes del SQL:
// 1. Un cálculo "a mano" en JS, con Decimal, sobre los MISMOS cheques que
//    generó el seed. El día y la hora local salen de `Intl.DateTimeFormat`, no
//    del `AT TIME ZONE` de Postgres.
// 2. Casos borde con números escritos a mano (en 2027, fuera del rango del
//    seed), para que el cálculo en JS no sea la única referencia.
//
// A1 está en America/Mexico_City (sin horario de verano) y A2 en
// America/Tijuana (con horario de verano; lo deja el 1 de noviembre de 2026):
// el corte de "hoy" tiene que hacerse en la zona de CADA sucursal.

const TIJUANA = 'America/Tijuana';
const CDMX = 'America/Mexico_City';

const OPCIONES_A: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: CDMX },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: TIJUANA },
  ],
  hoy: '2026-11-15',
};
const OPCIONES_B: OpcionesVentas = {
  empresaId: FX.empresaB,
  sucursales: [{ id: FX.sucursalB1, clave: 'B1', zonaHoraria: CDMX }],
  hoy: '2026-11-15',
  semilla: 99,
};
const ZONA: Record<string, string> = {
  [FX.sucursalA1]: CDMX,
  [FX.sucursalA2]: TIJUANA,
  [FX.sucursalB1]: CDMX,
};
const NOMBRE: Record<string, string> = { [FX.sucursalA1]: 'A1', [FX.sucursalA2]: 'A2' };

const A: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaA };
const B: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaB };
const GLOBAL: EmpresaScope = { tipo: 'global' };

// ---------------------------------------------------------------------------
// Cálculo a mano
// ---------------------------------------------------------------------------

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);
const pesos = (d: Prisma.Decimal) => d.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
const div2 = (a: Prisma.Decimal, b: number) =>
  a.div(b).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

function local(t: Date, zona: string): { dia: string; hora: number } {
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
  const hora = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: zona, hour: 'numeric', hourCycle: 'h23' }).format(
      t,
    ),
  );
  return { dia, hora };
}

function delFiltro(cheques: ChequeSeed[], f: FiltroVentas): ChequeSeed[] {
  return cheques.filter((c) => {
    if (c.empresaId !== f.empresaId) return false;
    if (f.sucursalId && c.sucursalId !== f.sucursalId) return false;
    const cuando = c.cancelado ? (c.cerradoAt ?? c.abiertoAt) : c.cerradoAt;
    if (!cuando) return false;
    const { dia } = local(cuando, ZONA[c.sucursalId]);
    return dia >= f.desde && dia <= f.hasta;
  });
}

function manual(cheques: ChequeSeed[], f: FiltroVentas) {
  const todos = delFiltro(cheques, f);
  const v = todos.filter((c) => !c.cancelado);
  const suma = (
    xs: ChequeSeed[],
    k: 'total' | 'subtotal' | 'impuestos' | 'propina' | 'descuentos',
  ) => xs.reduce((s, c) => s.plus(c[k]), D());
  const venta = suma(v, 'total');
  const conCom = v.filter((c) => c.comensales !== null);
  const comensales = conCom.reduce((s, c) => s + c.comensales!, 0);

  const resumen = {
    venta: pesos(venta),
    cuentas: v.length,
    ticketPromedio: pesos(v.length ? div2(venta, v.length) : D()),
    subtotal: pesos(suma(v, 'subtotal')),
    impuestos: pesos(suma(v, 'impuestos')),
    propina: pesos(suma(v, 'propina')),
    descuentos: {
      monto: pesos(suma(v, 'descuentos')),
      cuentas: v.filter((c) => !c.descuentos.isZero()).length,
    },
    cortesias: null,
    comensales: {
      total: comensales,
      cuentasConDato: conCom.length,
      promedioPorComensal: comensales
        ? pesos(
            div2(
              suma(
                conCom.filter((c) => c.comensales! > 0),
                'total',
              ),
              comensales,
            ),
          )
        : null,
    },
    cancelados: { cuentas: todos.length - v.length },
  };

  const porHora = Array.from({ length: 24 }, (_, hora) => {
    const xs = v.filter((c) => local(c.cerradoAt!, ZONA[c.sucursalId]).hora === hora);
    return { hora, venta: pesos(suma(xs, 'total')), cuentas: xs.length };
  });

  const catalogo = new Map(CATALOGO_SEED.map((c) => [c.formaRaw, c.forma]));
  const formas = new Map<FormaPago, Prisma.Decimal>(FORMAS.map((x) => [x, D()]));
  const sinCat = new Map<string, Prisma.Decimal>();
  for (const p of v.flatMap((c) => c.pagos)) {
    const forma = catalogo.get(p.formaRaw) ?? FormaPago.otro;
    formas.set(forma, formas.get(forma)!.plus(p.monto));
    if (!catalogo.has(p.formaRaw))
      sinCat.set(p.formaRaw, (sinCat.get(p.formaRaw) ?? D()).plus(p.monto));
  }
  const formasPago = {
    formas: FORMAS.map((forma) => ({ forma, monto: pesos(formas.get(forma)!) })),
    sinCatalogo: [...sinCat].map(([formaRaw, m]) => ({ formaRaw, monto: pesos(m) })),
  };

  const productos = new Map<string, { importe: Prisma.Decimal; cantidad: Prisma.Decimal }>();
  for (const p of v.flatMap((c) => c.partidas)) {
    const acc = productos.get(p.producto) ?? { importe: D(), cantidad: D() };
    productos.set(p.producto, {
      importe: acc.importe.plus(p.total),
      cantidad: acc.cantidad.plus(p.cantidad),
    });
  }
  const top = (por: 'importe' | 'cantidad', limite: number) =>
    [...productos]
      .sort(([na, a], [nb, b]) => b[por].comparedTo(a[por]) || (na < nb ? -1 : na > nb ? 1 : 0))
      .slice(0, limite)
      .map(([producto, x]) => ({
        producto,
        importe: pesos(x.importe),
        cantidad: x.cantidad.toFixed(3),
      }));

  const comparativo = Object.keys(NOMBRE)
    .filter((id) => !f.sucursalId || id === f.sucursalId)
    .map((id) => {
      const xs = v.filter((c) => c.sucursalId === id);
      const vs = suma(xs, 'total');
      return {
        sucursalId: id,
        nombre: NOMBRE[id],
        venta: pesos(vs),
        cuentas: xs.length,
        ticketPromedio: pesos(xs.length ? div2(vs, xs.length) : D()),
        comensales: xs.reduce((s, c) => s + (c.comensales ?? 0), 0),
      };
    })
    .sort((a, b) => (a.nombre < b.nombre ? -1 : 1));

  return { resumen, porHora, formasPago, top, comparativo };
}

// ---------------------------------------------------------------------------

describe('AgregadosVentasService (contra Postgres, seed de 500 cheques)', () => {
  const prisma = new PrismaClient();
  const servicio = new AgregadosVentasService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
  );
  const cheques = [...generarVentas(OPCIONES_A), ...generarVentas(OPCIONES_B)];

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    await sembrarVentas(prisma, OPCIONES_A);
    await sembrarVentas(prisma, OPCIONES_B);
  }, 60_000);

  afterAll(async () => {
    // `limpiarFixtures` borra las sucursales, así que el cambio de zona de A2 no sobrevive.
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const escenarios: Array<[string, FiltroVentas]> = [
    ['los 30 días completos', { empresaId: FX.empresaA, desde: '2026-10-17', hasta: '2026-11-15' }],
    [
      'el día del cambio de horario de Tijuana',
      { empresaId: FX.empresaA, desde: '2026-11-01', hasta: '2026-11-01' },
    ],
    ['un día normal', { empresaId: FX.empresaA, desde: '2026-11-10', hasta: '2026-11-10' }],
    [
      'sólo A2 (Tijuana), cruzando el cambio de horario',
      {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA2,
        desde: '2026-10-25',
        hasta: '2026-11-05',
      },
    ],
    [
      'sólo A1 (CDMX)',
      {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        desde: '2026-10-20',
        hasta: '2026-10-31',
      },
    ],
    ['un rango sin ventas', { empresaId: FX.empresaA, desde: '2025-01-01', hasta: '2025-01-31' }],
  ];

  describe.each(escenarios)('cuadra contra el cálculo a mano: %s', (_nombre, filtro) => {
    const esperado = manual(cheques, filtro);

    it('resumen', async () => {
      await expect(servicio.resumen(A, filtro)).resolves.toEqual(esperado.resumen);
    });

    it('serie por hora local', async () => {
      await expect(servicio.porHora(A, filtro)).resolves.toEqual(esperado.porHora);
    });

    it('formas de pago (con el catálogo)', async () => {
      const r = await servicio.formasPago(A, filtro);
      expect(r.formas).toEqual(esperado.formasPago.formas);
      expect(r.sinCatalogo).toEqual(esperado.formasPago.sinCatalogo);
    });

    it('top productos por importe y por cantidad', async () => {
      await expect(servicio.topProductos(A, filtro)).resolves.toEqual(esperado.top('importe', 10));
      await expect(
        servicio.topProductos(A, filtro, { por: 'cantidad', limite: 5 }),
      ).resolves.toEqual(esperado.top('cantidad', 5));
      await expect(servicio.topProductos(A, filtro, { limite: 50 })).resolves.toEqual(
        esperado.top('importe', 50),
      );
    });

    it('comparativo entre sucursales', async () => {
      await expect(servicio.comparativoSucursales(A, filtro)).resolves.toEqual(
        esperado.comparativo,
      );
    });
  });

  it('el seed completo sí tiene ventas en el rango (el escenario principal no es trivial)', async () => {
    const r = await servicio.resumen(A, escenarios[0][1]);
    expect(r.cuentas).toBeGreaterThan(450);
    expect(r.cancelados.cuentas).toBeGreaterThan(0);
    expect(Number(r.descuentos.cuentas)).toBeGreaterThan(0);
    const formas = await servicio.formasPago(A, escenarios[0][1]);
    expect(formas.sinCatalogo.map((s) => s.formaRaw)).toEqual([FORMA_SIN_CATALOGO]);
  });

  it('la venta de A es sólo de A: B tiene su propio seed y no se mezcla', async () => {
    const filtro = escenarios[0][1];
    const soloA = manual(
      cheques.filter((c) => c.empresaId === FX.empresaA),
      filtro,
    );
    await expect(servicio.resumen(A, filtro)).resolves.toEqual(soloA.resumen);
    const deB = await servicio.resumen(B, { ...filtro, empresaId: FX.empresaB });
    expect(deB).toEqual(manual(cheques, { ...filtro, empresaId: FX.empresaB }).resumen);
    expect(deB.venta).not.toBe(soloA.resumen.venta);
  });

  it('admin_global ve exactamente lo mismo que el visor de la empresa', async () => {
    const filtro = escenarios[0][1];
    await expect(servicio.resumen(GLOBAL, filtro)).resolves.toEqual(
      await servicio.resumen(A, filtro),
    );
    await expect(servicio.comparativoSucursales(GLOBAL, filtro)).resolves.toEqual(
      await servicio.comparativoSucursales(A, filtro),
    );
  });

  it('corregir el catálogo reclasifica el histórico sin reingerir', async () => {
    const filtro = escenarios[0][1];
    const antes = await servicio.formasPago(A, filtro);
    const vales = antes.sinCatalogo[0];
    const cat = await prisma.formaPagoCatalogo.create({
      data: { empresaId: FX.empresaA, formaRaw: FORMA_SIN_CATALOGO, forma: FormaPago.efectivo },
    });
    try {
      const despues = await servicio.formasPago(A, filtro);
      expect(despues.sinCatalogo).toEqual([]);
      const monto = (r: typeof antes, f: FormaPago) =>
        D(r.formas.find((x) => x.forma === f)!.monto);
      expect(
        monto(despues, FormaPago.efectivo).minus(monto(antes, FormaPago.efectivo)).toFixed(2),
      ).toBe(vales.monto);
      expect(monto(antes, FormaPago.otro).minus(monto(despues, FormaPago.otro)).toFixed(2)).toBe(
        vales.monto,
      );
    } finally {
      await prisma.formaPagoCatalogo.delete({ where: { id: cat.id } });
    }
  });

  it('el catálogo de otra empresa no se aplica', async () => {
    // B no tiene "VALES DESPENSA" mapeado; mapearlo en B no cambia nada en A.
    const filtro = escenarios[0][1];
    const antes = await servicio.formasPago(A, filtro);
    const cat = await prisma.formaPagoCatalogo.create({
      data: { empresaId: FX.empresaB, formaRaw: FORMA_SIN_CATALOGO, forma: FormaPago.tarjeta },
    });
    try {
      await expect(servicio.formasPago(A, filtro)).resolves.toEqual(antes);
    } finally {
      await prisma.formaPagoCatalogo.delete({ where: { id: cat.id } });
    }
  });

  describe('404, nunca 403', () => {
    const rango = { desde: '2026-10-17', hasta: '2026-11-15' };

    it.each([
      ['empresa de otro cliente', A, { empresaId: FX.empresaB }],
      ['empresa que no existe', A, { empresaId: FX.inexistente }],
      ['empresa que no existe (admin_global)', GLOBAL, { empresaId: FX.inexistente }],
      ['sucursal de otro cliente', A, { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 }],
      [
        'sucursal de otra empresa con la empresa del otro',
        A,
        { empresaId: FX.empresaB, sucursalId: FX.sucursalB1 },
      ],
      ['sucursal que no existe', A, { empresaId: FX.empresaA, sucursalId: FX.inexistente }],
      [
        'sucursal de otra empresa (admin_global)',
        GLOBAL,
        { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 },
      ],
    ] as Array<[string, EmpresaScope, Partial<FiltroVentas>]>)(
      '%s',
      async (_caso, scope, cambio) => {
        const filtro = { ...rango, ...cambio } as FiltroVentas;
        await expect(servicio.resumen(scope, filtro)).rejects.toThrow(NotFoundException);
        await expect(servicio.porHora(scope, filtro)).rejects.toThrow(NotFoundException);
        await expect(servicio.formasPago(scope, filtro)).rejects.toThrow(NotFoundException);
        await expect(servicio.topProductos(scope, filtro)).rejects.toThrow(NotFoundException);
        await expect(servicio.comparativoSucursales(scope, filtro)).rejects.toThrow(
          NotFoundException,
        );
      },
    );

    it('un id mal formado es 400 antes de tocar la base, no un 500', async () => {
      await expect(servicio.resumen(A, { ...rango, empresaId: 'no-es-uuid' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        servicio.resumen(A, { ...rango, empresaId: FX.empresaA, sucursalId: '1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('valida el orden y el límite del top', async () => {
    const filtro = escenarios[0][1];
    await expect(servicio.topProductos(A, filtro, { limite: 0 })).rejects.toThrow(/límite/);
    await expect(servicio.topProductos(A, filtro, { limite: 51 })).rejects.toThrow(/límite/);
    await expect(servicio.topProductos(A, filtro, { por: 'total' as 'importe' })).rejects.toThrow(
      /inválido/,
    );
  });

  it('cada agregado responde en menos de 300 ms con el seed', async () => {
    const filtro = escenarios[0][1];
    const llamadas: Array<() => Promise<unknown>> = [
      () => servicio.resumen(A, filtro),
      () => servicio.porHora(A, filtro),
      () => servicio.formasPago(A, filtro),
      () => servicio.topProductos(A, filtro),
      () => servicio.comparativoSucursales(A, filtro),
    ];
    for (const llamada of llamadas) {
      await llamada(); // calentamiento: conexión y plan
      const t0 = performance.now();
      await llamada();
      expect(performance.now() - t0).toBeLessThan(300);
    }
  });
});

// ---------------------------------------------------------------------------
// Casos borde con números escritos a mano (2027: lejos del rango del seed)
// ---------------------------------------------------------------------------

describe('AgregadosVentasService: casos borde con valores literales', () => {
  const prisma = new PrismaClient();
  const servicio = new AgregadosVentasService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
  );

  async function cheque(
    sucursalId: string,
    folioSr: string,
    cerradoAt: string | null,
    total: string,
    extra: {
      cancelado?: boolean;
      abiertoAt?: string;
      comensales?: number | null;
      descuentos?: string;
      propina?: string;
      partidas?: Array<[string, string, string]>; // producto, cantidad, total
      pagos?: Array<[string, string]>; // forma_raw, monto
    } = {},
  ): Promise<void> {
    const c = await prisma.cheque.create({
      data: {
        sucursalId,
        empresaId: FX.empresaA,
        folio: folioSr,
        folioSr,
        abiertoAt: new Date(extra.abiertoAt ?? cerradoAt!),
        cerradoAt: cerradoAt ? new Date(cerradoAt) : null,
        comensales: extra.comensales ?? null,
        subtotal: total,
        impuestos: '0',
        descuentos: extra.descuentos ?? '0',
        propina: extra.propina ?? '0',
        total,
        cancelado: extra.cancelado ?? false,
      },
    });
    for (const [orden, [producto, cantidad, t]] of (extra.partidas ?? []).entries()) {
      await prisma.chequePartida.create({
        data: {
          chequeId: c.id,
          empresaId: FX.empresaA,
          orden,
          producto,
          cantidad,
          precioUnit: t,
          total: t,
        },
      });
    }
    for (const [formaRaw, monto] of extra.pagos ?? []) {
      await prisma.chequePago.create({
        data: { chequeId: c.id, empresaId: FX.empresaA, forma: FormaPago.otro, formaRaw, monto },
      });
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    await prisma.formaPagoCatalogo.createMany({
      data: CATALOGO_SEED.map((c) => ({ ...c, empresaId: FX.empresaA })),
    });

    // A2, Tijuana, 7 de noviembre de 2027: ese día termina el horario de verano
    // (a las 02:00 PDT vuelve a ser 01:00 PST). El día local va de 07:00Z a 08:00Z del 8.
    await cheque(FX.sucursalA2, 'B-E5', '2027-11-07T06:59:59.999Z', '50.00'); // 6 nov 23:59:59.999 PDT
    await cheque(FX.sucursalA2, 'B-E1', '2027-11-07T08:30:00Z', '100.00'); // 01:30 PDT
    await cheque(FX.sucursalA2, 'B-E2', '2027-11-07T09:30:00Z', '200.00'); // 01:30 PST (la hora repetida)
    await cheque(FX.sucursalA2, 'B-E3', '2027-11-08T07:59:59.999Z', '300.00'); // 23:59:59.999 PST
    await cheque(FX.sucursalA2, 'B-E4', '2027-11-08T08:00:00Z', '400.00'); // 8 nov 00:00 PST
    await cheque(FX.sucursalA2, 'B-C1', '2027-11-07T20:00:00Z', '999.00', { cancelado: true });
    await cheque(FX.sucursalA2, 'B-C2', null, '888.00', {
      cancelado: true,
      abiertoAt: '2027-11-07T21:00:00Z',
    });

    // El mismo instante, 2027-12-11T07:30Z, es 10 dic 23:30 en Tijuana y 11 dic 01:30 en CDMX.
    await cheque(FX.sucursalA2, 'B-X2', '2027-12-11T07:30:00Z', '123.45', {
      comensales: 4,
      descuentos: '10.00',
      partidas: [
        ['Tacos', '2', '60.00'],
        ['Pozole', '1', '63.45'],
      ],
      pagos: [
        ['EFECTIVO', '100.00'],
        ['CHEQUE NOMINATIVO', '23.45'],
      ],
    });
    await cheque(FX.sucursalA1, 'B-X1', '2027-12-11T07:30:00Z', '77.70');
    // Medianoche de CDMX: 06:00Z abre el 10 de diciembre.
    await cheque(FX.sucursalA1, 'B-Y0', '2027-12-10T05:59:59.999Z', '1.00');
    await cheque(FX.sucursalA1, 'B-Y1', '2027-12-10T06:00:00Z', '10.00', {
      partidas: [['Agua', '1', '10.00']],
      pagos: [['TARJETA DE CREDITO', '10.00']],
    });
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const f = (desde: string, hasta = desde, sucursalId?: string): FiltroVentas => ({
    empresaId: FX.empresaA,
    desde,
    hasta,
    ...(sucursalId ? { sucursalId } : {}),
  });

  it('A2 el día del cambio de horario: 3 cuentas, 600.00, la hora repetida suma las dos', async () => {
    const r = await servicio.resumen(A, f('2027-11-07', '2027-11-07', FX.sucursalA2));
    expect(r.venta).toBe('600.00');
    expect(r.cuentas).toBe(3);
    expect(r.ticketPromedio).toBe('200.00');
    expect(r.cancelados.cuentas).toBe(2); // uno sin fecha de cierre, cortado por su apertura
    const horas = await servicio.porHora(A, f('2027-11-07', '2027-11-07', FX.sucursalA2));
    expect(horas[1]).toEqual({ hora: 1, venta: '300.00', cuentas: 2 });
    expect(horas[23]).toEqual({ hora: 23, venta: '300.00', cuentas: 1 });
    expect(horas.filter((h) => h.cuentas > 0)).toHaveLength(2);
  });

  it('los vecinos del día caen en su día', async () => {
    await expect(
      servicio.resumen(A, f('2027-11-06', '2027-11-06', FX.sucursalA2)),
    ).resolves.toMatchObject({
      venta: '50.00',
      cuentas: 1,
    });
    await expect(
      servicio.resumen(A, f('2027-11-08', '2027-11-08', FX.sucursalA2)),
    ).resolves.toMatchObject({
      venta: '400.00',
      cuentas: 1,
    });
  });

  it('el mismo instante cae en días distintos según la zona de cada sucursal', async () => {
    const dia10 = await servicio.resumen(A, f('2027-12-10'));
    // B-X2 (Tijuana, 23:30 del 10) + B-Y1 (CDMX, 00:00 del 10). B-X1 y B-Y0 no.
    expect(dia10.venta).toBe('133.45');
    expect(dia10.cuentas).toBe(2);
    expect(dia10.ticketPromedio).toBe('66.73'); // 66.725 → mitad lejos de cero
    expect(dia10.descuentos).toEqual({ monto: '10.00', cuentas: 1 });
    expect(dia10.comensales).toEqual({ total: 4, cuentasConDato: 1, promedioPorComensal: '30.86' });
    expect(dia10.cortesias).toBeNull();

    const dia11 = await servicio.resumen(A, f('2027-12-11'));
    expect(dia11.venta).toBe('77.70');
    expect(dia11.cuentas).toBe(1);

    const comparativo = await servicio.comparativoSucursales(A, f('2027-12-10'));
    expect(comparativo).toEqual([
      {
        sucursalId: FX.sucursalA1,
        nombre: 'A1',
        venta: '10.00',
        cuentas: 1,
        ticketPromedio: '10.00',
        comensales: 0,
      },
      {
        sucursalId: FX.sucursalA2,
        nombre: 'A2',
        venta: '123.45',
        cuentas: 1,
        ticketPromedio: '123.45',
        comensales: 4,
      },
    ]);

    const horas = await servicio.porHora(A, f('2027-12-10'));
    expect(horas[0]).toEqual({ hora: 0, venta: '10.00', cuentas: 1 });
    expect(horas[23]).toEqual({ hora: 23, venta: '123.45', cuentas: 1 });
  });

  it('formas de pago: catálogo exacto y lo no mapeado aparte', async () => {
    await expect(servicio.formasPago(A, f('2027-12-10'))).resolves.toEqual({
      formas: [
        { forma: 'efectivo', monto: '100.00' },
        { forma: 'tarjeta', monto: '10.00' },
        { forma: 'transferencia', monto: '0.00' },
        { forma: 'otro', monto: '23.45' },
      ],
      sinCatalogo: [{ formaRaw: 'CHEQUE NOMINATIVO', monto: '23.45' }],
    });
  });

  it('top productos con empate resuelto por nombre', async () => {
    await expect(servicio.topProductos(A, f('2027-12-10'))).resolves.toEqual([
      { producto: 'Pozole', importe: '63.45', cantidad: '1.000' },
      { producto: 'Tacos', importe: '60.00', cantidad: '2.000' },
      { producto: 'Agua', importe: '10.00', cantidad: '1.000' },
    ]);
    await expect(servicio.topProductos(A, f('2027-12-10'), { por: 'cantidad' })).resolves.toEqual([
      { producto: 'Tacos', importe: '60.00', cantidad: '2.000' },
      { producto: 'Agua', importe: '10.00', cantidad: '1.000' },
      { producto: 'Pozole', importe: '63.45', cantidad: '1.000' },
    ]);
  });

  it('un rango vacío da ceros, no nulls', async () => {
    const r = await servicio.resumen(A, f('2027-01-01'));
    expect(r).toEqual({
      venta: '0.00',
      cuentas: 0,
      ticketPromedio: '0.00',
      subtotal: '0.00',
      impuestos: '0.00',
      propina: '0.00',
      descuentos: { monto: '0.00', cuentas: 0 },
      cortesias: null,
      comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
      cancelados: { cuentas: 0 },
    });
    await expect(servicio.formasPago(A, f('2027-01-01'))).resolves.toEqual({
      formas: FORMAS.map((forma) => ({ forma, monto: '0.00' })),
      sinCatalogo: [],
    });
    await expect(servicio.topProductos(A, f('2027-01-01'))).resolves.toEqual([]);
    const horas = await servicio.porHora(A, f('2027-01-01'));
    expect(horas).toHaveLength(24);
    expect(horas.every((h) => h.venta === '0.00' && h.cuentas === 0)).toBe(true);
  });
});
