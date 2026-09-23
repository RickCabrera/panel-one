/**
 * Catálogos SINTÉTICOS de inventario del seed maestro (F2-201): unidades, grupos
 * de insumo, insumos, almacenes y proveedores. Ningún dato es de un restaurante
 * real, y NO es un mapeo de SoftRestaurant (§9–§10 de docs/esquema-sr.md siguen
 * pendientes): no obligan al modelo que diseñe F2-120.
 */

export interface Unidad {
  clave: string;
  nombre: string;
  /** Se cuenta en piezas enteras (no fraccionaria). */
  entera: boolean;
}

export interface GrupoInsumo {
  clave: string;
  nombre: string;
  /** Almacén en el que vive el grupo dentro de cada sucursal. */
  almacen: TipoAlmacen;
  /** Proveedor que lo surte. */
  proveedor: string;
}

export interface Insumo {
  clave: string;
  nombre: string;
  grupo: string;
  unidad: string;
  /** Costo base por unidad, sin IVA. */
  costo: string;
  /**
   * Insumo NUEVO (F2-127): se dio de alta hace estos días. No tiene inventario inicial ni entra
   * a la simulación diaria; sólo su primera compra (ver `ALTA_RECIENTE`). Sin él, todo insumo
   * tiene 90 días de historial y "sin datos" nunca se vería con el seed.
   */
  altaHaceDias?: number;
}

export type TipoAlmacen = 'GEN' | 'BAR';

export interface Proveedor {
  clave: string;
  nombre: string;
}

export const UNIDADES: readonly Unidad[] = [
  { clave: 'KG', nombre: 'Kilogramo', entera: false },
  { clave: 'LT', nombre: 'Litro', entera: false },
  { clave: 'PZA', nombre: 'Pieza', entera: true },
];

export const PROVEEDORES: readonly Proveedor[] = [
  { clave: 'PR01', nombre: 'Carnes Selectas de Ejemplo' },
  { clave: 'PR02', nombre: 'Lácteos del Valle (ficticio)' },
  { clave: 'PR03', nombre: 'Central de Abasto Demo' },
  { clave: 'PR04', nombre: 'Abarrotes Mayoreo Demo' },
  { clave: 'PR05', nombre: 'Distribuidora de Bebidas Demo' },
  { clave: 'PR06', nombre: 'Empaques Genéricos Demo' },
];

export const GRUPOS_INSUMO: readonly GrupoInsumo[] = [
  { clave: 'GI01', nombre: 'Carnes y pescados', almacen: 'GEN', proveedor: 'PR01' },
  { clave: 'GI02', nombre: 'Lácteos y huevo', almacen: 'GEN', proveedor: 'PR02' },
  { clave: 'GI03', nombre: 'Frutas y verduras', almacen: 'GEN', proveedor: 'PR03' },
  { clave: 'GI04', nombre: 'Abarrotes', almacen: 'GEN', proveedor: 'PR04' },
  { clave: 'GI05', nombre: 'Bebidas y licores', almacen: 'BAR', proveedor: 'PR05' },
  { clave: 'GI06', nombre: 'Desechables', almacen: 'GEN', proveedor: 'PR06' },
];

