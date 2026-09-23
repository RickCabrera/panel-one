import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RolUsuario } from '@prisma/client';

import { Public, Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_CONTACTO, THROTTLER_CONTACTO_HORA } from '../auth/throttlers';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ContactoService } from './contacto.service';
import {
  AltaGuiadaDto,
  AltaGuiadaRespuestaDto,
  ArranqueDto,
  ContactoDto,
  ContactoRecibidoDto,
} from './dto/onboarding.dto';
import { OnboardingService } from './onboarding.service';

const DESC_401 = 'Sin token, token inválido o vencido.';

/** El alta guiada y el checklist de arranque (F2-147). Conviven con `/empresas` de F1-060. */
@ApiTags('onboarding')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
@Controller('empresas')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('alta-guiada')
  @Roles(RolUsuario.admin_global)
  @HttpCode(201)
  // Las keys en claro no se quedan en ninguna caché intermedia.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Alta guiada: empresa + sucursales con su API key + primer admin, en un solo paso.',
    description:
      'Sólo admin_global. Todo en UNA transacción: si algo falla (p. ej. el email del ' +
      'administrador ya existe) no queda nada creado. Las API keys vienen en claro UNA sola ' +
      'vez; la contraseña del administrador NO vuelve.',
  })
  @ApiCreatedResponse({ type: AltaGuiadaRespuestaDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Cuerpo inválido, zona que no es IANA, o dos sucursales con el mismo nombre.',
  })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol distinto de admin_global.' })
  @ApiConflictResponse({ type: ErrorDto, description: 'El email del administrador ya existe.' })
  altaGuiada(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: AltaGuiadaDto,
  ): Promise<AltaGuiadaRespuestaDto> {
    const { id, rol } = req.usuario!;
    return this.onboarding.altaGuiada({ id, rol }, scope, dto);
  }

  @Get(':id/arranque')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Checklist de arranque de la empresa: qué falta para que el panel reciba datos.',
    description:
      'Se deduce de lo que ya hay (sucursales activas, sus keys, si su agente se reportó, si ' +
      'llegó alguna cuenta, y si hay un admin_empresa activo); no se guarda aparte.',
  })
  @ApiOkResponse({ type: ArranqueDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: '`id` no es un UUID.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor), por ruta.' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'No existe o es de otra empresa. Misma respuesta en los dos casos (nunca 403).',
  })
  arranque(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ArranqueDto> {
    return this.onboarding.arranque(scope, id);
  }
}

/** El formulario de contacto de la landing (F2-147): SIN sesión, con su propio límite por IP. */
@ApiTags('publico')
@Controller('publico')
export class ContactoController {
  constructor(private readonly contacto: ContactoService) {}

  @Post('contacto')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_CONTACTO, THROTTLER_CONTACTO_HORA)
  @HttpCode(202)
  @ApiOperation({
    summary: 'Mensaje del formulario de contacto de la landing; sale por correo al negocio.',
    description:
      'Pública: 3 por minuto y 20 por hora por IP. No guarda nada en la base. El campo ' +
      '`sitio` es una trampa para bots: con algo, responde 202 y no manda nada.',
  })
  @ApiAcceptedResponse({ type: ContactoRecibidoDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Cuerpo inválido.' })
  @ApiTooManyRequestsResponse({ description: 'Más de 3 por minuto o 20 por hora por IP.' })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description: 'El correo no salió (o el servidor no tiene buzón de contacto). Reintentable.',
  })
  async enviar(@Body() dto: ContactoDto): Promise<ContactoRecibidoDto> {
    await this.contacto.recibir(dto);
    return { recibido: true };
  }
}
