import {
  applyDecorators,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UseGuards,
  type CanActivate,
} from '@nestjs/common';

import { PAC_NO_CONECTADO } from '../adaptadores/adaptadores.module';
import { MENSAJE_FACTURACION_NO_CONECTADA } from '../adaptadores/timbrado/timbrado-no-conectado';

/**
 * Corta las rutas que timbran, cancelan o registran un CSD cuando producción corre SIN PAC
 * (`PAC_IMPL=falso` permitido en producción, deploy en Railway): 503 con un mensaje claro, antes
 * de validar el cuerpo, de reservar folio o de escribir nada. Fuera de producción, o con un PAC
 * real, no hace nada (el `TimbradoFalso` de desarrollo sigue simulando).
 *
 * Corre DESPUÉS de los guards globales (token y rol): a quien no puede usar la ruta se le sigue
 * contestando 401/403 como siempre. No distingue empresas: el 503 es igual para todos y no dice
 * nada de ningún recurso.
 */
@Injectable()
export class PacConectadoGuard implements CanActivate {
  constructor(@Inject(PAC_NO_CONECTADO) private readonly noConectado: boolean) {}

  canActivate(): boolean {
    if (this.noConectado) throw new ServiceUnavailableException(MENSAJE_FACTURACION_NO_CONECTADA);
    return true;
  }
}

/** En cada ruta que llama al PAC para timbrar, cancelar o registrar un CSD. */
export const RequierePacConectado = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseGuards(PacConectadoGuard));
