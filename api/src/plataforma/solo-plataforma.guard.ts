import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { RolUsuario } from '@prisma/client';

import type { RequestAutenticado } from '../auth/request-autenticado';

/**
 * El panel de plataforma es SÓLO para admin_global (nosotros). A cualquier otro rol la ruta le
 * responde 404 —el mismo cuerpo que una ruta que no existe—, no el 403 del `RolesGuard`: un 403
 * confirmaría que la ruta existe. Corre después del `JwtAuthGuard` global (sin token = 401, como
 * en todas las rutas).
 */
@Injectable()
export class SoloPlataformaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (!req.usuario) throw new UnauthorizedException('No autenticado');
    if (req.usuario.rol !== RolUsuario.admin_global || req.empresaScope?.tipo !== 'global') {
      // El mismo mensaje que el 404 de Nest para una ruta inexistente (`routes-resolver`).
      throw new NotFoundException(`Cannot ${req.method} ${req.originalUrl}`);
    }
    return true;
  }
}
