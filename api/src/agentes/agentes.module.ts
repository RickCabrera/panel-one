import { Module } from '@nestjs/common';

import { AgenteController } from './agente.controller';
import { AgentAuthGuard } from './agente-auth.guard';
import { AgentesAuthService } from './agentes-auth.service';
import { ApiKeyService } from './api-key.service';
import { EstadoAgentesController } from './estado-agentes.controller';
import { EstadoAgentesService } from './estado-agentes.service';
import { SucursalApiKeyController } from './sucursal-api-key.controller';

/**
 * Auth de los agentes por API key (F1-012): emitir/rotar la key de una sucursal
 * y autenticar las rutas `@AutenticacionAgente()`. El throttler `agente` se
 * registra en AuthModule, junto al de login. El estado de los agentes para el
 * panel (F1-061) también vive aquí.
 */
@Module({
  controllers: [SucursalApiKeyController, AgenteController, EstadoAgentesController],
  providers: [AgentesAuthService, AgentAuthGuard, ApiKeyService, EstadoAgentesService],
  exports: [AgentesAuthService, AgentAuthGuard],
})
export class AgentesModule {}
