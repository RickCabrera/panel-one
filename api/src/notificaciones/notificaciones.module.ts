import { Module } from '@nestjs/common';

import { VentasModule } from '../ventas/ventas.module';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesProgramador } from './programador';

/**
 * Notificaciones push de la PWA (F2-146): preferencias y navegadores propios, el push de
 * las alertas que abren (lo llama `AlertasService`), el de folios bajo (lo llama
 * `FoliosService`) y el resumen de cierre del día (programador propio).
 */
@Module({
  imports: [VentasModule],
  controllers: [NotificacionesController],
  providers: [NotificacionesService, NotificacionesProgramador],
  exports: [NotificacionesService, NotificacionesProgramador],
})
export class NotificacionesModule {}
