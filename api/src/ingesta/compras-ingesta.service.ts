import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { Reloj } from '../comun/reloj';
import { CandadoComprasOcupado } from '../scope/escritura-compras';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { TOLERANCIA_FUTURO_MS } from './dto/catalogos.dto';
import {
  MAX_PARTIDAS_COMPRAS_LOTE,
  type LoteComprasDto,
  type ResultadoComprasDto,
} from './dto/compras.dto';
import { esTransitorio } from './ingesta.service';
import { decidirCompra, normalizarLoteCompras, partidasDeCompras } from './compras';
import { fechaUtc } from './normalizar';

/**
 * La ingesta de compras (F2-126), calcada de la de movimientos (F2-122): un lote de compras de la
 * sucursal de la API key, cada una con TODAS sus partidas. Aquí sólo se valida, se compara y se
 * guarda en Postgres propio; nada se escribe a SoftRestaurant.
 *
 * Idempotencia: reenviar el mismo lote deja la base EXACTAMENTE igual (ids, `updated_at`,
 * `leida_at` y `recibida_at` incluidos). Una compra cuya versión guardada se leyó después de
 * este lote no se toca (`obsoletas`), así un lote viejo reintentado no revierte una corrección.
 *
 * Errores: una compra inválida se rechaza sola (`rechazadas`). Una falla transitoria de la base
 * o el candado ocupado → 503 (reintentar). Una falla determinista → 500 con "no reintentar
 * igual". El log nunca lleva el contenido del lote.
 */
@Injectable()
export class ComprasIngestaService {
  private readonly log = new Logger(ComprasIngestaService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async recibir(agente: AgenteAutenticado, lote: LoteComprasDto): Promise<ResultadoComprasDto> {
    await this.registrarContacto(agente);
    const ahora = new Date(this.reloj.ahora());
    const leidoAt = fechaUtc(lote.leidoAt);
    if (Number.isNaN(leidoAt.getTime())) {
      throw new BadRequestException('leidoAt no es una fecha válida.');
    }
    if (leidoAt.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
      throw new BadRequestException(
        'leidoAt está más de 5 minutos en el futuro respecto al reloj del API: revisar el reloj ' +
          'de la máquina del agente.',
      );
    }
    // El tope es del SOBRE: un lote que no cabe no escribe nada (el lector lo parte).
    if (partidasDeCompras(lote.compras) > MAX_PARTIDAS_COMPRAS_LOTE) {
      throw new BadRequestException(
        `El lote trae más de ${MAX_PARTIDAS_COMPRAS_LOTE} partidas en total: partirlo en lotes más chicos.`,
      );
    }
    const { validas, rechazos } = await normalizarLoteCompras(lote.compras, ahora.getTime());
    const r: ResultadoComprasDto = {
      recibidas: lote.compras.length,
      creadas: 0,
      actualizadas: 0,
      sinCambios: 0,
      obsoletas: 0,
      rechazadas: rechazos,
    };
    if (validas.length === 0) return r;

    try {
      return await this.datos.comprasDeSucursal(agente).bajoCandado(async (tx) => {
        const guardadas = new Map(
          (await tx.guardadas(validas.map((c) => c.origenSrId))).map((g) => [g.origenSrId, g]),
        );
        for (const c of validas) {
          const d = decidirCompra(guardadas.get(c.origenSrId), c, leidoAt);
          switch (d.accion) {
            case 'crear':
              await tx.crear(d.c, leidoAt, ahora);
              r.creadas++;
              break;
            case 'reemplazar':
              await tx.reemplazar(d.id, d.c, leidoAt, ahora);
              r.actualizadas++;
              break;
            case 'avanzar_lectura':
              await tx.avanzarLectura(d.id, leidoAt);
              r.sinCambios++;
              break;
            case 'sin_cambios':
              r.sinCambios++;
              break;
            case 'obsoleta':
              r.obsoletas++;
              break;
          }
        }
        return r;
      });
    } catch (err) {
      if (err instanceof CandadoComprasOcupado || esTransitorio(err)) {
        this.log.warn(
          `compras de la sucursal ${agente.sucursalId}: falla transitoria (${nombre(err)}).`,
        );
        throw new ServiceUnavailableException(
          'Falla transitoria al guardar las compras; reenviar más tarde.',
        );
      }
      this.log.error(
        `compras de la sucursal ${agente.sucursalId} no se guardaron: ${nombre(err)}.`,
      );
      throw new InternalServerErrorException(
        'Las compras no se pudieron guardar y reenviarlas igual va a fallar igual: no reintentar.',
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
