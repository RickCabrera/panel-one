import { Module } from '@nestjs/common';

import { ConteosController } from './conteos.controller';
import { ConteosService } from './conteos.service';
import { ExistenciasController } from './existencias.controller';
import { ExistenciasService } from './existencias.service';
import { MovimientosController } from './movimientos.controller';
import { MovimientosService } from './movimientos.service';

/**
 * Inventario del panel (Bloque E). F2-121: existencias por almacén y sus límites propios.
 * F2-122: movimientos, pólizas y kardex. F2-123: conteos físicos (dato propio, nunca a SR).
 */
@Module({
  controllers: [ExistenciasController, MovimientosController, ConteosController],
  providers: [ExistenciasService, MovimientosService, ConteosService],
})
export class InventarioModule {}
