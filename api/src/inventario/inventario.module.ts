import { Module } from '@nestjs/common';

import { ExistenciasController } from './existencias.controller';
import { ExistenciasService } from './existencias.service';
import { MovimientosController } from './movimientos.controller';
import { MovimientosService } from './movimientos.service';

/**
 * Inventario del panel (Bloque E). F2-121: existencias por almacén y sus límites propios.
 * F2-122: movimientos, pólizas y kardex.
 */
@Module({
  controllers: [ExistenciasController, MovimientosController],
  providers: [ExistenciasService, MovimientosService],
})
export class InventarioModule {}
