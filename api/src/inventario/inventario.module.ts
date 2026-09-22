import { Module } from '@nestjs/common';

import { ExistenciasController } from './existencias.controller';
import { ExistenciasService } from './existencias.service';

/** Inventario del panel (Bloque E). F2-121: existencias por almacén y sus límites propios. */
@Module({
  controllers: [ExistenciasController],
  providers: [ExistenciasService],
})
export class InventarioModule {}
