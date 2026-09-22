import { Module } from '@nestjs/common';

import { VentasModule } from '../ventas/ventas.module';
import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';

/**
 * Lectura de los catálogos espejo, metadata propia y forzado de sincronización (F2-230), y el
 * orquestador de menú (F2-145), que cruza lo vendido con los agregados de ventas.
 */
@Module({
  imports: [VentasModule],
  controllers: [CatalogosController],
  providers: [CatalogosService],
})
export class CatalogosModule {}
