import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import {
  ErrorTimbrado,
  type ArchivosPac,
  type CfdiEncontrado,
  type PuertoTimbrado,
} from '../adaptadores/timbrado/puerto';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import type {
  CfdiSinArchivos,
  DatosReceptor,
  ReservaColgada,
  SustitucionPendiente,
} from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { CancelacionCfdiService } from './cancelacion.service';
import { textoErrorPac } from './cancelacion';
import {
  fechaDeConfirmacion,
  LIMITE_POR_TIPO,
  resumenVacio,
  trasBusquedaVacia,
  type ResumenConciliacion,
} from './conciliacion';
import { EntregaCfdiService } from './entrega.service';

/** El receptor guardado en la reserva (JSON), o null si no tiene la forma esperada. */
export function receptorDeJson(valor: Prisma.JsonValue): DatosReceptor | null {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const r = valor as Record<string, unknown>;
  const texto = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null);
  const [rfc, razonSocial, regimenFiscal, cp, usoCfdi] = [
    texto('rfc'),
    texto('razonSocial'),
    texto('regimenFiscal'),
    texto('cp'),
    texto('usoCfdi'),
  ];
  if (!rfc || !razonSocial || !regimenFiscal || !cp || !usoCfdi) return null;
  return { rfc, razonSocial, regimenFiscal, cp, usoCfdi, email: texto('email') };
}

/**
 * Conciliación con el PAC (F2-110b): resuelve lo que la emisión o la cancelación dejaron SIN SABER.
 * Una vuelta revisa, en este orden, cada tipo con su límite:
 * 1. Reservas colgadas en `timbrando` (los cuatro orígenes): si el PAC la tiene, se CONFIRMA
 *    (`confirmarCfdi`: ticket `facturado`, global `en_global`, el sustituto se lleva el código) y se
 *    ENTREGA (archivos y el correo que nunca salió). Si no la tiene, la primera búsqueda vacía sólo
 *    se anota; la segunda, pasados 15 min, LIBERA (ticket de nuevo facturable; la global suelta sus
 *    tickets por CASCADE).
 * 2. Cancelaciones `sin_confirmar` (`CancelacionCfdiService.revisarSinConfirmar`).
 * 3. Refacturaciones con la 01 pendiente: `CancelacionCfdiService.solicitar`, que CONSULTA primero
 *    (si el PAC ya la canceló, sólo la anota) y si sigue vigente pide la 01.
 * 4. CFDI vigentes sin archivos: se descargan del PAC y se guardan (`entregar`).
 *
 * Cada elemento se RECLAMA en base antes de tocar el PAC (`reclamarConciliacion`): dos vueltas a la
 * vez no lo procesan dos veces. El PAC nunca corre dentro de una transacción. Nada de un elemento
 * hace fallar la vuelta: un error del PAC deja el elemento para la siguiente.
 *
 * El scope es el de quien la pide: el programador con el de sistema; el botón del tablero con el del
 * usuario (un admin_empresa sólo concilia lo de su empresa).
 */
