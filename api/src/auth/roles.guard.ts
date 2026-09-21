import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RolUsuario } from '@prisma/client';

import { ROLES } from './decoradores';
import type { RequestAutenticado } from './request-autenticado';

/**
 * Guard GLOBAL de `@Roles()`. Corre después del `JwtAuthGuard`.
 *
 * Un rol insuficiente es 403: depende sólo de la RUTA, no del recurso, así que
 * no dice nada sobre si un dato de otra empresa existe. El cruce entre empresas
 * nunca llega aquí: se resuelve con el scope en el WHERE y termina en 404.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RolUsuario[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }
    const { usuario } = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (!usuario) {
      throw new UnauthorizedException('No autenticado');
    }
    if (!roles.includes(usuario.rol)) {
      throw new ForbiddenException('Rol insuficiente');
    }
    return true;
  }
}
