import { createHash } from 'node:crypto';

import type { ThrottlerOptions } from '@nestjs/throttler';

import type { RequestAutenticado } from '../auth/request-autenticado';

export const THROTTLER_AGENTE = 'agente';

/**
 * Rate limit de los agentes: 120 requests por minuto POR SUCURSAL, sumando
 * todas las rutas de agente (la librería, por defecto, cuenta por ruta y por
 * IP). Se registra en el `ThrottlerModule.forRoot` de AuthModule.
 *
 * Sólo tiene sentido después del `AgentAuthGuard`: `@AutenticacionAgente()`
 * pone el ThrottlerGuard DETRÁS de él. Sin agente en el request, truena en vez
 * de contar por algo que no es la sucursal.
 */
export const OPCIONES_THROTTLER_AGENTE: ThrottlerOptions = {
  name: THROTTLER_AGENTE,
  ttl: 60_000,
  limit: 120,
  getTracker: (req) => {
    const { agente } = req as RequestAutenticado;
    if (!agente) {
      throw new Error('Throttler de agente en una ruta sin AgentAuthGuard delante.');
    }
    return agente.sucursalId;
  },
  generateKey: (_ctx, sucursalId, nombre) =>
    createHash('sha256').update(`${nombre}-${sucursalId}`).digest('hex'),
};
