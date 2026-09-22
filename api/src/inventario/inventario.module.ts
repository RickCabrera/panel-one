import { Module } from '@nestjs/common';

import { ConteosController } from './conteos.controller';
import { ConteosService } from './conteos.service';
import { ExistenciasController } from './existencias.controller';
import { ExistenciasService } from './existencias.service';
import { MovimientosController } from './movimientos.controller';
import { MovimientosService } from './movimientos.service';
import { TraspasosController } from './traspasos.controller';
import { TraspasosService } from './traspasos.service';

/**
 * Inventario del panel (Bloque E). F2-121: existencias por almacén y sus límites propios.
 * F2-122: movimientos, pólizas y kardex. F2-123: conteos físicos (dato propio, nunca a SR). F2-124: traspasos (propios, conciliados
 * contra las pólizas de SR).
 */
@Module({
  controllers: [
    ExistenciasController,
    MovimientosController,
    ConteosController,
    TraspasosController,
  ],
  providers: [ExistenciasService, MovimientosService, ConteosService, TraspasosService],
})
export class InventarioModule {}
