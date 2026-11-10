import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CatalogoSr } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { Reloj } from '../comun/reloj';
import {
  CandadoCatalogoOcupado,
  CierreIncompleto,
  type TransaccionCatalogo,
} from '../scope/escritura-catalogos';
import type { TransaccionFormasPago } from '../scope/escritura-formas-pago';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { decidir, normalizarPagina, solicitudPendiente } from './catalogos';
import {
  CATALOGO_FORMAS_PAGO,
  TOLERANCIA_FUTURO_MS,
  type CierreCatalogoDto,
  type PaginaCatalogoDto,
  type ResultadoCierreDto,
  type ResultadoPaginaDto,
  type SolicitudAgenteDto,
} from './dto/catalogos.dto';
import { planearFormasPago, validarFormasPago } from './formas-pago';
import { esTransitorio } from './ingesta.service';
import { fechaUtc } from './normalizar';

/**
 * La ingesta de catálogos (F2-230). Lo que llega es la traducción que hace el agente de lo
 * que lee en SoftRestaurant; aquí sólo se valida, se compara y se guarda en Postgres propio.
 *
 * Idempotencia: reenviar la misma página (o el mismo cierre) deja la base EXACTAMENTE igual,
 * ids, `updated_at` y `visto_at` incluidos. Ver las reglas en `catalogos.ts#decidir` y en
 * `TransaccionCatalogo`.
 *
 * Errores: un registro inválido se rechaza solo (`rechazados`). Una falla transitoria de la
 * base o el candado ocupado → 503 (reintentar). Una falla determinista → 500 con
 * "no reintentar igual". El log nunca lleva el contenido de los registros: los clientes
 * traen datos personales.
 */
