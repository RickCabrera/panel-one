import { Module } from '@nestjs/common';

import { AgregadosVentasService } from './agregados-ventas.service';

/** Agregados de ventas (F1-032). Los controllers de lectura llegan con F1-033. */
@Module({
  providers: [AgregadosVentasService],
  exports: [AgregadosVentasService],
})
export class VentasModule {}
