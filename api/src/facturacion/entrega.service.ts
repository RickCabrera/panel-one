import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PUERTO_ARCHIVOS, PUERTO_CORREO } from '../adaptadores/adaptadores.module';
import { ArchivoNoEncontrado, type PuertoArchivos } from '../adaptadores/archivos/puerto';
import type { PuertoCorreo } from '../adaptadores/correo/puerto';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  ENVIO_VENCIDO_MS,
  MAX_ERROR_ENVIO,
  whereEnvioAReintentar,
  type EnvioReclamado,
} from '../scope/escritura-facturacion';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type { EnvioCfdiDto, FiltroEnvio } from './dto/entrega.dto';
import {
  adjuntosCfdi,
  claveArchivoCfdi,
  plantillaFactura,
  textoDeError,
  tipoDeClaveCfdi,
  TTL_DESCARGA_PORTAL_S,
  type DatosCorreoFactura,
  type ExtensionCfdi,
} from './entrega';

/** Lo que la emisión (F2-104) sabe de un CFDI recién confirmado: todo sale de la base y del PAC. */
export interface CfdiParaEntregar {
  empresaId: string;
  cfdiId: string;
  uuid: string;
  idPac: string;
  serieFolio: string;
  /** Dinero como texto con 2 decimales. */
  total: string;
  fechaTimbrado: Date;
  zonaHoraria: string;
  sucursal: string;
  colorPortal: string | null;
  emisor: string;
  /** Lo que devolvió el PAC, en memoria. */
  xml: string;
  pdf: Buffer;
}

export const MENSAJE_REENVIO_CANCELADA =
  'Esta factura está cancelada ante el SAT: no se vuelve a enviar al receptor.';
export const MENSAJE_SIN_ARCHIVOS =
  'Esta factura no tiene sus archivos guardados, así que no se puede reenviar desde aquí. ' +
  'Recupérala del PAC con su folio fiscal.';

const NO_ENCONTRADO = 'Archivo no encontrado.';

/**
 * La entrega de un CFDI (F2-105): guarda el XML y el PDF por `PUERTO_ARCHIVOS`, da los enlaces
 * firmados del portal, y manda el correo por `PUERTO_CORREO` con su bitácora (`cfdi_envios`).
 *
 * `entregar` NUNCA lanza: corre después de confirmar el CFDI, que ya existe ante el SAT. Si el disco
 * falla, el portal no da enlaces pero el correo sale igual (con los archivos en memoria); si el
 * correo falla, el envío queda `fallido` para reintento y el portal sigue dando los enlaces.
 */
