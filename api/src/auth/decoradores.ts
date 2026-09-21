import { SetMetadata } from '@nestjs/common';
import type { RolUsuario } from '@prisma/client';

export const ES_PUBLICA = 'auth:es-publica';
export const ROLES = 'auth:roles';

/** La ruta no pide access token. Todo lo demás lo pide: el guard es global. */
export const Public = () => SetMetadata(ES_PUBLICA, true);

/** Sólo estos roles entran a la ruta. Sin `@Roles`, basta con estar autenticado. */
export const Roles = (...roles: RolUsuario[]) => SetMetadata(ROLES, roles);
