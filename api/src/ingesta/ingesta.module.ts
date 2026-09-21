import { Module } from '@nestjs/common';

import { AgentesModule } from '../agentes/agentes.module';
import { IngestaController } from './ingesta.controller';
import { IngestaService } from './ingesta.service';

/** `POST /ingesta/eventos` (F1-031): la única frontera entre el agente y el api. */
@Module({
  imports: [AgentesModule],
  controllers: [IngestaController],
  providers: [IngestaService],
})
export class IngestaModule {}
