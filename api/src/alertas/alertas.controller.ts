import { Body, Controller, Get, Param, ParseEnumPipe, Put, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario, TipoAlerta } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  AlertasService,
  type AlertaVista,
  type HistorialAlertas,
  type ReglaVista,
} from './alertas.service';
import {
  AlertaDto,
  AlertasQueryDto,
  GuardarReglaDto,
  HistorialAlertasDto,
  HistorialQueryDto,
  ReglaAlertaDto,
  ReglasQueryDto,
} from './dto/alertas.dto';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. ' +
  'Misma respuesta en todos los casos (nunca 403).';

@ApiTags('alertas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@Controller('alertas')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  @Get('abiertas')
  @ApiOperation({
    summary: 'Alertas abiertas del alcance (la campana y el panel leen ESTA lista).',
    description:
      'Sin paginar: su número está acotado por sucursales × cuentas abiertas. Orden: crítica ' +
      'primero, luego la más vieja. Las abre y cierra la evaluación periódica del API ' +
      '(`ALERTAS_INTERVALO_S`, 60 s por defecto) y el cambio de una regla; este GET no escribe.',
  })
  @ApiOkResponse({ type: [AlertaDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  abiertas(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: AlertasQueryDto,
  ): Promise<AlertaVista[]> {
    return this.alertas.abiertas(scope, q.empresaId, q.sucursalId);
  }

  @Get('historial')
  @ApiOperation({
    summary: 'Historial de alertas (abiertas y cerradas), de la más reciente a la más vieja.',
    description:
      'Una alerta que abre y cierra es UNA fila con sus dos marcas. Apagar una regla no borra ' +
      'nada del historial. 50 filas por página.',
  })
  @ApiOkResponse({ type: HistorialAlertasDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  historial(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: HistorialQueryDto,
  ): Promise<HistorialAlertas> {
    return this.alertas.historial(scope, q.empresaId, q.pagina ?? 1, q.sucursalId);
  }

  @Get('reglas')
  @ApiOperation({ summary: 'Las reglas de alerta de la empresa (guardadas o por defecto).' })
  @ApiOkResponse({ type: [ReglaAlertaDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  reglas(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ReglasQueryDto,
  ): Promise<ReglaVista[]> {
    return this.alertas.reglas(scope, q.empresaId);
  }

  @Put('reglas/:tipo')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Enciende, apaga o cambia el umbral de una regla, y recalcula las alertas ya.',
    description:
      'Guarda la regla y, en la misma transacción, recalcula las alertas abiertas de la ' +
      'empresa: con un umbral nuevo cierran las que ya no lo alcanzan (`condicion`) y abren ' +
      'las que sí; apagada, cierra las de su tipo (`regla_apagada`) y deja de abrir. El ' +
      'historial no se borra. Responde todas las reglas.',
  })
  @ApiParam({ name: 'tipo', enum: TipoAlerta, enumName: 'TipoAlerta' })
  @ApiOkResponse({ type: [ReglaAlertaDto] })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Tipo desconocido, cuerpo inválido o umbral fuera del rango de su tipo.',
  })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description:
      'Otra evaluación de la misma empresa tiene el candado y no lo soltó a tiempo. No se ' +
      'guardó nada: reintentar.',
  })
  guardarRegla(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('tipo', new ParseEnumPipe(TipoAlerta)) tipo: TipoAlerta,
    @Body() dto: GuardarReglaDto,
  ): Promise<ReglaVista[]> {
    const { id, rol } = req.usuario!;
    return this.alertas.guardarRegla({ id, rol }, scope, dto.empresaId, tipo, {
      activa: dto.activa,
      umbral: dto.umbral,
    });
  }
}
