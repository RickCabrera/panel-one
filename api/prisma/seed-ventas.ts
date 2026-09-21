import { FormaPago, Prisma, PrismaClient } from '@prisma/client';

import { SEED_IDS } from './seed';

/**
 * Seed de VENTAS de desarrollo (F1-032): 500 cheques SINTÉTICOS de 2 sucursales
 * × 30 días. Ningún dato es de un restaurante real. Es lo que deja avanzar al
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
 * Uso: `npm run seed:ventas` (después de `npx prisma db seed`). Siembra en las
 * sucursales demo 30 días que terminan HOY en su zona; correrlo otro día mueve
 * las fechas.
 */

export const PREFIJO_SEED = 'SEED-';
export const CHEQUES_POR_SUCURSAL = 250;
export const DIAS = 30;

export interface SucursalSeed {
  id: string;
  /** Texto corto para el folio (`SEED-<clave>-0001`). */
  clave: string;
  zonaHoraria: string;
}

export interface OpcionesVentas {
  empresaId: string;
  sucursales: readonly SucursalSeed[];
  /** Último día local (`YYYY-MM-DD`) de los 30. */
  hoy: string;
  semilla?: number;
}

export interface PartidaSeed {
  id: string;
  orden: number;
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
  mesa: string;
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

interface Platillo {
  producto: string;
  categoria: string;
  precio: string;
  /** Se vende por kg: cantidad fraccionaria. */
  porKg?: boolean;
}

const MENU: readonly Platillo[] = [
  { producto: 'Guacamole', categoria: 'Entradas', precio: '95.00' },
  { producto: 'Sopa de tortilla', categoria: 'Entradas', precio: '78.50' },
  { producto: 'Queso fundido', categoria: 'Entradas', precio: '112.00' },
  { producto: 'Ensalada de nopal', categoria: 'Entradas', precio: '84.90' },
  { producto: 'Tacos al pastor (orden)', categoria: 'Platos fuertes', precio: '89.00' },
  { producto: 'Enchiladas suizas', categoria: 'Platos fuertes', precio: '138.00' },
  { producto: 'Mole poblano', categoria: 'Platos fuertes', precio: '169.00' },
  { producto: 'Chiles en nogada', categoria: 'Platos fuertes', precio: '215.00' },
  { producto: 'Pescado a la talla', categoria: 'Platos fuertes', precio: '245.50' },
  { producto: 'Pozole rojo', categoria: 'Platos fuertes', precio: '124.00' },
  { producto: 'Arrachera', categoria: 'Cortes por kg', precio: '489.00', porKg: true },
  { producto: 'Rib eye', categoria: 'Cortes por kg', precio: '720.00', porKg: true },
  { producto: 'Carnitas', categoria: 'Cortes por kg', precio: '360.00', porKg: true },
  { producto: 'Agua de horchata', categoria: 'Bebidas', precio: '38.00' },
  { producto: 'Agua de jamaica', categoria: 'Bebidas', precio: '38.00' },
  { producto: 'Refresco', categoria: 'Bebidas', precio: '35.00' },
  { producto: 'Cerveza nacional', categoria: 'Bebidas', precio: '55.00' },
  { producto: 'Margarita', categoria: 'Bebidas', precio: '120.00' },
  { producto: 'Café de olla', categoria: 'Bebidas', precio: '42.00' },
  { producto: 'Flan napolitano', categoria: 'Postres', precio: '68.00' },
  { producto: 'Churros con chocolate', categoria: 'Postres', precio: '74.50' },
  { producto: 'Pastel de tres leches', categoria: 'Postres', precio: '79.00' },
];

const MODIFICADORES: ReadonlyArray<{ nombre: string; precio: string }> = [
  { nombre: 'Sin cebolla', precio: '0.00' },
  { nombre: 'Término medio', precio: '0.00' },
  { nombre: 'Extra queso', precio: '18.00' },
  { nombre: 'Aguacate extra', precio: '25.00' },
];

const MESEROS = ['Mesero Uno', 'Mesero Dos', 'Mesero Tres', 'Mesero Cuatro', 'Mesero Cinco'];

// ---------------------------------------------------------------------------
// Utilidades deterministas
// ---------------------------------------------------------------------------

/** mulberry32: PRNG pequeño y determinista. */
function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a de 32 bits en hex: prefijo estable de los ids de cada sucursal. */
function fnv(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** UUID determinista: sucursal + tipo (0 cheque, 1 partida, 2 pago) + contador. */
function idSeed(sucursalId: string, tipo: number, n: number): string {
  return `${fnv(sucursalId)}-5eed-4000-8${tipo}00-${n.toString(16).padStart(12, '0')}`;
}

function dinero(v: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Días `YYYY-MM-DD` desde `hoy - (n-1)` hasta `hoy`. */
function diasHasta(hoy: string, n: number): string[] {
  const [a, m, d] = hoy.split('-').map(Number);
  const base = Date.UTC(a, m - 1, d);
  if (Number.isNaN(base) || new Date(base).toISOString().slice(0, 10) !== hoy) {
    throw new Error(`hoy inválido: ${hoy}`);
  }
  return Array.from({ length: n }, (_, i) =>
    new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Día de la semana (0 = domingo) de un `YYYY-MM-DD`. */
function diaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/** Diferencia (ms) entre la hora local de `zona` y UTC en el instante `t`. */
function desfase(zona: string, t: number): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return local - Math.floor(t / 1000) * 1000;
}

/** El instante UTC de una hora de pared en `zona` (sin horas ambiguas en el seed). */
export function instanteLocal(dia: string, segundosDelDia: number, zona: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const pared = Date.UTC(a, m - 1, d) + segundosDelDia * 1000;
  let t = pared - desfase(zona, pared);
  t = pared - desfase(zona, t);
  return new Date(t);
}

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

function elegir<T>(r: () => number, lista: readonly T[]): T {
  return lista[Math.floor(r() * lista.length)];
}

// ---------------------------------------------------------------------------
// Generador
// ---------------------------------------------------------------------------

export function generarVentas(op: OpcionesVentas): ChequeSeed[] {
  const r = prng(op.semilla ?? 20260920);
  const dias = diasHasta(op.hoy, DIAS);
  const cheques: ChequeSeed[] = [];

  for (const suc of op.sucursales) {
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

      const partidas: PartidaSeed[] = [];
      const nPartidas = 1 + Math.floor(r() * 6);
      for (let orden = 0; orden < nPartidas; orden++) {
        const p = elegir(r, MENU);
        const cantidad = p.porKg
          ? new Prisma.Decimal(250 + 50 * Math.floor(r() * 26)).div(1000) // 0.250–1.500 kg
          : new Prisma.Decimal(1 + Math.floor(r() * 3));
        const modificadores = r() < 0.25 ? [elegir(r, MODIFICADORES)] : [];
        const precioMods = modificadores.reduce((s, m) => s.plus(m.precio), new Prisma.Decimal(0));
        const precioUnit = new Prisma.Decimal(p.precio);
        partidas.push({
          id: idSeed(suc.id, 1, ++nPartida),
          orden,
          producto: p.producto,
          categoria: p.categoria,
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

      cheques.push({
        id: idSeed(suc.id, 0, n),
        sucursalId: suc.id,
        empresaId: op.empresaId,
        folio: String(n),
        folioSr: `${PREFIJO_SEED}${suc.clave}-${String(n).padStart(4, '0')}`,
        abiertoAt,
        cerradoAt,
        mesa: `M${1 + Math.floor(r() * 30)}`,
        mesero: elegir(r, MESEROS),
        comensales: r() < 0.08 ? null : 1 + Math.floor(r() * 8),
        subtotal,
        impuestos,
        descuentos,
        propina,
        total,
        cancelado,
        partidas,
        pagos,
      });
    });
  }
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
  const filasCheque = cheques.map((c) => {
    const { partidas: _partidas, pagos: _pagos, ...fila } = c;
    void _partidas;
    void _pagos;
    return fila;
  });
  const partidas = cheques.flatMap((c) =>
    c.partidas.map((p) => ({ ...p, chequeId: c.id, empresaId: c.empresaId })),
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
  return { cheques: cheques.length, partidas: partidas.length, pagos: pagos.length };
}

/** Hoy (`YYYY-MM-DD`) en una zona IANA. */
export function hoyEn(zona: string, ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

async function main(): Promise<void> {
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
    const hoy = hoyEn(sucursales[0].zonaHoraria);
    const r = await sembrarVentas(prisma, { empresaId: SEED_IDS.empresaDemo, sucursales, hoy });
    console.log(
      `Seed de ventas aplicado: ${r.cheques} cheques, ${r.partidas} partidas, ${r.pagos} pagos ` +
        `(30 días hasta ${hoy}).`,
    );
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
