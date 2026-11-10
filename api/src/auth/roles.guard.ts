import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RolUsuario } from '@prisma/client';

import { ROLES } from './decoradores';
import { OCULTAR_A_CLIENTES, ROLES_INTERNOS, SOLO_INTERNO } from './mvp';
import type { RequestAutenticado } from './request-autenticado';

/**
 * Guard GLOBAL de `@Roles()`. Corre después del `JwtAuthGuard`.
 *
 * Un rol insuficiente es 403: depende sólo de la RUTA, no del recurso, así que
 * no dice nada sobre si un dato de otra empresa existe. El cruce entre empresas
 * nunca llega aquí: se resuelve con el scope en el WHERE y termina en 404.
 *
 * También aplica `@SoloInterno()` (MVP, ver `mvp.ts`): a quien no es del equipo interno le
 * responde 404 ANTES de mirar `@Roles`, para que ni un 403 confirme que la ruta existe.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const soloInterno = this.reflector.getAllAndOverride<boolean | undefined>(SOLO_INTERNO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (soloInterno && OCULTAR_A_CLIENTES) {
      const { usuario } = ctx.switchToHttp().getRequest<RequestAutenticado>();
      if (!usuario) {
        throw new UnauthorizedException('No autenticado');
      }
      if (!ROLES_INTERNOS.includes(usuario.rol)) {
        throw new NotFoundException('Recurso no encontrado');
      }
    }
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
