/**
 * Catálogos SINTÉTICOS del seed maestro (F2-201): productos, grupos, meseros,
 * clientes, áreas y canales. Ningún dato es de un restaurante real.
 *
 * SINTÉTICO, no es un mapeo de SoftRestaurant: estas formas son invención del
 * seed (§6–§10 de docs/esquema-sr.md siguen pendientes, y así lo dice ahí) y no
 * obligan al modelo que diseñe F2-230. Hoy sólo los cheques tienen tabla; el
 * resto lo persiste, desde `generarUniverso()`, la tarea que cree su tabla
 * (regla 2 de la Ronda 2).
 *
 * Las sucursales se referencian por su ÍNDICE en la lista del seed (0 = CENTRO,
 * 1 = NORTE en el demo), no por su clave: así los tests, que siembran en otras
 * sucursales, reciben el mismo universo.
 */

export interface GrupoProducto {
  clave: string;
  nombre: string;
}

export interface Producto {
  clave: string;
  nombre: string;
  /** Clave del grupo. */
  grupo: string;
  /** Precio con IVA en la sucursal de índice par. */
  precio: string;
  /** Precio en la sucursal de índice impar, si difiere (lo necesita F2-145). */
  precioAlterno?: string;
  /** Se vende por kg: cantidad fraccionaria. */
  porKg?: boolean;
  /** Días antes de "hoy" en que se dio de baja. Sólo se vende ANTES de ese día. */
  bajaHaceDias?: number;
}

export interface Mesero {
  clave: string;
  nombre: string;
  /** Índice de la sucursal (módulo 2). */
  sucursal: 0 | 1;
  /** Días antes de "hoy" en que se dio de baja. Sólo atiende ANTES de ese día. */
  bajaHaceDias?: number;
}

export interface Cliente {
  clave: string;
  nombre: string;
  telefono: string;
  correo: string;
  /** RFC de PRUEBA publicado por el SAT, o nulo. Nunca uno real. */
  rfc: string | null;
}

export type Canal = 'comedor' | 'mostrador' | 'domicilio';

export interface Area {
  nombre: string;
  /** Canal de negocio por defecto; F2-233 lo vuelve configurable. */
  canal: Canal;
  /** Peso relativo del área al repartir los cheques. */
  peso: number;
  /** Sucursales (índice módulo 2) que tienen esta área. */
  sucursales: ReadonlyArray<0 | 1>;
}

export const GRUPOS_PRODUCTO: readonly GrupoProducto[] = [
  { clave: 'G01', nombre: 'Desayunos' },
  { clave: 'G02', nombre: 'Entradas' },
  { clave: 'G03', nombre: 'Platos fuertes' },
  { clave: 'G04', nombre: 'Cortes por kg' },
  { clave: 'G05', nombre: 'Bebidas' },
  { clave: 'G06', nombre: 'Postres' },
];

// Nombres y precios de los que ya existían se conservan: el seed de mesas los usa.
export const PRODUCTOS: readonly Producto[] = [
  { clave: 'P001', nombre: 'Chilaquiles verdes', grupo: 'G01', precio: '98.00' },
  { clave: 'P002', nombre: 'Huevos rancheros', grupo: 'G01', precio: '92.00' },
  { clave: 'P003', nombre: 'Molletes', grupo: 'G01', precio: '76.00' },
  { clave: 'P004', nombre: 'Guacamole', grupo: 'G02', precio: '95.00' },
  { clave: 'P005', nombre: 'Sopa de tortilla', grupo: 'G02', precio: '78.50' },
  { clave: 'P006', nombre: 'Queso fundido', grupo: 'G02', precio: '112.00' },
  { clave: 'P007', nombre: 'Ensalada de nopal', grupo: 'G02', precio: '84.90' },
  {
    clave: 'P008',
    nombre: 'Tostada de ceviche',
    grupo: 'G02',
    precio: '88.00',
    bajaHaceDias: 40,
  },
  {
    clave: 'P009',
    nombre: 'Tacos al pastor (orden)',
    grupo: 'G03',
    precio: '89.00',
    precioAlterno: '95.00',
  },
  { clave: 'P010', nombre: 'Enchiladas suizas', grupo: 'G03', precio: '138.00' },
  { clave: 'P011', nombre: 'Mole poblano', grupo: 'G03', precio: '169.00' },
  { clave: 'P012', nombre: 'Chiles en nogada', grupo: 'G03', precio: '215.00' },
  { clave: 'P013', nombre: 'Pescado a la talla', grupo: 'G03', precio: '245.50' },
  { clave: 'P014', nombre: 'Pozole rojo', grupo: 'G03', precio: '124.00' },
  { clave: 'P015', nombre: 'Arrachera', grupo: 'G04', precio: '489.00', porKg: true },
  { clave: 'P016', nombre: 'Rib eye', grupo: 'G04', precio: '720.00', porKg: true },
  { clave: 'P017', nombre: 'Carnitas', grupo: 'G04', precio: '360.00', porKg: true },
  { clave: 'P018', nombre: 'Agua de horchata', grupo: 'G05', precio: '38.00' },
  { clave: 'P019', nombre: 'Agua de jamaica', grupo: 'G05', precio: '38.00' },
  { clave: 'P020', nombre: 'Refresco', grupo: 'G05', precio: '35.00' },
  {
    clave: 'P021',
    nombre: 'Cerveza nacional',
    grupo: 'G05',
    precio: '55.00',
    precioAlterno: '60.00',
  },
  { clave: 'P022', nombre: 'Margarita', grupo: 'G05', precio: '120.00' },
  { clave: 'P023', nombre: 'Café de olla', grupo: 'G05', precio: '42.00' },
  { clave: 'P024', nombre: 'Flan napolitano', grupo: 'G06', precio: '68.00' },
  { clave: 'P025', nombre: 'Churros con chocolate', grupo: 'G06', precio: '74.50' },
  { clave: 'P026', nombre: 'Pastel de tres leches', grupo: 'G06', precio: '79.00' },
];