@Injectable()
export class CatalogosIngestaService {
  private readonly log = new Logger(CatalogosIngestaService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async pagina(agente: AgenteAutenticado, p: PaginaCatalogoDto): Promise<ResultadoPaginaDto> {
    await this.registrarContacto(agente);
    const ahora = new Date(this.reloj.ahora());
    const capturadoAt = this.capturado(p.capturadoAt, ahora);
    if (p.catalogo === CATALOGO_FORMAS_PAGO) {
      return this.paginaFormasPago(agente, p.registros, ahora);
    }
    const catalogo = p.catalogo;
    const { validos, rechazos } = await normalizarPagina(catalogo, p.registros);
    const origenes = [
      ...validos.map((r) => r.origenSrId),
      ...rechazos.flatMap((r) => (r.origenSrId === null ? [] : [r.origenSrId])),
    ];
    const base = { catalogo, recibidos: p.registros.length, rechazados: rechazos };

    return this.escribir(agente, catalogo, 'página', async (tx) => {
      const estado = await tx.estado();
      if (estado && capturadoAt < estado.ultimaCompletaAt) {
        // Una sincronización completa más nueva ya cerró: nada de esta página se aplica.
        return {
          ...base,
          creados: 0,
          actualizados: 0,
          sinCambios: 0,
          obsoletos: validos.length,
          vistos: 0,
          rechazadosSinFila: rechazos.length,
        };
      }
      const existentes = await tx.existentes([...new Set(origenes)]);
      const plan = decidir({
        existentes,
        validos,
        rechazos,
        capturadoAt,
        sincronizacionId: p.sincronizacionId,
      });
      await tx.aplicar(plan, capturadoAt, p.sincronizacionId, ahora);
      return {
        ...base,
        creados: plan.crear.length,
        actualizados: plan.actualizar.length,
        sinCambios: plan.sinCambios,
        obsoletos: plan.obsoletos,
        vistos: plan.vistos,
        rechazadosSinFila: plan.rechazadosSinFila,
      };
    });
  }

  async cierre(agente: AgenteAutenticado, c: CierreCatalogoDto): Promise<ResultadoCierreDto> {
    await this.registrarContacto(agente);
    if (c.rechazados > c.total) {
      throw new BadRequestException('rechazados no puede ser mayor que total.');
    }
    const ahora = new Date(this.reloj.ahora());
    const capturadoAt = this.capturado(c.capturadoAt, ahora);
    if (c.catalogo === CATALOGO_FORMAS_PAGO) {
      return this.cierreFormasPago(agente);
    }
    const catalogo = c.catalogo;

    return this.escribir(agente, catalogo, 'cierre', async (tx) => {
      const estado = await tx.estado();
      if (estado && capturadoAt < estado.ultimaCompletaAt) {
        return { aplicado: false, desactivados: 0, activos: await tx.contarActivos() };
      }
      if (estado && estado.sincronizacionId === c.sincronizacionId) {
        // Reenvío del último cierre aplicado: no se escribe nada.
        return {
          aplicado: true,
          desactivados: estado.desactivados,
          activos: await tx.contarActivos(),
        };
      }
      const vistos = await tx.contarDeSincronizacion(c.sincronizacionId);
      if (vistos + c.rechazados < c.total) {
        throw new CierreIncompleto(vistos, c.rechazados, c.total);
      }
      // DECISION PROVISIONAL (nocturno): `total = 0` (el POS no tiene ese catálogo, p. ej.
      // sin clientes) da de baja todo lo que había. Es reversible con la siguiente
      // sincronización; el riesgo es un agente que se "trague" un error y lea cero
      // (docs/esquema-sr.md §13).
      const desactivados = await tx.desactivarNoVistas(c.sincronizacionId, capturadoAt, ahora);
      await tx.guardarEstado({
        sincronizacionId: c.sincronizacionId,
        ultimaCompletaAt: capturadoAt,
        total: c.total,
        rechazados: c.rechazados,
        desactivados,
        recibidaAt: ahora,
      });
      return { aplicado: true, desactivados, activos: await tx.contarActivos() };
    });
  }

  async solicitud(agente: AgenteAutenticado): Promise<SolicitudAgenteDto> {
    await this.registrarContacto(agente);
    const { solicitadaAt, recibidas } = await this.datos.catalogosDeSucursal(agente).solicitud();
    return {
      solicitadaAt: solicitadaAt?.toISOString() ?? null,
      pendiente: solicitudPendiente(solicitadaAt, recibidas),
    };
  }

  /**
   * Una página del catálogo `formas_pago` (PAG-01): llena `formas_pago_catalogo` de la EMPRESA
   * con el `tipo` de SR. Reglas en `formas-pago.ts#planearFormasPago`; las filas `manual` no se
   * tocan nunca. Idempotente: la misma página tres veces deja la base igual (ni `updatedAt` se
   * mueve). No lleva `vistoAt` ni sincronización: nada se da de baja por no venir.
   */
  private async paginaFormasPago(
    agente: AgenteAutenticado,
    registros: Record<string, unknown>[],
    ahora: Date,
  ): Promise<ResultadoPaginaDto> {
    const validacion = await validarFormasPago(registros);
    if (!validacion.ok) {
      throw new BadRequestException(
        `${validacion.motivo}. El tipo de una forma de pago es un entero 1-4 o nulo.`,
      );
    }
    const { validos, rechazos } = validacion;
    const plan = await this.escribirFormasPago(agente, async (tx) => {
      const p = planearFormasPago(
        validos,
        await tx.existentes([...new Set(validos.map((v) => v.nombre))]),
        agente.sucursalId,
      );
      await tx.aplicar(p, ahora);
      return p;
    });
    for (const c of plan.conflictos) {
      // El texto de una forma de pago de SR no es dato personal ("VISA"): se puede loguear.
      this.log.warn(
        `formas_pago de la sucursal ${agente.sucursalId}: «${c.formaRaw}» no se clasificó ` +
          (c.motivo === 'otra_sucursal'
            ? `porque otra sucursal de la empresa ya lo dio de alta como ${c.actual} y este POS dice ${c.pedidas.join(', ')}.`
            : `porque este POS lo trae varias veces con tipos distintos (${c.pedidas.join(', ')}).`) +
          ' Se deja como está; para decidirlo, dar de alta la fila como manual.',
      );
    }
    return {
      catalogo: CATALOGO_FORMAS_PAGO,
      recibidos: registros.length,
      creados: plan.crear.length,
      actualizados: plan.actualizar.length,
      sinCambios: plan.sinCambios,
      obsoletos: 0,
      vistos: 0,
      rechazadosSinFila: rechazos.length,
      rechazados: rechazos,
      manuales: plan.manuales,
      conflictos: plan.conflictos.length,
      sinTipo: plan.sinTipo,
    };
  }

  /**
   * El cierre de `formas_pago` (PAG-01) no da de baja nada: el catálogo es de la EMPRESA (otra
   * sucursal puede seguir usando el texto) y quitar una fila reclasificaría el histórico a `otro`.
   * Sólo cuadra el sobre (`rechazados` <= `total`, ya revisado) y responde cuántas filas tiene el
   * catálogo de la empresa. Idempotente: no escribe.
   */
  private async cierreFormasPago(agente: AgenteAutenticado): Promise<ResultadoCierreDto> {
    const activos = await this.escribirFormasPago(agente, (tx) => tx.contar());
    return { aplicado: true, desactivados: 0, activos };
  }

  private async escribirFormasPago<T>(
    agente: AgenteAutenticado,
    fn: (tx: TransaccionFormasPago) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.datos.formasPagoDeAgente(agente).bajoCandado(fn);
    } catch (err) {
      if (err instanceof CandadoCatalogoOcupado || esTransitorio(err)) {
        this.log.warn(
          `formas_pago de la sucursal ${agente.sucursalId}: falla transitoria (${nombre(err)}).`,
        );
        throw new ServiceUnavailableException(
          'Falla transitoria al guardar el catálogo; reenviar más tarde.',
        );
      }
      this.log.error(
        `formas_pago de la sucursal ${agente.sucursalId} no se guardó: ${nombre(err)}.`,
      );
      throw new InternalServerErrorException(
        'El catálogo no se pudo guardar y reenviarlo igual va a fallar igual: no reintentar.',
      );
    }
  }