export const INSUMOS: readonly Insumo[] = [
  {
    clave: 'I001',
    nombre: 'Carne de cerdo al pastor',
    grupo: 'GI01',
    unidad: 'KG',
    costo: '145.00',
  },
  { clave: 'I002', nombre: 'Pechuga de pollo', grupo: 'GI01', unidad: 'KG', costo: '98.00' },
  { clave: 'I003', nombre: 'Arrachera', grupo: 'GI01', unidad: 'KG', costo: '180.00' },
  { clave: 'I004', nombre: 'Rib eye', grupo: 'GI01', unidad: 'KG', costo: '290.00' },
  { clave: 'I005', nombre: 'Pierna de cerdo', grupo: 'GI01', unidad: 'KG', costo: '120.00' },
  { clave: 'I006', nombre: 'Huachinango', grupo: 'GI01', unidad: 'KG', costo: '230.00' },
  { clave: 'I007', nombre: 'Camarón', grupo: 'GI01', unidad: 'KG', costo: '280.00' },
  { clave: 'I010', nombre: 'Queso Oaxaca', grupo: 'GI02', unidad: 'KG', costo: '150.00' },
  { clave: 'I011', nombre: 'Crema', grupo: 'GI02', unidad: 'LT', costo: '60.00' },
  { clave: 'I012', nombre: 'Leche', grupo: 'GI02', unidad: 'LT', costo: '26.00' },
  { clave: 'I013', nombre: 'Huevo', grupo: 'GI02', unidad: 'KG', costo: '45.00' },
  { clave: 'I014', nombre: 'Queso fresco', grupo: 'GI02', unidad: 'KG', costo: '110.00' },
  { clave: 'I015', nombre: 'Leche condensada', grupo: 'GI02', unidad: 'LT', costo: '70.00' },
  { clave: 'I016', nombre: 'Leche evaporada', grupo: 'GI02', unidad: 'LT', costo: '50.00' },
  { clave: 'I020', nombre: 'Aguacate', grupo: 'GI03', unidad: 'KG', costo: '65.00' },
  { clave: 'I021', nombre: 'Jitomate', grupo: 'GI03', unidad: 'KG', costo: '28.00' },
  { clave: 'I022', nombre: 'Cebolla', grupo: 'GI03', unidad: 'KG', costo: '22.00' },
  { clave: 'I023', nombre: 'Limón', grupo: 'GI03', unidad: 'KG', costo: '30.00' },
  { clave: 'I024', nombre: 'Tomate verde', grupo: 'GI03', unidad: 'KG', costo: '30.00' },
  { clave: 'I025', nombre: 'Nopal', grupo: 'GI03', unidad: 'KG', costo: '25.00' },
  { clave: 'I026', nombre: 'Chile poblano', grupo: 'GI03', unidad: 'KG', costo: '48.00' },
  { clave: 'I027', nombre: 'Granada', grupo: 'GI03', unidad: 'KG', costo: '60.00' },
  { clave: 'I030', nombre: 'Tortilla de maíz', grupo: 'GI04', unidad: 'KG', costo: '22.00' },
  { clave: 'I031', nombre: 'Totopos', grupo: 'GI04', unidad: 'KG', costo: '55.00' },
  { clave: 'I032', nombre: 'Frijol', grupo: 'GI04', unidad: 'KG', costo: '38.00' },
  { clave: 'I033', nombre: 'Arroz', grupo: 'GI04', unidad: 'KG', costo: '30.00' },
  { clave: 'I034', nombre: 'Mole en pasta', grupo: 'GI04', unidad: 'KG', costo: '180.00' },
  { clave: 'I035', nombre: 'Maíz pozolero', grupo: 'GI04', unidad: 'KG', costo: '40.00' },
  { clave: 'I036', nombre: 'Harina de trigo', grupo: 'GI04', unidad: 'KG', costo: '20.00' },
  { clave: 'I037', nombre: 'Azúcar', grupo: 'GI04', unidad: 'KG', costo: '28.00' },
  { clave: 'I038', nombre: 'Chocolate de mesa', grupo: 'GI04', unidad: 'KG', costo: '150.00' },
  { clave: 'I039', nombre: 'Aceite vegetal', grupo: 'GI04', unidad: 'LT', costo: '42.00' },
  { clave: 'I040', nombre: 'Nuez de Castilla', grupo: 'GI04', unidad: 'KG', costo: '420.00' },
  { clave: 'I041', nombre: 'Bolillo', grupo: 'GI04', unidad: 'PZA', costo: '4.00' },
  { clave: 'I042', nombre: 'Café molido', grupo: 'GI04', unidad: 'KG', costo: '260.00' },
  { clave: 'I043', nombre: 'Canela', grupo: 'GI04', unidad: 'KG', costo: '300.00' },
  { clave: 'I050', nombre: 'Refresco 355 ml', grupo: 'GI05', unidad: 'PZA', costo: '12.00' },
  {
    clave: 'I051',
    nombre: 'Cerveza nacional 355 ml',
    grupo: 'GI05',
    unidad: 'PZA',
    costo: '18.00',
  },
  { clave: 'I052', nombre: 'Tequila blanco', grupo: 'GI05', unidad: 'LT', costo: '380.00' },
  {
    clave: 'I053',
    nombre: 'Concentrado de horchata',
    grupo: 'GI05',
    unidad: 'LT',
    costo: '110.00',
  },
  { clave: 'I054', nombre: 'Flor de jamaica', grupo: 'GI05', unidad: 'KG', costo: '250.00' },
  { clave: 'I055', nombre: 'Licor de naranja', grupo: 'GI05', unidad: 'LT', costo: '220.00' },
  { clave: 'I060', nombre: 'Contenedor para llevar', grupo: 'GI06', unidad: 'PZA', costo: '5.00' },
  { clave: 'I061', nombre: 'Bolsa de entrega', grupo: 'GI06', unidad: 'PZA', costo: '1.50' },
  {
    clave: 'I062',
    nombre: 'Vaso compostable 16 oz',
    grupo: 'GI06',
    unidad: 'PZA',
    costo: '3.50',
    altaHaceDias: 10,
  },
];

/**
 * La primera (y única) compra de cada insumo nuevo (F2-127), en cada sucursal: el día de su alta,
 * a costo base, sin PRNG. Mínimo y máximo son los que el encargado le puso al darlo de alta (no
 * salen de un consumo que todavía no existe).
 */
export const ALTA_RECIENTE: Readonly<
  Record<string, { cantidad: string; minimo: string; maximo: string }>
> = {
  I062: { cantidad: '120', minimo: '30', maximo: '150' },
};

/**
 * Casos forzados por almacén, para que F2-121 tenga qué señalar: el primero
 * termina hoy EN CERO y el segundo BAJO MÍNIMO (pero no en cero). Los fija un
 * ajuste de conteo físico del último día, no un saldo inventado aparte.
 */
export const FORZADOS: Readonly<Record<TipoAlmacen, { agotado: string; bajoMinimo: string }>> = {
  GEN: { agotado: 'I027', bajoMinimo: 'I040' },
  BAR: { agotado: 'I055', bajoMinimo: 'I052' },
};

export const NOMBRE_ALMACEN: Readonly<Record<TipoAlmacen, string>> = {
  GEN: 'Almacén general',
  BAR: 'Barra',
};

export function grupoInsumo(clave: string): GrupoInsumo {
  return GRUPOS_INSUMO.find((g) => g.clave === clave)!;
}

export function insumo(clave: string): Insumo {
  const i = INSUMOS.find((x) => x.clave === clave);
  if (!i) throw new Error(`insumo desconocido: ${clave}`);
  return i;
}

export function almacenDeInsumo(clave: string): TipoAlmacen {
  return grupoInsumo(insumo(clave).grupo).almacen;
}

export function unidadEntera(claveInsumo: string): boolean {
  return UNIDADES.find((u) => u.clave === insumo(claveInsumo).unidad)!.entera;
}
