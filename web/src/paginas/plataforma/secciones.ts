import {
  Building2,
  CreditCard,
  History,
  LayoutDashboard,
  Layers,
  Settings,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

/** Las secciones de la barra lateral del panel de plataforma, en orden. */
export interface SeccionPlataforma {
  ruta: string;
  texto: string;
  icono: LucideIcon;
  /** Sólo activa en la ruta exacta (el Tablero, que es el índice). */
  exacta?: boolean;
}

export const SECCIONES_PLATAFORMA: readonly SeccionPlataforma[] = [
  { ruta: '/plataforma', texto: 'Tablero', icono: LayoutDashboard, exacta: true },
  { ruta: '/plataforma/clientes', texto: 'Clientes', icono: Building2 },
  { ruta: '/plataforma/pagos', texto: 'Pagos', icono: CreditCard },
  { ruta: '/plataforma/planes', texto: 'Planes', icono: Layers },
  { ruta: '/plataforma/ajustes', texto: 'Ajustes', icono: Settings },
  { ruta: '/plataforma/administradores', texto: 'Administradores', icono: UsersRound },
  { ruta: '/plataforma/bitacora', texto: 'Bitácora', icono: History },
];
