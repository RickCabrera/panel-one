import { Module } from '@nestjs/common';

import { VentasModule } from '../ventas/ventas.module';
import { AlertasController } from './alertas.controller';
import { AlertasService } from './alertas.service';
import { AlertasProgramador } from './programador';

/** Centro de alertas (F2-224): reglas por empresa, evaluación periódica y lectura. */
@Module({
  imports: [VentasModule],
  controllers: [AlertasController],
  providers: [AlertasService, AlertasProgramador],
  exports: [AlertasService, AlertasProgramador],
})
export class AlertasModule {}
