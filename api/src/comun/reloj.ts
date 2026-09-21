import { Global, Injectable, Module } from '@nestjs/common';

/**
 * La hora del servidor, inyectable. La usan el cache de agregados (F1-033) y la
 * edad de los snapshots de mesas; los tests e2e la reemplazan en la app real
 * (`overrideProvider(Reloj)`) para mover el tiempo sin dormir.
 */
@Injectable()
export class Reloj {
  /** Milisegundos desde epoch, UTC. */
  ahora(): number {
    return Date.now();
  }
}

@Global()
@Module({ providers: [Reloj], exports: [Reloj] })
export class RelojModule {}
