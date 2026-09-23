import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  AltaPaqueteFoliosDto,
  ConfiguracionFoliosDto,
  FoliosDto,
  PaqueteCreadoDto,
  ReporteFoliosDto,
  ReporteFoliosQueryDto,
} from './dto/folios.dto';
import { FoliosService } from './folios.service';

/**
 * Control de folios del PAC (F2-110). Rutas de PLATAFORMA: el saldo es el de la cuenta de
 * Facturama y los paquetes los compra el admin_global, así que sólo él entra. Los demás roles
 * reciben 403 POR LA RUTA (como el alta de empresas de F1-060): no es la regla de "404 para datos
 * de otra empresa", porque aquí no hay recurso de ninguna empresa que se pudiera confirmar.
 */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiForbiddenResponse({
  type: ErrorDto,
  description: 'No es admin_global (la ruta es de la plataforma, no de una empresa).',
})
@Roles(RolUsuario.admin_global)
@Controller('facturacion/folios')
export class FoliosController {
  constructor(private readonly folios: FoliosService) {}

  @Get()
  @ApiOperation({
    summary: 'Saldo de folios del PAC, sus paquetes y el consumo por empresa (F2-110).',
    description:
      'Consume un folio cada CFDI vigente o cancelado (ticket, sin ticket, global, sustituto) y ' +
      'cada reserva en emisión. Asignación FIFO por vencimiento; un paquete vence 12 meses después ' +
      'de su compra. Sin ningún paquete registrado, `control = false` y la emisión no se limita.',
  })
  @ApiOkResponse({ type: FoliosDto })
  estado(@EmpresaScopeActual() scope: EmpresaScope): Promise<FoliosDto> {
    return this.folios.estado(scope);
  }

  @Post('paquetes')
  @ApiOperation({
    summary: 'Registra un paquete de folios comprado al PAC (F2-110).',
    description: 'Prende el control de folios (y ya no se apaga solo).',
  })
  @ApiCreatedResponse({ type: PaqueteCreadoDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Cantidad fuera de 1–1,000,000, fecha inválida o futura, nota de más de 200.',
  })
  alta(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: AltaPaqueteFoliosDto,
  ): Promise<PaqueteCreadoDto> {
    const u = req.usuario!;
    return this.folios.altaPaquete(scope, { id: u.id, rol: u.rol }, dto);
  }

  @Delete('paquetes/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra un paquete que todavía no tiene timbres asignados (F2-110).' })
  @ApiNoContentResponse({ description: 'Borrado.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'No existe.' })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'Ya tiene timbres asignados: borrarlo reescribiría el historial del saldo.',
  })
  async baja(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const u = req.usuario!;
    await this.folios.bajaPaquete(scope, { id: u.id, rol: u.rol }, id);
  }

  @Put('configuracion')
  @ApiOperation({
    summary: 'Umbral de aviso del saldo de folios, en % de lo vigente (F2-110). Default 20.',
  })
  @ApiOkResponse({ type: FoliosDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Umbral fuera de 1–100.' })
  configurar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: ConfiguracionFoliosDto,
  ): Promise<FoliosDto> {
    const u = req.usuario!;
    return this.folios.guardarUmbral(scope, { id: u.id, rol: u.rol }, dto.umbralPct);
  }

  @Get('reporte')
  @ApiOperation({
    summary: 'Timbres por empresa y mes: la base del recobro en la anualidad (F2-110).',
    description:
      'CFDI vigentes + cancelados por su fecha de timbrado, con el MES en la zona de la sucursal ' +
      'que emitió. Una fila por empresa y mes con timbres; `totales` trae todos los meses del rango.',
  })
  @ApiOkResponse({ type: ReporteFoliosDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Meses mal formados, al revés o > 24.' })
  reporte(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ReporteFoliosQueryDto,
  ): Promise<ReporteFoliosDto> {
    return this.folios.reporte(scope, q.desde, q.hasta);
  }
}
