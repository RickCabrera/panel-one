import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ApiSecurity, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { ErrorDto } from '../auth/dto/sesion.dto';
import type { AgenteAutenticado, RequestAutenticado } from '../auth/request-autenticado';
import { AgentAuthGuard } from './agente-auth.guard';

/** Nombre del esquema de seguridad `X-Api-Key` en el contrato OpenAPI. */
export const SEGURIDAD_AGENTE = 'agente';

// Sin exportar a propósito: la única forma de marcar una ruta como "de agente"
// es `@AutenticacionAgente()`, que trae el guard pegado. Un SetMetadata suelto
// dejaría una ruta sin Bearer y sin API key.
const ES_RUTA_AGENTE = 'agentes:es-ruta-agente';

/**
 * La ruta la llama el agente de una sucursal con `X-Api-Key`, no un usuario:
 * el `JwtAuthGuard` global no le pide Bearer, la autentica el `AgentAuthGuard`
 * y le aplica el rate limit de 120/min por sucursal (no el de login).
 */
export const AutenticacionAgente = () =>
  applyDecorators(
    SetMetadata(ES_RUTA_AGENTE, true),
    SkipThrottle({ login: true }),
    // En este orden: primero quién es la sucursal, luego se cuenta a ella.
    UseGuards(AgentAuthGuard, ThrottlerGuard),
    ApiSecurity(SEGURIDAD_AGENTE),
    ApiUnauthorizedResponse({
      type: ErrorDto,
      description:
        'Sin `X-Api-Key`, key desconocida o rotada, o sucursal/empresa inactiva. Mismo cuerpo.',
    }),
    ApiTooManyRequestsResponse({
      description: 'Más de 120 requests por minuto de la misma sucursal.',
    }),
  );

/** Para el `JwtAuthGuard`: la ruta es de agente y no lleva sesión de usuario. */
export function esRutaAgente(reflector: Reflector, ctx: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(ES_RUTA_AGENTE, [ctx.getHandler(), ctx.getClass()]) ===
    true
  );
}

/**
 * El agente que dejó el `AgentAuthGuard`. Usarlo en una ruta sin
 * `@AutenticacionAgente()` es un error de programación y truena.
 */
export const AgenteActual = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext): AgenteAutenticado => {
    const req = ctx.switchToHttp().getRequest<RequestAutenticado>();
    if (!req.agente) {
      throw new Error('AgenteActual usado en una ruta sin @AutenticacionAgente().');
    }
    return req.agente;
  },
);