@Injectable()
export class ConciliacionPacService {
  readonly #log = new Logger(ConciliacionPacService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_TIMBRADO) private readonly pac: PuertoTimbrado,
    private readonly entrega: EntregaCfdiService,
    private readonly cancelacion: CancelacionCfdiService,
  ) {}

  #ahora(): Date {
    return new Date(this.reloj.ahora());
  }

  #escritura(empresaId: string) {
    return this.datos.facturacion({ tipo: 'empresa', empresaId });
  }

  /** El disparo manual desde el tablero: la misma vuelta, con el scope del usuario y auditada. */
  async conciliar(scope: EmpresaScope, actor: Actor): Promise<ResumenConciliacion> {
    const r = await this.vuelta(scope);
    this.auditoria.registrar(actor, {
      accion: 'facturacion.conciliacion',
      recurso: 'conciliacion_pac',
      // Sin un recurso único: la empresa del alcance, o la plataforma entera (admin_global).
      recursoId: scope.tipo === 'empresa' ? scope.empresaId : 'plataforma',
      empresaId: scope.tipo === 'empresa' ? scope.empresaId : null,
      campos: [],
    });
    return r;
  }

  async vuelta(scope: EmpresaScope): Promise<ResumenConciliacion> {
    const resumen = resumenVacio();
    const lectura = this.datos.facturacion(scope);

    for (const r of await lectura.reservasPorConciliar(this.#ahora(), LIMITE_POR_TIPO)) {
      await this.#reserva(r, resumen);
    }
    for (const s of await lectura.solicitudesSinConfirmar(LIMITE_POR_TIPO)) {
      resumen.cancelaciones.revisadas++;
      const r = await this.cancelacion.revisarSinConfirmar(
        { tipo: 'empresa', empresaId: s.empresaId },
        s,
      );
      if (r === 'cancelada') resumen.cancelaciones.canceladas++;
      else if (r === 'descartada') resumen.cancelaciones.descartadas++;
      else if (r === 'fallida') resumen.fallidas++;
    }
    for (const p of await lectura.sustitucionesPendientes(this.#ahora(), LIMITE_POR_TIPO)) {
      await this.#sustitucion(p, resumen);
    }
    for (const c of await lectura.vigentesSinArchivos(this.#ahora(), LIMITE_POR_TIPO)) {
      await this.#archivos(c, resumen);
    }
    return resumen;
  }

  async #reclamar(empresaId: string, cfdiId: string, estado: 'timbrando' | 'vigente') {
    try {
      return await this.#escritura(empresaId).reclamarConciliacion(
        empresaId,
        cfdiId,
        estado,
        this.#ahora(),
      );
    } catch (error) {
      this.#log.warn(`No se pudo reclamar el CFDI ${cfdiId}: ${String(error)}`);
      return false;
    }
  }

  async #reserva(r: ReservaColgada, resumen: ResumenConciliacion): Promise<void> {
    if (!(await this.#reclamar(r.empresaId, r.id, 'timbrando'))) return;
    resumen.reservas.revisadas++;
    const serieFolio = `${r.serie}-${r.folio}`;
    let encontrado: CfdiEncontrado | null;
    try {
      encontrado = await this.pac.buscarPorFolio({
        rfcEmisor: r.rfcEmisor,
        serie: r.serie,
        folio: String(r.folio),
        zonaHoraria: r.zonaHoraria,
      });
    } catch (error) {
      resumen.fallidas++;
      this.#log.warn(
        `Reserva ${r.id} (${serieFolio}): no se pudo buscar en el PAC: ${textoErrorPac(error)}`,
      );
      return;
    }
    const escritura = this.#escritura(r.empresaId);
    try {
      if (encontrado === null) {
        const accion = trasBusquedaVacia(r.busquedaVaciaAt, this.#ahora());
        if (
          accion === 'liberar' &&
          (await escritura.liberarReservaSinTimbre(r.empresaId, r.id, this.#ahora()))
        ) {
          resumen.reservas.liberadas++;
          this.#log.warn(
            `Reserva ${r.id} (${serieFolio}, ${r.origen}) LIBERADA: el PAC no la tiene en dos ` +
              'búsquedas separadas. Su folio queda como hueco.',
          );
          return;
        }
        if (accion === 'anotar')
          await escritura.anotarBusquedaVacia(r.empresaId, r.id, this.#ahora());
        resumen.reservas.enEspera++;
        return;
      }
      await this.#confirmar(r, encontrado, serieFolio, resumen);
    } catch (error) {
      resumen.fallidas++;
      this.#log.error(
        `Reserva ${r.id} (${serieFolio}) sin conciliar: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #confirmar(
    r: ReservaColgada,
    encontrado: CfdiEncontrado,
    serieFolio: string,
    resumen: ResumenConciliacion,
  ): Promise<void> {
    const receptor = receptorDeJson(r.receptor);
    if (receptor === null) {
      throw new Error('el receptor guardado en la reserva no tiene la forma esperada');
    }
    let archivos: ArchivosPac | null = null;
    try {
      archivos = await this.pac.descargarArchivos(encontrado);
    } catch (error) {
      // Se confirma igual (el CFDI existe ante el SAT); el paso 4 recupera los archivos después.
      this.#log.warn(
        `CFDI ${encontrado.uuid}: no se pudieron descargar sus archivos: ${textoErrorPac(error)}`,
      );
    }
    const fechaTimbrado = fechaDeConfirmacion(
      encontrado.fechaTimbrado,
      archivos?.xml ?? null,
      r.zonaHoraria,
      r.reservadaAt,
    );
    try {
      await this.#escritura(r.empresaId).confirmarCfdi(
        r.empresaId,
        r.id,
        { uuid: encontrado.uuid, idPac: encontrado.idPac, fechaTimbrado },
        receptor,
        this.#ahora(),
      );
    } catch (error) {
      // Otra vuelta (o la emisión) la confirmó primero: ya no está en `timbrando`.
      if (error instanceof NotFoundException) return;
      throw error;
    }
    resumen.reservas.confirmadas++;
    this.#log.warn(
      `Reserva ${r.id} (${serieFolio}, ${r.origen}) CONFIRMADA con el UUID ${encontrado.uuid}.`,
    );
    if (encontrado.estado !== 'vigente') {
      resumen.requierenRevision.push(serieFolio);
      this.#log.error(
        `CFDI ${encontrado.uuid} (${serieFolio}) confirmado, pero el PAC ya lo reporta ` +
          `${encontrado.estado}: su cancelación no pasó por aquí. Revisar a mano.`,
      );
    }
    if (archivos) {
      await this.entrega.entregar({
        empresaId: r.empresaId,
        cfdiId: r.id,
        uuid: encontrado.uuid,
        idPac: encontrado.idPac,
        serieFolio,
        total: r.total.toFixed(2),
        fechaTimbrado,
        zonaHoraria: r.zonaHoraria,
        sucursal: r.sucursal,
        colorPortal: r.colorPortal,
        emisor: r.emisor,
        xml: archivos.xml,
        pdf: archivos.pdf,
      });
    }
  }

  async #sustitucion(p: SustitucionPendiente, resumen: ResumenConciliacion): Promise<void> {
    if (!(await this.#reclamar(p.empresaId, p.anteriorId, 'vigente'))) return;
    resumen.sustituciones.revisadas++;
    try {
      // `actor` null: la pide el sistema, no una persona (no se audita como si la hubiera pedido).
      const r = await this.cancelacion.solicitar(
        { tipo: 'empresa', empresaId: p.empresaId },
        null,
        p.anteriorId,
        { motivo: '01', uuidSustitucion: p.uuidSustituto },
      );
      if (r.estado === 'cancelado') resumen.sustituciones.cerradas++;
      this.#log.warn(
        `Refacturación ${p.serieFolio}: la cancelación 01 pendiente quedó ${r.estado}.`,
      );
    } catch (error) {
      resumen.fallidas++;
      this.#log.warn(
        `Refacturación ${p.serieFolio}: la cancelación 01 sigue pendiente: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #archivos(c: CfdiSinArchivos, resumen: ResumenConciliacion): Promise<void> {
    if (!(await this.#reclamar(c.empresaId, c.id, 'vigente'))) return;
    resumen.archivos.revisados++;
    let archivos: ArchivosPac;
    try {
      archivos = await this.pac.descargarArchivos({ uuid: c.uuid, idPac: c.idPac });
    } catch (error) {
      resumen.fallidas++;
      const codigo = error instanceof ErrorTimbrado ? error.codigo : 'ERROR';
      this.#log.warn(
        `CFDI ${c.uuid} (${c.serieFolio}) sin archivos: el PAC no los dio (${codigo}).`,
      );
      return;
    }
    // `entregar` guarda y anota las claves; el correo sólo sale si nunca se reclamó uno.
    const descargas = await this.entrega.entregar({
      empresaId: c.empresaId,
      cfdiId: c.id,
      uuid: c.uuid,
      idPac: c.idPac,
      serieFolio: c.serieFolio,
      total: c.total.toFixed(2),
      fechaTimbrado: c.emitidoAt,
      zonaHoraria: c.zonaHoraria,
      sucursal: c.sucursal,
      colorPortal: c.colorPortal,
      emisor: c.emisor,
      xml: archivos.xml,
      pdf: archivos.pdf,
    });
    if (descargas.xml !== null) resumen.archivos.recuperados++;
    else resumen.fallidas++;
  }
}
