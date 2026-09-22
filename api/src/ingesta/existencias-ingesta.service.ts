import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { Reloj } from '../comun/reloj';
import { CandadoExistenciasOcupado } from '../scope/escritura-existencias';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { TOLERANCIA_FUTURO_MS } from './dto/catalogos.dto';
import type { FotoExistenciasDto, ResultadoExistenciasDto } from './dto/existencias.dto';
import { decidirFoto, hayCambios, normalizarFoto } from './existencias';
import { esTransitorio } from './ingesta.service';
import { fechaUtc } from './normalizar';

/**
 * La ingesta de existencias (F2-121): la foto completa de UN almacén de la sucursal de la API
 * key. Aquí sólo se valida, se compara y se guarda en Postgres propio.
 *
 * Idempotencia: reenviar la misma foto deja la base EXACTAMENTE igual (ids, `updated_at` y la
 * `recibida_at` de la lectura incluidos). Una foto más vieja que la última aplicada del almacén
 * no escribe nada; con el MISMO `capturadoAt` gana la que llega después (bajo el candado).
 *
 * Errores: un registro inválido se rechaza solo (`rechazados`). Una falla transitoria de la
 * base o el candado ocupado → 503 (reintentar). Una falla determinista → 500 con "no
 * reintentar igual". El log nunca lleva el contenido de la foto.
 */
@Injectable()
export class ExistenciasIngestaService {
  private readonly log = new Logger(ExistenciasIngestaService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async recibir(
    agente: AgenteAutenticado,
    f: FotoExistenciasDto,
  ): Promise<ResultadoExistenciasDto> {
    await this.registrarContacto(agente);
    const ahora = new Date(this.reloj.ahora());
    const capturadoAt = fechaUtc(f.capturadoAt);
    if (capturadoAt.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
      throw new BadRequestException(
        'capturadoAt está más de 5 minutos en el futuro respecto al reloj del API: revisar el ' +
          'reloj de la máquina del agente.',
      );
    }
    const { validos, rechazos } = await normalizarFoto(f.registros);
    const base = {
      recibidos: f.registros.length,
      rechazados: rechazos,
      creados: 0,
      actualizados: 0,
      sinCambios: 0,
      borrados: 0,
      conservados: 0,
      ausentesConservados: false,
    };

    try {
      return await this.datos
        .existenciasDeSucursal(agente)
        .bajoCandado(f.almacenOrigenSrId, async (tx) => {
          const lectura = await tx.lectura();
          if (lectura && capturadoAt < lectura.capturadoAt) {
            // Una foto más nueva de este almacén ya se aplicó: ésta no revierte nada.
            return { ...base, aplicado: false };
          }
          const plan = decidirFoto({ existentes: await tx.existentes(), validos, rechazos });
          await tx.aplicar(plan, ahora);
          // Un reenvío idéntico (mismo instante, nada que cambiar) no mueve ni la lectura.
          if (!lectura || capturadoAt > lectura.capturadoAt || hayCambios(plan)) {
            await tx.guardarLectura({ capturadoAt, recibidaAt: ahora, filas: await tx.contar() });
          }
          return {
            ...base,
            aplicado: true,
            creados: plan.crear.length,
            actualizados: plan.actualizar.length,
            sinCambios: plan.sinCambios,
            borrados: plan.borrar.length,
            conservados: plan.conservados,
            ausentesConservados: plan.ausentesConservados,
          };
        });
    } catch (err) {
      if (err instanceof CandadoExistenciasOcupado || esTransitorio(err)) {
        this.log.warn(
          `existencias de la sucursal ${agente.sucursalId}: falla transitoria (${nombre(err)}).`,
        );
        throw new ServiceUnavailableException(
          'Falla transitoria al guardar las existencias; reenviar más tarde.',
        );
      }
      this.log.error(
        `existencias de la sucursal ${agente.sucursalId} no se guardaron: ${nombre(err)}.`,
      );
      throw new InternalServerErrorException(
        'Las existencias no se pudieron guardar y reenviarlas igual va a fallar igual: no reintentar.',
      );
    }
  }

  /** Si falla se loguea y se sigue, como en `/ingesta/eventos`. */
  private async registrarContacto(agente: AgenteAutenticado): Promise<void> {
    try {
      const ahora = new Date(this.reloj.ahora());
      await this.datos.deSucursal(agente).enTransaccion((ops) => ops.registrarContacto(ahora));
    } catch (err) {
      this.log.error(
        `No se registró el contacto del agente de la sucursal ${agente.sucursalId}: ${nombre(err)}`,
      );
    }
  }
}

/** El nombre y el código del error, nunca su mensaje completo. */
function nombre(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return `${(err as { constructor: { name: string } }).constructor.name} ${String((err as { code: unknown }).code)}`;
  }
  return err instanceof Error ? err.constructor.name : typeof err;
}
