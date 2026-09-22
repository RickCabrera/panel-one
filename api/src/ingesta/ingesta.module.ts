import { Module } from '@nestjs/common';

import { AgentesModule } from '../agentes/agentes.module';
import { CatalogosIngestaController } from './catalogos-ingesta.controller';
import { CatalogosIngestaService } from './catalogos-ingesta.service';
import { ExistenciasIngestaController } from './existencias-ingesta.controller';
import { ExistenciasIngestaService } from './existencias-ingesta.service';
import { MovimientosIngestaController } from './movimientos-ingesta.controller';
import { MovimientosIngestaService } from './movimientos-ingesta.service';
import { ComprasIngestaController } from './compras-ingesta.controller';
import { ComprasIngestaService } from './compras-ingesta.service';
import { RecetasIngestaController } from './recetas-ingesta.controller';
import { RecetasIngestaService } from './recetas-ingesta.service';
import { IngestaController } from './ingesta.controller';
import { IngestaService } from './ingesta.service';

/**
 * La frontera entre el agente y el api: `POST /ingesta/eventos` (F1-031), la ingesta de
 * catálogos `/ingesta/catalogos*` (F2-230), la de existencias `/ingesta/existencias` (F2-121) y
 * la de movimientos `/ingesta/movimientos` (F2-122), la de recetas `/ingesta/recetas` (F2-125) y
 * la de compras `/ingesta/compras` (F2-126).
 */
@Module({
  imports: [AgentesModule],
  controllers: [
    IngestaController,
    CatalogosIngestaController,
    ExistenciasIngestaController,
    MovimientosIngestaController,
    RecetasIngestaController,
    ComprasIngestaController,
  ],
  providers: [
    IngestaService,
    CatalogosIngestaService,
    ExistenciasIngestaService,
    MovimientosIngestaService,
    RecetasIngestaService,
    ComprasIngestaService,
  ],
})
export class IngestaModule {}