@Injectable()
export class EntregaCfdiService {
  readonly #log = new Logger(EntregaCfdiService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_ARCHIVOS) private readonly archivos: PuertoArchivos,
    @Inject(PUERTO_CORREO) private readonly correo: PuertoCorreo,
  ) {}

  #escritura(empresaId: string) {
    return this.datos.facturacion({ tipo: 'empresa', empresaId });
  }

  #ahora(): Date {
    return new Date(this.reloj.ahora());
  }

  /** Después de timbrar: archivos, enlaces y correo. Devuelve los enlaces (o nulos). */
  async entregar(c: CfdiParaEntregar): Promise<{ xml: string | null; pdf: string | null }> {
    const xml = Buffer.from(c.xml, 'utf8');
    const guardados = await this.#guardar(c, xml);
    let descargas: { xml: string | null; pdf: string | null } = { xml: null, pdf: null };
    if (guardados) {
      try {
        descargas = {
          xml: await this.archivos.urlFirmada(guardados.xmlClave, TTL_DESCARGA_PORTAL_S),
          pdf: await this.archivos.urlFirmada(guardados.pdfClave, TTL_DESCARGA_PORTAL_S),
        };
      } catch (error) {
        this.#log.error(`No se pudieron firmar los enlaces del CFDI ${c.uuid}: ${String(error)}`);
      }
    }

    const correo = await this.#enviarPrimero(c, xml);
    if (!guardados && correo !== 'enviado') {
      this.#log.error(
        `CFDI ${c.uuid} (idPac ${c.idPac}) SIN archivos guardados y SIN correo: hay que ` +
          'recuperarlo del PAC.',
      );
    }
    return descargas;
  }

  async #guardar(
    c: CfdiParaEntregar,
    xml: Buffer,
  ): Promise<{ xmlClave: string; pdfClave: string } | null> {
    const clave = (ext: ExtensionCfdi) =>
      claveArchivoCfdi(c.empresaId, c.uuid, c.fechaTimbrado, c.zonaHoraria, ext);
    try {
      // Dentro del try: una zona horaria inválida en la base tampoco puede tumbar la emisión.
      const claves = { xmlClave: clave('xml'), pdfClave: clave('pdf') };
      await this.archivos.guardar(claves.xmlClave, xml, 'application/xml');
      await this.archivos.guardar(claves.pdfClave, c.pdf, 'application/pdf');
      await this.#escritura(c.empresaId).registrarArchivosCfdi(
        c.empresaId,
        c.cfdiId,
        claves,
        this.#ahora(),
      );
      return claves;
    } catch (error) {
      this.#log.error(`No se guardaron los archivos del CFDI ${c.uuid}: ${String(error)}`);
      return null;
    }
  }

  /** El primer envío. Devuelve cómo quedó; nunca lanza. */
  async #enviarPrimero(
    c: CfdiParaEntregar,
    xml: Buffer,
  ): Promise<'enviado' | 'fallido' | 'sin_envio'> {
    let reclamado: EnvioReclamado | null;
    try {
      reclamado = await this.#escritura(c.empresaId).reclamarEnvioCfdi(
        c.empresaId,
        c.cfdiId,
        this.#ahora(),
      );
    } catch (error) {
      this.#log.error(`No se pudo registrar el envío del CFDI ${c.uuid}: ${String(error)}`);
      return 'fallido';
    }
    if (!reclamado) return 'sin_envio';
    return this.#enviar(c.empresaId, reclamado, datosCorreo(c), xml, c.pdf);
  }

  /** Manda el correo de un envío ya reclamado y lo cierra. Nunca lanza. */
  async #enviar(
    empresaId: string,
    envio: EnvioReclamado,
    datos: DatosCorreoFactura,
    xml: Buffer,
    pdf: Buffer,
  ): Promise<'enviado' | 'fallido'> {
    const escritura = this.#escritura(empresaId);
    let resultado: { ok: true; correoId: string } | { ok: false; error: string };
    try {
      const { id } = await this.correo.enviar(
        { email: envio.email },
        plantillaFactura(datos),
        adjuntosCfdi(datos.serieFolio, xml, pdf),
        { empresaId },
      );
      resultado = { ok: true, correoId: id };
    } catch (error) {
      resultado = { ok: false, error: textoDeError(error, MAX_ERROR_ENVIO) };
      this.#log.warn(`Falló el envío ${envio.envioId} (intento ${envio.intentos}).`);
    }
    try {
      await escritura.cerrarEnvioCfdi(empresaId, envio.envioId, resultado, this.#ahora());
    } catch (error) {
      // Se queda en `enviando`: pasados `ENVIO_VENCIDO_MS` se puede reintentar a mano.
      this.#log.error(`No se pudo cerrar el envío ${envio.envioId}: ${String(error)}`);
    }
    return resultado.ok ? 'enviado' : 'fallido';
  }

  // -------------------------------------------------------------------------
  // Administración y descargas
  // -------------------------------------------------------------------------

  /** El CFDI con scope, o 404 (de otra empresa o inexistente: el mismo). */
  async #cfdi(scope: EmpresaScope, cfdiId: string) {
    return encontradoOr404(
      await this.datos.para(scope).cfdi.findFirst({
        where: { id: cfdiId, estado: { not: 'timbrando' } },
        select: {
          id: true,
          empresaId: true,
          uuid: true,
          serie: true,
          folio: true,
          total: true,
          xmlClave: true,
          pdfClave: true,
          estado: true,
          perfil: { select: { razonSocial: true } },
          sucursal: {
            select: { nombre: true, portalFacturacion: { select: { color: true } } },
          },
        },
      }),
    );
  }

  /** El XML o el PDF de un CFDI del alcance. 404 si es de otra empresa o no tiene el archivo. */
  async descargar(
    scope: EmpresaScope,
    cfdiId: string,
    extension: ExtensionCfdi,
  ): Promise<{ contenido: Buffer; tipo: string; nombre: string }> {
    const cfdi = await this.#cfdi(scope, cfdiId);
    const clave = extension === 'xml' ? cfdi.xmlClave : cfdi.pdfClave;
    const tipo = clave ? tipoDeClaveCfdi(clave) : null;
    if (!clave || !tipo) throw new NotFoundException(NO_ENCONTRADO);
    return {
      contenido: await this.#leer(clave),
      tipo,
      nombre: `${cfdi.serie}-${cfdi.folio}.${extension}`,
    };
  }

  /**
   * La descarga pública por enlace firmado (portal). Clave fuera de `cfdi/`, que no es XML/PDF,
   * firma alterada o vencida, o archivo inexistente: el MISMO 404.
   */
  async descargaPublica(
    clave: string,
    expira: number,
    firma: string,
  ): Promise<{ contenido: Buffer; tipo: string; nombre: string }> {
    const tipo = tipoDeClaveCfdi(clave);
    if (!tipo || !this.archivos.verificarUrl(clave, expira, firma)) {
      throw new NotFoundException(NO_ENCONTRADO);
    }
    return {
      contenido: await this.#leer(clave),
      tipo,
      nombre: clave.slice(clave.lastIndexOf('/') + 1),
    };
  }

  async #leer(clave: string): Promise<Buffer> {
    try {
      return await this.archivos.leer(clave);
    } catch (error) {
      if (error instanceof ArchivoNoEncontrado) throw new NotFoundException(NO_ENCONTRADO);
      throw error;
    }
  }

  /** Los envíos de una empresa que hay que reintentar (fallidos y/o atorados). */
  async envios(
    scope: EmpresaScope,
    empresaId: string,
    filtro?: FiltroEnvio,
  ): Promise<EnvioCfdiDto[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const ahora = this.#ahora();
    const limite = new Date(ahora.getTime() - ENVIO_VENCIDO_MS);
    const where =
      filtro === 'fallido'
        ? { estado: 'fallido' as const }
        : filtro === 'atorado'
          ? { estado: 'enviando' as const, ultimoIntentoAt: { lt: limite } }
          : whereEnvioAReintentar(ahora);
    const filas = await datos.cfdiEnvio.findMany({
      where: { empresaId, ...where },
      orderBy: [{ ultimoIntentoAt: 'desc' }, { id: 'asc' }],
      take: 500,
      select: {
        cfdiId: true,
        email: true,
        estado: true,
        intentos: true,
        error: true,
        ultimoIntentoAt: true,
        cfdi: { select: { uuid: true, serie: true, folio: true } },
      },
    });
    return filas.map((f) => ({
      cfdiId: f.cfdiId,
      uuid: f.cfdi.uuid ?? '',
      serieFolio: `${f.cfdi.serie}-${f.cfdi.folio}`,
      email: f.email,
      estado: f.estado,
      requiereReintento:
        f.estado === 'fallido' || (f.estado === 'enviando' && f.ultimoIntentoAt < limite),
      intentos: f.intentos,
      error: f.error,
      ultimoIntentoAt: f.ultimoIntentoAt.toISOString(),
    }));
  }

  /**
   * Reintento manual del correo de un CFDI (admins). Orden fijo: scope (404) → archivos guardados
   * (409) → reclamo del envío fallido o atorado (409, y sólo uno gana si hay dos a la vez) → correo
   * al email GUARDADO en el envío → cierre. Responde cómo quedó el envío.
   */
  async reintentar(scope: EmpresaScope, actor: Actor, cfdiId: string): Promise<EnvioCfdiDto> {
    const cfdi = await this.#cfdi(scope, cfdiId);
    // F2-109: una factura cancelada no se vuelve a mandar como si valiera (las descargas del
    // administrador sí siguen: es historial).
    if (cfdi.estado === 'cancelado') throw new ConflictException(MENSAJE_REENVIO_CANCELADA);
    if (!cfdi.xmlClave || !cfdi.pdfClave) throw new ConflictException(MENSAJE_SIN_ARCHIVOS);
    let xml: Buffer;
    let pdf: Buffer;
    try {
      [xml, pdf] = await Promise.all([
        this.archivos.leer(cfdi.xmlClave),
        this.archivos.leer(cfdi.pdfClave),
      ]);
    } catch (error) {
      if (error instanceof ArchivoNoEncontrado) throw new ConflictException(MENSAJE_SIN_ARCHIVOS);
      throw error;
    }
    const envio = await this.datos
      .facturacion(scope)
      .reclamarReintentoEnvio(cfdi.empresaId, cfdi.id, this.#ahora());
    const datos: DatosCorreoFactura = {
      sucursal: cfdi.sucursal.nombre,
      color: cfdi.sucursal.portalFacturacion?.color ?? null,
      emisor: cfdi.perfil.razonSocial,
      uuid: cfdi.uuid ?? '',
      serieFolio: `${cfdi.serie}-${cfdi.folio}`,
      total: cfdi.total.toFixed(2),
    };
    await this.#enviar(cfdi.empresaId, envio, datos, xml, pdf);
    this.auditoria.registrar(actor, {
      accion: 'cfdi.reenvio',
      recurso: 'cfdi',
      recursoId: cfdi.id,
      empresaId: cfdi.empresaId,
      campos: [],
    });
    const fila = encontradoOr404(
      await this.datos.para(scope).cfdiEnvio.findFirst({
        where: { id: envio.envioId },
        select: { email: true, estado: true, intentos: true, error: true, ultimoIntentoAt: true },
      }),
    );
    const limite = this.reloj.ahora() - ENVIO_VENCIDO_MS;
    return {
      cfdiId: cfdi.id,
      uuid: datos.uuid,
      serieFolio: datos.serieFolio,
      email: fila.email,
      estado: fila.estado,
      requiereReintento:
        fila.estado === 'fallido' ||
        (fila.estado === 'enviando' && fila.ultimoIntentoAt.getTime() < limite),
      intentos: fila.intentos,
      error: fila.error,
      ultimoIntentoAt: fila.ultimoIntentoAt.toISOString(),
    };
  }
}

function datosCorreo(c: CfdiParaEntregar): DatosCorreoFactura {
  return {
    sucursal: c.sucursal,
    color: c.colorPortal,
    emisor: c.emisor,
    uuid: c.uuid,
    serieFolio: c.serieFolio,
    total: c.total,
  };
}
