import type { Rol } from '../api/tipos';
import { ROLES_INTERNOS } from './roles';

/**
 * MVP (9-nov-2026, pedido de dirección): las vistas de catálogo e inventario que invitan a
 * modificar el POS desde el panel (cosa que el panel no hace: el usuario SQL es de solo
 * lectura) no las ve ningún usuario cliente (admin_empresa ni visor), sólo el equipo interno.
 *
 * Es un solo interruptor a propósito: el menú (`layout/menu.ts`), las rutas (`App.tsx`) y los
 * enlaces cruzados (Productos → orquestador, Ventas por canal → Áreas) leen de aquí. Para
 * volver a mostrarlas a los clientes basta con ponerlo en `false`. Los tests de cada vista
 * oculta lo apagan con `vi.mock` para seguir probando la vista con los roles de cliente.
 */
export const OCULTAR_A_CLIENTES = true;

/** Si el rol ve las vistas ocultas del MVP. */
export function veVistasOcultas(rol: Rol): boolean {
  return !OCULTAR_A_CLIENTES || ROLES_INTERNOS.includes(rol);
}
