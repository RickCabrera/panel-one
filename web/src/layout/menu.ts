import {
  ArrowLeftRight,
  Boxes,
  Building2,
  ChartColumn,
  ChefHat,
  ClipboardList,
  Contact,
  FileCheck,
  FileText,
  GitCompareArrows,
  House,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  ListTree,
  Package,
  Receipt,
  Server,
  ShoppingCart,
  Store,
  TrendingUp,
  Truck,
  UserCog,
  UserRound,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import type { Rol } from '../api/tipos';
import { ROLES_ADMIN } from '../auth/roles';

/** Pestañas de Administración (`?tab=`), las mismas que `Administracion.tsx`. */
export type PestanaAdmin = 'sucursales' | 'usuarios' | 'agentes' | 'alertas' | 'empresas';
const PESTANA_ADMIN_POR_DEFECTO: PestanaAdmin = 'sucursales';
const PESTANAS_ADMIN: readonly string[] = [
  'sucursales',
  'usuarios',
  'agentes',
  'alertas',
  'empresas',
];

/** A dónde lleva una entrada cuyo módulo ya existe. */
export interface Destino {
  ruta: string;
  tab?: PestanaAdmin;
}

/**
 * Por qué una entrada todavía no navega. `tarea` es la del backlog que construye la
 * vista; sólo falta cuando NINGUNA tarea la construye todavía (ver `SIN_TAREA`).
 */
export interface Pendiente {
  tarea?: string;
  razon: string;
}

export interface EntradaMenu {
  id: string;
  texto: string;
  icono: LucideIcon;
  /** Módulo construido. Una entrada tiene `destino` o `pendiente`, nunca los dos. */
  destino?: Destino;
  pendiente?: Pendiente;
  /** Sin `roles` la ve todo el que entra. Ocultar por permiso no es ocultar lo pendiente. */
  roles?: readonly Rol[];
}

export interface SeccionMenu {
  id: string;
  titulo: string;
  entradas: readonly EntradaMenu[];
}

const construye = (tarea: string, detalle = ''): Pendiente => ({
  tarea,
  razon: `Se construye en ${tarea}${detalle}.`,
});

// DECISION ABIERTA (F2-250): ninguna tarea del backlog construye estas vistas. "Empresas" y
// "Sucursales" de Principal son de consulta (la gestión está en Administración), y las de
// insumos no las pinta F2-120, que sólo sincroniza el catálogo. Salen deshabilitadas sin
// inventarles destino, y la cosecha de F2-250 decide si llevan tarea o salen del menú.
const SIN_TAREA_CONSULTA: Pendiente = {
  razon: 'Vista de consulta sin tarea asignada todavía; se decide en el cierre de la Ronda 2.',
};
const SIN_TAREA_INSUMOS: Pendiente = {
  razon:
    'Vista sin tarea asignada todavía: F2-120 sólo sincroniza el catálogo; se decide en el cierre de la Ronda 2.',
};

/** Las únicas entradas pendientes sin tarea. El test obliga a que no crezca a escondidas. */
export const SIN_TAREA: readonly string[] = [
  'principal.empresas',
  'principal.sucursales',
  'catalogos.grupos-insumos',
  'catalogos.insumos',
];

/**
 * El mapa del producto (F2-210), en el orden y con los nombres de la ficha. Cuando una tarea
 * construye su módulo, su entrada cambia `pendiente` por `destino` (el test de rutas obliga a
 * que la ruta exista).
 */
export const SECCIONES: readonly SeccionMenu[] = [
  {
    id: 'principal',
    titulo: 'Principal',
    entradas: [
      { id: 'principal.inicio', texto: 'Inicio', icono: House, destino: { ruta: '/' } },
      {
        id: 'principal.empresas',
        texto: 'Empresas',
        icono: Building2,
        pendiente: SIN_TAREA_CONSULTA,
      },
      {
        id: 'principal.sucursales',
        texto: 'Sucursales',
        icono: Store,
        pendiente: SIN_TAREA_CONSULTA,
      },
      {
        id: 'principal.comparativos',
        texto: 'Comparativos',
        icono: GitCompareArrows,
        destino: { ruta: '/comparativos' },
      },
    ],
  },
  {
    id: 'ventas',
    titulo: 'Ventas y dirección',
    entradas: [
      {
        id: 'ventas.resumen',
        texto: 'Resumen',
        icono: LayoutDashboard,
        destino: { ruta: '/resumen' },
      },
      { id: 'ventas.tickets', texto: 'Tickets', icono: Receipt, destino: { ruta: '/tickets' } },
      {
        id: 'ventas.mesas',
        texto: 'Monitor de mesas',
        icono: LayoutGrid,
        destino: { ruta: '/mesas' },
      },
      {
        id: 'ventas.analisis',
        texto: 'Análisis',
        icono: ChartColumn,
        destino: { ruta: '/analisis' },
      },
      {
        id: 'ventas.reportes',
        texto: 'Reportes',
        icono: FileText,
        destino: { ruta: '/reportes' },
      },
    ],
  },
  {
    id: 'catalogos',
    titulo: 'Catálogos',
    entradas: [
      {
        id: 'catalogos.productos',
        texto: 'Productos',
        icono: Package,
        destino: { ruta: '/productos' },
      },
      {
        id: 'catalogos.orquestador',
        texto: 'Orquestador de menú',
        icono: ListTree,
        destino: { ruta: '/menu' },
      },
      {
        id: 'catalogos.grupos-insumos',
        texto: 'Grupos de insumos',
        icono: Layers,
        pendiente: SIN_TAREA_INSUMOS,
      },
      {
        id: 'catalogos.insumos',
        texto: 'Insumos',
        icono: Boxes,
        pendiente: SIN_TAREA_INSUMOS,
      },
      {
        id: 'catalogos.meseros',
        texto: 'Meseros',
        icono: UserRound,
        destino: { ruta: '/meseros' },
      },
      {
        id: 'catalogos.clientes',
        texto: 'Clientes',
        icono: Contact,
        pendiente: construye('F2-232'),
      },
    ],
  },
  {
    id: 'inventario',
    titulo: 'Inventario y compras',
    entradas: [
      {
        id: 'inventario.existencias',
        texto: 'Existencias',
        icono: Warehouse,
        pendiente: construye('F2-121'),
      },
      {
        id: 'inventario.conteos',
        texto: 'Conteos físicos',
        icono: ClipboardList,
        pendiente: construye('F2-123'),
      },
      {
        id: 'inventario.recetas',
        texto: 'Recetas',
        icono: ChefHat,
        pendiente: construye('F2-125'),
      },
      {
        id: 'inventario.proyecciones',
        texto: 'Proyecciones',
        icono: TrendingUp,
        pendiente: construye('F2-127'),
      },
      {
        id: 'inventario.compras',
        texto: 'Compras',
        icono: ShoppingCart,
        pendiente: construye('F2-126'),
      },
      {
        id: 'inventario.gastos',
        texto: 'Gastos y utilidad',
        icono: Wallet,
        pendiente: construye('F2-126'),
      },
      {
        id: 'inventario.traspasos',
        texto: 'Traspasos',
        icono: ArrowLeftRight,
        pendiente: construye('F2-124'),
      },
    ],
  },
  {
    id: 'canales',
    titulo: 'Canales',
    entradas: [
      {
        id: 'canales.ventas',
        texto: 'Ventas por canal',
        icono: Truck,
        pendiente: construye('F2-144', ', sobre los canales de F2-233'),
      },
    ],
  },
  {
    id: 'administracion',
    titulo: 'Administración',
    entradas: [
      {
        id: 'administracion.sucursales',
        texto: 'Sucursales',
        icono: Store,
        destino: { ruta: '/admin', tab: 'sucursales' },
        roles: ROLES_ADMIN,
      },
      {
        id: 'administracion.usuarios',
        texto: 'Usuarios',
        icono: UserCog,
        destino: { ruta: '/admin', tab: 'usuarios' },
        roles: ROLES_ADMIN,
      },
      {
        id: 'administracion.agentes',
        texto: 'Agentes',
        icono: Server,
        destino: { ruta: '/admin', tab: 'agentes' },
        roles: ROLES_ADMIN,
      },
      {
        // Igual que la pestaña: Empresas es sólo de admin_global.
        id: 'administracion.empresas',
        texto: 'Empresas',
        icono: Building2,
        destino: { ruta: '/admin', tab: 'empresas' },
        roles: ['admin_global'],
      },
      {
        id: 'administracion.facturacion',
        texto: 'Facturación',
        icono: FileCheck,
        pendiente: construye('F2-100', ' (datos fiscales) y F2-106 (dashboard)'),
        roles: ROLES_ADMIN,
      },
    ],
  },
];

/** Las secciones que ve un rol: sin las entradas que no le tocan, y sin secciones vacías. */
export function seccionesPara(rol: Rol): SeccionMenu[] {
  return SECCIONES.map((s) => ({
    ...s,
    entradas: s.entradas.filter((e) => !e.roles || e.roles.includes(rol)),
  })).filter((s) => s.entradas.length > 0);
}

/** `?empresa=&sucursal=` que ya trae el enlace, más la pestaña de Administración si aplica. */
export function searchDestino(destino: Destino, alcance: string): string {
  if (!destino.tab) return alcance;
  const parametros = new URLSearchParams(alcance);
  parametros.set('tab', destino.tab);
  return `?${parametros.toString()}`;
}

/**
 * Si la entrada es la vista actual. En `/admin` cuenta también la pestaña (sin `tab`, o
 * con uno que no existe, Administración abre Sucursales): si no, las cuatro entradas de
 * Administración saldrían activas a la vez.
 */
export function entradaActiva(
  entrada: EntradaMenu,
  pathname: string,
  parametros: URLSearchParams,
): boolean {
  const destino = entrada.destino;
  if (!destino) return false;
  const enRuta =
    destino.ruta === '/'
      ? pathname === '/'
      : pathname === destino.ruta || pathname.startsWith(`${destino.ruta}/`);
  if (!enRuta || !destino.tab) return enRuta;
  const pedida = parametros.get('tab');
  const actual = pedida && PESTANAS_ADMIN.includes(pedida) ? pedida : PESTANA_ADMIN_POR_DEFECTO;
  return actual === destino.tab;
}

const IDS_SECCION = new Set(SECCIONES.map((s) => s.id));
const clave = (usuarioId: string) => `monitor.menu.colapsadas.${usuarioId}`;

/**
 * Secciones que el usuario dejó colapsadas. Es una comodidad por navegador y por usuario:
 * si el storage no está (modo privado, bloqueado) o trae basura, el menú sale abierto.
 */
export function leerColapsadas(usuarioId: string): string[] {
  try {
    const crudo = window.localStorage.getItem(clave(usuarioId));
    if (!crudo) return [];
    const valor: unknown = JSON.parse(crudo);
    if (!Array.isArray(valor)) return [];
    return valor.filter((id): id is string => typeof id === 'string' && IDS_SECCION.has(id));
  } catch {
    return [];
  }
}

export function guardarColapsadas(usuarioId: string, ids: readonly string[]): void {
  try {
    window.localStorage.setItem(clave(usuarioId), JSON.stringify(ids));
  } catch {
    // Sin storage el colapso dura lo que la pestaña; no es motivo para romper el menú.
  }
}
