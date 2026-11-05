import { Module } from '@nestjs/common';

import { leerOnboardingConfig, ONBOARDING_CONFIG } from '../onboarding/onboarding.config';
import { SaludController } from './salud.controller';
import { SistemaController } from './sistema.controller';

/**
 * `GET /sistema` (F2-202) y `GET /health` (F1-002). La config la pone el
 * `AdaptadoresModule` y el `SaludBaseService` el `PrismaModule`, los dos globales.
 * INST-02: la URL de descarga del instalador (`AGENTE_URL_DESCARGA`) se lee con la misma
 * validación que usa el onboarding (https obligatorio; truena al arrancar si es inválida).
 */
@Module({
  controllers: [SistemaController, SaludController],
  providers: [{ provide: ONBOARDING_CONFIG, useFactory: () => leerOnboardingConfig() }],
})
export class SistemaModule {}
