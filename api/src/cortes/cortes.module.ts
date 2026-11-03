import { Module } from '@nestjs/common';

import { CortesController } from './cortes.controller';
import { CortesService } from './cortes.service';

/** Cortes de caja (turnos de SR) y lo cobrado en cada uno (MVP de cortes). */
@Module({
  controllers: [CortesController],
  providers: [CortesService],
})
export class CortesModule {}
