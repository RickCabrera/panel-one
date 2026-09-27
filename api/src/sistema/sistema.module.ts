import { Module } from '@nestjs/common';

import { SaludController } from './salud.controller';
import { SistemaController } from './sistema.controller';

/**
 * `GET /sistema` (F2-202) y `GET /health` (F1-002). La config la pone el
 * `AdaptadoresModule` y el `SaludBaseService` el `PrismaModule`, los dos globales.
 */
@Module({ controllers: [SistemaController, SaludController] })
export class SistemaModule {}
