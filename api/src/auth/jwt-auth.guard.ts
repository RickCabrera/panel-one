import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { esRutaAgente } from '../agentes/decoradores';
import { scopeDeUsuario, type EmpresaScope } from '../scope/empresa-scope';
import { ES_PUBLICA } from './decoradores';
import type { RequestAutenticado } from './request-autenticado';
import { TokensService } from './tokens.service';

/**
 * Guard GLOBAL: toda ruta pide `Authorization: Bearer <access>` salvo las
 * marcadas `@Public()` y las de agente (`@AutenticacionAgente()`, F1-012), que
 * autentica su propio guard con `X-Api-Key`. En ésas no hay usuario ni scope de
 * usuario: un Bearer no las abre.
 *
 * Es también quien inyecta `empresaScope` en el request. El backlog lo llama
 * "middleware", pero en Nest el middleware corre ANTES que los guards y no ve ni
 * el token validado ni la metadata `@Public()`; el único punto donde el usuario
 * ya es confiable es aquí. El scope se deriva del token (rol + empresa firmados
 * por nosotros), nunca de algo que mande el cliente.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const esPublica = this.reflector.getAllAndOverride<boolean>(ES_PUBLICA, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublica || esRutaAgente(this.reflector, ctx)) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    const token = extraerBearer(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('No autenticado');
    }
    const usuario = await this.tokens.verificarAccess(token);
    let scope: EmpresaScope;
    try {
      scope = scopeDeUsuario(usuario);
    } catch {
      throw new UnauthorizedException('No autenticado');
    }
    req.usuario = usuario;
    req.empresaScope = scope;
    return true;
  }
}

function extraerBearer(cabecera: string | undefined): string | null {
  if (!cabecera) {
    return null;
  }
  const [tipo, token, ...resto] = cabecera.split(' ');
  if (tipo !== 'Bearer' || !token || resto.length > 0) {
    return null;
  }
  return token;
}
