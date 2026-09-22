import { Module } from '@nestjs/common';

import { AgentesModule } from '../agentes/agentes.module';
import { CatalogosIngestaController } from './catalogos-ingesta.controller';
import { CatalogosIngestaService } from './catalogos-ingesta.service';
import { IngestaController } from './ingesta.controller';
import { IngestaService } from './ingesta.service';

/**
 * La frontera entre el agente y el api: `POST /ingesta/eventos` (F1-031) y la ingesta de
 * catálogos `/ingesta/catalogos*` (F2-230).
 */
@Module({
  imports: [AgentesModule],
  controllers: [IngestaController, CatalogosIngestaController],
  providers: [IngestaService, CatalogosIngestaService],
})
export class IngestaModule {}
