import { Module } from '@nestjs/common';

import { MesasModule } from '../mesas/mesas.module';
import { AgregadosVentasService } from './agregados-ventas.service';
import { AnalisisService } from './analisis.service';
import { AreasVentaService } from './areas-venta.service';
import { CacheAgregados } from './cache-agregados';
import { MeserosEnVivoService } from './meseros-en-vivo.service';
import { TicketsService } from './tickets.service';
import { VentasController } from './ventas.controller';

/** Agregados de ventas (F1-032), sus endpoints de lectura (F1-033) y los desgloses de Análisis (F2-221). */
@Module({
  imports: [MesasModule],
  controllers: [VentasController],
  providers: [
    AgregadosVentasService,
    AnalisisService,
    AreasVentaService,
    TicketsService,
    CacheAgregados,
    MeserosEnVivoService,
  ],
  exports: [AgregadosVentasService, AnalisisService],
})
export class VentasModule {}
