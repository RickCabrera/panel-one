import { Module } from '@nestjs/common';

import { ContactoService } from './contacto.service';
import { leerOnboardingConfig, ONBOARDING_CONFIG } from './onboarding.config';
import { ContactoController, OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding y landing (F2-147): el alta guiada de una empresa, su checklist de arranque y el
 * formulario de contacto público. La config se lee UNA vez al arrancar: un valor mal formado
 * truena aquí, no en la primera petición.
 */
@Module({
  controllers: [OnboardingController, ContactoController],
  providers: [
    OnboardingService,
    ContactoService,
    { provide: ONBOARDING_CONFIG, useFactory: () => leerOnboardingConfig() },
  ],
})
export class OnboardingModule {}
