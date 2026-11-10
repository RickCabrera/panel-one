import type { Rol } from '../api/tipos';

/** Quién ve Administración. El visor no. */
export const ROLES_ADMIN: readonly Rol[] = ['admin_global', 'admin_empresa'];

/** El equipo interno (nosotros). Ve también las vistas ocultas del MVP (ver `mvp.ts`). */
export const ROLES_INTERNOS: readonly Rol[] = ['admin_global'];

export const NOMBRE_ROL: Record<Rol, string> = {
  admin_global: 'Administrador global',
  admin_empresa: 'Administrador',
  visor: 'Visor',
};
