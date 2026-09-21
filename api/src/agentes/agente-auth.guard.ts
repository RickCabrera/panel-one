import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import type { RequestAutenticado } from '../auth/request-autenticado';
import { AgentesAuthService } from './agentes-auth.service';
import { HEADER_API_KEY, hashApiKey } from './api-key';

/**
 * Autentica al agente de una sucursal por `X-Api-Key`. No es global: lo pone
 * `@AutenticacionAgente()` en cada ruta de agente.
 *
 * La sucursal (y su empresa) salen de la KEY, buscada por su hash en cada
 * request y sin caché: una key rotada deja de servir en el request siguiente.
 * Nada que mande el agente en query, body u otros headers decide el tenant.
 *
 * Falta de header, key desconocida, sucursal inactiva o empresa inactiva: 401,
 * todos con el mismo cuerpo.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly auth: AgentesAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    const apiKey = req.headers[HEADER_API_KEY];
    // Exactamente un valor no vacío. Un header repetido llega como arreglo o
    // unido por comas; ninguno de los dos es una key.
    if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.includes(',')) {
      throw noAutenticado();
    }
    const agente = await this.auth.resolverPorHash(hashApiKey(apiKey));
    if (!agente) {
      throw noAutenticado();
    }
    req.agente = agente;
    return true;
  }
}

function noAutenticado(): UnauthorizedException {
  return new UnauthorizedException('No autenticado');
}
