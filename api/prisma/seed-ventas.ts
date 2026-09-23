import { FormaPago, Prisma, PrismaClient } from '@prisma/client';

import { cargarEnvLocal } from '../src/config/cargar-env';
import { SEED_IDS } from './seed';
import {
  diasHasta,
  diaSemana,
  dinero,
  elegir,
  fnv,
  hoyEn,
  instanteLocal,
  prng,
} from './seed-maestro/azar';
import {
  areasDe,
  claveDeArea,
  CLIENTES,
  meserosDe,
  MODIFICADORES,
  nombreGrupo,
  precioEn,
  PRODUCTOS,
  PROB_SIN_AREA,
  type Area,
  type Canal,
} from './seed-maestro/catalogos';
import { sembrarCatalogos } from './seed-catalogos';
import { sembrarCompras } from './seed-compras';
import { sembrarConteos } from './seed-conteos';
import { sembrarExistencias } from './seed-existencias';
import { sembrarFacturacion } from './seed-facturacion';
import { sembrarGastos } from './seed-gastos';
import { sembrarMovimientos } from './seed-movimientos';
import { sembrarRecetas } from './seed-recetas';
import { sembrarTraspasos } from './seed-traspasos';
import { generarUniverso, resumenPorModulo } from './seed-maestro';

// Se re-exportan: los specs y los consumidores los importaban de aquí.
export { hoyEn, instanteLocal };

/**
 * Seed de VENTAS de desarrollo (F1-032, ampliado en F2-201): 1500 cheques
 * SINTÉTICOS de 2 sucursales × 90 días. Ningún dato es de un restaurante real. Es lo que deja avanzar al
 * frontend (F1-040..F1-051) sin esperar al agente.
 *
 * - `generarVentas()` es PURO y determinista (PRNG con semilla): la misma
 *   entrada da exactamente los mismos cheques, ids incluidos. Los tests de
 *   agregados lo usan para calcular a mano lo que debe salir.
 * - `sembrarVentas()` es idempotente: borra lo que sembró antes en ESAS
 *   sucursales (`folio_sr` con prefijo `SEED-`) y lo vuelve a crear con los
 *   mismos ids. Tres corridas el mismo día dejan los mismos datos.
 *
 * Supuestos de los datos (sintéticos, no de SR): precios con IVA incluido;
 * total = Σ partidas − descuento; subtotal = total / 1.16; los pagos suman
 * total + propina; la propina sólo viene con tarjeta.
 *
 * Productos, precios por sucursal, meseros, áreas y clientes salen del catálogo
 * del seed maestro (`seed-maestro/`), que además genera el inventario, las
 * recetas, las compras y los gastos a partir de ESTAS ventas (F2-201).
 *
 * El día en curso no inventa futuro: con `ahora`, ningún cheque cierra (ni abre)
 * después de ese instante. Se generan igual que sin él y luego se descartan, así
 * que lo anterior a `ahora` es idéntico con o sin reloj (ids incluidos).
 *
 * Uso: `npm run seed:ventas` (después de `npx prisma db seed`). Siembra en las
 * sucursales demo 90 días que terminan HOY en su zona; correrlo otro día mueve
 * las fechas. `SEED_AHORA=2026-09-21T14:00:00-06:00` fija el reloj para
 * reproducir una corrida exacta.
 */

export const PREFIJO_SEED = 'SEED-';
export const CHEQUES_POR_SUCURSAL = 750;
export const DIAS = 90;

export interface SucursalSeed {
  id: string;
  /** Texto corto para el folio (`SEED-<clave>-0001`). */
  clave: string;
  zonaHoraria: string;
}

export interface OpcionesVentas {
  empresaId: string;
  sucursales: readonly SucursalSeed[];
  /** Último día local (`YYYY-MM-DD`) de los 90. */
  hoy: string;
  /**
   * El reloj: si viene, se descarta todo cheque que cierre después de este
   * instante (en cualquier zona). Sin él, se generan los días completos.
   */
  ahora?: Date;
  semilla?: number;
}

export interface PartidaSeed {
  id: string;
  orden: number;
  /** Clave del catálogo maestro. NO se persiste: la tabla guarda el nombre. */
  productoClave: string;
  producto: string;
  categoria: string;
  cantidad: Prisma.Decimal;
  precioUnit: Prisma.Decimal;
  total: Prisma.Decimal;
  modificadores: Array<{ nombre: string; precio: string }>;
}

