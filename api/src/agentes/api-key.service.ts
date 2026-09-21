import { Injectable } from '@nestjs/common';

import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { generarApiKey, hashApiKey } from './api-key';
import type { ApiKeyEmitidaDto } from './dto/agentes.dto';

/** La key emitida más la empresa de la sucursal, para la auditoría (F1-060). */
export interface ApiKeyRotada extends ApiKeyEmitidaDto {
  empresaId: string;
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly datos: ScopedPrismaService) {}

  /**
   * Genera la key de una sucursal, o la rota si ya tenía una: es la misma
   * operación. Una sola sentencia sobrescribe el hash, así que la key anterior
   * deja de existir en la base en ese instante.
   *
   * Va por el helper de scope: una sucursal de otra empresa da `count 0` y eso
   * es 404, igual que una que no existe.
   */
  async rotar(scope: EmpresaScope, sucursalId: string): Promise<ApiKeyRotada> {
    const apiKey = generarApiKey();
    const datos = this.datos.para(scope);
    const { count } = await datos.sucursal.updateMany({
      where: { id: sucursalId },
      data: { apiKeyHash: hashApiKey(apiKey) },
    });
    encontradoOr404(count === 1 ? count : null);
    // La empresa, sólo para la auditoría. Misma lectura con scope: la sucursal
    // que se acaba de escribir está en alcance.
    const { empresaId } = encontradoOr404(
      await datos.sucursal.findFirst({ where: { id: sucursalId }, select: { empresaId: true } }),
    );
    return { sucursalId, apiKey, empresaId };
  }
}
