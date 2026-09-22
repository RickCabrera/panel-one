import { Prisma, PrismaClient } from '@prisma/client';

import { cargarEnvLocal } from '../src/config/cargar-env';
import { SEED_IDS } from './seed';
import { meserosDe, nombreGrupo, precioEn, PRODUCTOS } from './seed-maestro/catalogos';

/**
 * Seed de SNAPSHOTS de mesas abiertas (F1-050), SINTÉTICOS. Ningún dato es de un
 * restaurante real. Deja probar el Monitor de mesas sin agente ni SoftRestaurant:
 *
 * - La PRIMERA sucursal queda "en vivo": capturado y recibido = `ahora`, con
 *   `MESAS_EN_VIVO` (60) mesas que cubren todo el semáforo (< 40, 40–60, > 60 min),
 *   cuentas con más de 3 partidas, modificadores (también de $0.00), `impreso` mezclado
 *   y partidas con la comanda pendiente de imprimir. Las 8 primeras están escritas a
 *   mano (sus importes se cuadran a mano en el spec); las otras 52 las genera
 *   `generadas()` sin azar (F2-223: el Monitor se prueba con 60 mesas abiertas).
 * - La SEGUNDA queda "desconectada": su último snapshot es de hace 2 h, para ver el
 *   banner en lugar de sus mesas.
 *
 * La forma de cada mesa es la PROVISIONAL de esquema-sr.md §5 (SUPUESTO; la valida
 * F1-023 contra SR real). "En vivo" sólo dura 90 s (3 intervalos del agente): para
 * volver a verla viva, se corre otra vez `npm run seed:mesas`.
 *
 * - `generarSnapshots()` es PURO: el mismo `ahora` da exactamente lo mismo.
 * - `sembrarMesas()` es idempotente: borra SÓLO los snapshots que marcó como suyos
 *   (`payload.origen = 'seed'`) en esas sucursales y crea los nuevos. Con el mismo
 *   `ahora`, tres corridas dejan los mismos datos.
 */

export const ORIGEN_SEED = 'seed';
/** Hace cuánto fue la última lectura de la sucursal desconectada. */
export const DESCONECTADA_HACE_MS = 2 * 60 * 60 * 1000;

export interface OpcionesMesas {
  empresaId: string;
  /** [en vivo, desconectada]. */
  sucursales: readonly [string, string];
  ahora: Date;
}

export interface PartidaMesaSeed {
  producto: string;
  categoria: string;
  cantidad: string;
  precioUnit: string;
  total: string;
  modificadores: Array<{ nombre: string; precio: string }>;
  /**
   * DECISION PROVISIONAL (nocturno): forma NUESTRA, no de SR (F2-223, esquema-sr.md §5):
   * si la comanda de la partida ya salió impresa. Regla del seed: en una cuenta ya
   * impresa, todas `true`; en una sin imprimir de índice impar, la última va `false`.
   */
  comandaImpresa: boolean;
}

export interface MesaSeed {
  mesa: string;
  mesero: string;
  folio: string;
  /** ISO UTC, "reloj del POS". */
  abiertoAt: string;
  total: string;
  comensales: number;
  impreso: boolean;
  partidas: PartidaMesaSeed[];
}

export interface SnapshotSeed {
  sucursalId: string;
  empresaId: string;
  capturadoAt: Date;
  recibidoAt: Date;
  payload: { origen: string; mesas: MesaSeed[] };
}

type Renglon = [
  producto: string,
  categoria: string,
  precio: string,
  cantidad: string,
  mods?: 0 | 1,
];

// Meseros y productos: los del catálogo del seed maestro (F2-201), con sus nombres,
// para que el Monitor y las ventas hablen de la misma gente y el mismo menú.
const MOD_GRATIS = { nombre: 'Sin cebolla', precio: '0.00' };
const MOD_CON_COSTO = { nombre: 'Extra queso', precio: '18.00' };

/** Mesa, mesero, minutos abierta, comensales, impreso, partidas. */
type Plantilla = [string, string, number, number, boolean, Renglon[]];

