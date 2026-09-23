import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { scopeDeAgente } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { ErrorDto } from '../auth/dto/sesion.dto';
import { ActualizacionAgenteService } from './actualizacion-agente.service';
import { AgenteActual, AutenticacionAgente } from './decoradores';
import { ReporteActualizacionDto, VersionCanalDto } from './dto/actualizacion.dto';
import { AgenteYoDto } from './dto/agentes.dto';

/** Rutas que llama el agente de la sucursal, autenticado con su API key. */
@ApiTags('agente')
@AutenticacionAgente()
@Controller('agente')
export class AgenteController {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly actualizacion: ActualizacionAgenteService,
  ) {}

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

  @Get('version')
  @ApiOperation({
    summary: 'El canal de versiones para la sucursal de la API key (F2-143).',
    description:
      'Sin la actualización automática encendida, o sin versión vigente: `disponible = false`. ' +
      'Con ella: la vigente, su SHA-256, su tamaño y un enlace firmado de 15 min. El api no ' +
      'compara versiones: si la del agente (sin `+commit`) es distinta, el agente actualiza.',
  })
  @ApiOkResponse({ type: VersionCanalDto })
  version(@AgenteActual() agente: AgenteAutenticado): Promise<VersionCanalDto> {
    return this.actualizacion.canal(agente);
  }

  @Post('actualizacion')
  @HttpCode(204)
  @ApiOperation({
    summary: 'El agente reporta el resultado de un intento de auto-actualización (F2-143).',
    description:
      'Upsert por sucursal: reenviar el mismo reporte no cambia nada (la racha de fallas de esa ' +
      'versión se conserva). Una falla de la versión vigente abre la alerta ' +
      '`actualizacion_fallida` pasado su umbral.',
  })
  @ApiNoContentResponse({ description: 'Guardado.' })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Versión que no es X.Y.Z, resultado o motivo desconocido, `motivo` que falta con ' +
      '`fallida` o que sobra con `aplicada`, detalle de más de 500.',
  })
  async reportar(
    @AgenteActual() agente: AgenteAutenticado,
    @Body() dto: ReporteActualizacionDto,
  ): Promise<void> {
    await this.actualizacion.reportar(agente, dto);
  }
}
