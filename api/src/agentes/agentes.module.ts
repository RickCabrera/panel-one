import { Module } from '@nestjs/common';

import {
  BinarioAgenteController,
  SucursalActualizacionController,
  VersionesAgenteController,
} from './actualizacion-agente.controller';
import { ActualizacionAgenteService } from './actualizacion-agente.service';
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
  controllers: [
    SucursalApiKeyController,
    AgenteController,
    EstadoAgentesController,
    // F2-143: auto-update del agente.
    VersionesAgenteController,
    SucursalActualizacionController,
    BinarioAgenteController,
  ],
  providers: [
    AgentesAuthService,
    AgentAuthGuard,
    ApiKeyService,
    EstadoAgentesService,
    ActualizacionAgenteService,
  ],
  exports: [AgentesAuthService, AgentAuthGuard],
})
export class AgentesModule {}