const EN_VIVO: readonly Plantilla[] = [
  ['1', 'Ana López', 10, 2, false, [['Guacamole', 'Entradas', '95.00', '1', 0]]],
  [
    '2',
    'Carlos Ramírez',
    35,
    4,
    false,
    [
      ['Tacos al pastor (orden)', 'Platos fuertes', '89.00', '2', 1],
      ['Agua de horchata', 'Bebidas', '38.00', '4'],
    ],
  ],
  ['4', 'Lucía Hernández', 40, 2, true, [['Mole poblano', 'Platos fuertes', '169.00', '2']]],
  [
    '5',
    'Ana López',
    45,
    6,
    false,
    [
      ['Queso fundido', 'Entradas', '112.00', '1', 1],
      ['Arrachera', 'Cortes por kg', '489.00', '0.750'],
      ['Enchiladas suizas', 'Platos fuertes', '138.00', '2'],
      ['Cerveza nacional', 'Bebidas', '55.00', '6'],
      ['Flan napolitano', 'Postres', '68.00', '2'],
    ],
  ],
  ['7', 'Jorge Martínez', 60, 3, true, [['Pozole rojo', 'Platos fuertes', '124.00', '3']]],
  [
    '10',
    'Carlos Ramírez',
    75,
    2,
    false,
    [
      ['Sopa de tortilla', 'Entradas', '78.50', '2', 0],
      ['Pescado a la talla', 'Platos fuertes', '245.50', '1'],
      ['Margarita', 'Bebidas', '120.00', '2'],
      ['Café de olla', 'Bebidas', '42.00', '2'],
    ],
  ],
  [
    '12',
    'Sofía García',
    130,
    8,
    true,
    [
      ['Rib eye', 'Cortes por kg', '720.00', '1.250'],
      ['Chiles en nogada', 'Platos fuertes', '215.00', '3'],
      ['Refresco', 'Bebidas', '35.00', '5'],
    ],
  ],
  ['Barra', 'Lucía Hernández', 22, 1, false, [['Café de olla', 'Bebidas', '42.00', '1']]],
];

/** Cuántas mesas abiertas tiene la sucursal en vivo (F2-223). */
export const MESAS_EN_VIVO = 60;

/**
 * Las mesas 13–64 de la sucursal en vivo, generadas SIN azar (aritmética sobre el
 * índice): meseros, productos, grupos y precios del catálogo maestro, minutos entre 5 y
 * 150 (los tres colores del semáforo), de 1 a 4 partidas e `impreso` mezclado. Son
 * invención del seed, como todo lo del catálogo maestro: no evidencia de SR.
 */
function generadas(cuantas: number): Plantilla[] {
  const meseros = meserosDe(0).map((m) => m.nombre);
  return Array.from({ length: cuantas }, (_, k): Plantilla => {
    const renglones = Array.from({ length: 1 + (k % 4) }, (_, j): Renglon => {
      const q = PRODUCTOS[(k * 7 + j * 11) % PRODUCTOS.length];
      return [q.nombre, nombreGrupo(q.grupo), precioEn(q, 0), String(1 + ((k + j) % 3))];
    });
    return [
      String(13 + k),
      meseros[k % meseros.length],
      5 + ((k * 37) % 146),
      1 + (k % 6),
      k % 3 === 0,
      renglones,
    ];
  });
}

const DESCONECTADA: readonly Plantilla[] = [
  ['3', 'Ana López', 20, 2, false, [['Guacamole', 'Entradas', '95.00', '1']]],
  ['8', 'Carlos Ramírez', 50, 4, true, [['Carnitas', 'Cortes por kg', '360.00', '1.000']]],
];