export interface PagoSeed {
  id: string;
  formaRaw: string;
  monto: Prisma.Decimal;
}

export interface ChequeSeed {
  id: string;
  sucursalId: string;
  empresaId: string;
  folio: string;
  folioSr: string;
  abiertoAt: Date;
  cerradoAt: Date | null;
  /** Nula en mostrador y domicilio: no hay mesa. */
  mesa: string | null;
  mesero: string;
  comensales: number | null;
  subtotal: Prisma.Decimal;
  impuestos: Prisma.Decimal;
  descuentos: Prisma.Decimal;
  propina: Prisma.Decimal;
  total: Prisma.Decimal;
  cancelado: boolean;
  partidas: PartidaSeed[];
  pagos: PagoSeed[];
  /**
   * Lo que el catálogo maestro sabe del cheque. Se persisten `clienteClave` (como
   * `cliente_origen_sr_id`, F2-232) y el área (su clave, como `area_origen_sr_id`, F2-233); lo
   * demás lo usan el inventario del seed y las tareas de catálogos.
   */
  maestro: {
    meseroClave: string;
    /** Nula en ~3 % de los cheques: F2-233 muestra "sin clasificar". */
    area: string | null;
    canal: Canal | null;
    clienteClave: string | null;
  };
}

/**
 * Catálogo sintético de formas de pago. "VALES DESPENSA" queda FUERA a
 * propósito: el desglose tiene que mostrar qué texto de SR no está mapeado.
 */
export const CATALOGO_SEED: ReadonlyArray<{ formaRaw: string; forma: FormaPago }> = [
  { formaRaw: 'EFECTIVO', forma: FormaPago.efectivo },
  { formaRaw: 'TARJETA DE CREDITO', forma: FormaPago.tarjeta },
  { formaRaw: 'TARJETA DE DEBITO', forma: FormaPago.tarjeta },
  { formaRaw: 'TRANSFERENCIA', forma: FormaPago.transferencia },
];
export const FORMA_SIN_CATALOGO = 'VALES DESPENSA';

/** UUID determinista: sucursal + tipo (0 cheque, 1 partida, 2 pago) + contador. */
function idSeed(sucursalId: string, tipo: number, n: number): string {
  return `${fnv(sucursalId)}-5eed-4000-8${tipo}00-${n.toString(16).padStart(12, '0')}`;
}

/** `dia` menos `n` días. */
function haceDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Área elegida por peso; nula con probabilidad `PROB_SIN_AREA`. */
function elegirArea(r: () => number, areas: readonly Area[]): Area | null {
  if (r() < PROB_SIN_AREA) return null;
  const total = areas.reduce((s, a) => s + a.peso, 0);
  let x = r() * total;
  for (const a of areas) {
    if ((x -= a.peso) < 0) return a;
  }
  return areas[areas.length - 1];
}

/** Probabilidad de que el cheque traiga cliente capturado, según el canal. */
const PROB_CLIENTE: Record<Canal, number> = { comedor: 0.05, mostrador: 0.2, domicilio: 0.9 };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Reparte `total` entre los días con peso (fin de semana pesa más). Suma exacta. */
function repartir(dias: string[], total: number): number[] {
  const pesos = dias.map((d) => ([0, 5, 6].includes(diaSemana(d)) ? 1.6 : 1));
  const suma = pesos.reduce((a, b) => a + b, 0);
  const exactos = pesos.map((p) => (p / suma) * total);
  const base = exactos.map(Math.floor);
  let faltan = total - base.reduce((a, b) => a + b, 0);
  const orden = exactos
    .map((e, i) => ({ i, resto: e - Math.floor(e) }))
    .sort((x, y) => y.resto - x.resto || x.i - y.i);
  for (const { i } of orden) {
    if (faltan-- <= 0) break;
    base[i]++;
  }
  return base;
}

/** Segundo del día local del cierre: comida y cena pesan más; algunos pasada la medianoche. */
function segundoDeCierre(r: () => number): number {
  const x = r();
  let hora: number;
  if (x < 0.04)
    hora = 0; // cuentas que cierran pasada la medianoche
  else if (x < 0.14)
    hora = 8 + Math.floor(r() * 4); // desayunos 8–11
  else if (x < 0.54)
    hora = 13 + Math.floor(r() * 4); // comida 13–16
  else if (x < 0.6)
    hora = 17 + Math.floor(r() * 2); // tarde 17–18
  else hora = 19 + Math.floor(r() * 5); // cena 19–23
  return hora * 3600 + Math.floor(r() * 3600);
}

