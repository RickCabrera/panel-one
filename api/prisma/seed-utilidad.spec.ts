import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { EstadoResultadosService } from '../src/finanzas/estado-resultados.service';
import { GastosService } from '../src/finanzas/gastos.service';
import { ComprasService } from '../src/finanzas/compras.service';
import { RecetasService } from '../src/inventario/recetas.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { AgregadosVentasService } from '../src/ventas/agregados-ventas.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import { sembrarCatalogos } from './seed-catalogos';
import { fechaCompra, lotesDeCompras, sembrarCompras } from './seed-compras';
import { sembrarExistencias } from './seed-existencias';
import { sembrarGastos } from './seed-gastos';
import { hoyEn } from './seed-maestro/azar';
import { CATEGORIAS_GASTO } from './seed-maestro/gastos';
import { RECETAS } from './seed-maestro/recetas';
import { sembrarMovimientos } from './seed-movimientos';
import { sembrarRecetas } from './seed-recetas';
import { generarVentas, sembrarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de compras y gastos (F2-126) y EL CRITERIO DE CIERRE contra el seed (regla 2 de la Ronda
// 2), en las sucursales de FIXTURES (empresa A; A1 en CDMX y A2 en Tijuana), nunca en las del seed
// de desarrollo. Reloj FIJO.
//
// Se siembra todo por las MISMAS ingestas del agente (ventas, catálogos, recetas, pólizas,
// existencias, compras) y los gastos por el helper de la captura, y se le pide al servicio el
// estado de resultados de AGOSTO de cada sucursal. El esperado se calcula AQUÍ, A MANO, desde los
// datos CRUDOS del generador, sin importar `cruzarVendidos`, `variaciones`, `valorDe` ni ningún
// servicio: venta neta = Σ subtotal de los cheques no cancelados cerrados ese mes LOCAL; teórico =
// Σ `RECETAS[productoClave]` × cantidad (cruce por CLAVE, el servicio cruza por NOMBRE); costo de
// referencia = Σ |cantidad × costo| / Σ |cantidad| de las salidas de consumo, merma y ajuste de las
// `PolizaSeed` del mes, o si no hay, Σ valor / Σ cantidad de las existencias finales con cantidad
// > 0; gastos = Σ `GastoSeed.monto` del mes. Los redondeos están escritos aquí.
//
// Qué prueba y qué NO: que la ingesta, el cruce y el cálculo CONSERVAN lo que simuló el seed. No
// dice nada de cómo registra SoftRestaurant sus ventas netas ni su costo (F2-193 con el contador).
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const SUCURSALES = [
  { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
  { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
];
const HOY = '2026-09-15';
const AHORA = new Date('2026-09-15T20:00:00.000Z');
const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: SUCURSALES,
  hoy: HOY,
  ahora: AHORA,
};
const CHEQUES = generarVentas(OP);
const U = universoDe(OP, CHEQUES);
const MES = { desde: '2026-08-01', hasta: '2026-08-31' };
const enMes = (dia: string) => dia >= MES.desde && dia <= MES.hasta;

type D = Prisma.Decimal;
const Dec = Prisma.Decimal;
const CERO = new Dec(0);
const LENTO_MS = 240_000;
const r2 = (v: D) => v.toDecimalPlaces(2, Dec.ROUND_HALF_UP);
const r3 = (v: D) => v.toDecimalPlaces(3, Dec.ROUND_HALF_UP);

/** El estado de resultados esperado, a mano, para UNA sucursal y agosto. */
function esperado(sucursalId: string, zona: string) {
  let cuentas = 0;
  let venta = CERO;
  let ventaNeta = CERO;
  const teorico = new Map<string, D>();
  const sinReceta = new Map<string, D>();
  for (const c of CHEQUES) {
    if (c.sucursalId !== sucursalId || c.cancelado || !c.cerradoAt) continue;
    if (!enMes(hoyEn(zona, c.cerradoAt))) continue;
    cuentas++;
    venta = venta.plus(c.total);
    ventaNeta = ventaNeta.plus(c.subtotal);
    for (const p of c.partidas) {
      const receta = RECETAS[p.productoClave];
      if (!receta) {
        sinReceta.set(p.productoClave, (sinReceta.get(p.productoClave) ?? CERO).plus(p.total));
        continue;
      }
      for (const [insumo, q] of receta) {
        teorico.set(insumo, (teorico.get(insumo) ?? CERO).plus(p.cantidad.times(q)));
      }
    }
  }
  // Costo de referencia del mes: las SALIDAS de consumo, merma y ajuste.
  const salidas = new Map<string, { importe: D; cantidad: D }>();
  for (const p of U.polizas) {
    if (p.sucursalId !== sucursalId || !enMes(p.dia)) continue;
    if (p.tipo !== 'consumo' && p.tipo !== 'merma' && p.tipo !== 'ajuste') continue;
    for (const m of p.movimientos) {
      if (!m.cantidad.isNegative() || m.cantidad.isZero()) continue;
      const s = salidas.get(m.insumo) ?? { importe: CERO, cantidad: CERO };
      s.importe = s.importe.plus(r2(m.cantidad.times(r2(m.costoUnitario))).abs());
      s.cantidad = s.cantidad.plus(m.cantidad.abs());
      salidas.set(m.insumo, s);
    }
  }
  const fotoFinal = (insumo: string): D | null => {
    let valor = CERO;
    let cantidad = CERO;
    for (const e of U.existencias) {
      if (e.sucursalId !== sucursalId || e.insumo !== insumo || !e.cantidad.greaterThan(0))
        continue;
      valor = valor.plus(r2(e.cantidad.times(r2(e.costoPromedio))));
      cantidad = cantidad.plus(e.cantidad);
    }
    return cantidad.greaterThan(0) ? r2(valor.div(cantidad)) : null;
  };
  let costo = CERO;
  let insumosSinCosto = 0;
  for (const [insumo, t] of teorico) {
    const teo = r3(t);
    if (!teo.greaterThan(0)) continue;
    const s = salidas.get(insumo);
    const unitario =
      s && s.cantidad.greaterThan(0) ? r2(s.importe.div(s.cantidad)) : fotoFinal(insumo);
    if (unitario === null) insumosSinCosto++;
    else costo = costo.plus(r2(teo.times(unitario)));
  }
  const gastos = U.gastos
    .filter((g) => g.sucursalId === sucursalId && enMes(g.dia))
    .reduce<D>((acc, g) => acc.plus(g.monto), CERO);
  const compras = U.compras
    .filter((c) => c.sucursalId === sucursalId && enMes(c.dia))
    .reduce<D>((acc, c) => acc.plus(c.total), CERO);
  const ventaSinCosto = [...sinReceta.values()].reduce<D>((a, v) => a.plus(v), CERO);
  const bruta = r2(ventaNeta.minus(costo));
  const operacion = r2(bruta.minus(gastos));
  return {
    cuentas,
    venta: r2(venta).toFixed(2),
    ventaNeta: r2(ventaNeta).toFixed(2),
    costo: {
      importe: r2(costo).toFixed(2),
      completo: insumosSinCosto === 0 && sinReceta.size === 0,
      insumosSinCosto,
      productosSinCosto: sinReceta.size,
      ventaSinCosto: r2(ventaSinCosto).toFixed(2),
    },
    gastos: r2(gastos).toFixed(2),
    compras: r2(compras).toFixed(2),
    utilidadBruta: bruta.toFixed(2),
    utilidadOperacion: operacion.toFixed(2),
    margenBruto: bruta.div(ventaNeta).times(100).toDecimalPlaces(1, Dec.ROUND_HALF_UP).toFixed(1),
    margenOperacion: operacion
      .div(ventaNeta)
      .times(100)
      .toDecimalPlaces(1, Dec.ROUND_HALF_UP)
      .toFixed(1),
    utilidadSobrestimada: !(insumosSinCosto === 0 && sinReceta.size === 0),
    sinVentas: cuentas === 0,
  };
}

describe('sembrarCompras() / sembrarGastos() y la utilidad contra el seed (F2-126)', () => {
  const prisma = new PrismaClient();
  const datos = new ScopedPrismaService(prisma as unknown as PrismaService);
  const agregados = new AgregadosVentasService(datos);
  const recetas = new RecetasService(datos, agregados);
  const reloj = { ahora: () => AHORA.getTime() };
  const gastosSvc = new GastosService(datos, reloj);
  const servicio = new EstadoResultadosService(datos, agregados, recetas, gastosSvc);
  const comprasSvc = new ComprasService(datos);
  const scopeA = { tipo: 'empresa', empresaId: FX.empresaA } as const;
  let polizasAntes = 0;

  const opSemilla = { empresaId: FX.empresaA, sucursales: SUCURSALES, universo: U, ahora: AHORA };

  async function foto() {
    const w = { where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.compra.findMany(w),
          prisma.partidaCompra.findMany(w),
          prisma.categoriaGasto.findMany(w),
          prisma.gasto.findMany(w),
        ]),
      ),
    );
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
    await sembrarVentas(prisma, OP);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: U,
      capturadoAt: AHORA,
    });
    await sembrarRecetas(prisma, opSemilla);
    await sembrarMovimientos(prisma, opSemilla);
    await sembrarExistencias(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: U,
      capturadoAt: AHORA,
    });
    polizasAntes = await prisma.polizaInventario.count({ where: { empresaId: FX.empresaA } });
    await sembrarCompras(prisma, opSemilla);
    await sembrarGastos(prisma, opSemilla);
  }, LENTO_MS);

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  }, 60_000);

  it('siembra todas las compras y gastos del universo, con sus categorías', async () => {
    expect(U.compras.length).toBeGreaterThan(0);
    expect(lotesDeCompras(U.compras).length).toBeGreaterThan(0);
    for (const s of SUCURSALES) {
      const suyas = U.compras.filter((c) => c.sucursalId === s.id);
      await expect(prisma.compra.count({ where: { sucursalId: s.id } })).resolves.toBe(
        suyas.length,
      );
      await expect(prisma.partidaCompra.count({ where: { sucursalId: s.id } })).resolves.toBe(
        suyas.reduce((n, c) => n + c.partidas.length, 0),
      );
      await expect(prisma.gasto.count({ where: { sucursalId: s.id } })).resolves.toBe(
        U.gastos.filter((g) => g.sucursalId === s.id).length,
      );
    }
    const cats = await prisma.categoriaGasto.findMany({ where: { empresaId: FX.empresaA } });
    expect(cats.map((c) => c.nombre).sort()).toEqual([...CATEGORIAS_GASTO].sort());
    // La compra es un documento APARTE: sembrarla no tocó ni duplicó las pólizas de F2-122.
    await expect(
      prisma.polizaInventario.count({ where: { empresaId: FX.empresaA } }),
    ).resolves.toBe(polizasAntes);
    // Cada compra cae en SU día local, y su total es el del universo.
    const guardadas = await prisma.compra.findMany({ where: { empresaId: FX.empresaA } });
    const porFolio = new Map(guardadas.map((c) => [`${c.sucursalId}|${c.origenSrId}`, c]));
    for (const c of U.compras) {
      const s = SUCURSALES.find((x) => x.id === c.sucursalId)!;
      const g = porFolio.get(`${c.sucursalId}|${c.folio}`)!;
      expect(hoyEn(s.zonaHoraria, g.fecha)).toBe(c.dia);
      expect(g.fecha.toISOString()).toBe(fechaCompra(c, s.zonaHoraria, AHORA).toISOString());
      expect(g.total.toFixed(2)).toBe(c.total.toFixed(2));
      expect(g.proveedorOrigenSrId).toBe(c.proveedor);
    }
  });

  it('es idempotente: sembrar dos veces más deja exactamente las mismas filas', async () => {
    const antes = await foto();
    for (let i = 0; i < 2; i++) {
      const c = await sembrarCompras(prisma, opSemilla);
      const g = await sembrarGastos(prisma, opSemilla);
      expect([c.borradas, g.borrados, g.categorias, g.omitidos]).toEqual([0, 0, 0, 0]);
    }
    expect(await foto()).toEqual(antes);
  });

  it('los proveedores de las compras se resuelven contra el espejo de F2-120 (ninguno "sin catálogo")', async () => {
    const r = await comprasSvc.listar(scopeA, { empresaId: FX.empresaA, ...MES });
    expect(r.porProveedor.length).toBeGreaterThan(0);
    expect(r.porProveedor.every((p) => p.proveedor !== null)).toBe(true);
    expect(r.compras.every((c) => c.almacen !== null)).toBe(true);
    const esperadoTotal = U.compras
      .filter((c) => enMes(c.dia))
      .reduce<D>((a, c) => a.plus(c.total), CERO);
    expect(r.total).toBe(esperadoTotal.toFixed(2));
  });

  for (const s of SUCURSALES) {
    it(
      `${s.clave}: el estado de resultados de agosto cuadra con el cálculo a mano desde el universo`,
      async () => {
        // Que el cruce por nombre del servicio y el cruce por clave de este test vean lo mismo: en el
        // mes no hay nombres ambiguos ni partidas sin catálogo, sólo los dos productos sin receta.
        const consumo = await recetas.consumoTeorico(scopeA, {
          empresaId: FX.empresaA,
          sucursalId: s.id,
          ...MES,
        });
        expect(consumo.aparte.every((a) => a.motivo === 'sin_receta')).toBe(true);

        const r = await servicio.estado(scopeA, {
          empresaId: FX.empresaA,
          sucursalId: s.id,
          ...MES,
        });
        const esp = esperado(s.id, s.zonaHoraria);
        expect(r.sucursales).toEqual([
          { sucursalId: s.id, sucursal: s.clave, motivo: null, ...esp },
        ]);
        // Que no pase en vacío: hubo ventas, costo, gastos y compras, y la fórmula no usa compras.
        expect(esp.cuentas).toBeGreaterThan(100);
        expect(new Dec(esp.costo.importe).greaterThan(0)).toBe(true);
        expect(new Dec(esp.gastos).greaterThan(0)).toBe(true);
        expect(new Dec(esp.compras).greaterThan(0)).toBe(true);
        expect(new Dec(esp.ventaNeta).minus(esp.costo.importe).minus(esp.gastos).toFixed(2)).toBe(
          esp.utilidadOperacion,
        );
        // Los dos productos sin receta del seed (P020, P021) dejan el costo marcado como incompleto.
        expect(esp.costo.productosSinCosto).toBe(2);
        expect(esp.utilidadSobrestimada).toBe(true);
      },
      LENTO_MS,
    );
  }

  it(
    'el total de la empresa es la suma de las dos sucursales',
    async () => {
      const r = await servicio.estado(scopeA, { empresaId: FX.empresaA, ...MES });
      const [a, b] = [
        esperado(FX.sucursalA1, 'America/Mexico_City'),
        esperado(FX.sucursalA2, 'America/Tijuana'),
      ];
      const suma = (x: string, y: string) => new Dec(x).plus(y).toFixed(2);
      expect(r.total).toMatchObject({
        sucursalesSinCalculo: [],
        ventaNeta: suma(a.ventaNeta, b.ventaNeta),
        gastos: suma(a.gastos, b.gastos),
        compras: suma(a.compras, b.compras),
        utilidadOperacion: suma(a.utilidadOperacion, b.utilidadOperacion),
        utilidadSobrestimada: true,
      });
      expect(r.gastosPorCategoria.length).toBeGreaterThan(3);
    },
    LENTO_MS,
  );
});