function dinero(v: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function mesas(plantillas: readonly Plantilla[], capturadoAt: Date, clave: string): MesaSeed[] {
  return plantillas.map(([mesa, mesero, minutos, comensales, impreso, renglones], i) => {
    const partidas = renglones.map(([producto, categoria, precio, cantidad, mods], j) => {
      const modificadores = mods === undefined ? [] : [mods === 0 ? MOD_GRATIS : MOD_CON_COSTO];
      const unitario = modificadores.reduce((s, m) => s.plus(m.precio), new Prisma.Decimal(precio));
      return {
        producto,
        categoria,
        cantidad,
        precioUnit: precio,
        total: dinero(unitario.times(cantidad)),
        modificadores,
        comandaImpresa: impreso || j < renglones.length - 1 || i % 2 === 0,
      };
    });
    return {
      mesa,
      mesero,
      folio: `SEED-${clave}-A${String(i + 1).padStart(3, '0')}`,
      abiertoAt: new Date(capturadoAt.getTime() - minutos * 60_000).toISOString(),
      // Mismo supuesto que el seed de ventas: precios con IVA, total = Σ partidas.
      total: dinero(partidas.reduce((s, p) => s.plus(p.total), new Prisma.Decimal(0))),
      comensales,
      impreso,
      partidas,
    };
  });
}

export function generarSnapshots(op: OpcionesMesas): SnapshotSeed[] {
  const ahora = new Date(op.ahora.getTime());
  if (Number.isNaN(ahora.getTime())) throw new Error('ahora inválido');
  const vieja = new Date(ahora.getTime() - DESCONECTADA_HACE_MS);
  const [vivo, desconectada] = op.sucursales;
  return [
    {
      sucursalId: vivo,
      empresaId: op.empresaId,
      capturadoAt: ahora,
      recibidoAt: ahora,
      payload: {
        origen: ORIGEN_SEED,
        mesas: mesas([...EN_VIVO, ...generadas(MESAS_EN_VIVO - EN_VIVO.length)], ahora, 'VIVO'),
      },
    },
    {
      sucursalId: desconectada,
      empresaId: op.empresaId,
      capturadoAt: vieja,
      recibidoAt: vieja,
      payload: { origen: ORIGEN_SEED, mesas: mesas(DESCONECTADA, vieja, 'DESC') },
    },
  ];
}

/** Siembra (o re-siembra) los snapshots. Sólo borra los que el propio seed marcó. */
export async function sembrarMesas(prisma: PrismaClient, op: OpcionesMesas): Promise<number> {
  const snapshots = generarSnapshots(op);
  await prisma.$transaction(async (tx) => {
    await tx.mesaSnapshot.deleteMany({
      where: {
        empresaId: op.empresaId,
        sucursalId: { in: [...op.sucursales] },
        payload: { path: ['origen'], equals: ORIGEN_SEED },
      },
    });
    await tx.mesaSnapshot.createMany({
      data: snapshots.map((s) => ({
        ...s,
        payload: s.payload as unknown as Prisma.InputJsonValue,
      })),
    });
  });
  return snapshots.length;
}

async function main(): Promise<void> {
  // api/.env: `npm run seed:*` corre fuera de la CLI de Prisma y nadie más lo carga
  // (F2-200). Antes del chequeo de producción, para que un NODE_ENV del .env cuente.
  cargarEnvLocal();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'El seed de mesas es de desarrollo y se niega a correr con NODE_ENV=production.',
    );
  }
  const prisma = new PrismaClient();
  try {
    const sucursales = [SEED_IDS.sucursalCentro, SEED_IDS.sucursalNorte] as const;
    const guardadas = await prisma.sucursal.count({
      where: { id: { in: [...sucursales] }, empresaId: SEED_IDS.empresaDemo },
    });
    if (guardadas !== sucursales.length) {
      throw new Error('Faltan las sucursales demo: corre primero `npx prisma db seed`.');
    }
    const n = await sembrarMesas(prisma, {
      empresaId: SEED_IDS.empresaDemo,
      sucursales,
      ahora: new Date(),
    });
    console.log(
      `Seed de mesas aplicado: ${n} snapshots (Sucursal Centro en vivo por 90 s, ` +
        `con ${MESAS_EN_VIVO} mesas abiertas; ` +
        'Sucursal Norte desconectada hace 2 h).',
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
