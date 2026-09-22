import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { Reloj } from '../comun/reloj';
import { CandadoRecetasOcupado } from '../scope/escritura-recetas';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { TOLERANCIA_FUTURO_MS } from './dto/catalogos.dto';
import {
  MAX_RENGLONES_LOTE,
  type LoteRecetasDto,
  type ResultadoRecetasDto,
} from './dto/recetas.dto';
import { esTransitorio } from './ingesta.service';
import { fechaUtc } from './normalizar';
import { decidirReceta, normalizarLoteRecetas, renglonesDelLote } from './recetas';

/**
 * La ingesta de recetas (F2-125): un lote de recetas de la sucursal de la API key, cada una con
 * TODOS sus renglones. Aquí sólo se valida, se compara y se guarda en Postgres propio.
 *
 * Idempotencia: reenviar el mismo lote (también con los renglones en otro orden) deja la base
 * EXACTAMENTE igual (ids, `updated_at`, `leida_at` y `recibida_at` incluidos). Una receta cuya
 * versión guardada se leyó después de este lote no se toca (`obsoletas`).
 *
 * Errores: una receta inválida se rechaza sola (`rechazadas`). Una falla transitoria de la base o
 * el candado ocupado → 503 (reintentar). Una falla determinista → 500 con "no reintentar igual".
 * El log nunca lleva el contenido del lote.
 */
@Injectable()
export class RecetasIngestaService {
  private readonly log = new Logger(RecetasIngestaService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async recibir(agente: AgenteAutenticado, lote: LoteRecetasDto): Promise<ResultadoRecetasDto> {
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
    if (renglonesDelLote(lote.recetas) > MAX_RENGLONES_LOTE) {
      throw new BadRequestException(
        `El lote trae más de ${MAX_RENGLONES_LOTE} renglones en total: partirlo en lotes más chicos.`,
      );
    }
    const { validas, rechazos } = await normalizarLoteRecetas(lote.recetas);
    const r: ResultadoRecetasDto = {
      recibidas: lote.recetas.length,
      creadas: 0,
      actualizadas: 0,
      sinCambios: 0,
      obsoletas: 0,
      rechazadas: rechazos,
    };
    if (validas.length === 0) return r;

    try {
      return await this.datos.recetasDeSucursal(agente).bajoCandado(async (tx) => {
        const guardadas = new Map(
          (await tx.guardadas(validas.map((x) => x.productoOrigenSrId))).map((g) => [
            g.productoOrigenSrId,
            g,
          ]),
        );
        for (const receta of validas) {
          const d = decidirReceta(guardadas.get(receta.productoOrigenSrId), receta, leidoAt);
          switch (d.accion) {
            case 'crear':
              await tx.crear(d.r, leidoAt, ahora);
              r.creadas++;
              break;
            case 'reemplazar':
              await tx.reemplazar(d.id, d.r, leidoAt, ahora);
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
      if (err instanceof CandadoRecetasOcupado || esTransitorio(err)) {
        this.log.warn(
          `recetas de la sucursal ${agente.sucursalId}: falla transitoria (${nombre(err)}).`,
        );
        throw new ServiceUnavailableException(
          'Falla transitoria al guardar las recetas; reenviar más tarde.',
        );
      }
      this.log.error(
        `recetas de la sucursal ${agente.sucursalId} no se guardaron: ${nombre(err)}.`,
      );
      throw new InternalServerErrorException(
        'Las recetas no se pudieron guardar y reenviarlas igual va a fallar igual: no reintentar.',
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
