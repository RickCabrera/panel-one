import type { Rol } from '../api/tipos';

/** Quién ve Administración. El visor no. */
export const ROLES_ADMIN: readonly Rol[] = ['admin_global', 'admin_empresa'];

export const NOMBRE_ROL: Record<Rol, string> = {
  admin_global: 'Administrador global',
  admin_empresa: 'Administrador',
  visor: 'Visor',
};
