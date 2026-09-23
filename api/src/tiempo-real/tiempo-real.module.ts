import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AvisosTiempoReal } from './avisos';
import { TiempoRealGateway } from './tiempo-real.gateway';

/**
 * El socket del monitor de mesas (F2-142). Exporta `AvisosTiempoReal`, que la ingesta llama
 * al terminar un lote.
 */
@Module({
  imports: [AuthModule],
  providers: [TiempoRealGateway, { provide: AvisosTiempoReal, useExisting: TiempoRealGateway }],
  exports: [AvisosTiempoReal],
})
export class TiempoRealModule {}