// ---------------------------------------------------------------------------
// Generador
// ---------------------------------------------------------------------------

export function generarVentas(op: OpcionesVentas): ChequeSeed[] {
  const r = prng(op.semilla ?? 20260920);
  const dias = diasHasta(op.hoy, DIAS);
  const cheques: ChequeSeed[] = [];

  op.sucursales.forEach((suc, iSuc) => {
    const areas = areasDe(iSuc);
    const meseros = meserosDe(iSuc);
    // Día desde el que cada producto y mesero dado de baja ya no aparece.
    const baja = (dias?: number) => (dias === undefined ? null : haceDias(op.hoy, dias));
    const vigente = (dia: string, desde: string | null) => desde === null || dia < desde;
    const productos = PRODUCTOS.map((p) => ({ p, desde: baja(p.bajaHaceDias) }));
    const plantilla = meseros.map((m) => ({ m, desde: baja(m.bajaHaceDias) }));
    const porDia = repartir(dias, CHEQUES_POR_SUCURSAL);
    const delDia: Array<{ dia: string; segundo: number }> = [];
    dias.forEach((dia, i) => {
      for (let k = 0; k < porDia[i]; k++) {
        delDia.push({ dia, segundo: segundoDeCierre(r) });
      }
    });
    // Folios en orden cronológico, como los numeraría el POS.
    delDia.sort((x, y) => x.dia.localeCompare(y.dia) || x.segundo - y.segundo);

    let nPartida = 0;
    let nPago = 0;
    delDia.forEach(({ dia, segundo }, idx) => {
      const n = idx + 1;
      const cierre = instanteLocal(dia, segundo, suc.zonaHoraria);
      const duracionMin = 25 + Math.floor(r() * 110);
      const abiertoAt = new Date(cierre.getTime() - duracionMin * 60_000);

      const area = elegirArea(r, areas);
      const canal = area?.canal ?? null;
      const menu = productos.filter((x) => vigente(dia, x.desde)).map((x) => x.p);
      const mesero = elegir(
        r,
        plantilla.filter((x) => vigente(dia, x.desde)).map((x) => x.m),
      );

      const partidas: PartidaSeed[] = [];
      const nPartidas = 1 + Math.floor(r() * 6);
      for (let orden = 0; orden < nPartidas; orden++) {
        const p = elegir(r, menu);
        const cantidad = p.porKg
          ? new Prisma.Decimal(250 + 50 * Math.floor(r() * 26)).div(1000) // 0.250–1.500 kg
          : new Prisma.Decimal(1 + Math.floor(r() * 3));
        const modificadores = r() < 0.25 ? [elegir(r, MODIFICADORES)] : [];
        const precioMods = modificadores.reduce((s, m) => s.plus(m.precio), new Prisma.Decimal(0));
        const precioUnit = new Prisma.Decimal(precioEn(p, iSuc));
        partidas.push({
          id: idSeed(suc.id, 1, ++nPartida),
          orden,
          productoClave: p.clave,
          producto: p.nombre,
          categoria: nombreGrupo(p.grupo),
          cantidad,
          precioUnit,
          total: dinero(precioUnit.plus(precioMods).times(cantidad)),
          modificadores,
        });
      }

      const bruto = partidas.reduce((s, p) => s.plus(p.total), new Prisma.Decimal(0));
      const descuentos = r() < 0.1 ? dinero(bruto.times(r() < 0.5 ? '0.10' : '0.15')) : dinero(0);
      const total = bruto.minus(descuentos);
      const subtotal = dinero(total.div('1.16'));
      const impuestos = total.minus(subtotal);
      const cancelado = r() < 0.03;
      // Un tercio de los cancelados no trae fecha de cierre (supuesto de F1-030).
      const cerradoAt = cancelado && r() < 0.34 ? null : cierre;

      const pagos: PagoSeed[] = [];
      let propina = dinero(0);
      if (!cancelado) {
        const x = r();
        const pago = (formaRaw: string, monto: Prisma.Decimal) =>
          pagos.push({ id: idSeed(suc.id, 2, ++nPago), formaRaw, monto });
        const tarjeta = r() < 0.6 ? 'TARJETA DE CREDITO' : 'TARJETA DE DEBITO';
        if (x < 0.5) {
          pago('EFECTIVO', total);
        } else if (x < 0.82) {
          propina = dinero(total.times(r() < 0.5 ? '0.10' : '0.15'));
          pago(tarjeta, total.plus(propina));
        } else if (x < 0.88) {
          pago('TRANSFERENCIA', total);
        } else if (x < 0.92) {
          pago(FORMA_SIN_CATALOGO, total);
        } else {
          // Pago mixto: parte en efectivo, el resto (con propina) en tarjeta.
          const efectivo = dinero(total.times(0.3 + r() * 0.4));
          propina = dinero(total.times('0.10'));
          pago('EFECTIVO', efectivo);
          pago(tarjeta, total.minus(efectivo).plus(propina));
        }
      }

      const numMesa = 1 + Math.floor(r() * 30);
      const comensales = r() < 0.08 ? null : 1 + Math.floor(r() * 8);
      const conCliente = r() < PROB_CLIENTE[canal ?? 'comedor'];
      const cliente = elegir(r, CLIENTES);

      // Sin futuro: el cheque se generó igual (el PRNG avanza lo mismo) pero no se
      // guarda. Van en orden cronológico, así que lo descartado es la cola: no hay
      // huecos de folio y lo anterior no cambia.
      if (op.ahora && cierre.getTime() > op.ahora.getTime()) return;

      cheques.push({
        id: idSeed(suc.id, 0, n),
        sucursalId: suc.id,
        empresaId: op.empresaId,
        folio: String(n),
        folioSr: `${PREFIJO_SEED}${suc.clave}-${String(n).padStart(4, '0')}`,
        abiertoAt,
        cerradoAt,
        mesa:
          canal === 'mostrador' || canal === 'domicilio'
            ? null
            : `${area?.nombre === 'Barra' ? 'B' : area?.nombre === 'Terraza' ? 'T' : 'M'}${numMesa}`,
        mesero: mesero.nombre,
        comensales,
        subtotal,
        impuestos,
        descuentos,
        propina,
        total,
        cancelado,
        partidas,
        pagos,
        maestro: {
          meseroClave: mesero.clave,
          area: area?.nombre ?? null,
          canal,
          clienteClave: conCliente ? cliente.clave : null,
        },
      });
    });
  });
  return cheques;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Siembra (o re-siembra) las ventas y el catálogo sintético. Sólo borra lo que
 * el propio seed creó: cheques `SEED-%` de las sucursales indicadas.
 */
export async function sembrarVentas(
  prisma: PrismaClient,
  op: OpcionesVentas,
): Promise<{ cheques: number; partidas: number; pagos: number }> {
  const cheques = generarVentas(op);
  const sucursalIds = op.sucursales.map((s) => s.id);
  const sembrados = {
    cheque: { sucursalId: { in: sucursalIds }, folioSr: { startsWith: PREFIJO_SEED } },
  };
  // Lo que no tiene columna (partidas y pagos van aparte; de `maestro` sólo el cliente y el
  // área, y la clave de producto no se persiste) se quita antes del `createMany`.
  const filasCheque = cheques.map((c) => {
    const { partidas: _partidas, pagos: _pagos, maestro, ...fila } = c;
    void _partidas;
    void _pagos;
    // El cliente sí tiene columna desde F2-232: el seed de catálogos usa su clave como
    // `origenSrId`, así que la cuenta lo referencia por ese mismo id.
    // El área, desde F2-233: su clave es el `origenSrId` del catálogo de áreas del seed.
    return {
      ...fila,
      clienteOrigenSrId: maestro.clienteClave,
      areaOrigenSrId: claveDeArea(maestro.area),
    };
  });
  const partidas = cheques.flatMap((c) =>
    c.partidas.map(({ productoClave: _clave, ...p }) => {
      void _clave;
      return { ...p, chequeId: c.id, empresaId: c.empresaId };
    }),
  );
  const pagos = cheques.flatMap((c) =>
    c.pagos.map((p) => ({
      ...p,
      chequeId: c.id,
      empresaId: c.empresaId,
      // La ingesta guarda `otro` (DECISION PROVISIONAL de F1-031); el seed
      // imita lo que de verdad queda en la base. Los agregados usan el catálogo.
      forma: FormaPago.otro,
    })),
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.chequePartida.deleteMany({ where: sembrados });
      await tx.chequePago.deleteMany({ where: sembrados });
      await tx.cheque.deleteMany({ where: sembrados.cheque });
      await tx.cheque.createMany({
        data: filasCheque,
      });
      await tx.chequePartida.createMany({ data: partidas });
      await tx.chequePago.createMany({ data: pagos });
      for (const { formaRaw, forma } of CATALOGO_SEED) {
        await tx.formaPagoCatalogo.upsert({
          where: { empresaId_formaRaw: { empresaId: op.empresaId, formaRaw } },
          create: { empresaId: op.empresaId, formaRaw, forma },
          update: { forma },
        });
      }
    },
    { timeout: 60_000 },
  );
  // Carga masiva: se refrescan en el acto las estadísticas del planificador (F2-222). Si se
  // analizaron con las tablas vacías (lo normal justo antes de sembrar), Postgres cree que
  // hay ~1 fila y los filtros de Tickets entran a las partidas por el índice de `empresa_id`
  // en vez del de `cheque_id`: medido, 2.7 s por consulta en vez de 16 ms. En producción lo
  // hace autovacuum (al pasar de 50 filas + 10 %); aquí no se le espera. Es NUESTRA base,
  // nunca la de SoftRestaurant.
  await prisma.$executeRaw`ANALYZE cheques, cheque_partidas, cheque_pagos`;
  return { cheques: cheques.length, partidas: partidas.length, pagos: pagos.length };
}