  /** `capturadoAt` a UTC; más de 5 min en el futuro = 400 (un reloj adelantado congelaría `visto_at`). */
  private capturado(iso: string, ahora: Date): Date {
    const t = fechaUtc(iso);
    if (t.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
      throw new BadRequestException(
        'capturadoAt está más de 5 minutos en el futuro respecto al reloj del API: revisar el ' +
          'reloj de la máquina del agente.',
      );
    }
    return t;
  }

  private async escribir<T>(
    agente: AgenteAutenticado,
    catalogo: CatalogoSr,
    que: string,
    fn: (tx: TransaccionCatalogo) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.datos.catalogosDeSucursal(agente).bajoCandado(catalogo, fn);
    } catch (err) {
      if (err instanceof CierreIncompleto) {
        throw new ConflictException(err.message);
      }
      if (err instanceof CandadoCatalogoOcupado || esTransitorio(err)) {
        this.log.warn(
          `${que} de ${catalogo} de la sucursal ${agente.sucursalId}: falla transitoria (${nombre(err)}).`,
        );
        throw new ServiceUnavailableException(
          'Falla transitoria al guardar el catálogo; reenviar más tarde.',
        );
      }
      // Sin el mensaje de Prisma: puede citar valores de la fila (datos personales).
      this.log.error(
        `${que} de ${catalogo} de la sucursal ${agente.sucursalId} no se guardó: ${nombre(err)}.`,
      );
      throw new InternalServerErrorException(
        'El catálogo no se pudo guardar y reenviarlo igual va a fallar igual: no reintentar.',
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