export const MODIFICADORES: ReadonlyArray<{ nombre: string; precio: string }> = [
  { nombre: 'Sin cebolla', precio: '0.00' },
  { nombre: 'Término medio', precio: '0.00' },
  { nombre: 'Extra queso', precio: '18.00' },
  { nombre: 'Aguacate extra', precio: '25.00' },
];

export const MESEROS: readonly Mesero[] = [
  { clave: 'M01', nombre: 'Ana López', sucursal: 0 },
  { clave: 'M02', nombre: 'Carlos Ramírez', sucursal: 0 },
  { clave: 'M03', nombre: 'Lucía Hernández', sucursal: 0 },
  { clave: 'M04', nombre: 'Jorge Martínez', sucursal: 0 },
  { clave: 'M05', nombre: 'Sofía García', sucursal: 0 },
  { clave: 'M06', nombre: 'Pedro Sánchez', sucursal: 0, bajaHaceDias: 30 },
  { clave: 'N01', nombre: 'María Torres', sucursal: 1 },
  { clave: 'N02', nombre: 'Luis Flores', sucursal: 1 },
  { clave: 'N03', nombre: 'Fernanda Cruz', sucursal: 1 },
  { clave: 'N04', nombre: 'Diego Morales', sucursal: 1 },
  { clave: 'N05', nombre: 'Raúl Ortiz', sucursal: 1, bajaHaceDias: 20 },
];

const NOMBRES_CLIENTE = [
  'Alejandra Ruiz',
  'Bernardo Castillo',
  'Claudia Mendoza',
  'Daniel Vargas',
  'Elena Reyes',
  'Francisco Jiménez',
  'Gabriela Navarro',
  'Héctor Domínguez',
  'Isabel Romero',
  'Javier Aguilar',
  'Karla Medina',
  'Leonardo Guzmán',
  'Mónica Salazar',
  'Nicolás Herrera',
  'Olivia Estrada',
  'Pablo Ríos',
  'Regina Campos',
  'Santiago Vega',
  'Teresa Molina',
  'Ulises Peña',
];

/** Los RFC de prueba que el SAT publica para sus ambientes de pruebas. */
const RFC_PRUEBA_SAT = ['EKU9003173C9', 'XIA190128J61', 'IIA040805DZ4'];

/** Quita acentos y espacios para armar un correo sintético. */
function usuarioCorreo(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.');
}

export const CLIENTES: readonly Cliente[] = NOMBRES_CLIENTE.map((nombre, i) => ({
  clave: `C${String(i + 1).padStart(3, '0')}`,
  nombre,
  // 555-010-xxxx: prefijo de ficción, no marca a nadie.
  telefono: `555-010-${String(i + 1).padStart(4, '0')}`,
  correo: `${usuarioCorreo(nombre)}@ejemplo.test`,
  rfc: i < RFC_PRUEBA_SAT.length ? RFC_PRUEBA_SAT[i] : null,
}));

export const CANALES: readonly Canal[] = ['comedor', 'mostrador', 'domicilio'];

export const AREAS: readonly Area[] = [
  { nombre: 'Comedor', canal: 'comedor', peso: 55, sucursales: [0, 1] },
  { nombre: 'Terraza', canal: 'comedor', peso: 12, sucursales: [0] },
  { nombre: 'Barra', canal: 'comedor', peso: 8, sucursales: [0, 1] },
  { nombre: 'Mostrador', canal: 'mostrador', peso: 10, sucursales: [0, 1] },
  { nombre: 'Domicilio', canal: 'domicilio', peso: 12, sucursales: [0, 1] },
];

/**
 * Probabilidad de que un cheque llegue SIN área: F2-233 tiene que mostrar la
 * fila "sin clasificar" y nunca repartirla a ojo.
 */
export const PROB_SIN_AREA = 0.03;

export function paridad(indiceSucursal: number): 0 | 1 {
  return (indiceSucursal % 2) as 0 | 1;
}

/** Precio del producto en la sucursal de ese índice. */
export function precioEn(p: Producto, indiceSucursal: number): string {
  return paridad(indiceSucursal) === 1 && p.precioAlterno ? p.precioAlterno : p.precio;
}

export function areasDe(indiceSucursal: number): Area[] {
  return AREAS.filter((a) => a.sucursales.includes(paridad(indiceSucursal)));
}

export function meserosDe(indiceSucursal: number): Mesero[] {
  return MESEROS.filter((m) => m.sucursal === paridad(indiceSucursal));
}

export function nombreGrupo(clave: string): string {
  return GRUPOS_PRODUCTO.find((g) => g.clave === clave)!.nombre;
}
