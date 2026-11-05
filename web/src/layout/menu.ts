import {
  ArrowLeftRight,
  Building2,
  Calculator,
  ChartColumn,
  ChefHat,
  ClipboardList,
  Contact,
  FileCheck,
  FileText,
  History,
  GitCompareArrows,
  House,
  LayoutDashboard,
  LayoutGrid,
  MapPinned,
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

/**
 * Las entradas pendientes sin tarea. UI-02 (D-01, decidida por Ricardo el 5-nov-2026) quitó
 * las cuatro que había (Empresas y Sucursales de Principal, Grupos de insumos e Insumos): no
 * llevaban a ninguna vista y sólo hacían ruido. Una entrada pendiente nueva tiene que nombrar
 * su tarea; el test obliga a que esta lista no crezca a escondidas.
 */
export const SIN_TAREA: readonly string[] = [];

/**
 * El mapa del producto (F2-210, compactado en UI-02). Cuando una tarea construye su módulo,
 * su entrada cambia `pendiente` por `destino` (el test de rutas obliga a que la ruta exista).
 *
 * UI-02 quitó lo que no llevaba a nada (las cuatro «Pronto» de SIN_TAREA, incluida la
 * «Sucursales» de Principal, que repetía la de Administración) y mudó «Ventas por canal» a
 * Ventas y dirección: una sección de una sola entrada era puro encabezado.
 */
export const SECCIONES: readonly SeccionMenu[] = [
  {
    id: 'principal',
    titulo: 'Principal',
    entradas: [
      { id: 'principal.inicio', texto: 'Inicio', icono: House, destino: { ruta: '/' } },
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
      // MVP: los turnos de SR (cortes de caja) y lo cobrado en cada uno.
      { id: 'ventas.cortes', texto: 'Cortes', icono: Calculator, destino: { ruta: '/cortes' } },
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
        id: 'canales.ventas',
        texto: 'Ventas por canal',
        icono: Truck,
        destino: { ruta: '/canales' },
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
        id: 'catalogos.meseros',
        texto: 'Meseros',
        icono: UserRound,
        destino: { ruta: '/meseros' },
      },
      {
        // UI-02: los clientes del POS son «Comensales», para no confundirlos con los clientes
        // de la plataforma (/plataforma/clientes). La ruta sigue siendo /clientes.
        id: 'catalogos.clientes',
        texto: 'Comensales',
        icono: Contact,
        destino: { ruta: '/clientes' },
      },
      {
        id: 'catalogos.areas',
        texto: 'Áreas y canales',
        icono: MapPinned,
        destino: { ruta: '/areas' },
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
        destino: { ruta: '/existencias' },
      },
      {
        id: 'inventario.movimientos',
        texto: 'Movimientos y kardex',
        icono: History,
        destino: { ruta: '/movimientos' },
      },
      {
        id: 'inventario.conteos',
        texto: 'Conteos físicos',
        icono: ClipboardList,
        destino: { ruta: '/conteos' },
      },
      {
        id: 'inventario.recetas',
        texto: 'Recetas',
        icono: ChefHat,
        destino: { ruta: '/recetas' },
      },
      {
        id: 'inventario.proyecciones',
        texto: 'Proyecciones',
        icono: TrendingUp,
        destino: { ruta: '/proyecciones' },
      },
      {
        id: 'inventario.compras',
        texto: 'Compras',
        icono: ShoppingCart,
        destino: { ruta: '/compras' },
      },
      {
        id: 'inventario.gastos',
        texto: 'Gastos y utilidad',
        icono: Wallet,
        destino: { ruta: '/gastos' },
      },
      {
        id: 'inventario.traspasos',
        texto: 'Traspasos',
        icono: ArrowLeftRight,
        destino: { ruta: '/traspasos' },
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
        // F2-100: datos fiscales y CSD; F2-106: el tablero, pestaña por defecto de la vista.
        destino: { ruta: '/facturacion' },
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
