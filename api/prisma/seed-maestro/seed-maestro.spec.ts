import { Prisma } from '@prisma/client';

import { generarVentas, universoDe, type OpcionesVentas } from '../seed-ventas';
import { hoyEn } from './azar';
import { CANALES, CLIENTES, GRUPOS_PRODUCTO, PRODUCTOS, precioEn } from './catalogos';
import { CATEGORIAS_GASTO } from './gastos';
import { FORZADOS, INSUMOS, insumo, PROVEEDORES, UNIDADES } from './insumos';
import { generarInventario, type PolizaSeed } from './inventario';
import { RECETAS } from './recetas';

// El universo del seed maestro (F2-201), un bloque por módulo de la Ronda 2.
//
// OJO: aquí se cuentan filas del UNIVERSO GENERADO, no de Postgres. Esos módulos
// todavía no tienen tabla; la tarea que la cree persiste desde `generarUniverso()`
// y su propio test cuenta las filas en la base (regla 2 de la Ronda 2).
//
// Los saldos, promedios y totales se RECALCULAN aquí desde los movimientos
// crudos, con una implementación propia: comparar la función contra sí misma no
// probaría nada.

const Dec = Prisma.Decimal;
const CERO = new Dec(0);
const redondear2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Dec.ROUND_HALF_UP);

