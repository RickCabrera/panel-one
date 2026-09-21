import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { RequestAutenticado } from '../auth/request-autenticado';
import type { EmpresaScope } from './empresa-scope';

/**
 * El scope del usuario autenticado, tal como lo dejó el `JwtAuthGuard`. En una
 * ruta `@Public()` no hay scope: usar este decorador ahí es un error de
 * programación y truena, en vez de devolver "sin filtro".
 */
export const EmpresaScopeActual = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext): EmpresaScope => {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (!req.empresaScope) {
      throw new Error('EmpresaScopeActual usado en una ruta sin usuario autenticado.');
    }
    return req.empresaScope;
  },
);
