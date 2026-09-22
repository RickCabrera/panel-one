import { Module } from '@nestjs/common';

import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';

/** Lectura de los catálogos espejo, metadata propia y forzado de sincronización (F2-230). */
@Module({
  controllers: [CatalogosController],
  providers: [CatalogosService],
})
export class CatalogosModule {}
