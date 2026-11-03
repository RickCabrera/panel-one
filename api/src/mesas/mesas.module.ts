import { Module } from '@nestjs/common';

import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';

/** Mesas abiertas en vivo, del último snapshot de cada sucursal (F1-033). */
@Module({
  controllers: [MesasController],
  providers: [MesasService],
  // La usa Meseros en vivo (`ventas/meseros-en-vivo.service.ts`) para lo que está en curso.
  exports: [MesasService],
})
export class MesasModule {}
