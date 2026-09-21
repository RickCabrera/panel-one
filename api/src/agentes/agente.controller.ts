import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { scopeDeAgente } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgenteActual, AutenticacionAgente } from './decoradores';
import { AgenteYoDto } from './dto/agentes.dto';

/** Rutas que llama el agente de la sucursal, autenticado con su API key. */
@ApiTags('agente')
@AutenticacionAgente()
@Controller('agente')
export class AgenteController {
  constructor(private readonly datos: ScopedPrismaService) {}

  @Get('yo')
  @ApiOperation({
    summary: 'La sucursal a la que pertenece la API key. Sirve al agente para verificar su key.',
  })
  @ApiOkResponse({ type: AgenteYoDto })
  async yo(@AgenteActual() agente: AgenteAutenticado): Promise<AgenteYoDto> {
    const sucursal = encontradoOr404(
      await this.datos.para(scopeDeAgente(agente)).sucursal.findFirst({
        where: { id: agente.sucursalId },
        select: { id: true, nombre: true, zonaHoraria: true },
      }),
    );
    return { sucursalId: sucursal.id, nombre: sucursal.nombre, zonaHoraria: sucursal.zonaHoraria };
  }
}
