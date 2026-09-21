import { Module } from '@nestjs/common';

import { AgregadosVentasService } from './agregados-ventas.service';
import { CacheAgregados } from './cache-agregados';
import { TicketsService } from './tickets.service';
import { VentasController } from './ventas.controller';

/** Agregados de ventas (F1-032) y sus endpoints de lectura (F1-033). */
@Module({
  controllers: [VentasController],
  providers: [AgregadosVentasService, TicketsService, CacheAgregados],
  exports: [AgregadosVentasService],
})
export class VentasModule {}
