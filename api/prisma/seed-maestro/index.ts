import {
  areasDe,
  CANALES,
  CLIENTES,
  GRUPOS_PRODUCTO,
  meserosDe,
  precioEn,
  PRODUCTOS,
  type Area,
  type Canal,
  type Cliente,
  type GrupoProducto,
} from './catalogos';
import { CATEGORIAS_GASTO, generarGastos, type GastoSeed } from './gastos';
import {
  GRUPOS_INSUMO,
  INSUMOS,
  PROVEEDORES,
  UNIDADES,
  type GrupoInsumo,
  type Insumo,
  type Proveedor,
  type Unidad,
} from './insumos';
import {
  generarInventario,
  type Inventario,
  type SucursalInventario,
  type VentaParaConsumo,
} from './inventario';
import { RECETAS, type Renglon } from './recetas';

/**
 * El UNIVERSO del seed maestro (F2-201): todo lo que la Ronda 2 va a necesitar
 * ver, generado de forma PURA y determinista a partir de las ventas del seed.
 *
 * Las ventas (cheques, partidas, pagos, formas) y, desde F2-230, grupos,
 * productos, meseros y clientes (`prisma/seed-catalogos.ts`) ya tienen tabla. El
 * resto NO se persiste aquí: lo persiste, desde esta función, la tarea que cree
 * su tabla (regla 2 de la Ronda 2), para no adelantarse a su diseño:
 *
 * | Parte del universo                     | La persiste |
 * |----------------------------------------|-------------|
 * | grupos, productos, precios por sucursal| F2-230 / F2-145 |
 * | meseros                                | F2-230 / F2-231 |
 * | clientes                               | F2-230 / F2-232 |
 * | áreas y canales                        | F2-233      |
 * | unidades, grupos de insumo, insumos, almacenes | F2-120 |
 * | existencias                            | F2-121      |
 * | pólizas y movimientos (kardex)         | F2-122 (conteos F2-123, traspasos F2-124) |
 * | recetas                                | F2-125      |
 * | compras, proveedores y gastos          | F2-126      |
 *
 * Nada de esto es un mapeo de SoftRestaurant: es sintético.
 */

export interface ProductoUniverso {
  clave: string;
  nombre: string;
  grupo: string;
  porKg: boolean;
  /** `YYYY-MM-DD` desde el que ya no se vende, o nulo si sigue activo. */
  bajaDesde: string | null;
  activo: boolean;
  /** Precio con IVA en cada sucursal (por id). */
  precios: Array<{ sucursalId: string; precio: string }>;
}

export interface MeseroUniverso {
  clave: string;
  nombre: string;
  sucursalId: string;
  activo: boolean;
  bajaDesde: string | null;
}

export interface AreaUniverso extends Pick<Area, 'clave' | 'nombre' | 'canal'> {
  sucursalId: string;
}

export interface Universo extends Inventario {
  grupos: readonly GrupoProducto[];
  productos: ProductoUniverso[];
  meseros: MeseroUniverso[];
  clientes: readonly Cliente[];
  canales: readonly Canal[];
  areas: AreaUniverso[];
  unidades: readonly Unidad[];
  gruposInsumo: readonly GrupoInsumo[];
  insumos: readonly Insumo[];
  proveedores: readonly Proveedor[];
  recetas: Array<{ producto: string; renglones: readonly Renglon[] }>;
  productosSinReceta: string[];
  gastos: GastoSeed[];
  categoriasGasto: readonly string[];
}

/** `dia` menos `n` días. */
function haceDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

export function generarUniverso(op: {
  sucursales: readonly SucursalInventario[];
  /** Los días (`YYYY-MM-DD`) que cubren las ventas, en orden. */
  dias: readonly string[];
  ventas: readonly VentaParaConsumo[];
}): Universo {
  const hoy = op.dias[op.dias.length - 1];
  const productos = PRODUCTOS.map((p) => {
    const bajaDesde = p.bajaHaceDias === undefined ? null : haceDias(hoy, p.bajaHaceDias);
    return {
      clave: p.clave,
      nombre: p.nombre,
      grupo: p.grupo,
      porKg: p.porKg ?? false,
      bajaDesde,
      activo: bajaDesde === null,
      precios: op.sucursales.map((s, i) => ({ sucursalId: s.id, precio: precioEn(p, i) })),
    };
  });
  const meseros = op.sucursales.flatMap((s, i) =>
    meserosDe(i).map((m) => {
      const bajaDesde = m.bajaHaceDias === undefined ? null : haceDias(hoy, m.bajaHaceDias);
      return {
        clave: m.clave,
        nombre: m.nombre,
        sucursalId: s.id,
        activo: bajaDesde === null,
        bajaDesde,
      };
    }),
  );
  const areas = op.sucursales.flatMap((s, i) =>
    areasDe(i).map((a) => ({ clave: a.clave, nombre: a.nombre, canal: a.canal, sucursalId: s.id })),
  );
  const recetas = Object.entries(RECETAS).map(([producto, renglones]) => ({ producto, renglones }));

  return {
    grupos: GRUPOS_PRODUCTO,
    productos,
    meseros,
    clientes: CLIENTES,
    canales: CANALES,
    areas,
    unidades: UNIDADES,
    gruposInsumo: GRUPOS_INSUMO,
    insumos: INSUMOS,
    proveedores: PROVEEDORES,
    recetas,
    productosSinReceta: PRODUCTOS.filter((p) => !RECETAS[p.clave]).map((p) => p.clave),
    ...generarInventario({ sucursales: op.sucursales, dias: op.dias, ventas: op.ventas }),
    gastos: generarGastos({ sucursales: op.sucursales, dias: op.dias }),
    categoriasGasto: CATEGORIAS_GASTO,
  };
}

/** Conteo por módulo, para imprimirlo al final del seed. */
export function resumenPorModulo(
  u: Universo,
): Array<[modulo: string, filas: number, tarea: string]> {
  return [
    ['grupos de producto', u.grupos.length, 'F2-230'],
    ['productos', u.productos.length, 'F2-230'],
    ['precios por sucursal', u.productos.reduce((n, p) => n + p.precios.length, 0), 'F2-145'],
    ['meseros', u.meseros.length, 'F2-231'],
    ['clientes', u.clientes.length, 'F2-232'],
    ['áreas', u.areas.length, 'F2-233'],
    ['insumos', u.insumos.length, 'F2-120'],
    ['almacenes', u.almacenes.length, 'F2-120'],
    ['existencias', u.existencias.length, 'F2-121'],
    ['pólizas', u.polizas.length, 'F2-122'],
    ['movimientos', u.polizas.reduce((n, p) => n + p.movimientos.length, 0), 'F2-122'],
    ['recetas', u.recetas.length, 'F2-125'],
    ['compras', u.compras.length, 'F2-126'],
    ['gastos', u.gastos.length, 'F2-126'],
  ];
}

