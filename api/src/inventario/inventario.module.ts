import { Module } from '@nestjs/common';

import { VentasModule } from '../ventas/ventas.module';
import { ConteosController } from './conteos.controller';
import { ConteosService } from './conteos.service';
import { ExistenciasController } from './existencias.controller';
import { ExistenciasService } from './existencias.service';
import { MovimientosController } from './movimientos.controller';
import { MovimientosService } from './movimientos.service';
import { ProyeccionesController } from './proyecciones.controller';
import { ProyeccionesService } from './proyecciones.service';
import { RecetasController } from './recetas.controller';
import { RecetasService } from './recetas.service';
import { TraspasosController } from './traspasos.controller';
import { TraspasosService } from './traspasos.service';

/**
 * Inventario del panel (Bloque E). F2-121: existencias por almacén y sus límites propios.
 * F2-122: movimientos, pólizas y kardex. F2-123: conteos físicos (dato propio, nunca a SR). F2-124: traspasos (propios, conciliados
 * contra las pólizas de SR).
 * F2-125: recetas y consumo teórico contra el real (lee ventas por el helper de agregados).
 * Exporta `RecetasService`: el estado de resultados de F2-126 reusa su consumo teórico.
 * F2-127: proyección de demanda y sugerido de compra (al vuelo, desde pólizas y existencias).
 */
@Module({
  imports: [VentasModule],
  controllers: [
    ExistenciasController,
    MovimientosController,
    ConteosController,
    TraspasosController,
    RecetasController,
    ProyeccionesController,
  ],
  providers: [
    ExistenciasService,
    MovimientosService,
    ConteosService,
    TraspasosService,
    RecetasService,
    ProyeccionesService,
  ],
  exports: [RecetasService],
})
export class InventarioModule {}