/**
 * El universo del seed maestro que corresponde a ESTAS ventas: catálogos,
 * inventario simulado contra ellas, recetas, compras y gastos (F2-201).
 */
export function universoDe(op: OpcionesVentas, cheques: readonly ChequeSeed[]) {
  return generarUniverso({
    sucursales: op.sucursales,
    dias: diasHasta(op.hoy, DIAS),
    ventas: cheques.map((c) => ({ ...c, canal: c.maestro.canal })),
  });
}

/**
 * El reloj de la corrida: `SEED_AHORA` si viene (para reproducir una corrida
 * exacta), si no el minuto en curso TRUNCADO. Truncar hace que dos corridas
 * seguidas dentro del mismo minuto dejen exactamente lo mismo; una que cruce de
 * minuto puede sumar los cheques que cerraron en ese minuto, y es lo correcto
 * para un seed que no inventa futuro.
 */
export function relojDelSeed(entorno: string | undefined, ahora = new Date()): Date {
  if (entorno) {
    const t = new Date(entorno);
    if (Number.isNaN(t.getTime())) throw new Error(`SEED_AHORA inválido: ${entorno}`);
    return t;
  }
  return new Date(Math.floor(ahora.getTime() / 60_000) * 60_000);
}

async function main(): Promise<void> {
  // api/.env: `npm run seed:*` corre fuera de la CLI de Prisma y nadie más lo carga
  // (F2-200). Antes del chequeo de producción, para que un NODE_ENV del .env cuente.
  cargarEnvLocal();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'El seed de ventas es de desarrollo y se niega a correr con NODE_ENV=production.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const demo = [
      { id: SEED_IDS.sucursalCentro, clave: 'CENTRO' },
      { id: SEED_IDS.sucursalNorte, clave: 'NORTE' },
    ];
    const guardadas = await prisma.sucursal.findMany({
      where: { id: { in: demo.map((s) => s.id) }, empresaId: SEED_IDS.empresaDemo },
      select: { id: true, zonaHoraria: true },
    });
    if (guardadas.length !== demo.length) {
      throw new Error('Faltan las sucursales demo: corre primero `npx prisma db seed`.');
    }
    const sucursales = demo.map((s) => ({
      ...s,
      zonaHoraria: guardadas.find((g) => g.id === s.id)!.zonaHoraria,
    }));
    const ahora = relojDelSeed(process.env.SEED_AHORA);
    const hoy = hoyEn(sucursales[0].zonaHoraria, ahora);
    const op: OpcionesVentas = { empresaId: SEED_IDS.empresaDemo, sucursales, hoy, ahora };
    const r = await sembrarVentas(prisma, op);
    console.log(
      `Seed de ventas aplicado: ${r.cheques} cheques, ${r.partidas} partidas, ${r.pagos} pagos ` +
        `(${DIAS} días hasta ${hoy}, sin cierres después de ${ahora.toISOString()}).`,
    );
    const universo = universoDe(op, generarVentas(op));
    // Catálogos espejo (F2-230): grupos, productos, meseros, clientes, áreas y canales (F2-233),
    // por la misma ingesta que usa el agente; y el mapeo demo área → canal (F2-233).
    const catalogos = await sembrarCatalogos(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      capturadoAt: ahora,
    });
    console.log(
      'Catálogos espejo sembrados (F2-230): ' +
        Object.entries(catalogos)
          .map(([c, n]) => `${c} ${n}`)
          .join(', ') +
        '.',
    );
    // Recetas (F2-125): por la misma ingesta del agente. P020 sin cabecera y P021 vacía: los dos
    // caminos de "sin receta" que el consumo teórico lista aparte.
    const recetas = await sembrarRecetas(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      ahora,
    });
    console.log(
      `Recetas sembradas (F2-125): ${recetas.recetas} con ${recetas.renglones} renglones ` +
        `(${recetas.creadas} nuevas, ${recetas.actualizadas} cambiadas).`,
    );
    // Pólizas y movimientos (F2-122): por la misma ingesta del agente, en lotes. Sus saldos son
    // exactamente la foto de existencias de abajo: el kardex la reproduce.
    const movimientos = await sembrarMovimientos(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      ahora,
    });
    console.log(
      `Pólizas sembradas (F2-122): ${movimientos.polizas} con ${movimientos.movimientos} ` +
        `movimientos; ${movimientos.borradas} de otra ventana borradas.`,
    );
    // Existencias (F2-121): una foto por almacén por la misma ingesta del agente, y los límites
    // demo (sin pisar los que se editaron en el panel).
    const existencias = await sembrarExistencias(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      capturadoAt: ahora,
    });
    console.log(
      `Existencias sembradas (F2-121): ${existencias.existencias} en ${existencias.almacenes} ` +
        `almacenes; ${existencias.limites} límites nuevos.`,
    );
    // Conteos físicos (F2-123): dato propio, sobre la foto de existencias de arriba. Uno cerrado
    // y uno en captura por sucursal; nunca toca los conteos de un usuario.
    const conteos = await sembrarConteos(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      ahora,
    });
    console.log(
      `Conteos físicos sembrados (F2-123): ${conteos.creados} creados, ` +
        `${conteos.conservados} sin cambios, ${conteos.borrados} de otra foto rehechos.`,
    );
    // Traspasos del panel (F2-124): dato propio, sobre las pólizas y existencias de arriba. Uno
    // conciliado contra un traspaso de SR del seed, dos pendientes y uno en alerta (> 48 h).
    const traspasos = await sembrarTraspasos(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      ahora,
    });
    console.log(
      `Traspasos sembrados (F2-124): ${traspasos.creados} creados, ` +
        `${traspasos.conservados} sin cambios, ${traspasos.borrados} de otro reloj rehechos; ` +
        `${traspasos.conciliados} conciliados en esta corrida.`,
    );
    // Compras (F2-126): por la misma ingesta del agente. Documento aparte de su póliza `compra`
    // (F2-122), que ya se sembró arriba y no se toca.
    const compras = await sembrarCompras(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      ahora,
    });
    console.log(
      `Compras sembradas (F2-126): ${compras.compras} con ${compras.partidas} partidas; ` +
        `${compras.borradas} de otra ventana borradas.`,
    );
    // Gastos (F2-126): dato propio, por el helper de escritura de la captura, con sus categorías.
    const gastos = await sembrarGastos(prisma, {
      empresaId: op.empresaId,
      sucursales,
      universo,
      ahora,
    });
    console.log(
      `Gastos sembrados (F2-126): ${gastos.gastos} en ${gastos.categorias} categorías nuevas; ` +
        `${gastos.omitidos} omitidos (categoría inactiva), ${gastos.borrados} de otra ventana borrados.`,
    );
    // Datos fiscales (F2-100): perfil con metadata SINTÉTICA de CSD (vence en 20 días, para ver
    // la alerta) y dos receptores frecuentes que ligan con clientes del seed por RFC.
    const facturacion = await sembrarFacturacion(prisma, { empresaId: op.empresaId, hoy, ahora });
    console.log(
      `Datos fiscales sembrados (F2-100): perfil ${facturacion.perfil}, ` +
        `${facturacion.receptores} receptores frecuentes.`,
    );
    // El resto del universo todavía no tiene tabla: se genera (y se valida en los
    // specs) para que la tarea que la cree lo persista desde aquí.
    console.log('Seed maestro (generado; lo persiste la tarea que crea cada tabla):');
    for (const [modulo, filas, tarea] of resumenPorModulo(universo)) {
      console.log(`  - ${modulo}: ${filas} (${tarea})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
