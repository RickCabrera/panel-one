import { Injectable } from '@nestjs/common';

// En la allowlist de PrismaService (eslint.config.mjs), igual que el login: la
// búsqueda por API key ocurre ANTES de saber de qué sucursal/empresa es el
// request, así que no hay scope que aplicar. Este servicio sólo tiene esa lectura.
import { PrismaService } from '../prisma/prisma.service';
import type { AgenteAutenticado } from '../auth/request-autenticado';

@Injectable()
export class AgentesAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La sucursal dueña de ese hash, sólo si ella Y su empresa están activas.
   * Cualquier otro caso es `null`, sin distinguir cuál: el guard responde lo
   * mismo a una key inventada que a una de una sucursal dada de baja.
   */
  async resolverPorHash(apiKeyHash: string): Promise<AgenteAutenticado | null> {
    const sucursal = await this.prisma.sucursal.findUnique({
      where: { apiKeyHash },
      select: { id: true, empresaId: true, activo: true, empresa: { select: { activo: true } } },
    });
    if (!sucursal || !sucursal.activo || !sucursal.empresa.activo) {
      return null;
    }
    return { sucursalId: sucursal.id, empresaId: sucursal.empresaId };
  }
}
