import { Module } from '@nestjs/common';

import { SistemaController } from './sistema.controller';

/** `GET /sistema` (F2-202). La config la pone el `AdaptadoresModule`, que es global. */
@Module({ controllers: [SistemaController] })
export class SistemaModule {}
