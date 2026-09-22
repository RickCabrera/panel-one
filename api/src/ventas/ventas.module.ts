import { Module } from '@nestjs/common';

import { AgregadosVentasService } from './agregados-ventas.service';
import { AnalisisService } from './analisis.service';
import { CacheAgregados } from './cache-agregados';
import { TicketsService } from './tickets.service';
import { VentasController } from './ventas.controller';

/** Agregados de ventas (F1-032), sus endpoints de lectura (F1-033) y los desgloses de Análisis (F2-221). */
@Module({
  controllers: [VentasController],
  providers: [AgregadosVentasService, AnalisisService, TicketsService, CacheAgregados],
  exports: [AgregadosVentasService, AnalisisService],
})
export class VentasModule {}
