import { Module } from '@nestjs/common';

import { AgenteController } from './agente.controller';
import { AgentAuthGuard } from './agente-auth.guard';
import { AgentesAuthService } from './agentes-auth.service';
import { ApiKeyService } from './api-key.service';
import { SucursalApiKeyController } from './sucursal-api-key.controller';

/**
 * Auth de los agentes por API key (F1-012): emitir/rotar la key de una sucursal
 * y autenticar las rutas `@AutenticacionAgente()`. El throttler `agente` se
 * registra en AuthModule, junto al de login.
 */
@Module({
  controllers: [SucursalApiKeyController, AgenteController],
  providers: [AgentesAuthService, AgentAuthGuard, ApiKeyService],
  exports: [AgentesAuthService, AgentAuthGuard],
})
export class AgentesModule {}
