import { Module } from '@nestjs/common';

import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';

/** Mesas abiertas en vivo, del último snapshot de cada sucursal (F1-033). */
@Module({
  controllers: [MesasController],
  providers: [MesasService],
})
export class MesasModule {}
