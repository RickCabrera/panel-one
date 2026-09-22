import { Module } from '@nestjs/common';

import { InventarioModule } from '../inventario/inventario.module';
import { VentasModule } from '../ventas/ventas.module';
import { ComprasService } from './compras.service';
import { EstadoResultadosService } from './estado-resultados.service';
import { FinanzasController } from './finanzas.controller';
import { GastosService } from './gastos.service';

/**
 * Compras, gastos y utilidad (F2-126): las compras leídas de SR (la ingesta vive en
 * `IngestaModule`), los gastos capturados en el panel y el estado de resultados simple, que reusa
 * el consumo teórico de F2-125 (`RecetasService`) y el helper de agregados de ventas.
 */
@Module({
  imports: [VentasModule, InventarioModule],
  controllers: [FinanzasController],
  providers: [ComprasService, GastosService, EstadoResultadosService],
})
export class FinanzasModule {}