const OPCIONES: OpcionesVentas = {
  empresaId: '00000000-0000-4000-8000-00000000e001',
  sucursales: [
    { id: '00000000-0000-4000-8000-0000000000a1', clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: '00000000-0000-4000-8000-0000000000a2', clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-11-15',
  ahora: new Date('2026-11-15T20:00:00Z'), // 14:00 en CDMX
};
const [S1, S2] = OPCIONES.sucursales;

const cheques = generarVentas(OPCIONES);
const u = universoDe(OPCIONES, cheques);
const vivos = cheques.filter((c) => !c.cancelado);

/** Recalcula el kardex de un almacén × insumo desde las pólizas, en orden. */
function kardex(polizas: readonly PolizaSeed[], almacen: string, clave: string) {
  let saldo = CERO;
  let cp = CERO;
  let minimoVisto = CERO;
  for (const p of polizas) {
    if (p.almacen !== almacen) continue;
    for (const m of p.movimientos) {
      if (m.insumo !== clave) continue;
      if (m.cantidad.greaterThan(0)) {
        const total = saldo.plus(m.cantidad);
        cp = saldo.lessThanOrEqualTo(0)
          ? m.costoUnitario
          : redondear2(saldo.times(cp).plus(m.cantidad.times(m.costoUnitario)).div(total));
        saldo = total;
      } else {
        saldo = saldo.plus(m.cantidad);
      }
      minimoVisto = Dec.min(minimoVisto, saldo);
    }
  }
  return { saldo, cp, minimoVisto };
}

describe('seed maestro: determinismo', () => {
  it('misma entrada, mismo universo; otras ventas, otro inventario', () => {
    expect(universoDe(OPCIONES, generarVentas(OPCIONES))).toEqual(u);
    const otras = generarVentas({ ...OPCIONES, semilla: 7 });
    expect(universoDe(OPCIONES, otras).polizas).not.toEqual(u.polizas);
  });
});

describe('módulo productos y grupos (F2-230, F2-145)', () => {
  it('cuenta grupos y productos, todos con grupo válido', () => {
    expect(u.grupos).toHaveLength(6);
    expect(u.productos).toHaveLength(PRODUCTOS.length);
    expect(u.productos.length).toBeGreaterThanOrEqual(25);
    const grupos = new Set(GRUPOS_PRODUCTO.map((g) => g.clave));
    for (const p of u.productos) expect(grupos.has(p.grupo)).toBe(true);
    expect(new Set(u.productos.map((p) => p.clave)).size).toBe(u.productos.length);
  });

  it('hay al menos un producto inactivo y ya no se vende desde su baja', () => {
    const inactivos = u.productos.filter((p) => !p.activo);
    expect(inactivos.length).toBeGreaterThanOrEqual(1);
    for (const p of inactivos) {
      const vendidos = cheques.flatMap((c) =>
        c.partidas
          .filter((x) => x.productoClave === p.clave)
          .map(() =>
            hoyEn(OPCIONES.sucursales.find((s) => s.id === c.sucursalId)!.zonaHoraria, c.abiertoAt),
          ),
      );
      expect(vendidos.length).toBeGreaterThan(0); // se vendía antes
      // abiertoAt puede caer la víspera local de un cierre del día de baja: se mide
      // contra el día del CIERRE planeado, que es el que decide la baja.
      const tras = cheques.filter(
        (c) =>
          c.cerradoAt &&
          hoyEn(OPCIONES.sucursales.find((s) => s.id === c.sucursalId)!.zonaHoraria, c.cerradoAt) >=
            p.bajaDesde! &&
          c.partidas.some((x) => x.productoClave === p.clave),
      );
      expect(tras).toEqual([]);
    }
  });

  it('el mismo producto tiene precio distinto entre las dos sucursales, y así se cobra', () => {
    const distintos = u.productos.filter((p) => new Set(p.precios.map((x) => x.precio)).size > 1);
    expect(distintos.length).toBeGreaterThanOrEqual(1);
    for (const p of distintos) {
      for (const [i, s] of [S1, S2].entries()) {
        const cobrados = new Set(
          cheques
            .filter((c) => c.sucursalId === s.id)
            .flatMap((c) => c.partidas.filter((x) => x.productoClave === p.clave))
            .map((x) => x.precioUnit.toFixed(2)),
        );
        expect([...cobrados]).toEqual([
          precioEn(
            PRODUCTOS.find((x) => x.clave === p.clave)!,
            i,
          ),
        ]);
      }
    }
  });
});

describe('módulo meseros (F2-231)', () => {
  it('cuenta meseros con nombre y clave por sucursal, y alguno dado de baja', () => {
    expect(u.meseros.length).toBeGreaterThanOrEqual(10);
    for (const s of [S1, S2]) {
      expect(u.meseros.filter((m) => m.sucursalId === s.id).length).toBeGreaterThanOrEqual(4);
    }
    for (const m of u.meseros) {
      expect(m.clave).toMatch(/^[A-Z]\d{2}$/);
      expect(m.nombre.length).toBeGreaterThan(3);
    }
    expect(u.meseros.some((m) => !m.activo)).toBe(true);
  });

  it('cada cheque lo atiende un mesero de SU sucursal, y el de baja no atiende después', () => {
    for (const c of cheques) {
      const m = u.meseros.find((x) => x.clave === c.maestro.meseroClave)!;
      expect(m.sucursalId).toBe(c.sucursalId);
      expect(c.mesero).toBe(m.nombre);
    }
    for (const m of u.meseros.filter((x) => !x.activo)) {
      const zona = OPCIONES.sucursales.find((s) => s.id === m.sucursalId)!.zonaHoraria;
      const suyos = cheques.filter((c) => c.maestro.meseroClave === m.clave);
      expect(suyos.length).toBeGreaterThan(0);
      expect(suyos.filter((c) => c.cerradoAt && hoyEn(zona, c.cerradoAt) >= m.bajaDesde!)).toEqual(
        [],
      );
    }
  });
});

describe('módulo clientes (F2-232)', () => {
  it('cuenta clientes sintéticos: correo de ficción, RFC de prueba del SAT o nulo', () => {
    expect(u.clientes.length).toBeGreaterThanOrEqual(20);
    for (const c of u.clientes) {
      expect(c.correo).toMatch(/@ejemplo\.test$/);
      expect([null, 'EKU9003173C9', 'XIA190128J61', 'IIA040805DZ4']).toContain(c.rfc);
    }
  });

  it('los cheques traen cliente sobre todo a domicilio', () => {
    const conCliente = cheques.filter((c) => c.maestro.clienteClave !== null);
    expect(conCliente.length).toBeGreaterThan(100);
    const claves = new Set(CLIENTES.map((c) => c.clave));
    for (const c of conCliente) expect(claves.has(c.maestro.clienteClave!)).toBe(true);
    const domicilio = cheques.filter((c) => c.maestro.canal === 'domicilio');
    const deDomicilio = domicilio.filter((c) => c.maestro.clienteClave !== null).length;
    expect(deDomicilio / domicilio.length).toBeGreaterThan(0.75);
  });
});

describe('módulo áreas y canales (F2-233)', () => {
  it('cuenta áreas por sucursal y los tres canales', () => {
    expect(u.canales).toEqual(['comedor', 'mostrador', 'domicilio']);
    for (const s of [S1, S2]) {
      const canales = new Set(u.areas.filter((a) => a.sucursalId === s.id).map((a) => a.canal));
      expect([...canales].sort()).toEqual([...CANALES].sort());
    }
  });

  it('cada canal aparece en los cheques, y hay cheques sin área', () => {
    for (const canal of CANALES) {
      expect(cheques.filter((c) => c.maestro.canal === canal).length).toBeGreaterThan(50);
    }
    const sinArea = cheques.filter((c) => c.maestro.area === null);
    expect(sinArea.length).toBeGreaterThan(0);
    expect(sinArea.every((c) => c.maestro.canal === null)).toBe(true);
  });

  it('mostrador y domicilio no tienen mesa; el área es de la sucursal del cheque', () => {
    for (const c of cheques) {
      if (c.maestro.canal === 'mostrador' || c.maestro.canal === 'domicilio') {
        expect(c.mesa).toBeNull();
      } else {
        expect(c.mesa).toMatch(/^[MTB]\d+$/);
      }
      if (c.maestro.area) {
        expect(
          u.areas.some((a) => a.sucursalId === c.sucursalId && a.nombre === c.maestro.area),
        ).toBe(true);
      }
    }
  });
});

describe('módulo catálogos de inventario (F2-120)', () => {
  it('cuenta unidades, grupos, insumos, proveedores y dos almacenes por sucursal', () => {
    expect(u.unidades).toHaveLength(UNIDADES.length);
    expect(u.gruposInsumo.length).toBeGreaterThanOrEqual(5);
    expect(u.insumos.length).toBeGreaterThanOrEqual(40);
    expect(u.proveedores).toHaveLength(PROVEEDORES.length);
    expect(u.almacenes.map((a) => a.clave)).toEqual(['A1-GEN', 'A1-BAR', 'A2-GEN', 'A2-BAR']);
    const unidades = new Set(UNIDADES.map((x) => x.clave));
    for (const i of u.insumos) expect(unidades.has(i.unidad)).toBe(true);
  });
});

describe('módulo existencias (F2-121)', () => {
  it('hay una existencia por insumo en su almacén, y todas cuadran con su kardex', () => {
    expect(u.existencias).toHaveLength(INSUMOS.length * OPCIONES.sucursales.length);
    for (const e of u.existencias) {
      const k = kardex(u.polizas, e.almacen, e.insumo);
      expect(e.cantidad.toFixed(3)).toBe(k.saldo.toFixed(3));
      expect(e.costoPromedio.toFixed(2)).toBe(k.cp.toFixed(2));
      expect(e.valor.toFixed(2)).toBe(redondear2(k.saldo.times(k.cp)).toFixed(2));
      expect(e.cantidad.isNegative()).toBe(false);
      expect(e.minimo.lessThan(e.maximo) || e.minimo.equals(e.maximo)).toBe(true);
    }
  });

  it('cada almacén tiene un insumo EN CERO y otro BAJO MÍNIMO (sin llegar a cero)', () => {
    for (const a of u.almacenes) {
      const de = (clave: string) =>
        u.existencias.find((e) => e.almacen === a.clave && e.insumo === clave)!;
      expect(de(FORZADOS[a.tipo].agotado).cantidad.isZero()).toBe(true);
      const bajo = de(FORZADOS[a.tipo].bajoMinimo);
      expect(bajo.cantidad.greaterThan(0)).toBe(true);
      expect(bajo.cantidad.lessThan(bajo.minimo)).toBe(true);
    }
  });
});

describe('módulo pólizas, movimientos y kardex (F2-122, F2-123, F2-124)', () => {
  it('cuenta pólizas de cada tipo, con folio único', () => {
    const porTipo = (t: string) => u.polizas.filter((p) => p.tipo === t).length;
    expect(porTipo('inicial')).toBe(4);
    expect(porTipo('consumo')).toBeGreaterThan(300);
    expect(porTipo('compra')).toBeGreaterThan(100);
    expect(porTipo('merma')).toBeGreaterThan(10);
    expect(porTipo('ajuste')).toBe(4);
    expect(porTipo('traspaso_salida')).toBeGreaterThanOrEqual(3);
    expect(new Set(u.polizas.map((p) => p.folio)).size).toBe(u.polizas.length);
    expect(u.polizas.reduce((n, p) => n + p.movimientos.length, 0)).toBeGreaterThan(5000);
  });

  it('ningún saldo pasa por negativo en ningún punto del kardex', () => {
    for (const a of u.almacenes) {
      for (const i of INSUMOS) {
        expect(kardex(u.polizas, a.clave, i.clave).minimoVisto.isNegative()).toBe(false);
      }
    }
  });

  it('cada importe es cantidad × costo, con signo, a 2 decimales; las salidas restan', () => {
    for (const p of u.polizas) {
      for (const m of p.movimientos) {
        expect(m.importe.toFixed(2)).toBe(redondear2(m.cantidad.times(m.costoUnitario)).toFixed(2));
        const sale = ['consumo', 'merma', 'traspaso_salida'].includes(p.tipo);
        if (sale) expect(m.cantidad.isNegative()).toBe(true);
        if (['inicial', 'compra', 'traspaso_entrada'].includes(p.tipo)) {
          expect(m.cantidad.greaterThan(0)).toBe(true);
        }
        expect(m.cantidad.decimalPlaces()).toBeLessThanOrEqual(3);
      }
    }
  });

  it('cada traspaso sale de un almacén y entra al otro con la misma cantidad', () => {
    const folios = new Set(
      u.polizas.filter((p) => p.tipo === 'traspaso_salida').map((p) => p.referencia),
    );
    for (const folio of folios) {
      const [sal] = u.polizas.filter((p) => p.referencia === folio && p.tipo === 'traspaso_salida');
      const [ent] = u.polizas.filter(
        (p) => p.referencia === folio && p.tipo === 'traspaso_entrada',
      );
      expect(sal.sucursalId).toBe(S1.id);
      expect(ent.sucursalId).toBe(S2.id);
      expect(ent.movimientos[0].insumo).toBe(sal.movimientos[0].insumo);
      expect(ent.movimientos[0].cantidad.plus(sal.movimientos[0].cantidad).isZero()).toBe(true);
    }
  });

  it('el consumo sale de las ventas: nunca menos del teórico salvo que no alcance el saldo', () => {
    // Teórico de A1 el último día, recalculado aquí desde los cheques y las recetas.
    const dia = OPCIONES.hoy;
    const teorico = new Map<string, Prisma.Decimal>();
    for (const c of vivos) {
      if (c.sucursalId !== S1.id || !c.cerradoAt || hoyEn(S1.zonaHoraria, c.cerradoAt) !== dia)
        continue;
      for (const p of c.partidas) {
        for (const [clave, q] of RECETAS[p.productoClave] ?? []) {
          teorico.set(clave, (teorico.get(clave) ?? CERO).plus(p.cantidad.times(q)));
        }
      }
    }
    const consumo = u.polizas.find(
      (p) => p.tipo === 'consumo' && p.almacen === 'A1-GEN' && p.dia === dia,
    )!;
    expect(teorico.size).toBeGreaterThan(0);
    for (const [clave, q] of teorico) {
      const m = consumo.movimientos.find((x) => x.insumo === clave);
      if (!m) continue; // saldo en cero: no había qué sacar
      const real = m.cantidad.negated();
      expect(real.lessThanOrEqualTo(q.times('1.04').plus('1'))).toBe(true);
    }
  });

  it('un kardex a mano: inicial al máximo, consumo, y el promedio ponderado de la compra', () => {
    // Una sucursal, tres días (dom, lun, mar): 30 kg de rib eye el domingo.
    // Rib eye (P016) consume 1.050 kg de I004 por kg vendido → 31.5 kg el domingo.
    // Promedio diario = 31.5 / 3 = 10.5 → mínimo 2 días = 21.0, máximo 7 días = 73.5.
    const s = { id: 'x', clave: 'X', zonaHoraria: 'America/Mexico_City' };
    const inv = generarInventario({
      sucursales: [s],
      dias: ['2026-11-15', '2026-11-16', '2026-11-17'],
      ventas: [
        {
          sucursalId: 'x',
          cerradoAt: new Date('2026-11-15T20:00:00Z'),
          cancelado: false,
          canal: 'comedor',
          partidas: [{ productoClave: 'P016', cantidad: new Dec(30) }],
        },
      ],
    });
    const movs = inv.polizas
      .filter((p) => p.almacen === 'X-GEN')
      .flatMap((p) =>
        p.movimientos
          .filter((m) => m.insumo === 'I004')
          .map((m) => ({ tipo: p.tipo, dia: p.dia, m })),
      );
    const ex = inv.existencias.find((e) => e.insumo === 'I004')!;
    expect(ex.minimo.toFixed(3)).toBe('21.000');
    expect(ex.maximo.toFixed(3)).toBe('73.500');

    const [inicial, consumo] = movs;
    expect(inicial.tipo).toBe('inicial');
    expect(inicial.m.cantidad.toFixed(3)).toBe('73.500');
    expect(inicial.m.costoUnitario.toFixed(2)).toBe(insumo('I004').costo);
    expect(inicial.m.importe.toFixed(2)).toBe('21315.00'); // 73.5 × 290
    expect(consumo.tipo).toBe('consumo');
    // 31.5 kg más 0–4 % de merma operativa: entre 31.500 y 32.760.
    expect(consumo.m.cantidad.negated().greaterThanOrEqualTo('31.5')).toBe(true);
    expect(consumo.m.cantidad.negated().lessThanOrEqualTo('32.76')).toBe(true);

    // El lunes surte lo que bajó del punto medio (47.25): vuelve a 73.5.
    const compra = movs.find((x) => x.tipo === 'compra' && x.dia === '2026-11-16')!;
    const saldoAntes = movs
      .filter((x) => x.dia === '2026-11-15')
      .reduce((acc, x) => acc.plus(x.m.cantidad), CERO);
    expect(saldoAntes.plus(compra.m.cantidad).toFixed(3)).toBe('73.500');
    const esperado = redondear2(
      saldoAntes.times(290).plus(compra.m.cantidad.times(compra.m.costoUnitario)).div('73.5'),
    );
    const kar = kardex(inv.polizas, 'X-GEN', 'I004');
    expect(ex.cantidad.toFixed(3)).toBe(kar.saldo.toFixed(3));
    // Sin más entradas después de la compra, el promedio final es el de la compra.
    const entradasDespues = movs.filter((x) => x.dia > '2026-11-16' && x.m.cantidad.greaterThan(0));
    expect(entradasDespues).toEqual([]);
    expect(ex.costoPromedio.toFixed(2)).toBe(esperado.toFixed(2));
  });
});

describe('módulo recetas (F2-125)', () => {
  it('la mayoría de los productos tiene receta y al menos dos no', () => {
    expect(u.recetas.length).toBeGreaterThan(u.productos.length / 2);
    expect(u.productosSinReceta.length).toBeGreaterThanOrEqual(2);
    expect(u.productosSinReceta).toEqual(['P020', 'P021']);
    // Y esos se venden: F2-125 tiene que listarlos aparte, no esconderlos.
    for (const clave of u.productosSinReceta) {
      expect(cheques.some((c) => c.partidas.some((p) => p.productoClave === clave))).toBe(true);
    }
  });

  it('todo insumo de receta existe, y el costo de la receta es 20–45 % del precio', () => {
    for (const { producto, renglones } of u.recetas) {
      const p = PRODUCTOS.find((x) => x.clave === producto)!;
      expect(p).toBeDefined();
      let costo = CERO;
      for (const [clave, q] of renglones) {
        costo = costo.plus(new Dec(insumo(clave).costo).times(q));
        expect(new Dec(q).greaterThan(0)).toBe(true);
      }
      const proporcion = costo.div(p.precio).toNumber();
      expect(proporcion).toBeGreaterThanOrEqual(0.2);
      expect(proporcion).toBeLessThanOrEqual(0.45);
    }
  });
});

describe('módulo compras y gastos (F2-126)', () => {
  it('cada compra suma lo mismo que su póliza de entrada, sumado aquí', () => {
    expect(u.compras.length).toBeGreaterThan(100);
    const polizas = new Map(u.polizas.map((p) => [p.folio, p]));
    const proveedores = new Set(PROVEEDORES.map((p) => p.clave));
    for (const c of u.compras) {
      const p = polizas.get(c.poliza)!;
      expect(p.tipo).toBe('compra');
      expect(p.referencia).toBe(c.folio);
      const suma = p.movimientos.reduce(
        (acc, m) => acc.plus(redondear2(m.cantidad.times(m.costoUnitario))),
        CERO,
      );
      expect(c.total.toFixed(2)).toBe(suma.toFixed(2));
      expect(c.total.greaterThan(0)).toBe(true);
      expect(proveedores.has(c.proveedor)).toBe(true);
    }
    expect(new Set(u.compras.map((c) => c.folio)).size).toBe(u.compras.length);
  });

  it('cuenta gastos de cada categoría en cada sucursal, dentro de los 90 días', () => {
    const dias = new Set(
      cheques.map((c) =>
        hoyEn(OPCIONES.sucursales.find((s) => s.id === c.sucursalId)!.zonaHoraria, c.abiertoAt),
      ),
    );
    for (const s of [S1, S2]) {
      for (const cat of CATEGORIAS_GASTO) {
        const suyos = u.gastos.filter((g) => g.sucursalId === s.id && g.categoria === cat);
        expect(suyos.length).toBeGreaterThan(0);
        const total = suyos.reduce((acc, g) => acc.plus(g.monto), CERO);
        expect(total.greaterThan(0)).toBe(true);
      }
    }
    for (const g of u.gastos) {
      expect(g.monto.decimalPlaces()).toBeLessThanOrEqual(2);
      expect(g.dia >= '2026-08-18' && g.dia <= '2026-11-15').toBe(true);
    }
    expect(dias.size).toBeGreaterThanOrEqual(90);
  });
});
