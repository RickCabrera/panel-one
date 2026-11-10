import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

/**
 * MVP (9-nov-2026, pedido de dirección): las vistas de catálogo e inventario que invitan a
 * modificar el POS desde el panel (Orquestador de menú, Comensales, Áreas y canales y toda
 * Inventario y compras) no las ve ningún usuario cliente. El web las oculta con su propio
 * interruptor (`web/src/auth/mvp.ts`); aquí se cierra lo mismo del lado del servidor, para que
 * un cliente con token tampoco las pueda leer ni escribir con curl.
 *
 * Un solo interruptor: con `false`, `@SoloInterno()` no hace nada y todo vuelve a como estaba.
 * Los e2e de cada vista lo apagan con `jest.mock` para seguir probando la vista con los roles de
 * cliente; lo cerrado se prueba aparte en `mvp.e2e.spec.ts`.
 */
export const OCULTAR_A_CLIENTES = true;

/** El equipo interno (nosotros). Ve también lo cerrado del MVP. */
export const ROLES_INTERNOS: readonly RolUsuario[] = [RolUsuario.admin_global];

export const SOLO_INTERNO = 'auth:solo-interno';

/**
 * La ruta (o el controlador entero) es del equipo interno mientras dure el MVP. A cualquier otro
 * rol le responde 404 con el cuerpo de una ruta inexistente, no 403: igual que el web («No
 * encontrada»), no se confirma que exista. Lo
 * aplica el `RolesGuard` global; en el contrato queda marcado como `x-solo-interno-mvp`.
 */
export const SoloInterno = () =>
  applyDecorators(SetMetadata(SOLO_INTERNO, true), ApiExtension('x-solo-interno-mvp', true));
