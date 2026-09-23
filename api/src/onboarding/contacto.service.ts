import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { PUERTO_CORREO } from '../adaptadores/adaptadores.module';
import type { PuertoCorreo } from '../adaptadores/correo/puerto';
import { plantillaContacto } from './contacto';
import type { ContactoDto } from './dto/onboarding.dto';
import { ONBOARDING_CONFIG, type OnboardingConfig } from './onboarding.config';

const NO_DISPONIBLE = 'Por ahora no pudimos recibir tu mensaje. Intenta de nuevo en unos minutos.';

/**
 * El formulario de contacto de la landing (F2-147). Sale por el `PuertoCorreo` (Brevo en
 * producción, el falso en local) al buzón de `CONTACTO_DESTINO`. No se guarda nada nuestro:
 * lo único que queda es lo que el propio puerto registre.
 */
@Injectable()
export class ContactoService {
  private readonly logger = new Logger(ContactoService.name);

  constructor(
    @Inject(PUERTO_CORREO) private readonly correo: PuertoCorreo,
    @Inject(ONBOARDING_CONFIG) private readonly config: OnboardingConfig,
  ) {}

  async recibir(dto: ContactoDto): Promise<void> {
    // La trampa para bots: se responde igual que un envío bueno y no sale nada.
    if (dto.sitio !== undefined && dto.sitio.trim() !== '') {
      return;
    }
    const destino = this.config.contactoDestino;
    if (destino === null) {
      this.logger.warn('Contacto de la landing sin CONTACTO_DESTINO: se respondió 503.');
      throw new ServiceUnavailableException(NO_DISPONIBLE);
    }
    const { nombre, email, telefono, negocio, sucursales, mensaje } = dto;
    try {
      await this.correo.enviar(
        { email: destino },
        plantillaContacto({ nombre, email, telefono, negocio, sucursales, mensaje }),
        [],
      );
    } catch (error) {
      // Sin datos del visitante en el log: sólo que falló.
      this.logger.error(
        `El correo de contacto no salió: ${error instanceof Error ? error.name : 'error'}`,
      );
      throw new ServiceUnavailableException(NO_DISPONIBLE);
    }
  }
}
